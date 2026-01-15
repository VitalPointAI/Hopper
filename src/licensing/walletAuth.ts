import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Session token from successful wallet authentication
 */
export interface WalletSession {
  /** Verified NEAR account ID */
  accountId: string;
  /** JWT session token for license API calls */
  token: string;
  /** When the session expires (Unix timestamp ms) */
  expiresAt: number;
}

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

const SESSION_STORAGE_KEY = 'specflow.walletSession';
const CHALLENGE_STORAGE_KEY = 'specflow.pendingChallenge';

/**
 * Wallet authentication manager
 *
 * Handles secure authentication flow:
 * 1. Generate challenge (nonce + timestamp)
 * 2. User signs challenge with NEAR wallet
 * 3. API verifies signature and issues JWT
 * 4. Extension caches JWT for session
 */
export class WalletAuthManager {
  private context: vscode.ExtensionContext;
  private session: WalletSession | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.loadSession();
  }

  /**
   * Load saved session from storage
   */
  private async loadSession(): Promise<void> {
    const stored = await this.context.secrets.get(SESSION_STORAGE_KEY);
    if (stored) {
      try {
        const session = JSON.parse(stored) as WalletSession;
        // Check if session is still valid (with 5 min buffer)
        if (session.expiresAt > Date.now() + 5 * 60 * 1000) {
          this.session = session;
          console.log(`Loaded wallet session for ${session.accountId}`);
        } else {
          console.log('Stored wallet session expired, clearing');
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
   * Get the authenticated account ID
   */
  getAccountId(): string | undefined {
    return this.session?.accountId;
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
   * Start the wallet authentication flow
   * Opens a browser window for wallet signing
   */
  async startAuth(): Promise<void> {
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

      // Store session
      this.session = {
        accountId,
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
   * Clear the current session (logout)
   */
  async clearSession(): Promise<void> {
    this.session = null;
    await this.context.secrets.delete(SESSION_STORAGE_KEY);
    await this.context.globalState.update(CHALLENGE_STORAGE_KEY, undefined);
    console.log('Wallet session cleared');
  }
}
