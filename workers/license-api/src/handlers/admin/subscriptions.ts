/**
 * Admin subscriptions endpoint handler
 * GET /admin/api/subscriptions
 */

import type { Context } from 'hono';
import type { Env, SubscriptionRecord, CryptoSubscription } from '../../types';
import { subscriptionsFragment } from './ui';

interface SubscriptionInfo {
  nearAccountId: string;
  type: 'stripe' | 'crypto';
  status: string;
  createdAt: string;
  nextCharge?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  monthlyAmount?: string;
}

/**
 * List subscriptions with optional type filter
 */
export async function handleAdminSubscriptions(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const type = c.req.query('type') || 'all';
    const limit = Math.min(parseInt(c.req.query('limit') || '100', 10), 100);
    const status = c.req.query('status'); // Optional status filter

    const subscriptions: SubscriptionInfo[] = [];

    // Fetch Stripe subscriptions
    if (type === 'all' || type === 'stripe') {
      let stripeCursor: string | undefined;
      let stripeCount = 0;

      do {
        const stripeList = await c.env.SUBSCRIPTIONS.list({
          prefix: 'customer:',
          cursor: stripeCursor,
          limit: Math.min(100, limit - subscriptions.length),
        });

        for (const key of stripeList.keys) {
          if (subscriptions.length >= limit) break;

          const data = await c.env.SUBSCRIPTIONS.get(key.name);
          if (data) {
            try {
              const record: SubscriptionRecord = JSON.parse(data);

              // Apply status filter if specified
              if (status && record.status !== status) {
                continue;
              }

              subscriptions.push({
                nearAccountId: record.nearAccountId,
                type: 'stripe',
                status: record.status,
                createdAt: new Date(record.createdAt).toISOString(),
                currentPeriodEnd: record.currentPeriodEnd,
                cancelAtPeriodEnd: record.cancelAtPeriodEnd,
              });
              stripeCount++;
            } catch {
              // Skip malformed records
            }
          }
        }

        stripeCursor = stripeList.list_complete ? undefined : stripeList.cursor;
      } while (stripeCursor && subscriptions.length < limit);
    }

    // Fetch crypto subscriptions
    if (type === 'all' || type === 'crypto') {
      let cryptoCursor: string | undefined;

      do {
        const cryptoList = await c.env.CRYPTO_SUBSCRIPTIONS.list({
          prefix: 'crypto_sub:',
          cursor: cryptoCursor,
          limit: Math.min(100, limit - subscriptions.length),
        });

        for (const key of cryptoList.keys) {
          if (subscriptions.length >= limit) break;

          const data = await c.env.CRYPTO_SUBSCRIPTIONS.get(key.name);
          if (data) {
            try {
              const record: CryptoSubscription = JSON.parse(data);

              // Apply status filter if specified
              if (status && record.status !== status) {
                continue;
              }

              subscriptions.push({
                nearAccountId: record.nearAccountId,
                type: 'crypto',
                status: record.status,
                createdAt: record.createdAt,
                nextCharge: record.nextChargeDate ?? undefined,
                monthlyAmount: record.monthlyAmountUsd,
              });
            } catch {
              // Skip malformed records
            }
          }
        }

        cryptoCursor = cryptoList.list_complete ? undefined : cryptoList.cursor;
      } while (cryptoCursor && subscriptions.length < limit);
    }

    // Sort by creation date (newest first)
    subscriptions.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Check if request is from htmx
    const isHtmx = c.req.header('HX-Request') === 'true';

    if (isHtmx) {
      // Transform to format expected by fragment
      const fragmentData = subscriptions.map((sub) => ({
        nearAccountId: sub.nearAccountId,
        type: sub.type,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
        nextChargeDate:
          sub.type === 'crypto'
            ? sub.nextCharge || null
            : sub.currentPeriodEnd
              ? new Date(sub.currentPeriodEnd * 1000).toISOString()
              : null,
      }));
      return c.html(subscriptionsFragment(fragmentData));
    }

    return c.json({
      success: true,
      data: {
        subscriptions,
        count: subscriptions.length,
        filter: {
          type: type === 'all' ? null : type,
          status: status || null,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching subscriptions:', errorMessage);
    return c.json({ error: 'Failed to fetch subscriptions' }, 500);
  }
}
