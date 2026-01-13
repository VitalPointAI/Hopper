/**
 * License status returned from validation
 */
export interface LicenseStatus {
  /** Whether the account has a valid license */
  isLicensed: boolean;
  /** Unix timestamp when license expires, null if not licensed or perpetual */
  expiresAt: number | null;
  /** Unix timestamp when this status was cached */
  cachedAt: number;
}

/**
 * Configuration for license validation
 */
export interface LicenseConfig {
  /** NEAR contract ID for license lookups */
  contractId: string;
  /** NEAR RPC URL for view calls */
  rpcUrl: string;
  /** Cache time-to-live in milliseconds */
  cacheTtlMs: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_LICENSE_CONFIG: Partial<LicenseConfig> = {
  contractId: 'license.specflow.near',
  cacheTtlMs: 3600000, // 1 hour
};

/**
 * NEAR RPC URLs by network
 */
export const NEAR_RPC_URLS: Record<string, string> = {
  mainnet: 'https://rpc.mainnet.near.org',
  testnet: 'https://rpc.testnet.near.org',
};
