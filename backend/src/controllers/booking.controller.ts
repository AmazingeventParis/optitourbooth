import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { config } from '../config/index.js';
import { scheduleGalleryDispatch, cancelPendingDispatches } from '../services/galleryDispatch.service.js';
import { processNewReview } from '../services/reviewMatching.service.js';
import { fetchReview, parsePubSubMessage, isGoogleBusinessConfigured } from '../services/googleBusiness.service.js';
import { isDriveConfigured, listFolderThumbnails, scanAndMatchDriveFolders } from '../services/googleDrive.service.js';
import { syncCrmData, lastSyncResult } from '../services/crmSync.service.js';
import { sendReviewLinkEmail, sendGalleryDirectEmail } from '../services/email.service.js';

// ===========================
// PUBLIC ROUTES (no auth)
// ===========================

/**
 * Hash IP address for privacy
 */
function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + 'optitour-salt').digest('hex').substring(0, 16);
}

/**
 * GET /api/public/bookings/:token
 * Validate token and return booking display data + log landing_view
 */
export const getBookingByToken = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { session_id, brand } = req.query;

  const booking = await prisma.booking.findUnique({
    where: { publicToken: token },
  });

  if (!booking) {
    return apiResponse.notFound(res, 'Page introuvable');
  }

  // Save brand from URL if provided and not yet set
  const urlBrand = brand as string;
  if (urlBrand && ['SHOOTNBOX', 'SMAKK'].includes(urlBrand) && booking.senderBrand !== urlBrand) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { senderBrand: urlBrand },
    });
    booking.senderBrand = urlBrand;
  }

  // Check if already closed/gallery sent
  if (booking.status === 'closed') {
    return apiResponse.success(res, {
      status: 'closed',
      message: 'Cette page n\'est plus disponible.',
    });
  }

  if (booking.status === 'gallery_sent') {
    return apiResponse.success(res, {
      status: 'gallery_sent',
      message: 'Votre galerie vous a déjà été envoyée.',
    });
  }

  // Log landing_view event
  await prisma.bookingEvent.create({
    data: {
      bookingId: booking.id,
      eventType: 'landing_view',
      sessionId: session_id as string || null,
      ipHash: hashIp(req.ip || ''),
      userAgent: req.headers['user-agent'] || null,
      referer: req.headers.referer || null,
    },
  });

  // Update status if first view
  if (booking.status === 'link_sent') {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'page_viewed' },
    });
  }

  // Fetch thumbnails from Drive folder (non-blocking, fail-safe)
  let thumbnails: string[] = [];
  if (booking.galleryUrl) {
    try {
      const result = await listFolderThumbnails(booking.galleryUrl);
      thumbnails = result.thumbnails;
    } catch (err) {
      console.error('[BookingByToken] Failed to fetch thumbnails:', err);
    }
  }

  return apiResponse.success(res, {
    status: booking.status,
    customerName: booking.customerName,
    eventDate: booking.eventDate,
    galleryUrl: booking.galleryUrl,
    senderBrand: booking.senderBrand,
    rating: booking.rating,
    hasGoogleReview: !!booking.googleReviewUrl,
    thumbnails,
  });
});

/**
 * POST /api/public/bookings/:token/actions/rate
 * Handle star rating submission (1-5)
 * - 1-3 stars: return galleryUrl for immediate access
 * - 4-5 stars: return ask_review to prompt Google review
 */
export const handleStarRating = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { rating, session_id, user_agent, referrer } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    return apiResponse.badRequest(res, 'Note entre 1 et 5 requise');
  }

  const booking = await prisma.booking.findUnique({
    where: { publicToken: token },
  });

  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  // Log star_rating event
  await prisma.bookingEvent.create({
    data: {
      bookingId: booking.id,
      eventType: 'star_rating',
      sessionId: session_id || null,
      ipHash: hashIp(req.ip || ''),
      userAgent: user_agent || req.headers['user-agent'] || null,
      referer: referrer || null,
      metadataJson: { rating },
    },
  });

  // Save rating on booking
  const isLowRating = rating <= 3;

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      rating,
      status: isLowRating ? 'rated_low' : 'rated_high',
    },
  });

  if (isLowRating) {
    // Low rating: give immediate access to gallery via dispatch system (prevents duplicates)
    if (booking.customerEmail && booking.galleryUrl) {
      scheduleGalleryDispatch(booking.id, 'after_review', new Date()).catch(err => {
        console.error(`[StarRating] Failed to schedule gallery dispatch:`, err);
      });
    }

    return apiResponse.success(res, {
      action: 'show_gallery',
      galleryUrl: booking.galleryUrl,
    });
  }

  // High rating: ask for Google review
  return apiResponse.success(res, {
    action: 'ask_review',
  });
});

