/**
 * Idempotency service using Cloudflare KV
 * Prevents duplicate processing of Stripe webhook events
 */

const EVENT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Check if an event has already been processed
 * @param kv - KV namespace for processed events
 * @param eventId - Stripe event ID
 * @returns true if event was already processed
 */
export async function isProcessed(
  kv: KVNamespace,
  eventId: string
): Promise<boolean> {
  const value = await kv.get(eventId);
  return value !== null;
}

/**
 * Mark an event as processed
 * @param kv - KV namespace for processed events
 * @param eventId - Stripe event ID
 */
export async function markProcessed(
  kv: KVNamespace,
  eventId: string
): Promise<void> {
  await kv.put(eventId, new Date().toISOString(), {
    expirationTtl: EVENT_EXPIRY_SECONDS,
  });
}
