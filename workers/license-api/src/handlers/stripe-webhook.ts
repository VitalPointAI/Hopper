/**
 * Stripe webhook handler for subscription events
 * Handles: invoice.paid, customer.subscription.updated, customer.subscription.deleted
 */

import type { Context } from 'hono';
import Stripe from 'stripe';
import type { Env, SubscriptionRecord } from '../types';
import { isProcessed, markProcessed } from '../services/idempotency';
import { grantLicense } from '../services/near-contract';
import {
  saveSubscription,
  updateSubscriptionStatus,
  getSubscriptionByCustomerId,
} from '../services/subscription-store';

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
 * Extends license for another billing period
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

  // Get customer to retrieve NEAR account ID from metadata
  const customer = await stripe.customers.retrieve(customerId);

  if (customer.deleted) {
    console.error('Customer has been deleted');
    return;
  }

  const nearAccountId = customer.metadata?.near_account_id;

  if (!nearAccountId) {
    console.error(`No near_account_id in customer ${customerId} metadata`);
    return;
  }

  // Get subscription details
  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Grant license on NEAR contract
  const durationDays = parseInt(env.LICENSE_DURATION_DAYS, 10) || 30;
  const result = await grantLicense(env, nearAccountId, durationDays);

  if (!result.success) {
    console.error(`Failed to grant license: ${result.error}`);
    throw new Error(`License grant failed: ${result.error}`);
  }

  console.log(
    `Granted ${durationDays}-day license to ${nearAccountId}, tx: ${result.txHash}`
  );

  // Update subscription record in KV
  const record: SubscriptionRecord = {
    nearAccountId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status: subscription.status as SubscriptionRecord['status'],
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await saveSubscription(env.SUBSCRIPTIONS, record);

  console.log(`Updated subscription record for ${nearAccountId}`);
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
