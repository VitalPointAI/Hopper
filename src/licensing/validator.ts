import * as vscode from 'vscode';
import { LicenseConfig, LicenseStatus, DEFAULT_LICENSE_CONFIG, NEAR_RPC_URLS } from './types';
import { viewIsLicensed, viewGetExpiry } from './nearRpc';

/**
 * License validator with caching support
 *
 * Checks license status against NEAR contract and caches results
 * to minimize RPC calls.
 */
export class LicenseValidator {
  private config: LicenseConfig;
  private context: vscode.ExtensionContext;
  private licenseCache: Map<string, LicenseStatus> = new Map();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.config = this.loadConfig();
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
   * Check license status for a NEAR account
   * Uses cached value if available and not expired
   *
   * @param nearAccountId - NEAR account ID to check
   * @returns License status with caching metadata
   */
  async checkLicense(nearAccountId: string): Promise<LicenseStatus> {
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
   * Get the NEAR account ID from settings
   * @returns NEAR account ID or undefined if not configured
   */
  getNearAccountId(): string | undefined {
    const config = vscode.workspace.getConfiguration('specflow');
    return config.get<string>('nearAccountId');
  }
}
