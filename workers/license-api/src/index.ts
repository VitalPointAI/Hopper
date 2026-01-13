import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { handleScheduled } from './handlers/cron-handler';
import { adminAuth } from './middleware/admin-auth';
import {
  generateAdminChallenge,
  verifyAdminSignature,
  createAdminJwt,
} from './services/admin-wallet-auth';

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

// ============================================================================
// Admin Routes
// ============================================================================

// Enable CORS for admin endpoints
app.use('/admin/*', cors());

/**
 * Get admin auth challenge
 * Returns a challenge string for the admin wallet to sign
 */
app.get('/admin/auth/challenge', async (c) => {
  const challenge = await generateAdminChallenge(c.env);
  return c.json({ challenge });
});

/**
 * Verify admin wallet signature and issue JWT
 * Body: { nearAccountId, signature, publicKey, message }
 */
app.post('/admin/auth/verify', async (c) => {
  const body = await c.req.json<{
    nearAccountId: string;
    signature: string;
    publicKey: string;
    message: string;
  }>();

  const { nearAccountId, signature, publicKey, message } = body;

  if (!nearAccountId || !signature || !publicKey || !message) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const result = await verifyAdminSignature(c.env, {
    nearAccountId,
    signature,
    publicKey,
    message,
  });

  if (!result.valid) {
    return c.json({ error: result.error }, 401);
  }

  const token = await createAdminJwt(c.env, nearAccountId);
  return c.json({
    token,
    expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  });
});

// Create admin API router (protected routes)
const adminApi = new Hono<{ Bindings: Env }>();

// Apply admin auth middleware to all admin API routes
adminApi.use('/*', adminAuth);

// Mount admin API handlers (to be added in Task 2)
// GET /admin/api/stats
// GET /admin/api/licenses
// GET /admin/api/subscriptions

// Mount admin API router
app.route('/admin/api', adminApi);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// Export for Cloudflare Workers with scheduled handler
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const result = await handleScheduled(event, env, ctx);
    console.log('Cron summary:', JSON.stringify(result));
  },
};