/**
 * POST /api/public/bookings/:token/actions/review-click
 * Handle "Leave a Google review" click
 */
export const handleReviewClick = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { session_id, user_agent, referrer, platform } = req.body;

  const booking = await prisma.booking.findUnique({
    where: { publicToken: token },
  });

  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  const reviewPlatform = platform === 'trustpilot' ? 'trustpilot' : 'google';

  // Log review_click event with platform info
  await prisma.bookingEvent.create({
    data: {
      bookingId: booking.id,
      eventType: 'review_click',
      sessionId: session_id || null,
      ipHash: hashIp(req.ip || ''),
      userAgent: user_agent || req.headers['user-agent'] || null,
      referer: referrer || null,
      metadataJson: { platform: reviewPlatform },
    },
  });

  // Update booking status
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: 'review_clicked' },
  });

  // Schedule fallback gallery dispatch at H+2 (non-blocking)
  const delayHours = config.reviewSystem.galleryDelayHours;
  const scheduledFor = new Date(Date.now() + delayHours * 60 * 60 * 1000);
  scheduleGalleryDispatch(booking.id, 'fallback_after_review_click', scheduledFor).catch(err =>
    console.error(`[ReviewClick] Failed to schedule gallery dispatch:`, err)
  );

  // Start active review polling for Google reviews (every 1 min for 1 hour)
  if (reviewPlatform === 'google') {
    const { startActivePolling } = await import('../services/reviewPolling.service.js');
    startActivePolling();
  }

  // Return the appropriate review URL based on platform
  let reviewUrl: string | null = null;

  if (reviewPlatform === 'trustpilot') {
    reviewUrl = booking.senderBrand === 'SMAKK'
      ? config.trustpilot.reviewUrlSmakk
      : config.trustpilot.reviewUrlShootnbox;
  } else {
    reviewUrl = booking.googleReviewUrl;
    if (!reviewUrl) {
      reviewUrl = booking.senderBrand === 'SMAKK'
        ? config.googleBusiness.reviewUrlSmakk
        : config.googleBusiness.reviewUrlShootnbox;
    }
    if (!reviewUrl) {
      reviewUrl = config.googleBusiness.defaultReviewUrl;
    }
  }

  console.log(`[ReviewClick] platform=${reviewPlatform}, brand=${booking.senderBrand}, reviewUrl=${reviewUrl}`);

  return apiResponse.success(res, {
    redirect_url: reviewUrl || null,
  });
});

/**
 * POST /api/public/bookings/:token/actions/no-review-click
 * Handle "I don't want to leave a review" click
 */
export const handleNoReviewClick = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { session_id, user_agent, referrer } = req.body;

  const booking = await prisma.booking.findUnique({
    where: { publicToken: token },
  });

  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  // Log no_review_click event
  await prisma.bookingEvent.create({
    data: {
      bookingId: booking.id,
      eventType: 'no_review_click',
      sessionId: session_id || null,
      ipHash: hashIp(req.ip || ''),
      userAgent: user_agent || req.headers['user-agent'] || null,
      referer: referrer || null,
    },
  });

  // Update booking status
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: 'no_review_selected' },
  });

  // Schedule gallery dispatch at H+48 for no-review (non-blocking)
  const delayHours = config.reviewSystem.noReviewDelayHours;
  const scheduledFor = new Date(Date.now() + delayHours * 60 * 60 * 1000);
  scheduleGalleryDispatch(booking.id, 'after_no_review_48h', scheduledFor).catch(err =>
    console.error(`[NoReviewClick] Failed to schedule gallery dispatch:`, err)
  );

  return apiResponse.success(res, {
    message: 'C\'est bien noté. Votre galerie vous sera envoyée automatiquement sous 48 heures.',
  });
});

/**
 * POST /api/public/bookings/:token/actions/submit-feedback
 * Save internal feedback from low-rating clients (never published)
 */
export const submitFeedback = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { feedback } = req.body;

  const booking = await prisma.booking.findUnique({
    where: { publicToken: token },
    select: { id: true },
  });

  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  if (feedback && typeof feedback === 'string' && feedback.trim().length > 0) {
    await prisma.booking.update({
      where: { id: booking.id },
      data: { internalFeedback: feedback.trim().substring(0, 2000) },
    });
  }

  return apiResponse.success(res, { saved: true });
});

// ===========================
// INTERNAL ROUTES (Pub/Sub)
// ===========================

/**
 * POST /api/internal/google/pubsub/reviews
 * Handle Google Pub/Sub push notification for new reviews
 */
