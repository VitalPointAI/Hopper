/**
 * OAuth Authentication Handlers
 * Provides Google and GitHub OAuth flows for VSCode extension users
 */

import type { Context } from 'hono';
import Stripe from 'stripe';
import type { Env, OAuthUserLicense, OAuthState } from '../types';

// ============================================================================
// JWT Helper
// ============================================================================

/**
 * Create JWT for OAuth authenticated user
 */
export async function createOAuthJwt(
  env: Env,
  userId: string,
  provider: string
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId, // oauth:{provider}:{id}
    type: 'oauth', // Different from 'user' (wallet)
    provider: provider,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
  };

  const encoder = new TextEncoder();

  // Use ADMIN_SECRET as JWT signing key (same secret, different token type)
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.ADMIN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const headerB64 = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const signatureInput = encoder.encode(`${headerB64}.${payloadB64}`);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, signatureInput);
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

// ============================================================================
// State Management
// ============================================================================

/**
 * Generate a cryptographically secure state token
 */
function generateStateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Store OAuth state in KV with 5-minute TTL
 */
async function storeOAuthState(
  env: Env,
  state: string,
  provider: 'google' | 'github',
  callback: string,
  payment?: 'stripe'
): Promise<void> {
  const oauthState: OAuthState = {
    provider,
    callback,
    createdAt: Date.now(),
    payment,
  };
  await env.PROCESSED_EVENTS.put(`oauth_state:${state}`, JSON.stringify(oauthState), {
    expirationTtl: 300, // 5 minutes
  });
}

/**
 * Retrieve and delete OAuth state (one-time use)
 */
async function consumeOAuthState(env: Env, state: string): Promise<OAuthState | null> {
  const data = await env.PROCESSED_EVENTS.get(`oauth_state:${state}`);
  if (!data) return null;

  // Delete state immediately (one-time use)
  await env.PROCESSED_EVENTS.delete(`oauth_state:${state}`);

  return JSON.parse(data) as OAuthState;
}

// ============================================================================
// User License Management
// ============================================================================

/**
 * Create or update OAuth user license in KV
 */
async function upsertOAuthUserLicense(
  env: Env,
  provider: 'google' | 'github',
  id: string,
  email: string,
  displayName?: string
): Promise<OAuthUserLicense> {
  const key = `oauth:${provider}:${id}`;
  const existing = await env.USER_LICENSES.get(key);

  const now = Date.now();
  let license: OAuthUserLicense;

  if (existing) {
    const parsed = JSON.parse(existing) as OAuthUserLicense;
    license = {
      ...parsed,
      email, // Update in case it changed
      displayName: displayName || parsed.displayName,
      updatedAt: now,
    };
  } else {
    license = {
      id,
      provider,
      email,
      displayName,
      licenseExpiry: null, // No license until they subscribe
      createdAt: now,
      updatedAt: now,
    };
  }

  await env.USER_LICENSES.put(key, JSON.stringify(license));
  return license;
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Redirect to callback with error
 */
function redirectWithError(callback: string, error: string): Response {
  const url = new URL(callback);
  url.searchParams.set('error', error);
  return Response.redirect(url.toString(), 302);
}

/**
 * Return error page for invalid state
 */
function errorPage(title: string, message: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Hopper</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center p-4">
  <div class="bg-white max-w-md w-full rounded-2xl shadow-lg p-8 text-center">
    <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
      <svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    </div>
    <h1 class="text-xl font-bold text-gray-900 mb-2">${title}</h1>
    <p class="text-gray-600">${message}</p>
    <p class="text-sm text-gray-500 mt-4">You can close this window.</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 400,
    headers: { 'Content-Type': 'text/html' },
  });
}

// ============================================================================
// Stripe Checkout Helper
// ============================================================================

/**
 * Create Stripe checkout session for OAuth user and return the checkout URL
 */
async function createStripeCheckoutForOAuth(
  env: Env,
  userId: string,
  email: string
): Promise<string> {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });

  // Search for existing customer
  const existingCustomers = await stripe.customers.search({
    query: `metadata['user_id']:'${userId}'`,
  });

  let customer: Stripe.Customer;

  if (existingCustomers.data.length > 0) {
    customer = existingCustomers.data[0];
  } else {
    // Create new customer
    customer = await stripe.customers.create({
      email,
      metadata: {
        source: 'hopper_extension',
        auth_type: 'oauth',
        user_id: userId,
      },
    });
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customer.id,
    mode: 'subscription',
    line_items: [
      {
        price: env.STRIPE_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: 'https://hopper.dev/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://hopper.dev/cancel',
    subscription_data: {
      metadata: {
        auth_type: 'oauth',
        user_id: userId,
      },
    },
  });

  if (!session.url) {
    throw new Error('Failed to get checkout URL');
  }

  return session.url;
}

