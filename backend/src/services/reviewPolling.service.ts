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

/**
 * Check if Google Places review polling is configured
 */
export function isReviewPollingConfigured(): boolean {
  const { apiKey, placeIds } = config.googlePlaces;
  return !!(apiKey && (placeIds.SHOOTNBOX || placeIds.SMAKK));
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
 * Generate a stable review ID from author + timestamp (Places API doesn't provide a unique ID)
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
 * Poll all configured brands for new reviews
 * Called by CRON every N minutes
 */
export async function pollAllReviews(): Promise<void> {
  if (!isReviewPollingConfigured()) return;

  const { placeIds } = config.googlePlaces;

  try {
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
  } catch (error) {
    console.error('[ReviewPolling] Error polling reviews:', error);
  }
}
