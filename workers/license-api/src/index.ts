import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
// NOTE: cron-handler imported dynamically to avoid loading SDK at startup
// import { handleScheduled } from './handlers/cron-handler';
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
 * Initialize crypto subscription without wallet auth
 * Body: { sessionId?: string }
 * Returns payment page URL where user will connect wallet
 */
app.post('/api/crypto/subscribe/init', async (c) => {
  const { handleCryptoSubscribeInit } = await import('./handlers/crypto-subscribe');
  return handleCryptoSubscribeInit(c);
});

/**
 * Link wallet account to pending subscription
 * Body: { intentId: string, nearAccountId: string }
 */
app.post('/api/crypto/subscribe/link', async (c) => {
  const { handleCryptoSubscribeLink } = await import('./handlers/crypto-subscribe');
  return handleCryptoSubscribeLink(c);
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

/**
 * Get supported tokens for crypto payment
 * Returns list of tokens with pricing info
 */
app.get('/api/crypto/tokens', async (c) => {
  const { handleGetTokens } = await import('./handlers/crypto-tokens');
  return handleGetTokens(c);
});

/**
 * Get quote for paying with a specific token
 * Body: { originAsset, amountUsd, nearAccountId }
 */
app.post('/api/crypto/quote', async (c) => {
  const { handleGetQuote } = await import('./handlers/crypto-tokens');
  return handleGetQuote(c);
});

/**
 * Create payment quote with deposit address
 * Body: { originAsset, amountUsd, nearAccountId }
 */
app.post('/api/crypto/payment-quote', async (c) => {
  const { handleCreatePaymentQuote } = await import('./handlers/crypto-tokens');
  return handleCreatePaymentQuote(c);
});

/**
 * Get tokens the user has in their wallet with balances and required amounts
 * Query: ?nearAccountId=xxx&amountUsd=4.00
 */
app.get('/api/crypto/wallet-tokens', async (c) => {
  const { handleGetWalletTokens } = await import('./handlers/crypto-tokens');
  return handleGetWalletTokens(c);
});

/**
 * Telemetry endpoint for extension analytics
 * Public endpoint (no auth required)
 * Body: { event, installId, extensionVersion, vscodeVersion, platform, nearAccountId?, source? }
 */
app.post('/api/telemetry', async (c) => {
  const { handleTelemetry } = await import('./handlers/telemetry');
  return handleTelemetry(c);
});

/**
 * License check endpoint for authenticated users
 * OAuth users: Returns license status from USER_LICENSES KV
 * Wallet users: Should check NEAR contract directly
 * Headers: Authorization: Bearer {jwt}
 */
app.get('/api/license/check', async (c) => {
  const { handleLicenseCheck } = await import('./handlers/license-check');
  return handleLicenseCheck(c);
});

// ============================================================================
// User Authentication Routes
// ============================================================================

// Enable CORS for auth endpoints
app.use('/auth/*', cors());

/**
 * Multi-chain wallet authentication page
 * Displays wallet selector for NEAR, Ethereum, Solana, etc.
 * Query params: callback, network
 */
app.get('/auth/wallet', async (c) => {
  const { handleWalletAuthPage } = await import('./handlers/wallet-auth-ui');
  return handleWalletAuthPage(c);
});

/**
 * User wallet authentication page (legacy NEAR-only)
 * Displays wallet selector for signing authentication message
 * Query params: nonce, timestamp, message, callback
 */
app.get('/auth/sign', async (c) => {
  const { handleUserSignPage } = await import('./handlers/user-auth');
  return handleUserSignPage(c);
});

/**
 * Verify user wallet signature and return JWT
 * Body: { nearAccountId, signature, publicKey, message, nonce?, recipient? }
 */
app.post('/auth/verify', async (c) => {
  const { handleUserVerify } = await import('./handlers/user-auth');
  return handleUserVerify(c);
});

// ============================================================================
// OAuth Authentication Routes
// ============================================================================

/**
 * Start Google OAuth flow
 * Query: callback (required) - VSCode callback URL
 */
app.get('/auth/oauth/google', async (c) => {
  const { handleGoogleAuth } = await import('./handlers/oauth-auth');
  return handleGoogleAuth(c);
});

/**
 * Google OAuth callback
 * Handles authorization code exchange and user info fetch
 */
app.get('/auth/oauth/google/callback', async (c) => {
  const { handleGoogleCallback } = await import('./handlers/oauth-auth');
  return handleGoogleCallback(c);
});

/**
 * Start GitHub OAuth flow
 * Query: callback (required) - VSCode callback URL
 */
app.get('/auth/oauth/github', async (c) => {
  const { handleGitHubAuth } = await import('./handlers/oauth-auth');
  return handleGitHubAuth(c);
});

/**
 * GitHub OAuth callback
 * Handles authorization code exchange and user info fetch
 */
app.get('/auth/oauth/github/callback', async (c) => {
  const { handleGitHubCallback } = await import('./handlers/oauth-auth');
  return handleGitHubCallback(c);
});

// ============================================================================
// Email Authentication Routes
// ============================================================================

/**
 * Register new email user
 * Body: { email, password, displayName? }
 */
app.post('/auth/email/register', async (c) => {
  const { handleEmailRegister } = await import('./handlers/email-auth');
  return handleEmailRegister(c);
});

/**
 * Login existing email user
 * Body: { email, password }
 */
app.post('/auth/email/login', async (c) => {
  const { handleEmailLogin } = await import('./handlers/email-auth');
  return handleEmailLogin(c);
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
 * Body: { nearAccountId, signature, publicKey, message, nonce?, recipient? }
 */
app.post('/admin/auth/verify', async (c) => {
  const body = await c.req.json<{
    nearAccountId: string;
    signature: string;
    publicKey: string;
    message: string;
    nonce?: number[];
    recipient?: string;
  }>();

  const { nearAccountId, signature, publicKey, message, nonce, recipient } = body;

  if (!nearAccountId || !signature || !publicKey || !message) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const result = await verifyAdminSignature(c.env, {
    nearAccountId,
    signature,
    publicKey,
    message,
    nonce,
    recipient,
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

// Admin API endpoints
adminApi.get('/stats', async (c) => {
  const { handleAdminStats } = await import('./handlers/admin/stats');
  return handleAdminStats(c);
});

adminApi.get('/licenses', async (c) => {
  const { handleAdminLicenses } = await import('./handlers/admin/licenses');
  return handleAdminLicenses(c);
});

adminApi.get('/subscriptions', async (c) => {
  const { handleAdminSubscriptions } = await import('./handlers/admin/subscriptions');
  return handleAdminSubscriptions(c);
});

// Admin action endpoints
adminApi.post('/licenses/grant', async (c) => {
  const { handleAdminGrantLicense } = await import('./handlers/admin/actions');
  return handleAdminGrantLicense(c);
});

adminApi.post('/licenses/revoke', async (c) => {
  const { handleAdminRevokeLicense } = await import('./handlers/admin/actions');
  return handleAdminRevokeLicense(c);
});

adminApi.post('/subscriptions/cancel', async (c) => {
  const { handleAdminCancelSubscription } = await import('./handlers/admin/actions');
  return handleAdminCancelSubscription(c);
});

// Mount admin API router
app.route('/admin/api', adminApi);

// ============================================================================
// Admin UI Routes (public pages - auth handled client-side via localStorage JWT)
// ============================================================================

/**
 * Admin root redirect
 */
app.get('/admin', async (c) => {
  const { handleAdminRoot } = await import('./handlers/admin/ui');
  return handleAdminRoot(c);
});

/**
 * Admin login page
 */
app.get('/admin/login', async (c) => {
  const { handleAdminLogin } = await import('./handlers/admin/ui');
  return handleAdminLogin(c);
});

/**
 * Admin dashboard page
 */
app.get('/admin/dashboard', async (c) => {
  const { handleAdminDashboard } = await import('./handlers/admin/ui');
  return handleAdminDashboard(c);
});

/**
 * Admin licenses page
 */
app.get('/admin/licenses', async (c) => {
  const { handleAdminLicensesPage } = await import('./handlers/admin/ui');
  return handleAdminLicensesPage(c);
});

/**
 * Admin subscriptions page
 */
app.get('/admin/subscriptions', async (c) => {
  const { handleAdminSubscriptionsPage } = await import('./handlers/admin/ui');
  return handleAdminSubscriptionsPage(c);
});

// ============================================================================
// Crypto Payment UI Routes
// ============================================================================

/**
 * Crypto payment page
 * Shows wallet selector for cross-chain payments
 */
app.get('/pay/:intentId', async (c) => {
  const { handleCryptoPaymentPage } = await import('./handlers/crypto-payment-ui');
  return handleCryptoPaymentPage(c);
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

// Export for Cloudflare Workers with scheduled handler
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Dynamic import to avoid loading SDK at worker startup
    const { handleScheduled } = await import('./handlers/cron-handler');
    const result = await handleScheduled(event, env, ctx);
    console.log('Cron summary:', JSON.stringify(result));
  },
};
