/**
 * Admin authentication middleware for Hono
 * Verifies JWT bearer tokens and attaches admin session to context
 */

import type { Context, Next } from 'hono';
import type { Env, AdminSession } from '../types';
import { verifyAdminJwt } from '../services/admin-wallet-auth';

// Extend Hono context with admin session
declare module 'hono' {
  interface ContextVariableMap {
    adminSession: AdminSession;
  }
}

/**
 * Admin auth middleware
 * Checks Authorization header for Bearer token and verifies JWT
 * Returns 401 if missing or invalid
 */
export async function adminAuth(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Invalid Authorization header format' }, 401);
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  if (!token) {
    return c.json({ error: 'Missing token' }, 401);
  }

  const session = await verifyAdminJwt(c.env, token);

  if (!session) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // Attach session to context for use in handlers
  c.set('adminSession', session);

  await next();
}
