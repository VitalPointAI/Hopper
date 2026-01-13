import * as vscode from 'vscode';
import { LicenseConfig, LicenseStatus, DEFAULT_LICENSE_CONFIG, NEAR_RPC_URLS } from './types';
import { viewIsLicensed, viewGetExpiry } from './nearRpc';
import { WalletAuthManager } from './walletAuth';

/**
 * License validator with caching support and wallet authentication
 *
 * Checks license status against NEAR contract and caches results
 * to minimize RPC calls. Requires wallet authentication to prove
 * account ownership before checking license.
 */
export class LicenseValidator {
  private config: LicenseConfig;
  private context: vscode.ExtensionContext;
  private licenseCache: Map<string, LicenseStatus> = new Map();
  private walletAuth: WalletAuthManager;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.config = this.loadConfig();
    this.walletAuth = new WalletAuthManager(context);
  }

  /**
   * Get the wallet auth manager for authentication flows
   */
  getWalletAuth(): WalletAuthManager {
    return this.walletAuth;
  }

  /**
   * Check if user is authenticated with their wallet
   */
  isAuthenticated(): boolean {
    return this.walletAuth.isAuthenticated();
  }

  /**
   * Get the authenticated NEAR account ID
   * Returns undefined if not authenticated
   */
  getAuthenticatedAccountId(): string | undefined {
    return this.walletAuth.getAccountId();
  }

  /**
   * Load configuration from VSCode settings
   */
  private loadConfig(): LicenseConfig {
    const config = vscode.workspace.getConfiguration('specflow');
    const contractId = config.get<string>('license.contractId')
      ?? DEFAULT_LICENSE_CONFIG.contractId!;
    const network = config.get<string>('license.nearNetwork') ?? 'mainnet';
    const rpcUrl = NEAR_RPC_URLS[network] ?? NEAR_RPC_URLS.mainnet;
    const cacheTtlMs = DEFAULT_LICENSE_CONFIG.cacheTtlMs!;

    return {
      contractId,
      rpcUrl,
      cacheTtlMs,
    };
  }

  /**
   * Check license status for the authenticated account
   * Uses cached value if available and not expired
   *
   * @returns License status with caching metadata, or null if not authenticated
   */
  async checkLicense(): Promise<LicenseStatus | null> {
    // Must be authenticated first
    const accountId = this.walletAuth.getAccountId();
    if (!accountId || !this.walletAuth.isAuthenticated()) {
      console.log('License check failed: not authenticated');
      return null;
    }

    // Check cache first
    const cached = this.licenseCache.get(accountId);
    const now = Date.now();

    if (cached && (now - cached.cachedAt) < this.config.cacheTtlMs) {
      console.log(`License cache hit for ${accountId}`);
      return cached;
    }

    console.log(`License cache miss for ${accountId}, checking contract...`);

    // Fetch fresh status from contract
    const [isLicensed, expiresAt] = await Promise.all([
      viewIsLicensed(accountId, this.config),
      viewGetExpiry(accountId, this.config),
    ]);

    const status: LicenseStatus = {
      isLicensed,
      expiresAt,
      cachedAt: now,
    };

    // Update cache
    this.licenseCache.set(accountId, status);

    return status;
  }

  /**
   * Check license status for a specific account (internal use)
   * Used after payment verification where we know the account
   *
   * @param nearAccountId - NEAR account ID to check
   * @returns License status with caching metadata
   */
  async checkLicenseForAccount(nearAccountId: string): Promise<LicenseStatus> {
    // Check cache first
    const cached = this.licenseCache.get(nearAccountId);
    const now = Date.now();

    if (cached && (now - cached.cachedAt) < this.config.cacheTtlMs) {
      console.log(`License cache hit for ${nearAccountId}`);
      return cached;
    }

    console.log(`License cache miss for ${nearAccountId}, checking contract...`);

    // Fetch fresh status from contract
    const [isLicensed, expiresAt] = await Promise.all([
      viewIsLicensed(nearAccountId, this.config),
      viewGetExpiry(nearAccountId, this.config),
    ]);

    const status: LicenseStatus = {
      isLicensed,
      expiresAt,
      cachedAt: now,
    };

    // Update cache
    this.licenseCache.set(nearAccountId, status);

    return status;
  }

  /**
   * Clear cached license status for an account
   * Use this after payment to force a fresh check
   *
   * @param nearAccountId - NEAR account ID to clear cache for
   */
  clearCache(nearAccountId: string): void {
    this.licenseCache.delete(nearAccountId);
    console.log(`License cache cleared for ${nearAccountId}`);
  }

  /**
   * Clear all cached license statuses
   */
  clearAllCache(): void {
    this.licenseCache.clear();
    console.log('License cache cleared for all accounts');
  }

  /**
   * Get the authenticated NEAR account ID
   * @returns NEAR account ID or undefined if not authenticated
   */
  getNearAccountId(): string | undefined {
    return this.walletAuth.getAccountId();
  }

  /**
   * Start wallet authentication flow
   */
  async startAuth(): Promise<void> {
    await this.walletAuth.startAuth();
  }

  /**
   * Handle authentication callback
   */
  async handleAuthCallback(accountId: string, signature: string, publicKey: string): Promise<boolean> {
    return this.walletAuth.handleCallback(accountId, signature, publicKey);
  }

  /**
   * Logout / clear authentication
   */
  async logout(): Promise<void> {
    await this.walletAuth.clearSession();
    this.clearAllCache();
  }
}
