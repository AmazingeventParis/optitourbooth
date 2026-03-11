import { config } from '../config/index.js';

let accessToken: string | null = null;
let tokenExpiry = 0;

/**
 * Check if Google Business Profile integration is configured
 */
export function isGoogleBusinessConfigured(): boolean {
  return !!(
    config.googleBusiness.oauthClientId &&
    config.googleBusiness.oauthClientSecret &&
    config.googleBusiness.oauthRefreshToken &&
    config.googleBusiness.accountId
  );
}

/**
 * Get a fresh access token using the refresh token
 */
async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleBusiness.oauthClientId,
      client_secret: config.googleBusiness.oauthClientSecret,
      refresh_token: config.googleBusiness.oauthRefreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = (await response.json()) as { access_token: string; expires_in: number };
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // Refresh 60s before expiry

  return accessToken;
}

/**
 * List Google Business Profile accounts
 */
export async function listAccounts(): Promise<unknown[]> {
  if (!isGoogleBusinessConfigured()) return [];

  const token = await getAccessToken();
  const response = await fetch(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const data = (await response.json()) as { accounts?: unknown[] };
  return data.accounts || [];
}

/**
 * Fetch reviews for a location
 */
export async function fetchReviews(
  accountId?: string,
  locationId?: string
): Promise<unknown[]> {
  if (!isGoogleBusinessConfigured()) return [];

  const acctId = accountId || config.googleBusiness.accountId;
  const locId = locationId || config.googleBusiness.locationId;

  if (!acctId || !locId) return [];

  const token = await getAccessToken();

  const response = await fetch(
    `https://mybusiness.googleapis.com/v4/accounts/${acctId}/locations/${locId}/reviews`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const data = (await response.json()) as { reviews?: unknown[] };
  return data.reviews || [];
}

/**
 * Fetch a single review by name (resource path)
 */
export async function fetchReview(
  reviewName: string
): Promise<Record<string, unknown> | null> {
  if (!isGoogleBusinessConfigured()) return null;

  const token = await getAccessToken();

  const response = await fetch(
    `https://mybusiness.googleapis.com/v4/${reviewName}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Setup Pub/Sub notification for new reviews
 */
export async function setupNotifications(): Promise<boolean> {
  if (!isGoogleBusinessConfigured()) return false;

  const { accountId, pubsubProjectId, pubsubTopicName } = config.googleBusiness;
  if (!pubsubProjectId || !pubsubTopicName) return false;

  const token = await getAccessToken();

  const response = await fetch(
    `https://mybusinessnotifications.googleapis.com/v1/accounts/${accountId}/notificationSetting?updateMask=pubsubTopic,notificationTypes`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `accounts/${accountId}/notificationSetting`,
        pubsubTopic: `projects/${pubsubProjectId}/topics/${pubsubTopicName}`,
        notificationTypes: ['NEW_REVIEW'],
      }),
    }
  );

  return response.ok;
}

/**
 * Parse a Pub/Sub push message for review notifications
 */
export function parsePubSubMessage(body: Record<string, unknown>): {
  notificationType: string;
  resourceName: string;
} | null {
  try {
    const message = body.message as Record<string, unknown> | undefined;
    if (!message || !message.data) return null;

    const data = JSON.parse(
      Buffer.from(message.data as string, 'base64').toString('utf-8')
    ) as { notificationType?: string; resourceName?: string };

    return {
      notificationType: data.notificationType || '',
      resourceName: data.resourceName || '',
    };
  } catch {
    return null;
  }
}
