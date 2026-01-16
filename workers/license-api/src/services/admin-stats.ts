/**
 * Admin statistics service
 * Aggregates subscription data from KV namespaces
 */

import type { Env, SubscriptionRecord, CryptoSubscription, TelemetryStats, OAuthUserLicense } from '../types';
import { getTelemetryStats } from './telemetry-store';

// Pricing for revenue estimates
const STRIPE_MONTHLY_USD = 5;
const CRYPTO_MONTHLY_USD = 4;

export interface SubscriptionStats {
  stripe: {
    active: number;
    canceled: number;
    pastDue: number;
  };
  crypto: {
    active: number;
    cancelled: number;
    pastDue: number;
    pending: number;
  };
  oauth: {
    totalUsers: number;
    licensedUsers: number;
  };
  totalActive: number;
  estimatedMonthlyRevenue: number;
  telemetry: TelemetryStats;
}

/**
 * Get aggregated subscription statistics
 */
export async function getSubscriptionStats(env: Env): Promise<SubscriptionStats> {
  // Get telemetry stats
  const telemetry = await getTelemetryStats(env.TELEMETRY);

  // Initialize counts
  const stats: SubscriptionStats = {
    stripe: { active: 0, canceled: 0, pastDue: 0 },
    crypto: { active: 0, cancelled: 0, pastDue: 0, pending: 0 },
    oauth: { totalUsers: 0, licensedUsers: 0 },
    totalActive: 0,
    estimatedMonthlyRevenue: 0,
    telemetry,
  };

  // Process Stripe subscriptions
  // Stripe subscriptions are stored with customer: prefix
  let stripeCursor: string | undefined;
  do {
    const stripeList = await env.SUBSCRIPTIONS.list({
      prefix: 'customer:',
      cursor: stripeCursor,
      limit: 1000,
    });

    for (const key of stripeList.keys) {
      const data = await env.SUBSCRIPTIONS.get(key.name);
      if (data) {
        try {
          const record: SubscriptionRecord = JSON.parse(data);
          switch (record.status) {
            case 'active':
              stats.stripe.active++;
              break;
            case 'canceled':
              stats.stripe.canceled++;
              break;
            case 'past_due':
            case 'unpaid':
              stats.stripe.pastDue++;
              break;
          }
        } catch {
          // Skip malformed records
        }
      }
    }

    stripeCursor = stripeList.list_complete ? undefined : stripeList.cursor;
  } while (stripeCursor);

  // Process crypto subscriptions
  let cryptoCursor: string | undefined;
  do {
    const cryptoList = await env.CRYPTO_SUBSCRIPTIONS.list({
      prefix: 'crypto_sub:',
      cursor: cryptoCursor,
      limit: 1000,
    });

    for (const key of cryptoList.keys) {
      const data = await env.CRYPTO_SUBSCRIPTIONS.get(key.name);
      if (data) {
        try {
          const record: CryptoSubscription = JSON.parse(data);
          switch (record.status) {
            case 'active':
              stats.crypto.active++;
              break;
            case 'cancelled':
              stats.crypto.cancelled++;
              break;
            case 'past_due':
              stats.crypto.pastDue++;
              break;
            case 'pending':
              stats.crypto.pending++;
              break;
          }
        } catch {
          // Skip malformed records
        }
      }
    }

    cryptoCursor = cryptoList.list_complete ? undefined : cryptoList.cursor;
  } while (cryptoCursor);

  // Process OAuth users
  let oauthCursor: string | undefined;
  const now = Date.now();
  do {
    const oauthList = await env.USER_LICENSES.list({
      prefix: 'oauth:',
      cursor: oauthCursor,
      limit: 1000,
    });

    for (const key of oauthList.keys) {
      stats.oauth.totalUsers++;
      const data = await env.USER_LICENSES.get(key.name);
      if (data) {
        try {
          const record: OAuthUserLicense = JSON.parse(data);
          if (record.licenseExpiry && record.licenseExpiry > now) {
            stats.oauth.licensedUsers++;
          }
        } catch {
          // Skip malformed records
        }
      }
    }

    oauthCursor = oauthList.list_complete ? undefined : oauthList.cursor;
  } while (oauthCursor);

  // Calculate totals
  stats.totalActive = stats.stripe.active + stats.crypto.active;
  stats.estimatedMonthlyRevenue =
    stats.stripe.active * STRIPE_MONTHLY_USD + stats.crypto.active * CRYPTO_MONTHLY_USD;

  return stats;
}
