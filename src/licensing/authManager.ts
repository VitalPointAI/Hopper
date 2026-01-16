import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { AuthSession, AuthType, AuthProvider } from './types';

/**
 * Challenge for wallet signing
 */
interface SigningChallenge {
  /** Random nonce */
  nonce: string;
  /** Timestamp when challenge was created */
  timestamp: number;
  /** Message to be signed */
  message: string;
}

const SESSION_STORAGE_KEY = 'specflow.authSession';
const CHALLENGE_STORAGE_KEY = 'specflow.pendingChallenge';

/**
 * Unified authentication manager
 *
 * Handles both OAuth and NEAR wallet authentication flows:
 *
 * OAuth Flow:
 * 1. Open OAuth provider URL (Google/GitHub)
 * 2. User authenticates in browser
 * 3. Callback redirects back to VSCode with JWT
 *
 * Wallet Flow:
 * 1. Generate challenge (nonce + timestamp)
 * 2. User signs challenge with NEAR wallet
 * 3. API verifies signature and issues JWT
 * 4. Extension caches JWT for session
 */
export class AuthManager {
  private context: vscode.ExtensionContext;
  private session: AuthSession | null = null;
  private initPromise: Promise<void>;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    // Store the init promise so callers can await it if needed
    this.initPromise = this.loadSession();
  }

  /**
   * Wait for initialization to complete
   * Call this before checking authentication if you need to ensure session is loaded
   */
  async ensureInitialized(): Promise<void> {
    await this.initPromise;
  }

  /**
   * Load saved session from storage
   */
  private async loadSession(): Promise<void> {
    const stored = await this.context.secrets.get(SESSION_STORAGE_KEY);
    if (stored) {
      try {
        const session = JSON.parse(stored) as AuthSession;
        // Check if session is still valid (with 5 min buffer)
        if (session.expiresAt > Date.now() + 5 * 60 * 1000) {
          this.session = session;
          console.log(`Loaded auth session for ${session.userId} (${session.provider})`);
        } else {
          console.log('Stored auth session expired, clearing');
          await this.clearSession();
        }
      } catch (e) {
        console.error('Failed to parse stored session:', e);
        await this.clearSession();
      }
    }
  }

  /**
   * Check if user is authenticated with a valid session
   */
  isAuthenticated(): boolean {
    if (!this.session) {
      return false;
    }
    // Check expiry with 5 min buffer
    return this.session.expiresAt > Date.now() + 5 * 60 * 1000;
  }

  /**
   * Get the current session
   */
  getSession(): AuthSession | null {
    if (!this.isAuthenticated()) {
      return null;
    }
    return this.session;
  }

  /**
   * Get the authenticated user ID
   * Returns userId for both OAuth and wallet sessions
   */
  getUserId(): string | undefined {
    return this.session?.userId;
  }

  /**
   * Get the authenticated account ID (alias for getUserId for backward compat)
   */
  getAccountId(): string | undefined {
    return this.getUserId();
  }

  /**
   * Get the session token for API calls
   */
  getToken(): string | undefined {
    if (!this.isAuthenticated()) {
      return undefined;
    }
    return this.session?.token;
  }

  /**
   * Get the current auth type
   */
  getAuthType(): AuthType | undefined {
    return this.session?.authType;
  }

  /**
   * Get the current auth provider
   */
  getProvider(): AuthProvider | undefined {
    return this.session?.provider;
  }

  /**
   * Start OAuth authentication flow
   * Opens browser to OAuth provider
   *
   * @param provider - OAuth provider ('google' or 'github')
   * @param options - Optional parameters
   * @param options.payment - If 'stripe', redirect to Stripe checkout after auth instead of VSCode
   */
  async startOAuth(provider: 'google' | 'github', options?: { payment?: 'stripe' }): Promise<void> {
    const config = vscode.workspace.getConfiguration('specflow');
    const apiUrl = config.get<string>('licenseApiUrl') ?? 'https://specflow-license-api.vitalpointai.workers.dev';

    // Build OAuth URL - callback is handled by Worker
    const oauthUrl = new URL(`${apiUrl}/auth/oauth/${provider}`);
    oauthUrl.searchParams.set('callback', 'vscode://vitalpointai.specflow/auth-callback');

    // If payment flow, tell OAuth to redirect to checkout after auth
    if (options?.payment === 'stripe') {
      oauthUrl.searchParams.set('payment', 'stripe');
    }

    vscode.window.showInformationMessage(`Opening ${provider} sign-in...`);
    await vscode.env.openExternal(vscode.Uri.parse(oauthUrl.toString()));
  }

  /**
   * Start email authentication flow
   * Opens modal for email/password entry (defer implementation to Plan 03)
   */
  async startEmailAuth(): Promise<void> {
    // Email auth UI will be implemented in Plan 03 (upgrade modal updates)
    vscode.window.showInformationMessage('Email authentication coming soon. Please use Google, GitHub, or NEAR wallet.');
  }

  /**
   * Start the multi-chain wallet authentication flow
   * Opens a browser window with wallet selection (NEAR, Ethereum, Solana, etc.)
   */
  async startWalletAuth(): Promise<void> {
    const config = vscode.workspace.getConfiguration('specflow');
    const apiUrl = config.get<string>('licenseApiUrl') ?? 'https://specflow-license-api.vitalpointai.workers.dev';
    const network = config.get<string>('license.nearNetwork') ?? 'mainnet';

    // Build wallet connection URL - opens multi-chain wallet page
    const walletUrl = new URL(`${apiUrl}/auth/wallet`);
    walletUrl.searchParams.set('network', network);
    walletUrl.searchParams.set('callback', 'vscode://vitalpointai.specflow/auth-callback');

    vscode.window.showInformationMessage('Opening wallet connection page...');
    await vscode.env.openExternal(vscode.Uri.parse(walletUrl.toString()));
  }

  /**
   * Start the NEAR wallet authentication flow (legacy)
   * Opens a browser window for NEAR wallet signing
   *
   * @param options - Optional parameters
   * @param options.payment - If 'crypto', stay in browser for payment after auth
   * @deprecated Use startWalletAuth() for multi-chain support
   */
  async startAuth(options?: { payment?: 'crypto' }): Promise<void> {
    const config = vscode.workspace.getConfiguration('specflow');
    const apiUrl = config.get<string>('licenseApiUrl') ?? 'https://specflow-license-api.vitalpointai.workers.dev';
    const network = config.get<string>('license.nearNetwork') ?? 'mainnet';

    // Generate challenge
    const challenge = this.generateChallenge();

    // Store challenge for verification when callback arrives
    await this.context.globalState.update(CHALLENGE_STORAGE_KEY, JSON.stringify(challenge));

    // Build signing URL
    // The signing page is hosted by the license API and uses NEAR Wallet Selector
    const signingUrl = new URL(`${apiUrl}/auth/sign`);
    signingUrl.searchParams.set('nonce', challenge.nonce);
    signingUrl.searchParams.set('timestamp', challenge.timestamp.toString());
    signingUrl.searchParams.set('message', challenge.message);
    signingUrl.searchParams.set('network', network);
    signingUrl.searchParams.set('callback', 'vscode://vitalpointai.specflow/auth-callback');

    // If payment flow, tell sign page to handle checkout after auth
    if (options?.payment === 'crypto') {
      signingUrl.searchParams.set('payment', 'crypto');
    }

    vscode.window.showInformationMessage('Opening NEAR wallet for authentication...');
    await vscode.env.openExternal(vscode.Uri.parse(signingUrl.toString()));
  }

  /**
   * Generate a signing challenge
   */
  private generateChallenge(): SigningChallenge {
    const nonce = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now();
    const message = `Sign this message to authenticate with SpecFlow.\n\nNonce: ${nonce}\nTimestamp: ${timestamp}`;

    return { nonce, timestamp, message };
  }

  /**
   * Handle the callback from wallet signing
   * Called when user is redirected back via vscode:// URI
   *
   * @param accountId - NEAR account that signed
   * @param signature - Base64 encoded signature
   * @param publicKey - Public key used for signing
   */
  async handleCallback(accountId: string, signature: string, publicKey: string): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('specflow');
    const apiUrl = config.get<string>('licenseApiUrl') ?? 'https://specflow-license-api.vitalpointai.workers.dev';

    // Retrieve stored challenge
    const storedChallenge = this.context.globalState.get<string>(CHALLENGE_STORAGE_KEY);
    if (!storedChallenge) {
      vscode.window.showErrorMessage('Authentication failed: No pending challenge found');
      return false;
    }

    const challenge = JSON.parse(storedChallenge) as SigningChallenge;

    // Check challenge is recent (within 5 minutes)
    if (Date.now() - challenge.timestamp > 5 * 60 * 1000) {
      vscode.window.showErrorMessage('Authentication failed: Challenge expired');
      await this.context.globalState.update(CHALLENGE_STORAGE_KEY, undefined);
      return false;
    }

    try {
      // Verify signature with license API
      const response = await fetch(`${apiUrl}/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_id: accountId,
          signature,
          public_key: publicKey,
          message: challenge.message,
          nonce: challenge.nonce,
          timestamp: challenge.timestamp,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Verification failed: ${error}`);
      }

      const data = await response.json() as { token: string; expires_at: number };

      // Store session with wallet auth type
      this.session = {
        userId: accountId,
        authType: 'wallet',
        provider: 'near',
        token: data.token,
        expiresAt: data.expires_at,
      };

      await this.context.secrets.store(SESSION_STORAGE_KEY, JSON.stringify(this.session));
      await this.context.globalState.update(CHALLENGE_STORAGE_KEY, undefined);

      vscode.window.showInformationMessage(`Authenticated as ${accountId}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Wallet auth error:', errorMessage);
      vscode.window.showErrorMessage(`Authentication failed: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Handle callback with pre-verified token from server
   * Used for both OAuth callbacks and wallet sign page callbacks
   *
   * @param sessionData - Session data from callback (userId, authType, provider, token, expiresAt, etc.)
   */
  async handleCallbackWithToken(sessionData: {
    userId: string;
    authType: AuthType;
    provider: AuthProvider;
    chain?: string;
    token: string;
    expiresAt: number;
    displayName?: string;
    email?: string;
  }): Promise<boolean> {
    try {
      // Store session directly - no verification needed
      this.session = {
        userId: sessionData.userId,
        authType: sessionData.authType,
        provider: sessionData.provider,
        chain: sessionData.chain,
        token: sessionData.token,
        expiresAt: sessionData.expiresAt,
        displayName: sessionData.displayName,
        email: sessionData.email,
      };

      await this.context.secrets.store(SESSION_STORAGE_KEY, JSON.stringify(this.session));
      await this.context.globalState.update(CHALLENGE_STORAGE_KEY, undefined);

      const displayId = sessionData.displayName ?? sessionData.email ?? sessionData.userId;
      vscode.window.showInformationMessage(`Authenticated as ${displayId}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Token storage error:', errorMessage);
      vscode.window.showErrorMessage(`Authentication failed: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Clear the current session (logout)
   */
  async clearSession(): Promise<void> {
    this.session = null;
    await this.context.secrets.delete(SESSION_STORAGE_KEY);
    await this.context.globalState.update(CHALLENGE_STORAGE_KEY, undefined);
    console.log('Auth session cleared');
  }
}

// Backward compatibility alias
export { AuthManager as WalletAuthManager };