export const handlePubSubReview = asyncHandler(async (req: Request, res: Response) => {
  const parsed = parsePubSubMessage(req.body);

  if (!parsed) {
    console.warn('[PubSub] Invalid message received');
    return res.status(200).json({ status: 'ignored' }); // ACK to prevent retry
  }

  if (parsed.notificationType !== 'NEW_REVIEW') {
    return res.status(200).json({ status: 'ignored', reason: 'not a new review' });
  }

  console.log(`[PubSub] NEW_REVIEW notification: ${parsed.resourceName}`);

  // Fetch the full review details
  if (isGoogleBusinessConfigured()) {
    const reviewData = await fetchReview(parsed.resourceName);
    if (reviewData) {
      await processNewReview({
        reviewId: (reviewData.reviewId as string) || '',
        reviewName: (reviewData.name as string) || parsed.resourceName,
        reviewerDisplayName: ((reviewData.reviewer as Record<string, unknown>)?.displayName as string) || '',
        isAnonymous: !!((reviewData.reviewer as Record<string, unknown>)?.isAnonymous),
        starRating: (reviewData.starRating as string) || '',
        comment: (reviewData.comment as string) || undefined,
        createTime: (reviewData.createTime as string) || new Date().toISOString(),
        updateTime: (reviewData.updateTime as string) || new Date().toISOString(),
        rawPayload: reviewData as Record<string, string | number | boolean | null>,
      });
    }
  }

  return res.status(200).json({ status: 'processed' });
});

// ===========================
// ADMIN ROUTES (authenticated)
// ===========================

/**
 * GET /api/bookings
 * List all bookings with pagination and filters
 */
export const listBookings = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const status = req.query.status as string;
  const search = req.query.search as string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { customerName: { contains: search, mode: 'insensitive' } },
      { customerEmail: { contains: search, mode: 'insensitive' } },
      { publicToken: { contains: search } },
    ];
  }

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: {
        _count: { select: { events: true, reviewMatches: true, galleryDispatches: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.booking.count({ where }),
  ]);

  return apiResponse.paginated(res, bookings, { page, limit, total });
});

/**
 * POST /api/bookings
 * Create a new booking
 */
export const createBooking = asyncHandler(async (req: Request, res: Response) => {
  const { customerName, customerEmail, customerPhone, eventDate, galleryUrl, googleReviewUrl } = req.body;

  if (!customerName || !eventDate) {
    return apiResponse.badRequest(res, 'Nom du client et date de l\'événement requis');
  }

  // Generate unique public token
  const publicToken = crypto.randomBytes(24).toString('base64url');

  const booking = await prisma.booking.create({
    data: {
      publicToken,
      customerName,
      customerEmail: customerEmail || null,
      customerPhone: customerPhone || null,
      eventDate: new Date(eventDate),
      galleryUrl: galleryUrl || null,
      googleReviewUrl: googleReviewUrl || config.googleBusiness.defaultReviewUrl || null,
      businessAccountId: config.googleBusiness.accountId || null,
      businessLocationId: config.googleBusiness.locationId || null,
      status: 'link_sent',
    },
  });

  const publicUrl = `${config.reviewSystem.publicBaseUrl}/${publicToken}`;

  return apiResponse.created(res, {
    ...booking,
    publicUrl,
  });
});

/**
 * GET /api/bookings/:id
 * Get booking detail with events, matches, dispatches
 */
export const getBookingDetail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      events: { orderBy: { occurredAt: 'desc' } },
      reviewMatches: { orderBy: { matchScore: 'desc' } },
      galleryDispatches: { orderBy: { scheduledFor: 'desc' } },
    },
  });

  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  const publicUrl = `${config.reviewSystem.publicBaseUrl}/${booking.publicToken}`;

  return apiResponse.success(res, { ...booking, publicUrl });
});

/**
 * PUT /api/bookings/:id
 * Update a booking
 */
export const updateBooking = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { customerName, customerEmail, customerPhone, eventDate, galleryUrl, googleReviewUrl, status, senderBrand, rating, numId } = req.body;

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      ...(customerName && { customerName }),
      ...(customerEmail !== undefined && { customerEmail }),
      ...(customerPhone !== undefined && { customerPhone }),
      ...(eventDate && { eventDate: new Date(eventDate) }),
      ...(galleryUrl !== undefined && { galleryUrl }),
      ...(googleReviewUrl !== undefined && { googleReviewUrl }),
      ...(status && { status }),
      ...(senderBrand !== undefined && { senderBrand }),
      ...(rating !== undefined && { rating }),
      ...(numId !== undefined && { numId }),
    },
  });

  return apiResponse.success(res, updated);
});

/**
 * DELETE /api/bookings/:id
 * Delete a booking
 */
export const deleteBooking = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  await prisma.booking.delete({ where: { id } });

  return apiResponse.noContent(res);
});

/**
 * POST /api/bookings/:id/send-gallery
 * Manually trigger gallery send
 */