// ============================================================================
// Google OAuth
// ============================================================================

/**
 * GET /auth/oauth/google - Start Google OAuth flow
 * Query params:
 *   - callback: Required. VSCode callback URL
 *   - payment: Optional. If 'stripe', redirect to Stripe checkout after auth
 */
export async function handleGoogleAuth(c: Context<{ Bindings: Env }>): Promise<Response> {
  const callback = c.req.query('callback');
  const payment = c.req.query('payment') as 'stripe' | undefined;

  if (!callback) {
    return c.json({ error: 'Missing callback parameter' }, 400);
  }

  // Check if OAuth is configured
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.json({ error: 'Google OAuth not configured' }, 500);
  }

  // Generate state token for CSRF protection
  const state = generateStateToken();
  await storeOAuthState(c.env, state, 'google', callback, payment);

  // Build Google OAuth URL
  const workerUrl = new URL(c.req.url).origin;
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${workerUrl}/auth/oauth/google/callback`,
    response_type: 'code',
    scope: 'email profile',
    state: state,
    access_type: 'offline',
    prompt: 'select_account',
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return Response.redirect(googleAuthUrl, 302);
}

/**
 * GET /auth/oauth/google/callback - Handle Google OAuth callback
 */
export async function handleGoogleCallback(c: Context<{ Bindings: Env }>): Promise<Response> {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  // Handle OAuth errors from Google
  if (error) {
    console.error('Google OAuth error:', error);
    return errorPage('Authentication Failed', `Google returned an error: ${error}`);
  }

  if (!code || !state) {
    return errorPage('Invalid Request', 'Missing authorization code or state parameter.');
  }

  // Verify state token
  const oauthState = await consumeOAuthState(c.env, state);
  if (!oauthState || oauthState.provider !== 'google') {
    return errorPage('Invalid State', 'The authentication session has expired or is invalid. Please try again.');
  }

  try {
    // Exchange code for tokens
    const workerUrl = new URL(c.req.url).origin;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        code: code,
        redirect_uri: `${workerUrl}/auth/oauth/google/callback`,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Google token error:', errorData);
      return redirectWithError(oauthState.callback, 'Failed to exchange authorization code');
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      id_token?: string;
    };

    // Fetch user info
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userResponse.ok) {
      console.error('Google user info error:', await userResponse.text());
      return redirectWithError(oauthState.callback, 'Failed to fetch user information');
    }

    const user = (await userResponse.json()) as {
      id: string;
      email: string;
      name?: string;
      picture?: string;
    };

    // Create/update user license
    await upsertOAuthUserLicense(c.env, 'google', user.id, user.email, user.name);

    // Generate JWT
    const userId = `oauth:google:${user.id}`;
    const token = await createOAuthJwt(c.env, userId, 'google');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    // If payment=stripe, create checkout session and redirect to Stripe
    if (oauthState.payment === 'stripe') {
      try {
        const checkoutUrl = await createStripeCheckoutForOAuth(c.env, userId, user.email);
        return Response.redirect(checkoutUrl, 302);
      } catch (checkoutErr) {
        console.error('Stripe checkout error:', checkoutErr);
        // Fall back to VSCode redirect with error
        return redirectWithError(oauthState.callback, 'Failed to create checkout session');
      }
    }

    // Normal flow - redirect to VSCode callback with token
    const callbackUrl = new URL(oauthState.callback);
    callbackUrl.searchParams.set('token', token);
    callbackUrl.searchParams.set('expires_at', expiresAt.toString());
    callbackUrl.searchParams.set('user_id', userId);
    callbackUrl.searchParams.set('auth_type', 'oauth');
    callbackUrl.searchParams.set('email', user.email);
    callbackUrl.searchParams.set('provider', 'google');
    if (user.name) {
      callbackUrl.searchParams.set('display_name', user.name);
    }

    return Response.redirect(callbackUrl.toString(), 302);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return redirectWithError(oauthState.callback, 'Authentication failed. Please try again.');
  }
}

// ============================================================================
// GitHub OAuth
// ============================================================================

/**
 * GET /auth/oauth/github - Start GitHub OAuth flow
 * Query params:
 *   - callback: Required. VSCode callback URL
 *   - payment: Optional. If 'stripe', redirect to Stripe checkout after auth
 */
export async function handleGitHubAuth(c: Context<{ Bindings: Env }>): Promise<Response> {
  const callback = c.req.query('callback');
  const payment = c.req.query('payment') as 'stripe' | undefined;

  if (!callback) {
    return c.json({ error: 'Missing callback parameter' }, 400);
  }

  // Check if OAuth is configured
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) {
    return c.json({ error: 'GitHub OAuth not configured' }, 500);
  }

  // Generate state token for CSRF protection
  const state = generateStateToken();
  await storeOAuthState(c.env, state, 'github', callback, payment);

  // Build GitHub OAuth URL
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/oauth/github/callback`,
    scope: 'read:user user:email',
    state: state,
  });

  const githubAuthUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
  return Response.redirect(githubAuthUrl, 302);
}

