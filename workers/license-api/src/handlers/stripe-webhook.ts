/**
 * Stripe webhook handler for subscription events
 * Handles: invoice.paid, customer.subscription.updated, customer.subscription.deleted
 *
 * Routes license grants based on auth_type metadata:
 * - OAuth users: Grant license in USER_LICENSES KV
 * - Wallet users: Grant license on NEAR contract
 */

import type { Context } from 'hono';
import Stripe from 'stripe';
import type { Env, SubscriptionRecord } from '../types';
import { isProcessed, markProcessed } from '../services/idempotency';
import { grantLicense } from '../services/near-contract';
import { grantOAuthLicense } from '../services/oauth-license-store';
import {
  saveSubscription,
  updateSubscriptionStatus,
  getSubscriptionByCustomerId,
} from '../services/subscription-store';
import { markUpgradeByAccount } from '../services/telemetry-store';

/**
 * Handle Stripe webhook events
 * Uses raw body for signature verification
 */
export async function handleStripeWebhook(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const env = c.env;

  // Get raw body for signature verification
  const rawBody = await c.req.text();
  const signature = c.req.header('stripe-signature');

  if (!signature) {
    console.error('Missing stripe-signature header');
    return c.json({ error: 'Missing signature' }, 400);
  }

  // Initialize Stripe client
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });

  // Verify webhook signature and construct event
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return c.json({ error: 'Invalid signature' }, 400);
  }

  // Check idempotency - skip if already processed
  if (await isProcessed(env.PROCESSED_EVENTS, event.id)) {
    console.log(`Event ${event.id} already processed, skipping`);
    return c.json({ received: true, status: 'already_processed' });
  }

  console.log(`Processing webhook event: ${event.type} (${event.id})`);

  try {
    // Handle different event types
    switch (event.type) {
      case 'invoice.paid':
        await handleInvoicePaid(env, stripe, event);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(env, event);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(env, event);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Mark event as processed after successful handling
    await markProcessed(env.PROCESSED_EVENTS, event.id);

    return c.json({ received: true });
  } catch (error) {
    console.error(`Error processing event ${event.id}:`, error);
    // Don't mark as processed on error - allow retry
    return c.json({ error: 'Processing failed' }, 500);
  }
}

/**
 * Handle invoice.paid event
 * Routes license grant based on auth_type:
 * - OAuth users: USER_LICENSES KV
 * - Wallet users: NEAR contract
 */
async function handleInvoicePaid(
  env: Env,
  stripe: Stripe,
  event: Stripe.Event
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  // Skip non-subscription invoices
  if (!invoice.subscription) {
    console.log('Invoice not from subscription, skipping');
    return;
  }

  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id;

  if (!customerId) {
    console.error('No customer ID in invoice');
    return;
  }

  // Get customer to retrieve user info from metadata
  const customer = await stripe.customers.retrieve(customerId);

  if (customer.deleted) {
    console.error('Customer has been deleted');
    return;
  }

  // Check auth type from metadata (new field)
  const authType = customer.metadata?.auth_type;
  const userId = customer.metadata?.user_id;
  // Fallback to near_account_id for backward compatibility
  const nearAccountId = customer.metadata?.near_account_id;

  // Determine if this is an OAuth user
  const isOAuthUser = authType === 'oauth' || (userId && userId.startsWith('oauth:'));

  // Get the effective user ID
  const effectiveUserId = userId || nearAccountId;

  if (!effectiveUserId) {
    console.error(`No user_id or near_account_id in customer ${customerId} metadata`);
    return;
  }

  // Get subscription details
  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Calculate license duration
  const durationDays = parseInt(env.LICENSE_DURATION_DAYS, 10) || 30;

  if (isOAuthUser) {
    // OAuth user: grant license in USER_LICENSES KV
    const result = await grantOAuthLicense(
      env.USER_LICENSES,
      effectiveUserId,
      durationDays,
      customerId
    );

    if (!result.success) {
      console.error(`Failed to grant OAuth license to ${effectiveUserId}`);
      throw new Error('OAuth license grant failed');
    }

    console.log(
      `Granted ${durationDays}-day license to OAuth user ${effectiveUserId}, expires: ${new Date(result.expiresAt).toISOString()}`
    );

    // For OAuth users, we don't need to save to SUBSCRIPTIONS KV (they use USER_LICENSES)
    // But we can still track for admin visibility
    const record: SubscriptionRecord = {
      nearAccountId: effectiveUserId, // Using the unified user ID
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      status: subscription.status as SubscriptionRecord['status'],
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveSubscription(env.SUBSCRIPTIONS, record);
  } else {
    // Wallet user: grant license on NEAR contract (existing flow)
    const accountId = nearAccountId || effectiveUserId;
    const result = await grantLicense(env, accountId, durationDays);

    if (!result.success) {
      console.error(`Failed to grant NEAR license: ${result.error}`);
      throw new Error(`NEAR license grant failed: ${result.error}`);
    }

    console.log(
      `Granted ${durationDays}-day license to ${accountId}, tx: ${result.txHash}`
    );

    // Update subscription record in KV
    const record: SubscriptionRecord = {
      nearAccountId: accountId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      status: subscription.status as SubscriptionRecord['status'],
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveSubscription(env.SUBSCRIPTIONS, record);

    // Mark installation as upgraded (for conversion tracking) - only for wallet users
    await markUpgradeByAccount(env.TELEMETRY, accountId);
  }

  console.log(`Updated subscription record for ${effectiveUserId}`);
}

/**
 * Handle customer.subscription.updated event
 * Updates subscription status in KV
 */
async function handleSubscriptionUpdated(
  env: Env,
  event: Stripe.Event
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  // Get existing record to preserve NEAR account ID
  const existing = await getSubscriptionByCustomerId(
    env.SUBSCRIPTIONS,
    customerId
  );

  if (!existing) {
    console.log(`No existing subscription record for customer ${customerId}`);
    // This might happen if subscription was created outside our flow
    // Log and continue - the next invoice.paid will create the record
    return;
  }

  // Update the subscription record
  await updateSubscriptionStatus(
    env.SUBSCRIPTIONS,
    customerId,
    subscription.status as SubscriptionRecord['status'],
    {
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    }
  );

  console.log(
    `Updated subscription status for ${existing.nearAccountId}: ${subscription.status}`
  );
}

/**
 * Handle customer.subscription.deleted event
 * Marks subscription as canceled but license remains valid until expiry
 */
async function handleSubscriptionDeleted(
  env: Env,
  event: Stripe.Event
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  // Get existing record
  const existing = await getSubscriptionByCustomerId(
    env.SUBSCRIPTIONS,
    customerId
  );

  if (!existing) {
    console.log(`No existing subscription record for customer ${customerId}`);
    return;
  }

  // Update status to canceled
  // Note: We don't revoke the license immediately - it remains valid until currentPeriodEnd
  await updateSubscriptionStatus(env.SUBSCRIPTIONS, customerId, 'canceled', {
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: true,
  });

  console.log(
    `Subscription deleted for ${existing.nearAccountId}, license valid until ${new Date(subscription.current_period_end * 1000).toISOString()}`
  );
}
