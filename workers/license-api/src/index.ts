import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';

// Create Hono app with typed Env
const app = new Hono<{ Bindings: Env }>();

// Enable CORS for API endpoints
app.use('/api/*', cors());

/**
 * Health check endpoint
 */
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'specflow-license-api',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Stripe webhook endpoint
 * Uses raw body for signature verification
 * Handles: invoice.paid, customer.subscription.updated, customer.subscription.deleted
 */
app.post('/webhook/stripe', async (c) => {
  // Import handler dynamically to keep main bundle small
  const { handleStripeWebhook } = await import('./handlers/stripe-webhook');
  return handleStripeWebhook(c);
});

/**
 * Create Stripe checkout session for subscription
 * Body: { nearAccountId: string, successUrl: string, cancelUrl: string }
 */
app.post('/api/checkout', async (c) => {
  const { handleCheckout } = await import('./handlers/checkout');
  return handleCheckout(c);
});

/**
 * Cancel subscription at period end
 * Body: { nearAccountId: string }
 */
app.post('/api/subscription/cancel', async (c) => {
  const { handleCancelSubscription } = await import('./handlers/subscription-manage');
  return handleCancelSubscription(c);
});

/**
 * Get subscription status
 * Query: ?nearAccountId=xxx
 */
app.get('/api/subscription/status', async (c) => {
  const { handleGetSubscriptionStatus } = await import('./handlers/subscription-manage');
  return handleGetSubscriptionStatus(c);
});

/**
 * Create crypto subscription with NEAR Intents
 * Body: { nearAccountId: string, billingDay?: number }
 */
app.post('/api/crypto/subscribe', async (c) => {
  const { handleCryptoSubscribe } = await import('./handlers/crypto-subscribe');
  return handleCryptoSubscribe(c);
});

/**
 * Confirm crypto subscription after first payment
 * Body: { intentId: string }
 */
app.post('/api/crypto/subscribe/confirm', async (c) => {
  const { handleCryptoSubscribeConfirm } = await import('./handlers/crypto-subscribe');
  return handleCryptoSubscribeConfirm(c);
});

/**
 * Get crypto subscription status
 * Query: ?nearAccountId=xxx
 */
app.get('/api/crypto/subscription/status', async (c) => {
  const { handleCryptoSubscriptionStatus } = await import('./handlers/crypto-subscribe');
  return handleCryptoSubscriptionStatus(c);
});

/**
 * Cancel crypto subscription
 * Body: { nearAccountId: string }
 */
app.post('/api/crypto/subscription/cancel', async (c) => {
  const { handleCryptoSubscriptionCancel } = await import('./handlers/crypto-subscribe');
  return handleCryptoSubscriptionCancel(c);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Export for Cloudflare Workers
export default app;
