/**
 * Crypto subscription storage service
 * Manages NEAR Intents-based crypto subscriptions in Cloudflare KV
 */

import type { CryptoSubscription } from '../types';

// KV key prefixes
const SUBSCRIPTION_PREFIX = 'crypto_sub:';
const SUBSCRIPTIONS_BY_DATE_PREFIX = 'crypto_subs_by_date:';

/**
 * Get the KV key for a subscription by NEAR account ID
 */
function getSubscriptionKey(nearAccountId: string): string {
  return `${SUBSCRIPTION_PREFIX}${nearAccountId}`;
}

/**
 * Get the KV key for subscriptions due on a specific date
 */
function getDateKey(date: string): string {
  return `${SUBSCRIPTIONS_BY_DATE_PREFIX}${date}`;
}

/**
 * Save a crypto subscription to KV
 */
export async function saveCryptoSubscription(
  kv: KVNamespace,
  subscription: CryptoSubscription
): Promise<void> {
  const key = getSubscriptionKey(subscription.nearAccountId);

  // Update the updatedAt timestamp
  const updatedSubscription: CryptoSubscription = {
    ...subscription,
    updatedAt: new Date().toISOString(),
  };

  // Store with 2 year expiration (subscriptions older than this are stale)
  await kv.put(key, JSON.stringify(updatedSubscription), {
    expirationTtl: 2 * 365 * 24 * 60 * 60, // 2 years in seconds
  });

  // Also index by next charge date for efficient cron processing
  if (subscription.status === 'active' || subscription.status === 'past_due') {
    await indexByChargeDate(kv, subscription.nearAccountId, subscription.nextChargeDate);
  }
}

/**
 * Index a subscription by its next charge date
 */
async function indexByChargeDate(
  kv: KVNamespace,
  nearAccountId: string,
  chargeDate: string
): Promise<void> {
  // Extract just the date portion (YYYY-MM-DD)
  const dateOnly = chargeDate.split('T')[0];
  const dateKey = getDateKey(dateOnly);

  // Get existing subscriptions for this date
  const existing = await kv.get(dateKey);
  const accounts: string[] = existing ? JSON.parse(existing) : [];

  // Add this account if not already present
  if (!accounts.includes(nearAccountId)) {
    accounts.push(nearAccountId);
    // Store with TTL of 40 days (covers monthly billing + buffer)
    await kv.put(dateKey, JSON.stringify(accounts), {
      expirationTtl: 40 * 24 * 60 * 60,
    });
  }
}

/**
 * Remove a subscription from the date index
 */
async function removeFromDateIndex(
  kv: KVNamespace,
  nearAccountId: string,
  chargeDate: string
): Promise<void> {
  const dateOnly = chargeDate.split('T')[0];
  const dateKey = getDateKey(dateOnly);

  const existing = await kv.get(dateKey);
  if (existing) {
    const accounts: string[] = JSON.parse(existing);
    const filtered = accounts.filter((a) => a !== nearAccountId);
    if (filtered.length > 0) {
      await kv.put(dateKey, JSON.stringify(filtered), {
        expirationTtl: 40 * 24 * 60 * 60,
      });
    } else {
      await kv.delete(dateKey);
    }
  }
}

/**
 * Get a crypto subscription by NEAR account ID
 */
export async function getCryptoSubscription(
  kv: KVNamespace,
  nearAccountId: string
): Promise<CryptoSubscription | null> {
  const key = getSubscriptionKey(nearAccountId);
  const data = await kv.get(key);
  return data ? JSON.parse(data) : null;
}

/**
 * Get a crypto subscription by intent ID (deposit address)
 */
export async function getCryptoSubscriptionByIntentId(
  kv: KVNamespace,
  intentId: string
): Promise<CryptoSubscription | null> {
  // List all subscriptions to find by intent ID
  // Note: In production, you'd want a secondary index for this
  const list = await kv.list({ prefix: SUBSCRIPTION_PREFIX });

  for (const key of list.keys) {
    const data = await kv.get(key.name);
    if (data) {
      const sub: CryptoSubscription = JSON.parse(data);
      if (sub.intentId === intentId) {
        return sub;
      }
    }
  }

  return null;
}

/**
 * List all subscriptions due for charging on a specific date
 */
export async function listDueSubscriptions(
  kv: KVNamespace,
  date: Date
): Promise<CryptoSubscription[]> {
  const dateStr = date.toISOString().split('T')[0];
  const dateKey = getDateKey(dateStr);

  const accountsData = await kv.get(dateKey);
  if (!accountsData) {
    return [];
  }

  const accounts: string[] = JSON.parse(accountsData);
  const subscriptions: CryptoSubscription[] = [];

  for (const nearAccountId of accounts) {
    const sub = await getCryptoSubscription(kv, nearAccountId);
    if (sub && (sub.status === 'active' || sub.status === 'past_due')) {
      // Double-check the date is actually due (not future)
      const nextChargeDate = new Date(sub.nextChargeDate);
      if (nextChargeDate <= date) {
        subscriptions.push(sub);
      }
    }
  }

  return subscriptions;
}

/**
 * Update crypto subscription status
 */
export async function updateCryptoSubscriptionStatus(
  kv: KVNamespace,
  nearAccountId: string,
  status: CryptoSubscription['status'],
  updates?: Partial<CryptoSubscription>
): Promise<CryptoSubscription | null> {
  const subscription = await getCryptoSubscription(kv, nearAccountId);
  if (!subscription) {
    return null;
  }

  const oldNextChargeDate = subscription.nextChargeDate;

  // Update the subscription
  const updated: CryptoSubscription = {
    ...subscription,
    ...updates,
    status,
    updatedAt: new Date().toISOString(),
  };

  // Save updated subscription
  await saveCryptoSubscription(kv, updated);

  // If next charge date changed, update the index
  if (updates?.nextChargeDate && updates.nextChargeDate !== oldNextChargeDate) {
    await removeFromDateIndex(kv, nearAccountId, oldNextChargeDate);
    if (status === 'active' || status === 'past_due') {
      await indexByChargeDate(kv, nearAccountId, updates.nextChargeDate);
    }
  }

  // If cancelled, remove from date index
  if (status === 'cancelled') {
    await removeFromDateIndex(kv, nearAccountId, oldNextChargeDate);
  }

  return updated;
}

/**
 * Delete a crypto subscription (for cleanup)
 */
export async function deleteCryptoSubscription(
  kv: KVNamespace,
  nearAccountId: string
): Promise<void> {
  const subscription = await getCryptoSubscription(kv, nearAccountId);
  if (subscription) {
    // Remove from date index
    await removeFromDateIndex(kv, nearAccountId, subscription.nextChargeDate);
    // Delete the subscription
    await kv.delete(getSubscriptionKey(nearAccountId));
  }
}

/**
 * Calculate the next charge date from billing day
 */
export function calculateNextChargeDate(billingDay: number, fromDate?: Date): string {
  const date = fromDate ? new Date(fromDate) : new Date();

  // Move to next month
  date.setMonth(date.getMonth() + 1);

  // Set the billing day (cap at 28 to handle February)
  const day = Math.min(billingDay, 28);
  date.setDate(day);

  // Reset time to midnight UTC
  date.setUTCHours(0, 0, 0, 0);

  return date.toISOString();
}

/**
 * Get default billing day (current day of month, capped at 28)
 */
export function getDefaultBillingDay(): number {
  const today = new Date();
  return Math.min(today.getDate(), 28);
}
