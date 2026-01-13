import type { Context } from 'hono';
import type { Env } from '../types';

/**
 * Stripe webhook handler - stub for Task 1
 * Full implementation in Task 2
 */
export async function handleStripeWebhook(c: Context<{ Bindings: Env }>): Promise<Response> {
  // Placeholder - full implementation in Task 2
  return c.json({ received: true });
}
