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
 * Verify admin wallet signature (NEP-413 format)
 */
export async function verifyAdminSignature(
  env: Env,
  params: {
    nearAccountId: string;
    signature: string;
    publicKey: string;
    message: string;
    nonce?: number[];
    recipient?: string;
  }
): Promise<{ valid: boolean; error?: string }> {
  const { nearAccountId, signature, publicKey, message, nonce, recipient } = params;

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

  const challengeNonce = nonceMatch[1];
  const challengeKey = `${CHALLENGE_PREFIX}${challengeNonce}`;
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

  // Verify the signature using NEP-413 format
  try {
    // Validate public key format
    if (!publicKey.startsWith('ed25519:')) {
      return { valid: false, error: 'Invalid public key format: must start with ed25519:' };
    }

    const pubKey = PublicKey.fromString(publicKey);

    // Decode base64 signature
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    } catch {
      return { valid: false, error: 'Invalid signature: not valid base64' };
    }

    // For NEP-413, we need to verify the hash of the Borsh-encoded payload
    // The payload format is: tag (4 bytes) + message (string) + nonce (32 bytes) + recipient (string) + callbackUrl (optional string)
    if (nonce && recipient) {
      // Validate nonce length
      if (nonce.length !== 32) {
        return { valid: false, error: `Invalid nonce length: expected 32, got ${nonce.length}` };
      }

      // NEP-413 verification
      const payloadHash = await createNep413PayloadHash(message, nonce, recipient);

      console.log('NEP-413 verification:', {
        publicKey,
        signatureLength: signatureBytes.length,
        payloadHashLength: payloadHash.length,
        nonceLength: nonce.length,
        recipient,
        messageLength: message.length,
      });

      const isValid = pubKey.verify(payloadHash, signatureBytes);

      if (!isValid) {
        return { valid: false, error: 'Invalid signature' };
      }
    } else {
      // Fallback to raw message verification (legacy)
      const messageBytes = new TextEncoder().encode(message);
      const isValid = pubKey.verify(messageBytes, signatureBytes);

      if (!isValid) {
        return { valid: false, error: 'Invalid signature' };
      }
    }

    // Delete challenge after successful verification (one-time use)
    await env.PROCESSED_EVENTS.delete(challengeKey);

    return { valid: true };
  } catch (error) {
    console.error('Signature verification error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { valid: false, error: `Signature verification failed: ${errorMessage}` };
  }
}

/**
 * Create NEP-413 payload hash for signature verification
 * Format: SHA256(tag + borsh_serialize(Payload))
 * where tag = 2^31 + 413 = 2147484061
 */
async function createNep413PayloadHash(
  message: string,
  nonce: number[],
  recipient: string,
  callbackUrl?: string
): Promise<Uint8Array> {
  // NEP-413 tag: 2^31 + 413 = 2147484061
  const tag = 2147484061;

  // Borsh encode the payload
  const payloadBytes = borshSerializeNep413Payload(message, nonce, recipient, callbackUrl);

  // Prepend the tag (4 bytes, little-endian)
  const tagBytes = new Uint8Array(4);
  tagBytes[0] = tag & 0xff;
  tagBytes[1] = (tag >> 8) & 0xff;
  tagBytes[2] = (tag >> 16) & 0xff;
  tagBytes[3] = (tag >> 24) & 0xff;

  // Concatenate tag + payload
  const fullPayload = new Uint8Array(tagBytes.length + payloadBytes.length);
  fullPayload.set(tagBytes, 0);
  fullPayload.set(payloadBytes, tagBytes.length);

  // SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', fullPayload);
  return new Uint8Array(hashBuffer);
}

/**
 * Borsh serialize NEP-413 payload
 * Payload { message: String, nonce: [u8; 32], recipient: String, callbackUrl: Option<String> }
 */
function borshSerializeNep413Payload(
  message: string,
  nonce: number[],
  recipient: string,
  callbackUrl?: string
): Uint8Array {
  const encoder = new TextEncoder();

  // Encode message (4-byte length prefix + UTF-8 bytes)
  const messageBytes = encoder.encode(message);
  const messageLenBytes = new Uint8Array(4);
  messageLenBytes[0] = messageBytes.length & 0xff;
  messageLenBytes[1] = (messageBytes.length >> 8) & 0xff;
  messageLenBytes[2] = (messageBytes.length >> 16) & 0xff;
  messageLenBytes[3] = (messageBytes.length >> 24) & 0xff;

  // Nonce is fixed 32 bytes
  const nonceBytes = new Uint8Array(nonce);

  // Encode recipient (4-byte length prefix + UTF-8 bytes)
  const recipientBytes = encoder.encode(recipient);
  const recipientLenBytes = new Uint8Array(4);
  recipientLenBytes[0] = recipientBytes.length & 0xff;
  recipientLenBytes[1] = (recipientBytes.length >> 8) & 0xff;
  recipientLenBytes[2] = (recipientBytes.length >> 16) & 0xff;
  recipientLenBytes[3] = (recipientBytes.length >> 24) & 0xff;

  // Encode callbackUrl (Option<String>: 1 byte for Some/None + optional length + bytes)
  let callbackUrlBytes: Uint8Array;
  if (callbackUrl) {
    const urlBytes = encoder.encode(callbackUrl);
    const urlLenBytes = new Uint8Array(4);
    urlLenBytes[0] = urlBytes.length & 0xff;
    urlLenBytes[1] = (urlBytes.length >> 8) & 0xff;
    urlLenBytes[2] = (urlBytes.length >> 16) & 0xff;
    urlLenBytes[3] = (urlBytes.length >> 24) & 0xff;
    callbackUrlBytes = new Uint8Array(1 + 4 + urlBytes.length);
    callbackUrlBytes[0] = 1; // Some
    callbackUrlBytes.set(urlLenBytes, 1);
    callbackUrlBytes.set(urlBytes, 5);
  } else {
    callbackUrlBytes = new Uint8Array([0]); // None
  }

  // Concatenate all parts
  const totalLength =
    messageLenBytes.length +
    messageBytes.length +
    nonceBytes.length +
    recipientLenBytes.length +
    recipientBytes.length +
    callbackUrlBytes.length;

  const result = new Uint8Array(totalLength);
  let offset = 0;

  result.set(messageLenBytes, offset);
  offset += messageLenBytes.length;
  result.set(messageBytes, offset);
  offset += messageBytes.length;
  result.set(nonceBytes, offset);
  offset += nonceBytes.length;
  result.set(recipientLenBytes, offset);
  offset += recipientLenBytes.length;
  result.set(recipientBytes, offset);
  offset += recipientBytes.length;
  result.set(callbackUrlBytes, offset);

  return result;
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