export const manualSendGallery = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { brand: requestedBrand } = req.body || {};

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  if (!booking.galleryUrl) {
    return apiResponse.badRequest(res, 'Aucune URL de galerie configurée pour cette réservation');
  }

  if (!booking.customerEmail) {
    return apiResponse.badRequest(res, 'Aucun email client configuré pour cette réservation');
  }

  const brand = (requestedBrand === 'SMAKK' || requestedBrand === 'SHOOTNBOX')
    ? requestedBrand
    : (booking.senderBrand === 'SMAKK' ? 'SMAKK' : 'SHOOTNBOX') as 'SHOOTNBOX' | 'SMAKK';

  // Cancel pending dispatches in background — don't block the response
  cancelPendingDispatches(booking.id).catch(err =>
    console.error('[Booking] cancelPendingDispatches error:', err)
  );

  // Mark booking as sent and record dispatch immediately — respond to client without waiting for SMTP
  await prisma.galleryDispatch.create({
    data: {
      booking: { connect: { id } },
      dispatchType: 'manual',
      scheduledFor: new Date(),
      channel: 'email',
      deliveryStatus: 'sent',
      sentAt: new Date(),
      payloadJson: {
        to: booking.customerEmail,
        galleryUrl: booking.galleryUrl,
        customerName: booking.customerName,
      },
    },
  });

  await prisma.booking.update({
    where: { id },
    data: { status: 'gallery_sent' },
  });

  // Respond immediately — SMTP send happens in background to avoid client timeout
  res.json({ success: true, data: { message: `Galerie en cours d'envoi à ${booking.customerEmail} via ${brand}` } });

  // Fire-and-forget email send
  sendGalleryDirectEmail({
    to: booking.customerEmail,
    customerName: booking.customerName,
    galleryUrl: booking.galleryUrl,
    brand,
  }).catch(err => {
    console.error(`[Booking] Erreur envoi galerie à ${booking.customerEmail}:`, err);
  });
  return;
});

/**
 * PATCH /api/bookings/review-matches/:matchId/status
 * Update review match status (validate/reject)
 */
export const updateReviewMatchStatus = asyncHandler(async (req: Request, res: Response) => {
  const { matchId } = req.params;
  const { status } = req.body; // matched | rejected

  if (!['matched', 'rejected'].includes(status)) {
    return apiResponse.badRequest(res, 'Statut invalide. Valeurs acceptées: matched, rejected');
  }

  const match = await prisma.reviewMatch.findUnique({
    where: { id: matchId },
    include: { booking: true },
  });

  if (!match) {
    return apiResponse.notFound(res, 'Match introuvable');
  }

  await prisma.reviewMatch.update({
    where: { id: matchId },
    data: {
      matchStatus: status,
      matchedAt: status === 'matched' ? new Date() : null,
    },
  });

  if (status === 'matched') {
    // Trigger immediate gallery send
    await prisma.booking.update({
      where: { id: match.bookingId },
      data: { status: 'review_matched' },
    });
    await scheduleGalleryDispatch(match.bookingId, 'after_review', new Date());
  }

  return apiResponse.success(res, { message: `Match ${status === 'matched' ? 'validé' : 'rejeté'}` });
});

/**
 * GET /api/bookings/calendar-events
 * List Google Calendar events grouped, with their booking status
 * Returns upcoming and past events
 */
