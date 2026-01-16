/**
 * Telemetry storage service
 * Tracks extension installations and conversions for analytics
 */

import type { InstallationRecord, TelemetryStats } from '../types';

// KV key prefixes
const INSTALL_PREFIX = 'install:';
const ACCOUNT_INDEX_PREFIX = 'account_index:';

/**
 * Record an installation or activation event
 */
export async function recordInstallation(
  kv: KVNamespace,
  data: {
    installId: string;
    extensionVersion: string;
    vscodeVersion: string;
    platform: string;
    source?: string;
  }
): Promise<InstallationRecord> {
  const key = `${INSTALL_PREFIX}${data.installId}`;
  const existing = await kv.get<InstallationRecord>(key, 'json');
  const now = new Date().toISOString();

  if (existing) {
    // Update existing record
    const updated: InstallationRecord = {
      ...existing,
      lastSeen: now,
      extensionVersion: data.extensionVersion,
      vscodeVersion: data.vscodeVersion,
    };
    await kv.put(key, JSON.stringify(updated));
    return updated;
  }

  // Create new record
  const record: InstallationRecord = {
    installId: data.installId,
    firstSeen: now,
    lastSeen: now,
    extensionVersion: data.extensionVersion,
    vscodeVersion: data.vscodeVersion,
    platform: data.platform,
    source: data.source,
  };
  await kv.put(key, JSON.stringify(record));
  return record;
}

/**
 * Record a user login (associate NEAR account with installation)
 */
export async function recordLogin(
  kv: KVNamespace,
  installId: string,
  nearAccountId: string
): Promise<InstallationRecord | null> {
  const key = `${INSTALL_PREFIX}${installId}`;
  const existing = await kv.get<InstallationRecord>(key, 'json');

  if (!existing) {
    return null;
  }

  const updated: InstallationRecord = {
    ...existing,
    lastSeen: new Date().toISOString(),
    nearAccountId,
  };
  await kv.put(key, JSON.stringify(updated));

  // Also create an index by account ID for quick lookup
  const accountKey = `${ACCOUNT_INDEX_PREFIX}${nearAccountId}`;
  await kv.put(accountKey, installId);

  return updated;
}

/**
 * Record an upgrade event (free -> pro conversion)
 */
export async function recordUpgrade(
  kv: KVNamespace,
  installId: string,
  nearAccountId: string
): Promise<InstallationRecord | null> {
  const key = `${INSTALL_PREFIX}${installId}`;
  const existing = await kv.get<InstallationRecord>(key, 'json');
  const now = new Date().toISOString();

  if (!existing) {
    return null;
  }

  // Don't overwrite if already upgraded
  if (existing.upgradedAt) {
    return existing;
  }

  const updated: InstallationRecord = {
    ...existing,
    lastSeen: now,
    nearAccountId,
    upgradedAt: now,
  };
  await kv.put(key, JSON.stringify(updated));
  return updated;
}

/**
 * Mark installation as upgraded by NEAR account ID
 * Called when a subscription is created
 */
export async function markUpgradeByAccount(
  kv: KVNamespace,
  nearAccountId: string
): Promise<boolean> {
  // Look up install ID by account
  const accountKey = `${ACCOUNT_INDEX_PREFIX}${nearAccountId}`;
  const installId = await kv.get(accountKey);

  if (!installId) {
    // No installation tracked for this account
    return false;
  }

  const result = await recordUpgrade(kv, installId, nearAccountId);
  return result !== null;
}

/**
 * Get telemetry statistics for admin dashboard
 */
export async function getTelemetryStats(kv: KVNamespace): Promise<TelemetryStats> {
  let totalInstallations = 0;
  let activeInstallations = 0;
  let loggedInUsers = 0;
  let conversions = 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Iterate through all installations
  let cursor: string | undefined;
  do {
    const result = await kv.list<InstallationRecord>({
      prefix: INSTALL_PREFIX,
      cursor,
      limit: 100,
    });

    for (const key of result.keys) {
      totalInstallations++;

      // Get the actual record to check details
      const record = await kv.get<InstallationRecord>(key.name, 'json');
      if (record) {
        // Check if active (seen in last 30 days)
        const lastSeen = new Date(record.lastSeen);
        if (lastSeen >= thirtyDaysAgo) {
          activeInstallations++;
        }

        // Check if logged in
        if (record.nearAccountId) {
          loggedInUsers++;
        }

        // Check if converted (upgraded)
        if (record.upgradedAt) {
          conversions++;
        }
      }
    }

    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  const conversionRate =
    totalInstallations > 0 ? (conversions / totalInstallations) * 100 : 0;

  return {
    totalInstallations,
    activeInstallations,
    loggedInUsers,
    conversions,
    conversionRate: Math.round(conversionRate * 100) / 100, // Round to 2 decimal places
  };
}

/**
 * Get installation record by ID
 */
export async function getInstallation(
  kv: KVNamespace,
  installId: string
): Promise<InstallationRecord | null> {
  const key = `${INSTALL_PREFIX}${installId}`;
  return kv.get<InstallationRecord>(key, 'json');
}

/**
 * Get installation record by NEAR account ID
 */
export async function getInstallationByAccount(
  kv: KVNamespace,
  nearAccountId: string
): Promise<InstallationRecord | null> {
  const accountKey = `${ACCOUNT_INDEX_PREFIX}${nearAccountId}`;
  const installId = await kv.get(accountKey);

  if (!installId) {
    return null;
  }

  return getInstallation(kv, installId);
}
