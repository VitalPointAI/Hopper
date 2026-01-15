/**
 * OAuth license storage service
 * Manages licenses for OAuth users in USER_LICENSES KV
 */

import type { OAuthUserLicense } from '../types';

/**
 * Grant license to OAuth user by updating USER_LICENSES KV
 *
 * @param kv - USER_LICENSES KV namespace
 * @param userId - OAuth user ID (oauth:{provider}:{id})
 * @param durationDays - License duration in days
 * @param stripeCustomerId - Optional Stripe customer ID
 * @returns Success status and expiry timestamp
 */
export async function grantOAuthLicense(
  kv: KVNamespace,
  userId: string,
  durationDays: number,
  stripeCustomerId?: string
): Promise<{ success: boolean; expiresAt: number }> {
  // Get existing record
  const existing = await kv.get(userId, 'json') as OAuthUserLicense | null;

  if (!existing) {
    console.error(`No OAuth user record for ${userId}`);
    return { success: false, expiresAt: 0 };
  }

  // Calculate new expiry (extend from max of current expiry or now)
  const now = Date.now();
  const currentExpiry = existing.licenseExpiry ?? now;
  const baseTime = Math.max(currentExpiry, now);
  const newExpiry = baseTime + durationDays * 24 * 60 * 60 * 1000;

  // Update record
  const updated: OAuthUserLicense = {
    ...existing,
    licenseExpiry: newExpiry,
    stripeCustomerId: stripeCustomerId ?? existing.stripeCustomerId,
    updatedAt: now,
  };

  await kv.put(userId, JSON.stringify(updated));
  console.log(`Granted ${durationDays}-day license to OAuth user ${userId}, expires: ${new Date(newExpiry).toISOString()}`);

  return { success: true, expiresAt: newExpiry };
}

/**
 * Get OAuth user license expiry
 *
 * @param kv - USER_LICENSES KV namespace
 * @param userId - OAuth user ID (oauth:{provider}:{id})
 * @returns License expiry timestamp or null if not licensed
 */
export async function getOAuthLicenseExpiry(
  kv: KVNamespace,
  userId: string
): Promise<number | null> {
  const record = await kv.get(userId, 'json') as OAuthUserLicense | null;
  return record?.licenseExpiry ?? null;
}

/**
 * Check if OAuth user has valid license
 *
 * @param kv - USER_LICENSES KV namespace
 * @param userId - OAuth user ID (oauth:{provider}:{id})
 * @returns True if user has valid (non-expired) license
 */
export async function hasValidOAuthLicense(
  kv: KVNamespace,
  userId: string
): Promise<boolean> {
  const expiry = await getOAuthLicenseExpiry(kv, userId);
  if (!expiry) {
    return false;
  }
  return expiry > Date.now();
}

/**
 * Revoke OAuth user license
 *
 * @param kv - USER_LICENSES KV namespace
 * @param userId - OAuth user ID (oauth:{provider}:{id})
 * @returns True if license was revoked
 */
export async function revokeOAuthLicense(
  kv: KVNamespace,
  userId: string
): Promise<boolean> {
  const existing = await kv.get(userId, 'json') as OAuthUserLicense | null;

  if (!existing) {
    console.error(`No OAuth user record for ${userId}`);
    return false;
  }

  // Set license expiry to null (no license)
  const updated: OAuthUserLicense = {
    ...existing,
    licenseExpiry: null,
    updatedAt: Date.now(),
  };

  await kv.put(userId, JSON.stringify(updated));
  console.log(`Revoked license for OAuth user ${userId}`);

  return true;
}