export const listCalendarEvents = asyncHandler(async (_req: Request, res: Response) => {
  // Get all unique Google Calendar events from PendingPoints
  const pendingPoints = await prisma.pendingPoint.findMany({
    where: { source: 'google_calendar' },
    orderBy: { date: 'desc' },
  });

  // Group by Google event ID (externalId without _livraison/_ramassage suffix)
  const eventsMap = new Map<string, {
    googleEventId: string;
    clientName: string;
    startDate: string;
    endDate: string;
    produitNom: string | null;
    adresse: string | null;
    contactNom: string | null;
    contactTelephone: string | null;
    notes: string | null;
  }>();

  for (const pp of pendingPoints) {
    if (!pp.externalId) continue;
    const eventId = pp.externalId.replace(/_livraison$/, '').replace(/_ramassage$/, '');

    const existing = eventsMap.get(eventId);
    if (!existing) {
      eventsMap.set(eventId, {
        googleEventId: eventId,
        clientName: pp.clientName,
        startDate: pp.date.toISOString().substring(0, 10),
        endDate: pp.date.toISOString().substring(0, 10),
        produitNom: pp.produitNom,
        adresse: pp.adresse,
        contactNom: pp.contactNom,
        contactTelephone: pp.contactTelephone,
        notes: pp.notes,
      });
    } else {
      // Update start/end dates
      const dateStr = pp.date.toISOString().substring(0, 10);
      if (pp.type === 'livraison' && dateStr < existing.startDate) {
        existing.startDate = dateStr;
      }
      if (pp.type === 'ramassage' && dateStr > existing.endDate) {
        existing.endDate = dateStr;
      }
      // Fill missing info
      if (!existing.adresse && pp.adresse) existing.adresse = pp.adresse;
      if (!existing.contactNom && pp.contactNom) existing.contactNom = pp.contactNom;
      if (!existing.contactTelephone && pp.contactTelephone) existing.contactTelephone = pp.contactTelephone;
      if (!existing.produitNom && pp.produitNom) existing.produitNom = pp.produitNom;
    }
  }

  // Get all bookings with googleEventId
  const bookings = await prisma.booking.findMany({
    where: { googleEventId: { not: null } },
    include: {
      _count: { select: { events: true, reviewMatches: true, galleryDispatches: true } },
      galleryDispatches: {
        where: { deliveryStatus: 'sent' },
        orderBy: { sentAt: 'desc' },
        take: 1,
        select: { sentAt: true },
      },
    },
  });

  const bookingByEventId = new Map<string, typeof bookings[0]>();
  for (const b of bookings) {
    if (b.googleEventId) bookingByEventId.set(b.googleEventId, b);
  }

  // Also include bookings without a matching PendingPoint (manually created)
  for (const b of bookings) {
    if (b.googleEventId && !eventsMap.has(b.googleEventId)) {
      eventsMap.set(b.googleEventId, {
        googleEventId: b.googleEventId,
        clientName: b.customerName,
        startDate: b.eventDate.toISOString().substring(0, 10),
        endDate: (b.eventEndDate || b.eventDate).toISOString().substring(0, 10),
        produitNom: b.produitNom,
        adresse: null,
        contactNom: null,
        contactTelephone: null,
        notes: null,
      });
    }
  }

  // Build result
  const now = new Date();
  const todayStr = now.toISOString().substring(0, 10);
  const upcoming: unknown[] = [];
  const past: unknown[] = [];

  for (const [eventId, ev] of eventsMap) {
    const booking = bookingByEventId.get(eventId);
    const entry = {
      ...ev,
      booking: booking ? {
        id: booking.id,
        publicToken: booking.publicToken,
        publicUrl: `${config.reviewSystem.publicBaseUrl}/${booking.publicToken}`,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
        companyName: booking.companyName,
        contactName: booking.contactName,
        eventName: booking.eventName,
        crmBrand: booking.crmBrand,
        senderBrand: booking.senderBrand,
        rating: booking.rating,
        galleryUrl: booking.galleryUrl,
        googleReviewUrl: booking.googleReviewUrl,
        status: booking.status,
        emailSentAt: booking.emailSentAt,
        gallerySentAt: booking.galleryDispatches?.[0]?.sentAt || null,
        photosNotUnloaded: booking.photosNotUnloaded,
        photoCount: booking.photoCount ?? null,
        createdAt: booking.createdAt,
        _count: booking._count,
      } : null,
    };

    if (ev.endDate >= todayStr) {
      upcoming.push(entry);
    } else {
      past.push(entry);
    }
  }

  // Sort: upcoming by startDate ASC, past by endDate DESC
  upcoming.sort((a: any, b: any) => a.startDate.localeCompare(b.startDate));
  past.sort((a: any, b: any) => b.endDate.localeCompare(a.endDate));

  return apiResponse.success(res, { upcoming, past });
});

/**
 * POST /api/bookings/from-event
 * Create a booking from a Google Calendar event + optionally send email
 */
export const createBookingFromEvent = asyncHandler(async (req: Request, res: Response) => {
  const { googleEventId, customerName, customerEmail, customerPhone, eventDate, eventEndDate, produitNom, galleryUrl, googleReviewUrl } = req.body;

  if (!googleEventId || !customerName || !eventDate) {
    return apiResponse.badRequest(res, 'googleEventId, customerName et eventDate requis');
  }

  // Check if booking already exists for this event
  const existing = await prisma.booking.findUnique({ where: { googleEventId } });
  if (existing) {
    return apiResponse.badRequest(res, 'Un lien existe déjà pour cet événement');
  }

  const publicToken = crypto.randomBytes(24).toString('base64url');

  const booking = await prisma.booking.create({
    data: {
      publicToken,
      customerName,
      customerEmail: customerEmail || null,
      customerPhone: customerPhone || null,
      eventDate: new Date(eventDate),
      eventEndDate: eventEndDate ? new Date(eventEndDate) : null,
      produitNom: produitNom || null,
      galleryUrl: galleryUrl || null,
      googleEventId,
      googleReviewUrl: googleReviewUrl || config.googleBusiness.defaultReviewUrl || null,
      businessAccountId: config.googleBusiness.accountId || null,
      businessLocationId: config.googleBusiness.locationId || null,
      status: 'link_sent',
    },
  });

  const publicUrl = `${config.reviewSystem.publicBaseUrl}/${publicToken}`;

  return apiResponse.created(res, { ...booking, publicUrl });
});

