import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { apiResponse } from '../utils/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { config } from '../config/index.js';
import { scheduleGalleryDispatch } from '../services/galleryDispatch.service.js';
import { processNewReview } from '../services/reviewMatching.service.js';
import { fetchReview, parsePubSubMessage, isGoogleBusinessConfigured } from '../services/googleBusiness.service.js';

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
  const { session_id } = req.query;

  const booking = await prisma.booking.findUnique({
    where: { publicToken: token },
  });

  if (!booking) {
    return apiResponse.notFound(res, 'Page introuvable');
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

  return apiResponse.success(res, {
    status: 'active',
    customerName: booking.customerName,
    eventDate: booking.eventDate,
    hasGoogleReview: !!booking.googleReviewUrl,
  });
});

/**
 * POST /api/public/bookings/:token/actions/review-click
 * Handle "Leave a Google review" click
 */
export const handleReviewClick = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.params;
  const { session_id, user_agent, referrer } = req.body;

  const booking = await prisma.booking.findUnique({
    where: { publicToken: token },
  });

  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  // Log review_click event
  await prisma.bookingEvent.create({
    data: {
      bookingId: booking.id,
      eventType: 'review_click',
      sessionId: session_id || null,
      ipHash: hashIp(req.ip || ''),
      userAgent: user_agent || req.headers['user-agent'] || null,
      referer: referrer || null,
    },
  });

  // Update booking status
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: 'review_clicked' },
  });

  // Schedule fallback gallery dispatch at H+24
  const delayHours = config.reviewSystem.galleryDelayHours;
  const scheduledFor = new Date(Date.now() + delayHours * 60 * 60 * 1000);
  await scheduleGalleryDispatch(booking.id, 'fallback_24h', scheduledFor);

  // Return the Google review URL
  const reviewUrl = booking.googleReviewUrl || config.googleBusiness.defaultReviewUrl;

  return apiResponse.success(res, {
    redirect_url: reviewUrl,
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

  // Schedule gallery dispatch at H+24
  const delayHours = config.reviewSystem.galleryDelayHours;
  const scheduledFor = new Date(Date.now() + delayHours * 60 * 60 * 1000);
  await scheduleGalleryDispatch(booking.id, 'after_no_review_24h', scheduledFor);

  return apiResponse.success(res, {
    message: 'C\'est bien noté. Votre galerie vous sera envoyée automatiquement dans les 24 heures.',
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

  const publicUrl = `${config.reviewSystem.publicBaseUrl}/r/${publicToken}`;

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

  const publicUrl = `${config.reviewSystem.publicBaseUrl}/r/${booking.publicToken}`;

  return apiResponse.success(res, { ...booking, publicUrl });
});

/**
 * PUT /api/bookings/:id
 * Update a booking
 */
export const updateBooking = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { customerName, customerEmail, customerPhone, eventDate, galleryUrl, googleReviewUrl, status } = req.body;

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

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return apiResponse.notFound(res, 'Réservation introuvable');
  }

  if (!booking.galleryUrl) {
    return apiResponse.badRequest(res, 'Aucune URL de galerie configurée pour cette réservation');
  }

  await scheduleGalleryDispatch(id as string, 'manual', new Date());

  return apiResponse.success(res, { message: 'Envoi de la galerie déclenché' });
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
