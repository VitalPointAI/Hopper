/**
 * Crypto subscription endpoints
 * Handles NEAR Intents-based recurring crypto subscriptions
 */

import type { Context } from 'hono';
import type {
  Env,
  CryptoSubscribeRequest,
  CryptoSubscribeResponse,
  CryptoConfirmResponse,
  CryptoSubscription,
  CryptoSubscriptionStatusResponse,
  CryptoSubscriptionCancelResponse,
} from '../types';
import {
  createSubscriptionIntent,
  checkSubscriptionPayment,
  cancelSubscription as cancelIntentSubscription,
} from '../services/near-intents';
import {
  saveCryptoSubscription,
  getCryptoSubscription,
  getCryptoSubscriptionByIntentId,
  updateCryptoSubscriptionStatus,
  calculateNextChargeDate,
  getDefaultBillingDay,
} from '../services/crypto-subscription-store';
import { grantLicense } from '../services/near-contract';
import { markUpgradeByAccount } from '../services/telemetry-store';

/**
 * POST /api/crypto/subscribe
 * Create a new crypto subscription with NEAR Intents deposit address
 */
export async function handleCryptoSubscribe(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<CryptoSubscribeRequest>();

    // Validate request
    if (!body.nearAccountId) {
      return c.json({ error: 'nearAccountId is required' }, 400);
    }

    // Check if subscription already exists
    const existing = await getCryptoSubscription(
      c.env.CRYPTO_SUBSCRIPTIONS,
      body.nearAccountId
    );
    if (existing && (existing.status === 'active' || existing.status === 'pending')) {
      return c.json(
        {
          error: 'Subscription already exists',
          existingIntentId: existing.intentId,
          status: existing.status,
        },
        409
      );
    }

    // Get billing day (default to current day, capped at 28)
    const billingDay = body.billingDay
      ? Math.min(Math.max(body.billingDay, 1), 28)
      : getDefaultBillingDay();

    // Get monthly amount from config
    const monthlyAmountUsd = c.env.CRYPTO_MONTHLY_USD;

    // Create subscription intent via NEAR Intents 1Click
    const intentResult = await createSubscriptionIntent(
      c.env,
      body.nearAccountId,
      monthlyAmountUsd
    );

    // Calculate initial next charge date (billing day this month or next)
    const today = new Date();
    let nextChargeDate: string;
    if (today.getDate() <= billingDay) {
      // Billing day is still ahead this month
      const chargeDate = new Date(today);
      chargeDate.setDate(billingDay);
      chargeDate.setUTCHours(0, 0, 0, 0);
      nextChargeDate = chargeDate.toISOString();
    } else {
      // Billing day has passed, set to next month
      nextChargeDate = calculateNextChargeDate(billingDay, today);
    }

    // Create pending subscription record
    const subscription: CryptoSubscription = {
      nearAccountId: body.nearAccountId,
      intentId: intentResult.intentId,
      monthlyAmountUsd,
      billingDay,
      status: 'pending',
      retryCount: 0,
      lastChargeDate: null,
      nextChargeDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save to KV
    await saveCryptoSubscription(c.env.CRYPTO_SUBSCRIPTIONS, subscription);

    // Build payment page URL (our own page with near-connect wallet selector)
    const baseUrl = c.req.url.replace(/\/api\/crypto\/subscribe$/, '');
    const paymentUrl = `${baseUrl}/pay/${encodeURIComponent(intentResult.intentId)}`;

    // Return response with our payment page URL
    const response: CryptoSubscribeResponse = {
      intentId: intentResult.intentId,
      authorizationUrl: paymentUrl,
      monthlyAmount: monthlyAmountUsd,
    };

    return c.json(response, 201);
  } catch (error) {
    console.error('Error creating crypto subscription:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to create subscription' },
      500
    );
  }
}

/**
 * POST /api/crypto/subscribe/init
 * Initialize crypto subscription without requiring wallet auth
 * Returns payment page URL where user will connect wallet and pay
 */
export async function handleCryptoSubscribeInit(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<{ sessionId?: string }>();

    // Generate session ID if not provided
    const sessionId = body.sessionId || crypto.randomUUID();

    // Get monthly amount from config
    const monthlyAmountUsd = c.env.CRYPTO_MONTHLY_USD;

    // Create NEAR Intents deposit address using session ID as temporary identifier
    const intentResult = await createSubscriptionIntent(
      c.env,
      sessionId, // Use session ID as temporary identifier
      monthlyAmountUsd
    );

    // Store pending subscription with session ID (no nearAccountId yet)
    const subscription: CryptoSubscription = {
      nearAccountId: '', // Will be set when wallet connects
      sessionId,
      intentId: intentResult.intentId,
      monthlyAmountUsd,
      billingDay: getDefaultBillingDay(),
      status: 'pending',
      retryCount: 0,
      lastChargeDate: null,
      nextChargeDate: null, // Will be set when activated
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveCryptoSubscription(c.env.CRYPTO_SUBSCRIPTIONS, subscription);

    // Return payment page URL
    const baseUrl = c.req.url.replace(/\/api\/crypto\/subscribe\/init$/, '');
    const paymentUrl = `${baseUrl}/pay/${encodeURIComponent(intentResult.intentId)}`;

    return c.json({
      intentId: intentResult.intentId,
      paymentUrl,
      sessionId,
    }, 201);
  } catch (error) {
    console.error('Error initializing crypto subscription:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to initialize subscription' },
      500
    );
  }
}

/**
 * POST /api/crypto/subscribe/link
 * Link wallet account to pending subscription
 * Called after wallet connects on payment page, before payment
 */