/**
 * POST /api/bookings/:id/send-link-email
 * Send the review link to the customer by email
 */
export const sendLinkEmail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { email, senderBrand } = req.body;

  if (!email) {
    return apiResponse.badRequest(res, 'Email requis');
  }

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  const publicUrl = `${config.reviewSystem.publicBaseUrl}/${booking.publicToken}`;

  const brand = (senderBrand === 'SMAKK' ? 'SMAKK' : 'SHOOTNBOX') as 'SHOOTNBOX' | 'SMAKK';

  // Send actual email
  try {
    await sendReviewLinkEmail({
      to: email,
      customerName: booking.customerName,
      publicUrl,
      galleryUrl: booking.galleryUrl,
      brand,
    });
  } catch (err) {
    console.error(`[Booking] Erreur envoi email:`, err);
    return apiResponse.serverError(res, `Erreur lors de l'envoi de l'email: ${(err as Error).message}`);
  }

  // Update email + sender brand + mark as sent
  await prisma.booking.update({
    where: { id },
    data: {
      customerEmail: email,
      emailSentAt: new Date(),
      senderBrand: brand,
    },
  });

  return apiResponse.success(res, {
    message: `Lien envoyé à ${email} via ${brand}`,
    publicUrl,
  });
});

/**
 * POST /api/bookings/reset-gallery-urls
 * Reset all galleryUrl fields so next sync recreates Drive folders in monthly subfolders
 */
export const resetGalleryUrls = asyncHandler(async (_req: Request, res: Response) => {
  const result = await prisma.booking.updateMany({
    where: { galleryUrl: { not: null } },
    data: { galleryUrl: null },
  });

  return apiResponse.success(res, {
    message: `${result.count} galleryUrl réinitialisées`,
    count: result.count,
  });
});

/**
 * POST /api/bookings/reset-ratings
 * Reset all booking ratings to null and revert statuses from rated_high/rated_low
 */
export const resetAllRatings = asyncHandler(async (_req: Request, res: Response) => {
  // Reset ratings
  const ratingResult = await prisma.booking.updateMany({
    where: { rating: { not: null } },
    data: { rating: null },
  });

  // Revert statuses that were set by the rating system
  const statusResult = await prisma.booking.updateMany({
    where: { status: { in: ['rated_high', 'rated_low'] } },
    data: { status: 'page_viewed' },
  });

  return apiResponse.success(res, {
    message: `${ratingResult.count} ratings réinitialisés, ${statusResult.count} statuts révertés`,
    ratingsReset: ratingResult.count,
    statusesReverted: statusResult.count,
  });
});

/**
 * POST /api/bookings/scan-drive-folders
 * Manually trigger a Drive folder scan and match
 */
export const triggerDriveScan = asyncHandler(async (_req: Request, res: Response) => {
  // Fire-and-forget: Drive scan can take several minutes (counts photos in all folders)
  scanAndMatchDriveFolders()
    .then(r => console.log(`[Drive Scan] Manual trigger done: matched=${r.matched}, photoCountsUpdated=${r.photoCountsUpdated}`))
    .catch(e => console.error('[Drive Scan] Manual trigger error:', e));
  return apiResponse.success(res, { message: 'Drive scan started in background' });
});

export const triggerCrmSync = asyncHandler(async (req: Request, res: Response) => {
  // ?wait=1 returns the full sync result synchronously (for debugging)
  if (req.query.wait === '1') {
    const result = await syncCrmData();
    return apiResponse.success(res, result);
  }
  // Fire-and-forget: CRM sync can take several minutes
  syncCrmData()
    .then(r => console.log(`[CRM Sync] Manual trigger done: matched=${r.matched}, updated=${r.updated}, errors=${JSON.stringify(r.errors)}`))
    .catch(e => console.error('[CRM Sync] Manual trigger error:', e));
  return apiResponse.success(res, { message: 'CRM sync started in background' });
});

/**
 * POST /api/bookings/dedup-crm
 * Find and delete duplicate CRM bookings (same brand + date ± 2d + matching name).
 * Keeps the most complete booking; merges email/galleryUrl from deleted ones into keeper.
 */
