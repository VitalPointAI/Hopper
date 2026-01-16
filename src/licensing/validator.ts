import * as vscode from 'vscode';
import { LicenseConfig, LicenseStatus, DEFAULT_LICENSE_CONFIG, NEAR_RPC_URLS, AuthSession, AuthType, AuthProvider } from './types';
import { viewIsLicensed, viewGetExpiry } from './nearRpc';
import { AuthManager } from './authManager';
import { trackLogin, trackUpgrade } from '../telemetry/telemetryService';

/**
 * License validator with caching support and dual authentication
 *
 * Checks license status against NEAR contract (for wallet users) or
 * license API (for OAuth users) and caches results to minimize calls.
 * Supports both OAuth (Google/GitHub/email) and NEAR wallet authentication.
 */
export class LicenseValidator {
  private config: LicenseConfig;
  private context: vscode.ExtensionContext;
  private licenseCache: Map<string, LicenseStatus> = new Map();
  private authManager: AuthManager;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.config = this.loadConfig();
    this.authManager = new AuthManager(context);
  }

  /**
   * Get the auth manager for authentication flows
   */
  getAuthManager(): AuthManager {
    return this.authManager;
  }

  /**
   * Get the wallet auth manager (alias for backward compatibility)
   * @deprecated Use getAuthManager() instead
   */
  getWalletAuth(): AuthManager {
    return this.authManager;
  }

  /**
   * Ensure auth manager is initialized (session loaded from storage)
   */
  async ensureInitialized(): Promise<void> {
    await this.authManager.ensureInitialized();
  }

  /**
   * Check if user is authenticated
   * Note: Call ensureInitialized() first if checking immediately after extension activation
   */
  isAuthenticated(): boolean {
    return this.authManager.isAuthenticated();
  }

  /**
   * Get the authenticated user ID
   * Returns userId for both OAuth and wallet sessions
   * Returns undefined if not authenticated
   */
  getAuthenticatedAccountId(): string | undefined {
    return this.authManager.getUserId();
  }

  /**
   * Get the current auth type
   */
  getAuthType(): AuthType | undefined {
    return this.authManager.getAuthType();
  }

  /**
   * Get the current auth session
   * Returns null if not authenticated
   */
  getSession(): AuthSession | null {
    return this.authManager.getSession();
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
   * Routes to correct backend based on auth type:
   * - ALL wallet users: Check NEAR contract (supports NEAR, EVM, Solana, etc.)
   * - OAuth users: Check license API
   *
   * @returns License status with caching metadata, or null if not authenticated
   */
  async checkLicense(): Promise<LicenseStatus | null> {
    // Must be authenticated first
    const session = this.authManager.getSession();
    if (!session || !this.authManager.isAuthenticated()) {
      console.log('License check failed: not authenticated');
      return null;
    }

    if (session.authType === 'wallet') {
      // ALL wallets (NEAR, EVM, Solana, etc.) use the NEAR contract
      // The contract now accepts any wallet address string
      return this.checkLicenseOnContract(session.userId);
    } else {
      // OAuth flow: check license API
      return this.checkLicenseOnApi(session);
    }
  }

  /**
   * Check license on NEAR contract (for wallet users)
   */
  private async checkLicenseOnContract(accountId: string): Promise<LicenseStatus> {
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

    // Track upgrade if user just became licensed (wasn't licensed before, is now)
    if (isLicensed && (!cached || !cached.isLicensed)) {
      trackUpgrade(this.context, accountId).catch(() => {
        // Silently ignore telemetry errors
      });
    }

    // Update cache
    this.licenseCache.set(accountId, status);

    return status;
  }

  /**
   * Check license on API (for OAuth users)
   */
  private async checkLicenseOnApi(session: AuthSession): Promise<LicenseStatus> {
    const config = vscode.workspace.getConfiguration('specflow');
    const apiUrl = config.get<string>('licenseApiUrl') ?? 'https://specflow-license-api.vitalpointai.workers.dev';

    // Check cache first
    const cached = this.licenseCache.get(session.userId);
    const now = Date.now();

    if (cached && (now - cached.cachedAt) < this.config.cacheTtlMs) {
      console.log(`License cache hit for ${session.userId}`);
      return cached;
    }

    console.log(`License cache miss for ${session.userId}, checking API...`);

    try {
      const response = await fetch(`${apiUrl}/api/license/check`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`License check failed: ${response.status}`);
      }

      const data = await response.json() as { isLicensed: boolean; expiresAt: number | null };
      const status: LicenseStatus = {
        isLicensed: data.isLicensed,
        expiresAt: data.expiresAt,
        cachedAt: now,
      };

      // Track upgrade if user just became licensed
      if (status.isLicensed && (!cached || !cached.isLicensed)) {
        trackUpgrade(this.context, session.userId).catch(() => {
          // Silently ignore telemetry errors
        });
      }

      // Update cache
      this.licenseCache.set(session.userId, status);

      return status;
    } catch (error) {
      console.error('OAuth license check failed:', error);
      return { isLicensed: false, expiresAt: null, cachedAt: now };
    }
  }

  /**
   * Check license status for a specific account (internal use)
   * Used after payment verification where we know the account
   * ALL wallet types are stored on the NEAR contract
   *
   * @param walletAddress - Wallet address to check (NEAR account, EVM address, Solana pubkey, etc.)
   * @returns License status with caching metadata
   */
  async checkLicenseForAccount(walletAddress: string): Promise<LicenseStatus> {
    // Check cache first
    const cached = this.licenseCache.get(walletAddress);
    const now = Date.now();

    if (cached && (now - cached.cachedAt) < this.config.cacheTtlMs) {
      console.log(`License cache hit for ${walletAddress}`);
      return cached;
    }

    console.log(`License cache miss for ${walletAddress}, checking NEAR contract...`);

    // Fetch fresh status from NEAR contract
    // The contract now accepts any wallet address string
    const [isLicensed, expiresAt] = await Promise.all([
      viewIsLicensed(walletAddress, this.config),
      viewGetExpiry(walletAddress, this.config),
    ]);

    const status: LicenseStatus = {
      isLicensed,
      expiresAt,
      cachedAt: now,
    };

    // Update cache
    this.licenseCache.set(walletAddress, status);

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
   * Get the authenticated user ID
   * @returns User ID or undefined if not authenticated
   */
  getNearAccountId(): string | undefined {
    return this.authManager.getUserId();
  }

  /**
   * Start wallet authentication flow
   *
   * @param options - Optional parameters
   * @param options.payment - If 'crypto', stay in browser for payment after auth
   */
  async startAuth(options?: { payment?: 'crypto' }): Promise<void> {
    await this.authManager.startAuth(options);
  }

  /**
   * Handle authentication callback with signature verification
   */
  async handleAuthCallback(accountId: string, signature: string, publicKey: string): Promise<boolean> {
    const success = await this.authManager.handleCallback(accountId, signature, publicKey);

    if (success) {
      // Track login telemetry
      trackLogin(this.context, accountId).catch(() => {
        // Silently ignore telemetry errors
      });
    }

    return success;
  }

  /**
   * Handle authentication callback with pre-verified token
   * Supports both OAuth and wallet callbacks with full session data
   */
  async handleAuthCallbackWithToken(sessionData: {
    userId: string;
    authType: AuthType;
    provider: AuthProvider;
    chain?: string;
    token: string;
    expiresAt: number;
    displayName?: string;
    email?: string;
  }): Promise<boolean> {
    const success = await this.authManager.handleCallbackWithToken(sessionData);

    if (success) {
      // Track login telemetry
      trackLogin(this.context, sessionData.userId).catch(() => {
        // Silently ignore telemetry errors
      });
    }

    return success;
  }

  /**
   * Logout / clear authentication
   */
  async logout(): Promise<void> {
    await this.authManager.clearSession();
    this.clearAllCache();
  }
}
