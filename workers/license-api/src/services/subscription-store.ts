/**
 * Subscription store using Cloudflare KV
 * Tracks Stripe subscription state linked to NEAR accounts
 */

import type { SubscriptionRecord } from '../types';

// TTL buffer: keep records 30 days after subscription ends
const RECORD_BUFFER_SECONDS = 30 * 24 * 60 * 60;

/**
 * Get subscription record by Stripe customer ID
 */
export async function getSubscriptionByCustomerId(
  kv: KVNamespace,
  stripeCustomerId: string
): Promise<SubscriptionRecord | null> {
  const value = await kv.get(`customer:${stripeCustomerId}`, 'json');
  return value as SubscriptionRecord | null;
}

/**
 * Get subscription record by NEAR account ID
 */
export async function getSubscriptionByNearAccount(
  kv: KVNamespace,
  nearAccountId: string
): Promise<SubscriptionRecord | null> {
  // First get the customer ID mapping
  const customerId = await kv.get(`near:${nearAccountId}`);
  if (!customerId) {
    return null;
  }
  return getSubscriptionByCustomerId(kv, customerId);
}

/**
 * Save or update subscription record
 * Creates two entries:
 * - customer:{stripeCustomerId} -> SubscriptionRecord
 * - near:{nearAccountId} -> stripeCustomerId (reverse lookup)
 */
export async function saveSubscription(
  kv: KVNamespace,
  record: SubscriptionRecord
): Promise<void> {
  const now = Date.now();
  const updatedRecord: SubscriptionRecord = {
    ...record,
    updatedAt: now,
    createdAt: record.createdAt || now,
  };

  // Calculate TTL: period end + buffer
  const ttlSeconds = Math.max(
    record.currentPeriodEnd - Math.floor(now / 1000) + RECORD_BUFFER_SECONDS,
    RECORD_BUFFER_SECONDS
  );

  // Store main record by customer ID
  await kv.put(
    `customer:${record.stripeCustomerId}`,
    JSON.stringify(updatedRecord),
    { expirationTtl: ttlSeconds }
  );

  // Store reverse lookup by NEAR account ID
  await kv.put(`near:${record.nearAccountId}`, record.stripeCustomerId, {
    expirationTtl: ttlSeconds,
  });
}

/**
 * Update subscription status
 */
export async function updateSubscriptionStatus(
  kv: KVNamespace,
  stripeCustomerId: string,
  status: SubscriptionRecord['status'],
  updates?: Partial<Pick<SubscriptionRecord, 'currentPeriodEnd' | 'cancelAtPeriodEnd'>>
): Promise<void> {
  const existing = await getSubscriptionByCustomerId(kv, stripeCustomerId);
  if (!existing) {
    console.warn(`Subscription not found for customer: ${stripeCustomerId}`);
    return;
  }

  const updatedRecord: SubscriptionRecord = {
    ...existing,
    status,
    ...updates,
    updatedAt: Date.now(),
  };

  await saveSubscription(kv, updatedRecord);
}
