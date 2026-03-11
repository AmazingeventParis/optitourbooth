import { prisma } from '../config/database.js';
import { galleryQueue, areQueuesAvailable } from '../config/queue.js';
import { config } from '../config/index.js';

/**
 * Schedule a gallery dispatch for a booking.
 * Prevents duplicate dispatches for the same booking.
 */
export async function scheduleGalleryDispatch(
  bookingId: string,
  dispatchType: 'after_review' | 'after_no_review_24h' | 'fallback_24h' | 'manual',
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

  // Schedule delayed job via BullMQ
  if (areQueuesAvailable() && galleryQueue) {
    const delay = scheduledFor.getTime() - Date.now();
    await galleryQueue.add(
      'send-gallery',
      { dispatchId: dispatch.id, bookingId },
      {
        delay: Math.max(0, delay),
        jobId: `gallery-${dispatch.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 },
      }
    );
    console.log(`[GalleryDispatch] Job scheduled for booking ${bookingId} at ${scheduledFor.toISOString()}`);
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

  if (!booking.galleryUrl) {
    console.warn(`[GalleryDispatch] No gallery URL for booking ${booking.id}`);
    await prisma.galleryDispatch.update({
      where: { id: dispatchId },
      data: { deliveryStatus: 'failed', payloadJson: { error: 'No gallery URL configured' } },
    });
    return;
  }

  // TODO: Integrate with actual email/SMS provider
  // For now, log the send and mark as sent
  console.log(`[GalleryDispatch] Sending gallery to ${booking.customerEmail || booking.customerPhone}`);
  console.log(`[GalleryDispatch] Gallery URL: ${booking.galleryUrl}`);
  console.log(`[GalleryDispatch] Channel: ${dispatch.channel}`);

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
