import { prisma } from '../config/database.js';
import { galleryQueue, areQueuesAvailable } from '../config/queue.js';
import { config } from '../config/index.js';
import { sendGalleryDirectEmail } from './email.service.js';

/**
 * Schedule a gallery dispatch for a booking.
 * Prevents duplicate dispatches for the same booking.
 */
export async function scheduleGalleryDispatch(
  bookingId: string,
  dispatchType: 'after_review' | 'after_no_review_24h' | 'after_no_review_48h' | 'fallback_24h' | 'fallback_after_review_click' | 'manual',
  scheduledFor: Date
): Promise<void> {
  // Check if gallery already sent
  const existingDispatch = await prisma.galleryDispatch.findFirst({
    where: {
      bookingId,
      deliveryStatus: { in: ['sent', 'delivered'] },
    },
  });

  if (existingDispatch) {
    console.log(`[GalleryDispatch] Gallery already sent for booking ${bookingId}, skipping`);
    return;
  }

  // Create dispatch record
  const dispatch = await prisma.galleryDispatch.create({
    data: {
      bookingId,
      dispatchType,
      scheduledFor,
      channel: 'email',
      deliveryStatus: 'pending',
    },
  });

  // Log event
  await prisma.bookingEvent.create({
    data: {
      bookingId,
      eventType: 'gallery_send_scheduled',
      metadataJson: {
        dispatchId: dispatch.id,
        dispatchType,
        scheduledFor: scheduledFor.toISOString(),
      },
    },
  });

  // If immediate (after_review or manual), send now
  if (dispatchType === 'after_review' || dispatchType === 'manual') {
    await sendGallery(dispatch.id);
    return;
  }

  // Schedule delayed job via BullMQ (non-blocking with timeout)
  if (areQueuesAvailable() && galleryQueue) {
    const delay = scheduledFor.getTime() - Date.now();
    const queuePromise = galleryQueue.add(
      'send-gallery',
      { dispatchId: dispatch.id, bookingId },
      {
        delay: Math.max(0, delay),
        jobId: `gallery-${dispatch.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
      }
    );
    // Timeout after 3 seconds - poller will pick it up if queue fails
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Queue timeout')), 3000));
    try {
      await Promise.race([queuePromise, timeoutPromise]);
      console.log(`[GalleryDispatch] Job scheduled for booking ${bookingId} at ${scheduledFor.toISOString()}`);
    } catch (err) {
      console.warn(`[GalleryDispatch] Queue add failed/timed out for dispatch ${dispatch.id}, poller will handle it:`, (err as Error).message);
    }
  } else {
    console.warn(`[GalleryDispatch] Queues unavailable, dispatch ${dispatch.id} will be picked up by poller`);
  }
}

/**
 * Actually send the gallery link to the customer.
 * For now, logs the send (email/SMS integration to be configured).
 */
export async function sendGallery(dispatchId: string): Promise<void> {
  const dispatch = await prisma.galleryDispatch.findUnique({
    where: { id: dispatchId },
    include: {
      booking: true,
    },
  });

  if (!dispatch) {
    console.error(`[GalleryDispatch] Dispatch ${dispatchId} not found`);
    return;
  }

  // Anti-doublon: check if already sent
  if (dispatch.deliveryStatus === 'sent' || dispatch.deliveryStatus === 'delivered') {
    console.log(`[GalleryDispatch] Dispatch ${dispatchId} already sent, skipping`);
    return;
  }

  const { booking } = dispatch;

  // Anti-doublon: check if booking already has gallery sent (e.g. manual send)
  if (booking.status === 'gallery_sent') {
    console.log(`[GalleryDispatch] Booking ${booking.id} already has gallery_sent status, cancelling dispatch`);
    await prisma.galleryDispatch.update({
      where: { id: dispatchId },
      data: { deliveryStatus: 'cancelled' },
    });
    return;
  }

  if (!booking.galleryUrl) {
    console.warn(`[GalleryDispatch] No gallery URL for booking ${booking.id}`);
    await prisma.galleryDispatch.update({
      where: { id: dispatchId },
      data: { deliveryStatus: 'failed', payloadJson: { error: 'No gallery URL configured' } },
    });
    return;
  }

  // Send email if customer has an email address
  if (booking.customerEmail) {
    const brand = (booking.senderBrand === 'SMAKK' ? 'SMAKK' : 'SHOOTNBOX') as 'SHOOTNBOX' | 'SMAKK';
    try {
      await sendGalleryDirectEmail({
        to: booking.customerEmail,
        customerName: booking.customerName,
        galleryUrl: booking.galleryUrl,
        brand,
      });
      console.log(`[GalleryDispatch] Email sent to ${booking.customerEmail} via ${brand}`);
    } catch (err) {
      console.error(`[GalleryDispatch] Email send failed for ${booking.customerEmail}:`, err);
      await prisma.galleryDispatch.update({
        where: { id: dispatchId },
        data: { deliveryStatus: 'failed', payloadJson: { error: (err as Error).message } },
      });
      return;
    }
  } else {
    console.warn(`[GalleryDispatch] No email for booking ${booking.id}, marking as sent (manual follow-up needed)`);
  }

  // Mark as sent
  await prisma.galleryDispatch.update({
    where: { id: dispatchId },
    data: {
      deliveryStatus: 'sent',
      sentAt: new Date(),
      payloadJson: {
        to: booking.customerEmail || booking.customerPhone,
        galleryUrl: booking.galleryUrl,
        customerName: booking.customerName,
      },
    },
  });

  // Update booking status
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: 'gallery_sent' },
  });

  // Log event
  await prisma.bookingEvent.create({
    data: {
      bookingId: booking.id,
      eventType: 'gallery_sent',
      metadataJson: {
        dispatchId,
        channel: dispatch.channel,
        dispatchType: dispatch.dispatchType,
      },
    },
  });
}

/**
 * Cancel pending gallery dispatches for a booking
 * (used when review is matched and gallery sent immediately)
 */
export async function cancelPendingDispatches(bookingId: string): Promise<void> {
  const pendingDispatches = await prisma.galleryDispatch.findMany({
    where: {
      bookingId,
      deliveryStatus: 'pending',
    },
  });

  for (const dispatch of pendingDispatches) {
    await prisma.galleryDispatch.update({
      where: { id: dispatch.id },
      data: { deliveryStatus: 'cancelled' },
    });

    // Try to remove from queue
    if (areQueuesAvailable() && galleryQueue) {
      try {
        const job = await galleryQueue.getJob(`gallery-${dispatch.id}`);
        if (job) await job.remove();
      } catch {
        // Job may have already been processed
      }
    }
  }
}

/**
 * Poll and process overdue gallery dispatches (fallback when BullMQ is unavailable)
 */
export async function processOverdueDispatches(): Promise<void> {
  const overdueDispatches = await prisma.galleryDispatch.findMany({
    where: {
      deliveryStatus: 'pending',
      scheduledFor: { lte: new Date() },
    },
    take: 10,
  });

  for (const dispatch of overdueDispatches) {
    await sendGallery(dispatch.id);
  }

  if (overdueDispatches.length > 0) {
    console.log(`[GalleryDispatch] Processed ${overdueDispatches.length} overdue dispatches`);
  }
}
