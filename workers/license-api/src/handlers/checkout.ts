/**
 * Stripe checkout handler for subscription creation
 * Creates checkout sessions in subscription mode
 */

import type { Context } from 'hono';
import Stripe from 'stripe';
import type { Env, CheckoutRequest, CheckoutResponse } from '../types';

/**
 * Handle checkout request
 * Creates a Stripe checkout session for subscription
 */
export async function handleCheckout(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const env = c.env;

  // Parse request body
  let body: CheckoutRequest;
  try {
    body = await c.req.json<CheckoutRequest>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Validate required fields
  const { nearAccountId, successUrl, cancelUrl } = body;

  if (!nearAccountId) {
    return c.json({ error: 'nearAccountId is required' }, 400);
  }

  if (!successUrl || !cancelUrl) {
    return c.json({ error: 'successUrl and cancelUrl are required' }, 400);
  }

  // Validate NEAR account ID format (basic validation)
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(nearAccountId)) {
    return c.json({ error: 'Invalid NEAR account ID format' }, 400);
  }

  // Initialize Stripe client
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    // Check if customer already exists with this NEAR account ID
    const existingCustomers = await stripe.customers.search({
      query: `metadata['near_account_id']:'${nearAccountId}'`,
    });

    let customer: Stripe.Customer;

    if (existingCustomers.data.length > 0) {
      // Use existing customer
      customer = existingCustomers.data[0];
      console.log(`Found existing customer ${customer.id} for ${nearAccountId}`);
    } else {
      // Create new customer with NEAR account ID in metadata
      customer = await stripe.customers.create({
        metadata: {
          near_account_id: nearAccountId,
          source: 'specflow_extension',
        },
      });
      console.log(`Created new customer ${customer.id} for ${nearAccountId}`);
    }

    // Create checkout session in subscription mode
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      line_items: [
        {
          price: env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: {
          near_account_id: nearAccountId,
        },
      },
    });

    const response: CheckoutResponse = {
      sessionId: session.id,
      url: session.url || '',
    };

    console.log(`Created checkout session ${session.id} for ${nearAccountId}`);

    return c.json(response);
  } catch (error) {
    console.error('Failed to create checkout session:', error);

    if (error instanceof Stripe.errors.StripeError) {
      const statusCode = (error.statusCode || 500) as 400 | 401 | 402 | 403 | 404 | 500;
      return c.json({ error: `Stripe error: ${error.message}` }, statusCode);
    }

    return c.json({ error: 'Failed to create checkout session' }, 500);
  }
}
