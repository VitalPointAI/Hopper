/**
 * Admin action endpoint handlers
 * POST /admin/api/licenses/grant
 * POST /admin/api/licenses/revoke
 * POST /admin/api/subscriptions/cancel
 */

import type { Context } from 'hono';
import type { Env, SubscriptionRecord, CryptoSubscription } from '../../types';
import { grantLicense } from '../../services/near-contract';
import { getSubscriptionByNearAccount } from '../../services/subscription-store';
import {
  getCryptoSubscription,
  updateCryptoSubscriptionStatus,
} from '../../services/crypto-subscription-store';
import Stripe from 'stripe';

/**
 * Validate NEAR account ID format
 * Valid: lowercase alphanumeric, hyphens, underscores, periods
 * Length: 2-64 characters, or 64 hex characters for implicit accounts
 */
function isValidNearAccountId(accountId: string): boolean {
  if (!accountId || typeof accountId !== 'string') {
    return false;
  }

  // Implicit accounts (64 hex characters)
  if (/^[0-9a-f]{64}$/.test(accountId)) {
    return true;
  }

  // Named accounts: 2-64 chars, lowercase alphanumeric, hyphens, underscores, periods
  // Must not start or end with hyphen/underscore/period
  // Must not have consecutive periods
  if (accountId.length < 2 || accountId.length > 64) {
    return false;
  }

  return /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9_-]*[a-z0-9])?)*$/.test(
    accountId
  );
}

/**
 * POST /admin/api/licenses/grant
 * Grant a license to a NEAR account
 */