export const dedupCrmBookings = asyncHandler(async (_req: Request, res: Response) => {
  const bookings = await prisma.booking.findMany({
    where: { crmBrand: { not: null } },
    include: {
      _count: { select: { events: true, reviewMatches: true, galleryDispatches: true } },
    },
    orderBy: { eventDate: 'asc' },
  });

  const normalize = (s: string | null | undefined) =>
    (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

  const score = (b: typeof bookings[0]) => {
    let s = 0;
    if (b.customerEmail) s += 4;
    if (b.emailSentAt) s += 3;
    if (b.galleryUrl) s += 3;
    if (b.rating) s += 3;
    if (b._count.events > 0) s += 2;
    if (b._count.reviewMatches > 0) s += 2;
    if (b._count.galleryDispatches > 0) s += 2;
    if (b.crmOrderId) s += 1;
    if (b.numId) s += 1;
    if (b.photoCount && b.photoCount > 0) s += 1;
    if (b.status !== 'link_sent') s += 1;
    return s;
  };

  const processed = new Set<string>();
  const toDelete: string[] = [];
  const merges: string[] = [];

  for (const b of bookings) {
    if (processed.has(b.id)) continue;

    const bDate = b.eventDate.getTime();
    const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
    const bNameA = normalize(b.companyName || b.customerName);
    const bNameB = normalize(b.contactName || b.customerName);

    // Find all bookings that could be duplicates of b
    const group = bookings.filter(other => {
      if (other.id === b.id) return true;
      if (processed.has(other.id)) return false;
      if (other.crmBrand !== b.crmBrand) return false;
      if (Math.abs(other.eventDate.getTime() - bDate) > TWO_DAYS) return false;
      const oNameA = normalize(other.companyName || other.customerName);
      const oNameB = normalize(other.contactName || other.customerName);
      return (
        (bNameA && oNameA && bNameA === oNameA) ||
        (bNameA && oNameB && bNameA === oNameB) ||
        (bNameB && oNameA && bNameB === oNameA)
      );
    });

    group.forEach(g => processed.add(g.id));

    if (group.length < 2) continue;

    // Pick keeper (highest score)
    group.sort((x, y) => score(y) - score(x));
    const keeper = group[0]!;
    const duplicates = group.slice(1);

    // Merge useful data from duplicates into keeper
    const mergeData: Record<string, unknown> = {};
    for (const dup of duplicates) {
      if (!keeper.customerEmail && dup.customerEmail) mergeData.customerEmail = dup.customerEmail;
      if (!keeper.galleryUrl && dup.galleryUrl) mergeData.galleryUrl = dup.galleryUrl;
      if (!keeper.crmOrderId && dup.crmOrderId) mergeData.crmOrderId = dup.crmOrderId;
      if (!keeper.numId && dup.numId) mergeData.numId = dup.numId;
      if (!keeper.photoCount && dup.photoCount) mergeData.photoCount = dup.photoCount;
      if (!keeper.googleReviewUrl && dup.googleReviewUrl) mergeData.googleReviewUrl = dup.googleReviewUrl;
    }

    if (Object.keys(mergeData).length > 0) {
      await prisma.booking.update({ where: { id: keeper.id }, data: mergeData });
      merges.push(`${keeper.customerName} (${keeper.id.slice(0, 8)})`);
    }

    for (const dup of duplicates) {
      await prisma.booking.delete({ where: { id: dup.id } });
      toDelete.push(`${dup.customerName} (${dup.id.slice(0, 8)}) → kept ${keeper.id.slice(0, 8)}`);
    }
  }

  return apiResponse.success(res, {
    deleted: toDelete.length,
    merged: merges.length,
    deletedList: toDelete,
    mergedList: merges,
  });
});

/**
 * GET /api/bookings/crm-status
 * Returns the result of the last completed CRM sync (for debugging).
 */
export const getCrmStatus = asyncHandler(async (_req: Request, res: Response) => {
  return apiResponse.success(res, lastSyncResult ?? { message: 'No sync completed yet since last restart' });
});

/**
 * GET /api/bookings/test-crm-login
 * Quick test: can the server reach ShootNBox CRM and log in? Returns sample orders.
 */
export const testCrmLogin = asyncHandler(async (_req: Request, res: Response) => {
  const email = process.env.CRM_SHOOTNBOX_EMAIL || '';
  const password = process.env.CRM_SHOOTNBOX_PASSWORD || '';
  const base = 'https://shootnbox.fr/manager2';
  try {
    // Step 1: Login
    const loginResp = await fetch(`${base}/d26386b04e.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `event=login&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
      redirect: 'manual',
    });
    const loginText = await loginResp.text();
    const setCookies = loginResp.headers.getSetCookie?.() || [];
    const cookie = setCookies.map((c: string) => c.split(';')[0]).join('; ');

    if (loginText.trim() !== 'done' || !cookie) {
      return apiResponse.success(res, { loginOk: false, loginBody: loginText.trim(), cookie: !!cookie });
    }

    // Step 2: Fetch counts for current + archive orders
    const [curResp, archResp] = await Promise.all([
      fetch(`${base}/orders_ajax.php?status=2`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'draw=1&start=0&length=5',
      }),
      fetch(`${base}/orders_ajax.php?status=2&arch=true`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'draw=1&start=0&length=5',
      }),
    ]);
    const [curData, archData] = await Promise.all([curResp.json() as any, archResp.json() as any]);
    const curTotal = curData.iTotalDisplayRecords || curData.recordsFiltered || 0;
    const archTotal = archData.iTotalDisplayRecords || archData.recordsFiltered || 0;
    const curRows = (curData.aaData || curData.data || []) as any[];

    // Step 3: Fetch readiness sample (to see all available field names)
    const readinessResp = await fetch(`${base}/readiness_ajax.php`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'draw=1&start=0&length=3',
    });
    const readinessData = await readinessResp.json() as any;
    const readinessRows = (readinessData.aaData || readinessData.data || []) as any[];

    return apiResponse.success(res, {
      loginOk: true,
      currentTotal: curTotal,
      archiveTotal: archTotal,
      sampleCurrentRows: curRows.slice(0, 3).map((r: any) => ({
        id: r.id,
        email: r.email ? String(r.email).replace(/<[^>]+>/g, '').trim() : null,
        event_date: r.event_date ? String(r.event_date).replace(/<[^>]+>/g, '').trim() : null,
        customer: r.customer ? String(r.customer).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) : null,
      })),
      // Raw readiness row to discover all available field names
      sampleReadinessRowKeys: readinessRows.length > 0 ? Object.keys(readinessRows[0]) : [],
      sampleReadinessRow: readinessRows[0] || null,
    });
  } catch (e: any) {
    return apiResponse.success(res, { loginOk: false, error: e.message });
  }
});

