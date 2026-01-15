/**
 * Stripe checkout handler for subscription creation
 * Creates checkout sessions in subscription mode
 *
 * Supports two authentication methods:
 * 1. OAuth users: JWT token in Authorization header
 * 2. Wallet users: nearAccountId in request body (legacy)
 */

import type { Context } from 'hono';
import Stripe from 'stripe';
import type { Env, CheckoutResponse, OAuthUserLicense } from '../types';

/**
 * Extended checkout request that supports both auth methods
 */
interface ExtendedCheckoutRequest {
  nearAccountId?: string;  // For wallet users (existing)
  near_account_id?: string;  // Alternative field name
  successUrl?: string;
  cancelUrl?: string;
}

/**
 * Handle checkout request
 * Creates a Stripe checkout session for subscription
 *
 * Auth methods:
 * - OAuth users: Authorization: Bearer {jwt}
 * - Wallet users: { nearAccountId: "account.near" } in body
 */
export async function handleCheckout(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const env = c.env;

  // Parse request body
  let body: ExtendedCheckoutRequest;
  try {
    body = await c.req.json<ExtendedCheckoutRequest>();
  } catch {
    body = {};
  }

  // Check for JWT auth first (OAuth users)
  const authHeader = c.req.header('Authorization');
  let userId: string;
  let email: string | undefined;
  let isOAuthUser = false;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = await verifyJwt(token, env.ADMIN_SECRET);
      userId = payload.sub;  // oauth:{provider}:{id}
      isOAuthUser = payload.type === 'oauth' || payload.authType === 'oauth' || userId.startsWith('oauth:');

      if (isOAuthUser) {
        // Get email from stored user profile
        const userRecord = await env.USER_LICENSES.get(userId, 'json') as OAuthUserLicense | null;
        email = userRecord?.email;
      }
    } catch {
      return c.json({ error: 'Invalid token' }, 401);
    }
  } else {
    // Wallet user (existing flow)
    const nearAccountId = body.nearAccountId || body.near_account_id;

    if (!nearAccountId) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    // Validate NEAR account ID format (basic validation)
    if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(nearAccountId)) {
      return c.json({ error: 'Invalid NEAR account ID format' }, 400);
    }

    userId = nearAccountId;
    isOAuthUser = false;
  }

  // Use default URLs if not provided
  const successUrl = body.successUrl || 'https://specflow.dev/success?session_id={CHECKOUT_SESSION_ID}';
  const cancelUrl = body.cancelUrl || 'https://specflow.dev/cancel';

  // Initialize Stripe client
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    // Prepare metadata for customer lookup and creation
    const metadataKey = isOAuthUser ? 'user_id' : 'near_account_id';
    const searchQuery = `metadata['${metadataKey}']:'${userId}'`;

    // Check if customer already exists with this user ID
    const existingCustomers = await stripe.customers.search({
      query: searchQuery,
    });

    let customer: Stripe.Customer;

    if (existingCustomers.data.length > 0) {
      // Use existing customer
      customer = existingCustomers.data[0];
      console.log(`Found existing customer ${customer.id} for ${userId}`);
    } else {
      // Create new customer with user ID in metadata
      const customerMetadata: Record<string, string> = {
        source: 'specflow_extension',
        auth_type: isOAuthUser ? 'oauth' : 'wallet',
        user_id: userId,
      };

      // Add near_account_id for wallet users (backward compatibility)
      if (!isOAuthUser) {
        customerMetadata.near_account_id = userId;
      }

      customer = await stripe.customers.create({
        email: email,  // Pre-fill for OAuth users
        metadata: customerMetadata,
      });
      console.log(`Created new customer ${customer.id} for ${userId} (${isOAuthUser ? 'oauth' : 'wallet'})`);
    }

    // Prepare subscription metadata
    const subscriptionMetadata: Record<string, string> = {
      auth_type: isOAuthUser ? 'oauth' : 'wallet',
      user_id: userId,
    };

    // Add near_account_id for wallet users (backward compatibility)
    if (!isOAuthUser) {
      subscriptionMetadata.near_account_id = userId;
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
      customer_email: !existingCustomers.data.length ? email : undefined,  // Pre-fill only for new customers
      subscription_data: {
        metadata: subscriptionMetadata,
      },
    });

    const response: CheckoutResponse = {
      sessionId: session.id,
      url: session.url || '',
    };

    console.log(`Created checkout session ${session.id} for ${userId} (${isOAuthUser ? 'oauth' : 'wallet'})`);

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

/**
 * JWT verification helper (same pattern as license-check.ts)
 * Verifies HMAC-SHA256 signature and expiry
 */
async function verifyJwt(token: string, secret: string): Promise<{
  sub: string;
  type?: string;
  authType?: string;
  exp?: number;
  [key: string]: unknown;
}> {
  const [headerB64, payloadB64, signatureB64] = token.split('.');

  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new Error('Invalid token format');
  }

  // Verify signature using HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );

  // Generate expected signature
  const data = `${headerB64}.${payloadB64}`;
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const expectedSignature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signatureBytes)));

  if (signatureB64 !== expectedSignature) {
    throw new Error('Invalid signature');
  }

  // Decode and check expiry
  const payload = JSON.parse(base64UrlDecode(payloadB64));

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  // Also check expiresAt (used by our JWT format)
  if (payload.expiresAt && payload.expiresAt < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}

/**
 * Base64 URL encoding
 */
function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64 URL decoding
 */
function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with = if needed
  while (str.length % 4) {
    str += '=';
  }
  return atob(str);
}
