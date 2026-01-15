/**
 * License check endpoint for authenticated users
 * OAuth users: Check USER_LICENSES KV
 * Wallet users: Should check NEAR contract directly (returns guidance message)
 */

import type { Context } from 'hono';
import type { Env, OAuthUserLicense } from '../types';

/**
 * Check license status for authenticated user
 * JWT token in Authorization header determines user
 */
export async function handleLicenseCheck(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization' }, 401);
  }

  const token = authHeader.slice(7);

  // Verify JWT and extract user
  try {
    const payload = await verifyJwt(token, env.ADMIN_SECRET);

    // Check auth type - wallet users should check NEAR contract directly
    if (payload.type === 'user' || payload.authType === 'wallet') {
      // Wallet user - they should check contract, but we can return status
      return c.json({
        isLicensed: false,
        expiresAt: null,
        message: 'Wallet users should check NEAR contract directly',
      });
    }

    // OAuth user - check USER_LICENSES KV
    const userId = payload.sub;  // oauth:{provider}:{id}
    const record = await env.USER_LICENSES.get(userId, 'json') as OAuthUserLicense | null;

    if (!record || !record.licenseExpiry) {
      return c.json({ isLicensed: false, expiresAt: null });
    }

    const now = Date.now();
    const isLicensed = record.licenseExpiry > now;

    return c.json({
      isLicensed,
      expiresAt: isLicensed ? record.licenseExpiry : null,
    });
  } catch (error) {
    console.error('JWT verification failed:', error);
    return c.json({ error: 'Invalid token' }, 401);
  }
}

/**
 * JWT verification helper (same pattern as admin-wallet-auth.ts)
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
