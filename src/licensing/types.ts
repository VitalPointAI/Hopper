/**
 * Authentication type
 */
export type AuthType = 'oauth' | 'wallet';

/**
 * Authentication provider
 */
export type AuthProvider = 'google' | 'github' | 'email' | 'near' | 'eth' | 'base' | 'sol' | 'ton' | 'stellar' | 'tron' | 'arb' | 'pol' | 'bsc' | 'avax' | 'op';

/**
 * Unified auth session (replaces WalletSession)
 * Supports both OAuth and wallet authentication (any chain)
 */
export interface AuthSession {
  /** User ID: oauth:{provider}:{id} OR wallet address (any chain) */
  userId: string;
  /** Type of authentication used */
  authType: AuthType;
  /** Provider used for authentication (oauth provider or chain identifier) */
  provider: AuthProvider;
  /** Chain identifier for wallet auth (near, eth, base, sol, etc.) */
  chain?: string;
  /** JWT session token from Worker */
  token: string;
  /** When the session expires (Unix timestamp ms) */
  expiresAt: number;
  /** Display name from OAuth profile */
  displayName?: string;
  /** Email from OAuth profile */
  email?: string;
}

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
  contractId: 'license.hopper.near',
  cacheTtlMs: 3600000, // 1 hour
};

/**
 * NEAR RPC URLs by network (using FastNEAR for better performance)
 */
export const NEAR_RPC_URLS: Record<string, string> = {
  mainnet: 'https://rpc.mainnet.fastnear.com',
  testnet: 'https://rpc.testnet.fastnear.com',
};
