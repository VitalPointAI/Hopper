/**
 * Subscription management handlers
 * Cancel subscription and get subscription status
 */

import type { Context } from 'hono';
import Stripe from 'stripe';
import type { Env, CancelSubscriptionRequest, SubscriptionStatusResponse } from '../types';
import { getSubscriptionByNearAccount } from '../services/subscription-store';

/**
 * Cancel subscription at period end
 * Does not immediately cancel - subscription remains active until current period ends
 */
export async function handleCancelSubscription(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const env = c.env;

  // Parse request body
  let body: CancelSubscriptionRequest;
  try {
    body = await c.req.json<CancelSubscriptionRequest>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { nearAccountId } = body;

  if (!nearAccountId) {
    return c.json({ error: 'nearAccountId is required' }, 400);
  }

  // Get subscription from KV
  const subscription = await getSubscriptionByNearAccount(
    env.SUBSCRIPTIONS,
    nearAccountId
  );

  if (!subscription) {
    return c.json({ error: 'No subscription found for this account' }, 404);
  }

  // Initialize Stripe client
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    // Cancel at period end (not immediate cancellation)
    const updatedSubscription = await stripe.subscriptions.update(
      subscription.stripeSubscriptionId,
      {
        cancel_at_period_end: true,
      }
    );

    console.log(
      `Subscription ${subscription.stripeSubscriptionId} set to cancel at period end for ${nearAccountId}`
    );

    return c.json({
      success: true,
      cancelledAt: new Date().toISOString(),
      activeUntil: new Date(updatedSubscription.current_period_end * 1000).toISOString(),
    });
  } catch (error) {
    console.error('Failed to cancel subscription:', error);

    if (error instanceof Stripe.errors.StripeError) {
      const statusCode = (error.statusCode || 500) as 400 | 401 | 402 | 403 | 404 | 500;
      return c.json({ error: `Stripe error: ${error.message}` }, statusCode);
    }

    return c.json({ error: 'Failed to cancel subscription' }, 500);
  }
}

/**
 * Get subscription status
 * Returns current subscription details from KV cache
 */
export async function handleGetSubscriptionStatus(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const env = c.env;

  // Get nearAccountId from query params
  const nearAccountId = c.req.query('nearAccountId');

  if (!nearAccountId) {
    return c.json({ error: 'nearAccountId query parameter is required' }, 400);
  }

  // Get subscription from KV
  const subscription = await getSubscriptionByNearAccount(
    env.SUBSCRIPTIONS,
    nearAccountId
  );

  if (!subscription) {
    const response: SubscriptionStatusResponse = {
      status: 'none',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      nearAccountId,
    };
    return c.json(response);
  }

  const response: SubscriptionStatusResponse = {
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    nearAccountId,
  };

  return c.json(response);
}
