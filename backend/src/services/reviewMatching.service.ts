import { prisma } from '../config/database.js';
import { Prisma } from '@prisma/client';

interface ReviewData {
  reviewId: string;
  reviewName: string;
  reviewerDisplayName: string;
  isAnonymous: boolean;
  starRating: string;
  comment?: string;
  createTime: string;
  updateTime: string;
  rawPayload: Prisma.InputJsonValue;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const m = b.length;
  const n = a.length;
  const matrix: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) matrix[i]![0] = i;
  for (let j = 0; j <= n; j++) matrix[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j]! + 1
        );
      }
    }
  }
  return matrix[m]![n]!;
}

/**
 * Normalize a name for comparison (remove accents, lowercase, trim)
 */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Calculate name similarity score (0-15)
 */
function calculateNameScore(customerName: string, reviewerName: string): number {
  if (!customerName || !reviewerName) return 0;

  const normalCustomer = normalizeName(customerName);
  const normalReviewer = normalizeName(reviewerName);

  // Exact match
  if (normalCustomer === normalReviewer) return 15;

  // Check if first or last name matches
  const customerParts = normalCustomer.split(/\s+/);
  const reviewerParts = normalReviewer.split(/\s+/);

  for (const cp of customerParts) {
    for (const rp of reviewerParts) {
      if (cp === rp && cp.length > 2) return 12;
      if (levenshteinDistance(cp, rp) <= 1 && cp.length > 3) return 10;
    }
  }

  // Overall Levenshtein
  const distance = levenshteinDistance(normalCustomer, normalReviewer);
  const maxLen = Math.max(normalCustomer.length, normalReviewer.length);
  const similarity = 1 - distance / maxLen;

  if (similarity > 0.7) return 8;
  if (similarity > 0.5) return 5;

  return 0;
}

/**
 * Calculate matching score between a booking click and a new review
 */
export function calculateMatchScore(
  clickTime: Date,
  reviewCreateTime: Date,
  customerName: string,
  reviewerDisplayName: string,
  isAnonymous: boolean,
  concurrentClicksCount: number
): number {
  let score = 0;

  // Time-based scoring
  const diffMinutes = (reviewCreateTime.getTime() - clickTime.getTime()) / (1000 * 60);

  if (diffMinutes >= 0 && diffMinutes <= 5) {
    score += 60;
  } else if (diffMinutes > 5 && diffMinutes <= 15) {
    score += 35;
  } else if (diffMinutes > 15 && diffMinutes <= 60) {
    score += 15;
  } else {
    // Outside matching window
    return 0;
  }

  // Concurrent clicks scoring
  if (concurrentClicksCount === 1) {
    score += 20;
  } else if (concurrentClicksCount > 1) {
    score -= 30;
  }

  // Anonymous penalty
  if (isAnonymous) {
    score -= 10;
  }

  // Name matching bonus
  score += calculateNameScore(customerName, reviewerDisplayName);

  return Math.max(0, score);
}

/**
 * Process a new Google review and try to match it with recent bookings
 */
export async function processNewReview(review: ReviewData): Promise<void> {
  // Check for duplicate review
  const existingMatch = await prisma.reviewMatch.findUnique({
    where: { googleReviewId: review.reviewId },
  });
  if (existingMatch) {
    console.log(`[ReviewMatching] Review ${review.reviewId} already processed, skipping`);
    return;
  }

  const reviewCreateTime = new Date(review.createTime);
  const windowStart = new Date(reviewCreateTime.getTime() - 60 * 60 * 1000); // 60 min before

  // Find bookings that had a review_click in the matching window
  const recentClicks = await prisma.bookingEvent.findMany({
    where: {
      eventType: 'review_click',
      occurredAt: {
        gte: windowStart,
        lte: reviewCreateTime,
      },
    },
    include: {
      booking: true,
    },
    orderBy: { occurredAt: 'desc' },
  });

  if (recentClicks.length === 0) {
    console.log('[ReviewMatching] No recent review_click events found in window');
    return;
  }

  // Calculate scores for each candidate
  const candidates: Array<{
    bookingId: string;
    score: number;
    clickTime: Date;
    customerName: string;
  }> = [];

  for (const click of recentClicks) {
    const score = calculateMatchScore(
      click.occurredAt,
      reviewCreateTime,
      click.booking.customerName,
      review.reviewerDisplayName,
      review.isAnonymous,
      recentClicks.length
    );

    candidates.push({
      bookingId: click.bookingId,
      score,
      clickTime: click.occurredAt,
      customerName: click.booking.customerName,
    });
  }

  if (candidates.length === 0) return;

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  const bestMatch = candidates[0]!;

  // Determine match status
  let matchStatus: 'matched' | 'manual_check' | 'rejected';
  if (bestMatch.score >= 80) {
    matchStatus = 'matched';
  } else if (bestMatch.score >= 50) {
    matchStatus = 'manual_check';
  } else {
    matchStatus = 'rejected';
  }

  // Create the review match record
  const reviewMatch = await prisma.reviewMatch.create({
    data: {
      bookingId: bestMatch.bookingId,
      googleReviewName: review.reviewName,
      googleReviewId: review.reviewId,
      googleReviewerDisplayName: review.reviewerDisplayName,
      googleReviewCreateTime: reviewCreateTime,
      googleReviewUpdateTime: new Date(review.updateTime),
      matchScore: bestMatch.score,
      matchStatus,
      matchedAt: matchStatus === 'matched' ? new Date() : null,
      rawPayloadJson: review.rawPayload,
    },
  });

  // Log the review detection event
  await prisma.bookingEvent.create({
    data: {
      bookingId: bestMatch.bookingId,
      eventType: 'review_detected',
      metadataJson: {
        reviewId: review.reviewId,
        matchScore: bestMatch.score,
        matchStatus,
      },
    },
  });

  // Update booking status
  if (matchStatus === 'matched') {
    await prisma.booking.update({
      where: { id: bestMatch.bookingId },
      data: { status: 'review_matched' },
    });

    // Trigger immediate gallery send
    const { scheduleGalleryDispatch } = await import('./galleryDispatch.service.js');
    await scheduleGalleryDispatch(bestMatch.bookingId, 'after_review', new Date());

    console.log(`[ReviewMatching] Auto-matched review ${review.reviewId} to booking ${bestMatch.bookingId} (score: ${bestMatch.score})`);
  } else if (matchStatus === 'manual_check') {
    await prisma.booking.update({
      where: { id: bestMatch.bookingId },
      data: { status: 'manual_check_required' },
    });

    await prisma.bookingEvent.create({
      data: {
        bookingId: bestMatch.bookingId,
        eventType: 'manual_review_required',
        metadataJson: { reviewMatchId: reviewMatch.id },
      },
    });

    console.log(`[ReviewMatching] Manual check required for review ${review.reviewId} (score: ${bestMatch.score})`);
  } else {
    console.log(`[ReviewMatching] Review ${review.reviewId} rejected (score: ${bestMatch.score})`);
  }
}
