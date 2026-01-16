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
  console.log('[subscribe] Handler started');
  try {
    const body = await c.req.json<CryptoSubscribeRequest>();
    console.log('[subscribe] Body:', JSON.stringify(body));

    // Validate request
    if (!body.nearAccountId) {
      console.log('[subscribe] Missing nearAccountId');
      return c.json({ error: 'nearAccountId is required' }, 400);
    }

    // Check if subscription already exists
    console.log('[subscribe] Checking for existing subscription for:', body.nearAccountId);
    const existing = await getCryptoSubscription(
      c.env.CRYPTO_SUBSCRIPTIONS,
      body.nearAccountId
    );
    console.log('[subscribe] Existing subscription:', existing ? JSON.stringify(existing) : 'none');
    if (existing && (existing.status === 'active' || existing.status === 'pending')) {
      console.log('[subscribe] Returning 409 with existingIntentId:', existing.intentId);

      // Re-save to ensure all indexes exist (fixes missing intent ID index issue)
      await saveCryptoSubscription(c.env.CRYPTO_SUBSCRIPTIONS, existing);
      console.log('[subscribe] Re-saved existing subscription to refresh indexes');

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
    console.log('[subscribe] Saving subscription to KV with intentId:', subscription.intentId);
    await saveCryptoSubscription(c.env.CRYPTO_SUBSCRIPTIONS, subscription);
    console.log('[subscribe] Subscription saved');

    // Verify the save was successful by reading it back
    const verifySubscription = await getCryptoSubscriptionByIntentId(
      c.env.CRYPTO_SUBSCRIPTIONS,
      subscription.intentId
    );
    console.log('[subscribe] Verify read-back:', verifySubscription ? 'SUCCESS' : 'FAILED');
    if (!verifySubscription) {
      console.error('[subscribe] KV write verification FAILED for intentId:', subscription.intentId);
    }

    // Build payment page URL (our own page with near-connect wallet selector)
    const baseUrl = c.req.url.replace(/\/api\/crypto\/subscribe$/, '');
    const paymentUrl = `${baseUrl}/pay/${encodeURIComponent(intentResult.intentId)}`;
    console.log('[subscribe] Payment URL:', paymentUrl);

    // Return response with our payment page URL
    const response: CryptoSubscribeResponse = {
      intentId: intentResult.intentId,
      authorizationUrl: paymentUrl,
      monthlyAmount: monthlyAmountUsd,
    };

    console.log('[subscribe] Returning response:', JSON.stringify(response));
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
  console.log('[init] Handler started');
  try {
    // Validate required configuration early to prevent crashes
    if (!c.env.CRYPTO_MONTHLY_USD) {
      console.error('[init] Missing CRYPTO_MONTHLY_USD configuration');
      return c.json({ error: 'Crypto subscriptions not configured' }, 503);
    }
    if (!c.env.NEAR_INTENTS_API_URL) {
      console.error('[init] Missing NEAR_INTENTS_API_URL configuration');
      return c.json({ error: 'Payment service not configured' }, 503);
    }
    if (!c.env.SETTLEMENT_ACCOUNT) {
      console.error('[init] Missing SETTLEMENT_ACCOUNT configuration');
      return c.json({ error: 'Settlement account not configured' }, 503);
    }

    const body = await c.req.json<{ sessionId?: string }>();
    console.log('[init] Body parsed:', JSON.stringify(body));

    // Generate session ID if not provided
    const sessionId = body.sessionId || crypto.randomUUID();
    console.log('[init] Session ID:', sessionId);

    // Get monthly amount from config
    const monthlyAmountUsd = c.env.CRYPTO_MONTHLY_USD;
    console.log('[init] Monthly USD:', monthlyAmountUsd);
    console.log('[init] NEAR_INTENTS_API_URL:', c.env.NEAR_INTENTS_API_URL);
    console.log('[init] Has NEAR_INTENTS_API_KEY:', !!c.env.NEAR_INTENTS_API_KEY);

    // Create NEAR Intents deposit address using session ID as temporary identifier
    console.log('[init] Calling createSubscriptionIntent...');
    const intentResult = await createSubscriptionIntent(
      c.env,
      sessionId, // Use session ID as temporary identifier
      monthlyAmountUsd
    );
    console.log('[init] Intent created:', intentResult.intentId);

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
 *
 * Supports any wallet address from any chain (NEAR, EVM, Solana, etc.)
 */
export async function handleCryptoSubscribeLink(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<{
      intentId: string;
      walletAddress: string;
      chain: string;
      nearAccountId?: string; // @deprecated - use walletAddress
    }>();

    // Support both new walletAddress and legacy nearAccountId
    const walletAddress = body.walletAddress || body.nearAccountId;
    const chain = body.chain || 'near';

    if (!body.intentId || !walletAddress) {
      return c.json({ error: 'intentId and walletAddress required' }, 400);
    }

    console.log('[link] Linking wallet:', { intentId: body.intentId, walletAddress, chain });

    const subscription = await getCryptoSubscriptionByIntentId(
      c.env.CRYPTO_SUBSCRIPTIONS,
      body.intentId
    );

    if (!subscription) {
      console.log('[link] Subscription not found for intentId:', body.intentId);
      return c.json({ error: 'Subscription not found' }, 404);
    }

    if (subscription.status !== 'pending') {
      return c.json({ error: 'Subscription already processed' }, 409);
    }

    // Update subscription with wallet account
    subscription.walletAddress = walletAddress;
    subscription.walletChain = chain;
    subscription.nearAccountId = walletAddress; // Keep for backwards compatibility
    subscription.updatedAt = new Date().toISOString();

    await saveCryptoSubscription(c.env.CRYPTO_SUBSCRIPTIONS, subscription);
    console.log('[link] Wallet linked successfully');

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
 *
 * Accepts either intentId or nearAccountId for lookup
 */
export async function handleCryptoSubscribeConfirm(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<{
      intentId?: string;
      nearAccountId?: string;
      depositAddress?: string; // Optional: actual deposit address to check (useful for recovery)
    }>();

    if (!body.intentId && !body.nearAccountId) {
      return c.json({ error: 'intentId or nearAccountId is required' }, 400);
    }

    // Find subscription by intent ID or NEAR account ID
    let subscription;
    if (body.intentId) {
      subscription = await getCryptoSubscriptionByIntentId(
        c.env.CRYPTO_SUBSCRIPTIONS,
        body.intentId
      );
    }

    // Fallback to lookup by NEAR account ID
    if (!subscription && body.nearAccountId) {
      subscription = await getCryptoSubscription(
        c.env.CRYPTO_SUBSCRIPTIONS,
        body.nearAccountId
      );
    }

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404);
    }

    if (subscription.status === 'active') {
      return c.json({ error: 'Subscription already active' }, 409);
    }

    // CRITICAL: Use the actual payment deposit address if available
    // Priority: 1) body.depositAddress (explicit override), 2) subscription.paymentDepositAddress, 3) intentId
    // The intentId is the initial deposit address created with INTENTS deposit type,
    // but the actual payment uses a NEW deposit address from payment-quote with ORIGIN_CHAIN type.
    const depositAddressToCheck = body.depositAddress || subscription.paymentDepositAddress || body.intentId || subscription.intentId;

    console.log('[confirm] Checking payment status:', {
      intentId: body.intentId,
      nearAccountId: body.nearAccountId,
      explicitDepositAddress: body.depositAddress,
      storedPaymentDepositAddress: subscription.paymentDepositAddress,
      storedIntentId: subscription.intentId,
      usingAddress: depositAddressToCheck,
    });

    // Check if payment has been received
    const paymentResult = await checkSubscriptionPayment(c.env, depositAddressToCheck);

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

    // Get the wallet address (prefer new field, fallback to legacy)
    const walletAddress = subscription.walletAddress || subscription.nearAccountId;
    const walletChain = subscription.walletChain || 'near';

    if (!walletAddress) {
      console.error('[confirm] No wallet address linked to subscription');
      return c.json(
        {
          error: 'Payment received but no wallet linked',
          details: 'Please connect your wallet before completing payment',
        },
        400
      );
    }

    // Payment received - grant initial license
    const durationDays = parseInt(c.env.LICENSE_DURATION_DAYS, 10);
    const licenseResult = await grantLicense(
      c.env,
      walletAddress,
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

    // Update subscription status to active (use walletAddress as key)
    await updateCryptoSubscriptionStatus(
      c.env.CRYPTO_SUBSCRIPTIONS,
      walletAddress,
      'active',
      {
        lastChargeDate: new Date().toISOString(),
        nextChargeDate,
        retryCount: 0,
      }
    );

    // Mark installation as upgraded (for conversion tracking)
    await markUpgradeByAccount(c.env.TELEMETRY, walletAddress);

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    // Build VSCode callback URL for wallet authentication
    // Include chain info so VSCode knows how to handle non-NEAR addresses
    const vscodeCallback = `vscode://vitalpointai.specflow/auth-callback?` +
      `type=wallet&` +
      `accountId=${encodeURIComponent(walletAddress)}&` +
      `chain=${encodeURIComponent(walletChain)}&` +
      `status=success`;

    return c.json({
      success: true,
      license: {
        days: durationDays,
        expiresAt: expiresAt.toISOString(),
      },
      walletAddress,
      walletChain,
      redirectUrl: vscodeCallback,
    });
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
