/**
 * Admin licenses endpoint handler
 * GET /admin/api/licenses
 */

import type { Context } from 'hono';
import type { Env, SubscriptionRecord, CryptoSubscription } from '../../types';
import { licensesFragment } from './ui';

interface LicenseInfo {
  nearAccountId: string;
  source: 'stripe' | 'crypto' | 'admin';
  subscriptionStatus: string;
  currentPeriodEnd?: number;
  nextChargeDate?: string;
  contractLicense?: {
    isLicensed: boolean;
    expiry: string | null;
  };
}

/**
 * Check if a string looks like a complete NEAR account ID
 * (ends with .near, .testnet, or is a 64-char hex implicit account)
 */
function isCompleteNearAccountId(search: string): boolean {
  if (!search || search.length < 2) return false;

  // Check for named accounts (.near, .testnet, .tg)
  if (search.includes('.')) {
    const validSuffixes = ['.near', '.testnet', '.tg'];
    return validSuffixes.some((suffix) => search.endsWith(suffix));
  }

  // Check for implicit account (64-char hex)
  if (search.length === 64 && /^[0-9a-f]+$/i.test(search)) {
    return true;
  }

  return false;
}

/**
 * Query NEAR contract for license status
 */
async function queryContractLicense(
  env: Env,
  nearAccountId: string
): Promise<{ isLicensed: boolean; expiry: string | null }> {
  try {
    // Call is_licensed view function
    const isLicensedResponse = await fetch(env.NEAR_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'is_licensed',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: env.LICENSE_CONTRACT_ID,
          method_name: 'is_licensed',
          args_base64: btoa(JSON.stringify({ account_id: nearAccountId })),
        },
      }),
    });

    const isLicensedResult = (await isLicensedResponse.json()) as {
      result?: { result: number[] };
    };

    const isLicensed = isLicensedResult.result?.result
      ? JSON.parse(String.fromCharCode(...isLicensedResult.result.result))
      : false;

    // Call get_expiry view function
    const expiryResponse = await fetch(env.NEAR_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get_expiry',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: env.LICENSE_CONTRACT_ID,
          method_name: 'get_expiry',
          args_base64: btoa(JSON.stringify({ account_id: nearAccountId })),
        },
      }),
    });

    const expiryResult = (await expiryResponse.json()) as {
      result?: { result: number[] };
    };

    let expiry: string | null = null;
    if (expiryResult.result?.result) {
      const expiryNs = JSON.parse(String.fromCharCode(...expiryResult.result.result));
      if (expiryNs) {
        // Convert nanoseconds to milliseconds and format as ISO string
        expiry = new Date(Number(expiryNs) / 1_000_000).toISOString();
      }
    }

    return { isLicensed, expiry };
  } catch (error) {
    console.error(`Failed to query contract for ${nearAccountId}:`, error);
    return { isLicensed: false, expiry: null };
  }
}

/**
 * Search for licenses by NEAR account ID prefix
 * Returns license data from KV and NEAR contract
 */
export async function handleAdminLicenses(c: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    const search = c.req.query('search') || '';
    const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 50);

    const licenses: LicenseInfo[] = [];
    const seenAccounts = new Set<string>();

    // If search looks like a complete NEAR account ID, check on-chain directly first
    // This finds licenses granted via admin that have no subscription record
    if (isCompleteNearAccountId(search)) {
      const contractLicense = await queryContractLicense(c.env, search);
      if (contractLicense.isLicensed || contractLicense.expiry) {
        // License exists on-chain - add it as admin-granted
        licenses.push({
          nearAccountId: search,
          source: 'admin',
          subscriptionStatus: contractLicense.isLicensed ? 'active' : 'expired',
          contractLicense,
        });
        seenAccounts.add(search);
      }
    }

    // Search Stripe subscriptions by NEAR account ID
    // We need to check the near: prefix mappings
    const stripeList = await c.env.SUBSCRIPTIONS.list({
      prefix: `near:${search}`,
      limit: limit,
    });

    for (const key of stripeList.keys) {
      if (licenses.length >= limit) break;

      const nearAccountId = key.name.replace('near:', '');

      // Skip if we already have this account (from direct on-chain query)
      if (seenAccounts.has(nearAccountId)) continue;

      const customerId = await c.env.SUBSCRIPTIONS.get(key.name);

      if (customerId) {
        const subData = await c.env.SUBSCRIPTIONS.get(`customer:${customerId}`);
        if (subData) {
          const sub: SubscriptionRecord = JSON.parse(subData);
          const contractLicense = await queryContractLicense(c.env, nearAccountId);

          licenses.push({
            nearAccountId,
            source: 'stripe',
            subscriptionStatus: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd,
            contractLicense,
          });
          seenAccounts.add(nearAccountId);
        }
      }
    }

    // Search crypto subscriptions
    const cryptoList = await c.env.CRYPTO_SUBSCRIPTIONS.list({
      prefix: `crypto_sub:${search}`,
      limit: limit - licenses.length,
    });

    for (const key of cryptoList.keys) {
      if (licenses.length >= limit) break;

      const nearAccountId = key.name.replace('crypto_sub:', '');

      // Skip if we already have this account
      if (seenAccounts.has(nearAccountId)) continue;

      const subData = await c.env.CRYPTO_SUBSCRIPTIONS.get(key.name);

      if (subData) {
        const sub: CryptoSubscription = JSON.parse(subData);
        const contractLicense = await queryContractLicense(c.env, nearAccountId);

        licenses.push({
          nearAccountId,
          source: 'crypto',
          subscriptionStatus: sub.status,
          nextChargeDate: sub.nextChargeDate,
          contractLicense,
        });
        seenAccounts.add(nearAccountId);
      }
    }

    // Check if request is from htmx
    const isHtmx = c.req.header('HX-Request') === 'true';

    if (isHtmx) {
      return c.html(licensesFragment(licenses));
    }

    return c.json({
      success: true,
      data: {
        licenses,
        count: licenses.length,
        search: search || null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching licenses:', errorMessage);
    return c.json({ error: 'Failed to fetch licenses' }, 500);
  }
}