/**
 * GET /api/bookings/gallery-view
 * Returns all bookings for the /galeries page.
 * Upcoming: only CRM-matched bookings (crmBrand set).
 * Past: all bookings (including calendar-only, for history).
 */
export const listGalleryBookings = asyncHandler(async (_req: Request, res: Response) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const allBookings = await prisma.booking.findMany({
    include: {
      _count: { select: { events: true, reviewMatches: true, galleryDispatches: true } },
      galleryDispatches: {
        where: { deliveryStatus: 'sent' },
        orderBy: { sentAt: 'desc' },
        take: 1,
        select: { sentAt: true },
      },
    },
    orderBy: { eventDate: 'desc' },
  });

  const format = (b: typeof allBookings[0]) => ({
    id: b.id,
    publicToken: b.publicToken,
    publicUrl: `${config.reviewSystem.publicBaseUrl}/${b.publicToken}`,
    customerName: b.customerName,
    customerEmail: b.customerEmail,
    customerPhone: b.customerPhone,
    companyName: b.companyName,
    contactName: b.contactName,
    eventName: b.eventName,
    crmBrand: b.crmBrand,
    senderBrand: b.senderBrand,
    rating: b.rating,
    status: b.status,
    galleryUrl: b.galleryUrl,
    googleReviewUrl: b.googleReviewUrl,
    emailSentAt: b.emailSentAt,
    gallerySentAt: b.galleryDispatches?.[0]?.sentAt || null,
    photosNotUnloaded: b.photosNotUnloaded,
    photoCount: b.photoCount ?? null,
    produitNom: b.produitNom,
    eventDate: b.eventDate.toISOString().substring(0, 10),
    eventEndDate: b.eventEndDate ? b.eventEndDate.toISOString().substring(0, 10) : null,
    createdAt: b.createdAt,
    internalFeedback: b.internalFeedback,
    _count: b._count,
  });

  const upcoming = allBookings
    .filter(b => b.eventDate >= today && b.crmBrand !== null)
    .map(format)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  const past = allBookings
    .filter(b => b.eventDate < today && b.crmBrand !== null)
    .map(format);

  return apiResponse.success(res, { upcoming, past });
});

/**
 * GET /api/bookings/stats
 * Get booking statistics
 */
export const getBookingStats = asyncHandler(async (_req: Request, res: Response) => {
  const [total, byStatus, recentEvents] = await Promise.all([
    prisma.booking.count(),
    prisma.booking.groupBy({
      by: ['status'],
      _count: true,
    }),
    prisma.bookingEvent.count({
      where: {
        occurredAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  const statusMap: Record<string, number> = {};
  for (const s of byStatus) {
    statusMap[s.status] = s._count;
  }

  return apiResponse.success(res, {
    total,
    byStatus: statusMap,
    recentEvents7d: recentEvents,
    googleBusinessConfigured: isGoogleBusinessConfigured(),
  });
});