/**
 * GET /auth/oauth/github/callback - Handle GitHub OAuth callback
 */
export async function handleGitHubCallback(c: Context<{ Bindings: Env }>): Promise<Response> {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const errorDescription = c.req.query('error_description');

  // Handle OAuth errors from GitHub
  if (error) {
    console.error('GitHub OAuth error:', error, errorDescription);
    return errorPage('Authentication Failed', errorDescription || `GitHub returned an error: ${error}`);
  }

  if (!code || !state) {
    return errorPage('Invalid Request', 'Missing authorization code or state parameter.');
  }

  // Verify state token
  const oauthState = await consumeOAuthState(c.env, state);
  if (!oauthState || oauthState.provider !== 'github') {
    return errorPage('Invalid State', 'The authentication session has expired or is invalid. Please try again.');
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code: code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('GitHub token error:', errorData);
      return redirectWithError(oauthState.callback, 'Failed to exchange authorization code');
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
      scope: string;
      error?: string;
      error_description?: string;
    };

    if (tokens.error) {
      console.error('GitHub token error:', tokens.error, tokens.error_description);
      return redirectWithError(oauthState.callback, tokens.error_description || 'Failed to obtain access token');
    }

    // Fetch user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Hopper-License-API',
      },
    });

    if (!userResponse.ok) {
      console.error('GitHub user info error:', await userResponse.text());
      return redirectWithError(oauthState.callback, 'Failed to fetch user information');
    }

    const user = (await userResponse.json()) as {
      id: number;
      login: string;
      name: string | null;
      email: string | null;
    };

    // Fetch primary email if not public
    let email = user.email;
    if (!email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Hopper-License-API',
        },
      });

      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primaryEmail = emails.find((e) => e.primary && e.verified);
        email = primaryEmail?.email || emails.find((e) => e.verified)?.email || null;
      }
    }

    if (!email) {
      return redirectWithError(oauthState.callback, 'Could not retrieve email from GitHub. Please make your email public or add a verified email.');
    }

    // Create/update user license
    const githubId = user.id.toString();
    await upsertOAuthUserLicense(c.env, 'github', githubId, email, user.name || user.login);

    // Generate JWT
    const userId = `oauth:github:${githubId}`;
    const token = await createOAuthJwt(c.env, userId, 'github');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    // If payment=stripe, create checkout session and redirect to Stripe
    if (oauthState.payment === 'stripe') {
      try {
        const checkoutUrl = await createStripeCheckoutForOAuth(c.env, userId, email);
        return Response.redirect(checkoutUrl, 302);
      } catch (checkoutErr) {
        console.error('Stripe checkout error:', checkoutErr);
        // Fall back to VSCode redirect with error
        return redirectWithError(oauthState.callback, 'Failed to create checkout session');
      }
    }

    // Normal flow - redirect to VSCode callback with token
    const callbackUrl = new URL(oauthState.callback);
    callbackUrl.searchParams.set('token', token);
    callbackUrl.searchParams.set('expires_at', expiresAt.toString());
    callbackUrl.searchParams.set('user_id', userId);
    callbackUrl.searchParams.set('auth_type', 'oauth');
    callbackUrl.searchParams.set('email', email);
    callbackUrl.searchParams.set('provider', 'github');
    if (user.name || user.login) {
      callbackUrl.searchParams.set('display_name', user.name || user.login);
    }

    return Response.redirect(callbackUrl.toString(), 302);
  } catch (err) {
    console.error('GitHub OAuth callback error:', err);
    return redirectWithError(oauthState.callback, 'Authentication failed. Please try again.');
  }
}
