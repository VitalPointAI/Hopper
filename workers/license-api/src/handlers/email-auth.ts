/**
 * Email+Password Authentication Handlers
 * Provides registration and login for users without OAuth or NEAR wallet
 */

import type { Context } from 'hono';
import bcrypt from 'bcryptjs';
import type {
  Env,
  EmailUser,
  OAuthUserLicense,
  EmailRegisterRequest,
  EmailLoginRequest,
  EmailAuthResponse,
  RateLimitRecord,
} from '../types';

// ============================================================================
// Constants
// ============================================================================

const PASSWORD_MIN_LENGTH = 8;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_TTL = 60 * 60; // 1 hour TTL for rate limit records

// RFC 5322 basic email pattern
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================================
// JWT Helper (shared with oauth-auth.ts)
// ============================================================================

/**
 * Create JWT for email authenticated user
 */
async function createEmailJwt(env: Env, email: string): Promise<string> {
  const userId = `oauth:email:${email}`;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    type: 'oauth', // Same type as other OAuth users
    provider: 'email',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
  };

  const encoder = new TextEncoder();

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
// Rate Limiting
// ============================================================================

/**
 * Get client IP from request headers
 */
function getClientIp(c: Context<{ Bindings: Env }>): string {
  // Cloudflare provides the real client IP in CF-Connecting-IP header
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    'unknown'
  );
}

/**
 * Check if IP is rate limited
 * Returns { allowed: true } if request is allowed
 * Returns { allowed: false, retryAfter: number } if rate limited
 */
async function checkRateLimit(
  env: Env,
  ip: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const key = `ratelimit:${ip}`;
  const data = await env.PROCESSED_EVENTS.get(key);

  if (!data) {
    return { allowed: true };
  }

  const record = JSON.parse(data) as RateLimitRecord;
  const now = Date.now();

  // Check if currently locked out
  if (record.lockoutUntil && record.lockoutUntil > now) {
    return {
      allowed: false,
      retryAfter: Math.ceil((record.lockoutUntil - now) / 1000),
    };
  }

  // If lockout has expired, reset the counter
  if (record.lockoutUntil && record.lockoutUntil <= now) {
    return { allowed: true };
  }

  return { allowed: true };
}

/**
 * Record a failed login attempt
 */
async function recordFailedAttempt(env: Env, ip: string): Promise<void> {
  const key = `ratelimit:${ip}`;
  const data = await env.PROCESSED_EVENTS.get(key);
  const now = Date.now();

  let record: RateLimitRecord;

  if (data) {
    record = JSON.parse(data) as RateLimitRecord;

    // If previous lockout expired, reset counter
    if (record.lockoutUntil && record.lockoutUntil <= now) {
      record = {
        failedAttempts: 1,
        lockoutUntil: null,
        lastAttempt: now,
      };
    } else {
      record.failedAttempts++;
      record.lastAttempt = now;

      // Apply lockout if threshold reached
      if (record.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        record.lockoutUntil = now + LOCKOUT_DURATION_MS;
      }
    }
  } else {
    record = {
      failedAttempts: 1,
      lockoutUntil: null,
      lastAttempt: now,
    };
  }

  await env.PROCESSED_EVENTS.put(key, JSON.stringify(record), {
    expirationTtl: RATE_LIMIT_TTL,
  });
}

/**
 * Clear rate limit on successful login
 */
async function clearRateLimit(env: Env, ip: string): Promise<void> {
  const key = `ratelimit:${ip}`;
  await env.PROCESSED_EVENTS.delete(key);
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate email format
 */
function validateEmail(email: string): string | null {
  if (!email || typeof email !== 'string') {
    return 'Email is required';
  }

  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(trimmed)) {
    return 'Invalid email format';
  }

  return null; // Valid
}

/**
 * Validate password
 */
function validatePassword(password: string): string | null {
  if (!password || typeof password !== 'string') {
    return 'Password is required';
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }

  return null; // Valid
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * POST /auth/email/register - Create new email user
 */
export async function handleEmailRegister(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<EmailRegisterRequest>();
    const { email, password, displayName } = body;

    // Validate input
    const emailError = validateEmail(email);
    if (emailError) {
      return c.json({ error: emailError }, 400);
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return c.json({ error: passwordError }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if email already registered
    const existingUser = await c.env.USER_LICENSES.get(`email:${normalizedEmail}`);
    if (existingUser) {
      return c.json({ error: 'Email already registered' }, 409);
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    // Store email user record
    const emailUser: EmailUser = {
      email: normalizedEmail,
      passwordHash,
      createdAt: Date.now(),
    };
    await c.env.USER_LICENSES.put(`email:${normalizedEmail}`, JSON.stringify(emailUser));

    // Create OAuth user license entry (for consistent license lookup)
    const now = Date.now();
    const userLicense: OAuthUserLicense = {
      id: normalizedEmail,
      provider: 'email',
      email: normalizedEmail,
      displayName: displayName?.trim(),
      licenseExpiry: null, // No license until they subscribe
      createdAt: now,
      updatedAt: now,
    };
    await c.env.USER_LICENSES.put(`oauth:email:${normalizedEmail}`, JSON.stringify(userLicense));

    // Generate JWT
    const token = await createEmailJwt(c.env, normalizedEmail);
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    const response: EmailAuthResponse = {
      token,
      expiresAt,
      userId: `oauth:email:${normalizedEmail}`,
    };

    return c.json(response, 201);
  } catch (err) {
    console.error('Email registration error:', err);
    return c.json({ error: 'Registration failed. Please try again.' }, 500);
  }
}

/**
 * POST /auth/email/login - Login existing email user
 */
export async function handleEmailLogin(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const ip = getClientIp(c);

  // Check rate limit before processing
  const rateLimitCheck = await checkRateLimit(c.env, ip);
  if (!rateLimitCheck.allowed) {
    return c.json(
      {
        error: 'Too many failed login attempts. Please try again later.',
        retryAfter: rateLimitCheck.retryAfter,
      },
      429
    );
  }

  try {
    const body = await c.req.json<EmailLoginRequest>();
    const { email, password } = body;

    // Validate input
    const emailError = validateEmail(email);
    if (emailError) {
      return c.json({ error: emailError }, 400);
    }

    if (!password) {
      return c.json({ error: 'Password is required' }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Lookup user
    const userData = await c.env.USER_LICENSES.get(`email:${normalizedEmail}`);
    if (!userData) {
      // Record failed attempt (user not found)
      await recordFailedAttempt(c.env, ip);
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    const emailUser = JSON.parse(userData) as EmailUser;

    // Verify password
    const passwordValid = await bcrypt.compare(password, emailUser.passwordHash);
    if (!passwordValid) {
      // Record failed attempt
      await recordFailedAttempt(c.env, ip);
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    // Clear rate limit on successful login
    await clearRateLimit(c.env, ip);

    // Generate JWT
    const token = await createEmailJwt(c.env, normalizedEmail);
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    const response: EmailAuthResponse = {
      token,
      expiresAt,
      userId: `oauth:email:${normalizedEmail}`,
    };

    return c.json(response);
  } catch (err) {
    console.error('Email login error:', err);
    return c.json({ error: 'Login failed. Please try again.' }, 500);
  }
}
