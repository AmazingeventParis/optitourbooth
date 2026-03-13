import { config } from '../config/index.js';
import { prisma } from '../config/database.js';
import { processNewReview } from './reviewMatching.service.js';

interface PlacesReview {
  author_name: string;
  rating: number;
  time: number; // epoch seconds
  text?: string;
  author_url?: string;
  profile_photo_url?: string;
  language?: string;
  relative_time_description?: string;
}

interface PlaceDetailsResponse {
  result?: {
    reviews?: PlacesReview[];
  };
  status: string;
  error_message?: string;
}

type Brand = 'SHOOTNBOX' | 'SMAKK';

// Active polling state
let pollingTimer: ReturnType<typeof setInterval> | null = null;
const ACTIVE_POLL_INTERVAL = 60_000; // 1 minute when actively watching
const ACTIVE_POLL_DURATION = 60 * 60 * 1000; // Stop after 1 hour

/**
 * Check if Google Places review polling is configured
 */
export function isReviewPollingConfigured(): boolean {
  const { apiKey, placeIds } = config.googlePlaces;
  return !!(apiKey && (placeIds.SHOOTNBOX || placeIds.SMAKK));
}

/**
 * Check if there are pending review clicks within the last hour
 * (someone clicked "Leave a review" and we're waiting for their review)
 */
async function hasPendingReviewClicks(): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - ACTIVE_POLL_DURATION);

  const count = await prisma.bookingEvent.count({
    where: {
      eventType: 'review_click',
      occurredAt: { gte: oneHourAgo },
      booking: {
        status: { in: ['review_clicked'] },
      },
    },
  });

  return count > 0;
}

/**
 * Fetch latest reviews for a Google Place using the Places API
 */
async function fetchLatestReviews(placeId: string): Promise<PlacesReview[]> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews&reviews_sort=newest&key=${config.googlePlaces.apiKey}`;

  const response = await fetch(url);
  const data = (await response.json()) as PlaceDetailsResponse;

  if (data.status !== 'OK') {
    console.warn(`[ReviewPolling] Places API error: ${data.status} - ${data.error_message || ''}`);
    return [];
  }

  return data.result?.reviews || [];
}

/**
 * Generate a stable review ID from author + timestamp
 */
function generateReviewId(placeId: string, review: PlacesReview): string {
  return `places_${placeId}_${review.author_name.replace(/\s+/g, '_')}_${review.time}`;
}

/**
 * Poll reviews for a single brand/place and process new ones
 */
async function pollBrandReviews(brand: Brand, placeId: string): Promise<number> {
  const reviews = await fetchLatestReviews(placeId);
  if (reviews.length === 0) return 0;

  let newCount = 0;

  for (const review of reviews) {
    const reviewId = generateReviewId(placeId, review);
    const reviewCreateTime = new Date(review.time * 1000);

    // Skip reviews older than 2 hours (outside matching window)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    if (reviewCreateTime < twoHoursAgo) continue;

    // Check if already processed
    const existing = await prisma.reviewMatch.findUnique({
      where: { googleReviewId: reviewId },
    });
    if (existing) continue;

    // New review found - process it
    console.log(`[ReviewPolling] New ${brand} review by "${review.author_name}" (${review.rating}★) at ${reviewCreateTime.toISOString()}`);

    await processNewReview({
      reviewId,
      reviewName: `places/${placeId}/reviews/${reviewId}`,
      reviewerDisplayName: review.author_name,
      isAnonymous: !review.author_name || review.author_name === 'A Google User',
      starRating: String(review.rating),
      comment: review.text,
      createTime: reviewCreateTime.toISOString(),
      updateTime: reviewCreateTime.toISOString(),
      rawPayload: {
        source: 'places_api_polling',
        brand,
        placeId,
        author_name: review.author_name,
        rating: review.rating,
        time: review.time,
        text: review.text || '',
        author_url: review.author_url || '',
      },
    });

    newCount++;
  }

  return newCount;
}

/**
 * Execute a single poll cycle for all brands
 */
async function doPoll(): Promise<void> {
  const { placeIds } = config.googlePlaces;
  let total = 0;

  if (placeIds.SHOOTNBOX) {
    total += await pollBrandReviews('SHOOTNBOX', placeIds.SHOOTNBOX);
  }
  if (placeIds.SMAKK) {
    total += await pollBrandReviews('SMAKK', placeIds.SMAKK);
  }

  if (total > 0) {
    console.log(`[ReviewPolling] Processed ${total} new review(s)`);
  }
}

/**
 * Start active polling (called when a client clicks "Leave a review")
 * Polls every 1 minute for up to 1 hour, then stops automatically.
 * Only polls when there are actually pending review clicks.
 */
export function startActivePolling(): void {
  if (!isReviewPollingConfigured()) return;
  if (pollingTimer) return; // Already polling

  console.log('[ReviewPolling] Starting active polling (every 1 min)');

  // Poll immediately
  doPoll().catch(console.error);

  // Then poll every minute
  pollingTimer = setInterval(async () => {
    try {
      // Check if there are still pending review clicks
      const hasPending = await hasPendingReviewClicks();
      if (!hasPending) {
        stopActivePolling();
        return;
      }
      await doPoll();
    } catch (error) {
      console.error('[ReviewPolling] Poll error:', error);
    }
  }, ACTIVE_POLL_INTERVAL);

  // Auto-stop after 1 hour
  setTimeout(() => stopActivePolling(), ACTIVE_POLL_DURATION);
}

/**
 * Stop active polling
 */
function stopActivePolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log('[ReviewPolling] Active polling stopped');
  }
}

/**
 * Called by CRON every 5 min — only polls if there are pending review clicks
 * This is a lightweight check (1 DB query) that starts active polling if needed
 */
export async function checkAndPoll(): Promise<void> {
  if (!isReviewPollingConfigured()) return;

  const hasPending = await hasPendingReviewClicks();
  if (hasPending && !pollingTimer) {
    startActivePolling();
  }
}