export async function handleAdminGrantLicense(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<{
      nearAccountId: string;
      durationDays: number;
    }>();

    const { nearAccountId, durationDays } = body;

    // Validate inputs
    if (!nearAccountId) {
      return c.json({ success: false, error: 'nearAccountId is required' }, 400);
    }

    if (!isValidNearAccountId(nearAccountId)) {
      return c.json(
        { success: false, error: 'Invalid NEAR account ID format' },
        400
      );
    }

    if (!durationDays || typeof durationDays !== 'number') {
      return c.json({ success: false, error: 'durationDays is required' }, 400);
    }

    if (durationDays < 1 || durationDays > 365) {
      return c.json(
        { success: false, error: 'durationDays must be between 1 and 365' },
        400
      );
    }

    // Grant license on NEAR contract
    const result = await grantLicense(c.env, nearAccountId, durationDays);

    if (!result.success) {
      return c.json(
        {
          success: false,
          error: result.error || 'Failed to grant license',
        },
        500
      );
    }

    // Calculate expiry timestamp
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + durationDays);

    // Store admin grant in KV for discoverability in license list
    // Uses SUBSCRIPTIONS KV with admin_grant: prefix
    await c.env.SUBSCRIPTIONS.put(
      `admin_grant:${nearAccountId}`,
      JSON.stringify({
        nearAccountId,
        grantedAt: new Date().toISOString(),
        durationDays,
        expiry: expiryDate.toISOString(),
        txHash: result.txHash,
      })
    );

    console.log(`Admin granted license to ${nearAccountId} for ${durationDays} days, stored in KV`);

    return c.json({
      success: true,
      nearAccountId,
      durationDays,
      expiry: expiryDate.toISOString(),
      txHash: result.txHash,
    });
  } catch (error) {
    console.error('Error granting license:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}

/**
 * POST /admin/api/licenses/revoke
 * Revoke a license from a NEAR account
 *
 * Note: The current NEAR contract only supports grant_license which extends expiry.
 * There is no revoke_license method. We return an error explaining this limitation.
 */
export async function handleAdminRevokeLicense(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const body = await c.req.json<{ nearAccountId: string }>();

  if (!body.nearAccountId) {
    return c.json({ success: false, error: 'nearAccountId is required' }, 400);
  }

  if (!isValidNearAccountId(body.nearAccountId)) {
    return c.json(
      { success: false, error: 'Invalid NEAR account ID format' },
      400
    );
  }

  // License revocation not yet supported
  // The NEAR contract uses grant_license which calculates:
  //   new_expiry = max(current_expiry, now) + duration_days
  // So granting 0 days would still extend from max(current, now)
  // We need a dedicated revoke_license method in the contract
  return c.json(
    {
      success: false,
      error: 'License revocation not yet supported',
      details:
        'The NEAR contract requires a revoke_license method to be added. ' +
        'For now, licenses can only be granted and will expire naturally. ' +
        'See ISS-XXX for tracking.',
    },
    501 // Not Implemented
  );
}

/**
 * POST /admin/api/subscriptions/cancel
 * Cancel a subscription (Stripe or crypto)
 */
export async function handleAdminCancelSubscription(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<{
      nearAccountId: string;
      type: 'stripe' | 'crypto';
    }>();

    const { nearAccountId, type } = body;

    if (!nearAccountId) {
      return c.json({ success: false, error: 'nearAccountId is required' }, 400);
    }

    if (!isValidNearAccountId(nearAccountId)) {
      return c.json(
        { success: false, error: 'Invalid NEAR account ID format' },
        400
      );
    }

    if (!type || !['stripe', 'crypto'].includes(type)) {
      return c.json(
        { success: false, error: 'type must be "stripe" or "crypto"' },
        400
      );
    }

    if (type === 'stripe') {
      return await cancelStripeSubscription(c, nearAccountId);
    } else {
      return await cancelCryptoSubscription(c, nearAccountId);
    }
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
}

/**
 * Cancel Stripe subscription for a NEAR account
 */
async function cancelStripeSubscription(
  c: Context<{ Bindings: Env }>,
  nearAccountId: string
): Promise<Response> {
  // Get subscription from KV
  const subscription = await getSubscriptionByNearAccount(
    c.env.SUBSCRIPTIONS,
    nearAccountId
  );

  if (!subscription) {
    return c.json(
      { success: false, error: 'No Stripe subscription found for this account' },
      404
    );
  }

  // Initialize Stripe client
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });

  // Cancel at period end
  const updatedSubscription = await stripe.subscriptions.update(
    subscription.stripeSubscriptionId,
    { cancel_at_period_end: true }
  );

  console.log(
    `Admin cancelled Stripe subscription ${subscription.stripeSubscriptionId} for ${nearAccountId}`
  );

  return c.json({
    success: true,
    type: 'stripe',
    nearAccountId,
    cancelledAt: new Date().toISOString(),
    activeUntil: new Date(
      updatedSubscription.current_period_end * 1000
    ).toISOString(),
  });
}

/**
 * Cancel crypto subscription for a NEAR account
 */
async function cancelCryptoSubscription(
  c: Context<{ Bindings: Env }>,
  nearAccountId: string
): Promise<Response> {
  // Get subscription from KV
  const subscription = await getCryptoSubscription(
    c.env.CRYPTO_SUBSCRIPTIONS,
    nearAccountId
  );

  if (!subscription) {
    return c.json(
      { success: false, error: 'No crypto subscription found for this account' },
      404
    );
  }

  if (subscription.status === 'cancelled') {
    return c.json(
      { success: false, error: 'Subscription already cancelled' },
      409
    );
  }

  // Update status to cancelled
  await updateCryptoSubscriptionStatus(
    c.env.CRYPTO_SUBSCRIPTIONS,
    nearAccountId,
    'cancelled'
  );

  // Calculate when current license expires
  const durationDays = parseInt(c.env.LICENSE_DURATION_DAYS, 10);
  const activeUntil = new Date(
    subscription.lastChargeDate || subscription.createdAt
  );
  activeUntil.setDate(activeUntil.getDate() + durationDays);

  console.log(`Admin cancelled crypto subscription for ${nearAccountId}`);

  return c.json({
    success: true,
    type: 'crypto',
    nearAccountId,
    cancelledAt: new Date().toISOString(),
    activeUntil: activeUntil.toISOString(),
  });
}
