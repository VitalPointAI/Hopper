/**
 * Admin wallet authentication service
 * Handles challenge generation, signature verification, and JWT management
 */

import type { Env, AdminSession } from '../types';
import { PublicKey } from '@near-js/crypto';

// Challenge TTL in seconds (5 minutes)
const CHALLENGE_TTL_SECONDS = 5 * 60;

// JWT expiry in seconds (24 hours)
const JWT_EXPIRY_SECONDS = 24 * 60 * 60;

// KV key prefix for challenges
const CHALLENGE_PREFIX = 'admin_challenge:';

/**
 * Generate a random challenge for admin wallet to sign
 */
export async function generateAdminChallenge(env: Env): Promise<string> {
  // Generate random bytes
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const nonce = Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const timestamp = Date.now();
  const challenge = `Sign this message to authenticate as SpecFlow admin.\n\nNonce: ${nonce}\nTimestamp: ${timestamp}`;

  // Store challenge in KV with TTL
  const challengeKey = `${CHALLENGE_PREFIX}${nonce}`;
  await env.PROCESSED_EVENTS.put(challengeKey, challenge, {
    expirationTtl: CHALLENGE_TTL_SECONDS,
  });

  return challenge;
}

/**
 * Verify admin wallet signature
 */
export async function verifyAdminSignature(
  env: Env,
  params: {
    nearAccountId: string;
    signature: string;
    publicKey: string;
    message: string;
  }
): Promise<{ valid: boolean; error?: string }> {
  const { nearAccountId, signature, publicKey, message } = params;

  // Verify nearAccountId matches env.ADMIN_WALLET
  if (nearAccountId !== env.ADMIN_WALLET) {
    return {
      valid: false,
      error: `Unauthorized: ${nearAccountId} is not the admin wallet`,
    };
  }

  // Extract nonce from message to verify it exists in KV
  const nonceMatch = message.match(/Nonce: ([a-f0-9]+)/);
  if (!nonceMatch) {
    return { valid: false, error: 'Invalid challenge format: missing nonce' };
  }

  const nonce = nonceMatch[1];
  const challengeKey = `${CHALLENGE_PREFIX}${nonce}`;
  const storedChallenge = await env.PROCESSED_EVENTS.get(challengeKey);

  if (!storedChallenge) {
    return { valid: false, error: 'Challenge expired or not found' };
  }

  if (storedChallenge !== message) {
    return { valid: false, error: 'Challenge mismatch' };
  }

  // Verify the timestamp is within TTL
  const timestampMatch = message.match(/Timestamp: (\d+)/);
  if (!timestampMatch) {
    return { valid: false, error: 'Invalid challenge format: missing timestamp' };
  }

  const timestamp = parseInt(timestampMatch[1], 10);
  if (Date.now() - timestamp > CHALLENGE_TTL_SECONDS * 1000) {
    return { valid: false, error: 'Challenge expired' };
  }

  // Verify the signature using @near-js/crypto
  try {
    const pubKey = PublicKey.fromString(publicKey);
    const messageBytes = new TextEncoder().encode(message);

    // Decode base64 signature
    const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));

    const isValid = pubKey.verify(messageBytes, signatureBytes);

    if (!isValid) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Delete challenge after successful verification (one-time use)
    await env.PROCESSED_EVENTS.delete(challengeKey);

    return { valid: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { valid: false, error: `Signature verification failed: ${errorMessage}` };
  }
}

/**
 * Create an admin JWT token
 */
export async function createAdminJwt(env: Env, nearAccountId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + JWT_EXPIRY_SECONDS;

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const payload: AdminSession = {
    nearAccountId,
    issuedAt: now,
    expiresAt,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;

  const signature = await sign(data, env.ADMIN_SECRET);
  return `${data}.${signature}`;
}

/**
 * Verify an admin JWT token and return the session
 */
export async function verifyAdminJwt(
  env: Env,
  token: string
): Promise<AdminSession | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const data = `${headerB64}.${payloadB64}`;

    // Verify signature
    const expectedSignature = await sign(data, env.ADMIN_SECRET);
    if (signatureB64 !== expectedSignature) {
      return null;
    }

    // Decode payload
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as AdminSession;

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.expiresAt <= now) {
      return null;
    }

    // Verify the account is still the admin
    if (payload.nearAccountId !== env.ADMIN_WALLET) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * HMAC-SHA256 signature
 */
async function sign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const dataBytes = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
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