export async function handleCryptoSubscribeLink(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<{ intentId: string; nearAccountId: string }>();

    if (!body.intentId || !body.nearAccountId) {
      return c.json({ error: 'intentId and nearAccountId required' }, 400);
    }

    const subscription = await getCryptoSubscriptionByIntentId(
      c.env.CRYPTO_SUBSCRIPTIONS,
      body.intentId
    );

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    if (subscription.status !== 'pending') {
      return c.json({ error: 'Subscription already processed' }, 409);
    }

    // Update subscription with wallet account
    subscription.nearAccountId = body.nearAccountId;
    subscription.updatedAt = new Date().toISOString();

    await saveCryptoSubscription(c.env.CRYPTO_SUBSCRIPTIONS, subscription);

    return c.json({ success: true });
  } catch (error) {
    console.error('Error linking wallet to subscription:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to link wallet' },
      500
    );
  }
}

/**
 * POST /api/crypto/subscribe/confirm
 * Confirm subscription after user sends first payment
 * Verifies payment received and grants initial license
 */
export async function handleCryptoSubscribeConfirm(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<{ intentId: string }>();

    if (!body.intentId) {
      return c.json({ error: 'intentId is required' }, 400);
    }

    // Find subscription by intent ID
    const subscription = await getCryptoSubscriptionByIntentId(
      c.env.CRYPTO_SUBSCRIPTIONS,
      body.intentId
    );

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    if (subscription.status === 'active') {
      return c.json({ error: 'Subscription already active' }, 409);
    }

    // Check if payment has been received
    const paymentResult = await checkSubscriptionPayment(c.env, body.intentId);

    if (!paymentResult.success) {
      return c.json(
        {
          error: 'Payment not yet received',
          status: paymentResult.status,
          details: 'Please send payment to the deposit address and try again',
        },
        402
      );
    }

    // Payment received - grant initial license
    const durationDays = parseInt(c.env.LICENSE_DURATION_DAYS, 10);
    const licenseResult = await grantLicense(
      c.env,
      subscription.nearAccountId,
      durationDays
    );

    if (!licenseResult.success) {
      console.error('Failed to grant license:', licenseResult.error);
      return c.json(
        {
          error: 'Payment received but failed to grant license',
          details: licenseResult.error,
        },
        500
      );
    }

    // Calculate next charge date
    const nextChargeDate = calculateNextChargeDate(subscription.billingDay);

    // Update subscription status to active
    await updateCryptoSubscriptionStatus(
      c.env.CRYPTO_SUBSCRIPTIONS,
      subscription.nearAccountId,
      'active',
      {
        lastChargeDate: new Date().toISOString(),
        nextChargeDate,
        retryCount: 0,
      }
    );

    // Mark installation as upgraded (for conversion tracking)
    await markUpgradeByAccount(c.env.TELEMETRY, subscription.nearAccountId);

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const response: CryptoConfirmResponse = {
      success: true,
      license: {
        days: durationDays,
        expiresAt: expiresAt.toISOString(),
      },
    };

    return c.json(response);
  } catch (error) {
    console.error('Error confirming crypto subscription:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to confirm subscription' },
      500
    );
  }
}

/**
 * GET /api/crypto/subscription/status
 * Get subscription status for a NEAR account
 */
export async function handleCryptoSubscriptionStatus(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const nearAccountId = c.req.query('nearAccountId');

  if (!nearAccountId) {
    return c.json({ error: 'nearAccountId query parameter is required' }, 400);
  }

  const subscription = await getCryptoSubscription(
    c.env.CRYPTO_SUBSCRIPTIONS,
    nearAccountId
  );

  if (!subscription) {
    const response: CryptoSubscriptionStatusResponse = {
      status: 'none',
      nextChargeDate: null,
      monthlyAmount: c.env.CRYPTO_MONTHLY_USD,
      nearAccountId,
    };
    return c.json(response);
  }

  const response: CryptoSubscriptionStatusResponse = {
    status: subscription.status,
    nextChargeDate: subscription.nextChargeDate,
    monthlyAmount: subscription.monthlyAmountUsd,
    nearAccountId: subscription.nearAccountId,
  };

  return c.json(response);
}

/**
 * POST /api/crypto/subscription/cancel
 * Cancel a crypto subscription
 * License continues until current period expires
 */
export async function handleCryptoSubscriptionCancel(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<{ nearAccountId: string }>();

    if (!body.nearAccountId) {
      return c.json({ error: 'nearAccountId is required' }, 400);
    }

    const subscription = await getCryptoSubscription(
      c.env.CRYPTO_SUBSCRIPTIONS,
      body.nearAccountId
    );

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    if (subscription.status === 'cancelled') {
      return c.json({ error: 'Subscription already cancelled' }, 409);
    }

    // Cancel on our side (NEAR Intents deposit address will naturally expire)
    cancelIntentSubscription();

    // Update status to cancelled
    await updateCryptoSubscriptionStatus(
      c.env.CRYPTO_SUBSCRIPTIONS,
      body.nearAccountId,
      'cancelled'
    );

    // Calculate when current license expires
    // License lasts LICENSE_DURATION_DAYS from last charge
    const durationDays = parseInt(c.env.LICENSE_DURATION_DAYS, 10);
    const activeUntil = new Date(subscription.lastChargeDate || subscription.createdAt);
    activeUntil.setDate(activeUntil.getDate() + durationDays);

    const response: CryptoSubscriptionCancelResponse = {
      cancelledAt: new Date().toISOString(),
      activeUntil: activeUntil.toISOString(),
    };

    return c.json(response);
  } catch (error) {
    console.error('Error cancelling crypto subscription:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to cancel subscription' },
      500
    );
  }
}
