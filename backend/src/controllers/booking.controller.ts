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

  const publicUrl = `${config.reviewSystem.publicBaseUrl}/galerie/${publicToken}`;

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

  const publicUrl = `${config.reviewSystem.publicBaseUrl}/galerie/${booking.publicToken}`;

  return apiResponse.success(res, { ...booking, publicUrl });
});

/**
 * PUT /api/bookings/:id
 * Update a booking
 */
export const updateBooking = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { customerName, customerEmail, customerPhone, eventDate, galleryUrl, googleReviewUrl, status, senderBrand, rating } = req.body;

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

  // Cancel any pending automatic dispatches before sending manually
  await cancelPendingDispatches(booking.id);

  try {
    await sendGalleryDirectEmail({
      to: booking.customerEmail,
      customerName: booking.customerName,
      galleryUrl: booking.galleryUrl,
      brand,
    });
  } catch (err) {
    console.error(`[Booking] Erreur envoi galerie:`, err);
    return apiResponse.serverError(res, `Erreur lors de l'envoi: ${(err as Error).message}`);
  }

  // Record as dispatch to prevent future duplicates
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

  return apiResponse.success(res, { message: `Galerie envoyée à ${booking.customerEmail} via ${brand}` });
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
        publicUrl: `${config.reviewSystem.publicBaseUrl}/galerie/${booking.publicToken}`,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
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

  const publicUrl = `${config.reviewSystem.publicBaseUrl}/galerie/${publicToken}`;

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

  const publicUrl = `${config.reviewSystem.publicBaseUrl}/galerie/${booking.publicToken}`;

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
  const result = await scanAndMatchDriveFolders();
  return apiResponse.success(res, result);
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
