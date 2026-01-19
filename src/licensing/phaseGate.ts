import * as vscode from 'vscode';
import { LicenseValidator } from './validator';
import { UpgradeModalPanel } from './upgradeModal';
import { log, logError } from '../logging';

/**
 * Options for checkPhaseAccess behavior
 */
interface CheckPhaseAccessOptions {
  /** If true, don't show modal dialogs - just return result */
  quiet?: boolean;
}

/**
 * Check if the user has access to a specific phase
 *
 * Phase 1 is always free. Phase 2+ requires:
 * 1. Wallet authentication (prove account ownership)
 * 2. Valid license on that account
 *
 * @param phaseNumber - The phase number to check access for
 * @param validator - LicenseValidator instance
 * @param context - Extension context for showing modal
 * @param options - Optional behavior configuration
 * @returns true if access is granted, false if gated
 */
export async function checkPhaseAccess(
  phaseNumber: number,
  validator: LicenseValidator,
  context: vscode.ExtensionContext,
  options?: CheckPhaseAccessOptions
): Promise<boolean> {
  // Phase 1 is always free
  if (phaseNumber <= 1) {
    return true;
  }

  // Check if user is authenticated
  if (!validator.isAuthenticated()) {
    // In quiet mode, just return false without showing dialogs
    if (options?.quiet) {
      return false;
    }

    const action = await vscode.window.showWarningMessage(
      'Hopper Pro requires wallet authentication to verify your license.',
      'Connect Wallet',
      'Learn More'
    );

    if (action === 'Connect Wallet') {
      await validator.startAuth();
    } else if (action === 'Learn More') {
      await vscode.env.openExternal(vscode.Uri.parse('https://hopper.dev/pro'));
    }

    return false;
  }

  // Get authenticated session
  const authSession = validator.getSession();
  if (!authSession) {
    // This shouldn't happen if isAuthenticated() is true, but handle it
    logError('license', 'Authenticated but no session');
    return false;
  }

  // For cache operations, we need the user ID
  const userId = authSession.userId;

  // Check license status
  const status = await validator.checkLicense();
  log('license', 'checkPhaseAccess license status', status);

  if (!status) {
    // Not authenticated (shouldn't reach here)
    return false;
  }

  if (status.isLicensed) {
    // Check if license is expired
    // Note: expiresAt from NEAR contract is in nanoseconds, OAuth API returns milliseconds
    // We determine which format based on auth type
    const authType = authSession.authType;
    let expiresAtMs: number | null = null;

    if (status.expiresAt) {
      if (authType === 'wallet') {
        // NEAR contract returns nanoseconds - convert to milliseconds
        expiresAtMs = status.expiresAt / 1_000_000;
      } else {
        // OAuth API returns milliseconds - use directly
        expiresAtMs = status.expiresAt;
      }
    }
    log('license', 'checkPhaseAccess expiry check', {
      authType,
      expiresAtRaw: status.expiresAt,
      expiresAtMs,
      now: Date.now(),
      isExpired: expiresAtMs ? expiresAtMs < Date.now() : false
    });

    if (expiresAtMs && expiresAtMs < Date.now()) {
      // License expired - clear cache and recheck
      validator.clearCache(userId);
      const refreshedStatus = await validator.checkLicense();

      if (!refreshedStatus || !refreshedStatus.isLicensed) {
        // In quiet mode, just return false without showing dialogs
        if (!options?.quiet) {
          vscode.window.showWarningMessage(
            'Your Hopper Pro license has expired. Please renew to continue using Phase 2+ features.'
          );
          UpgradeModalPanel.show(context, authSession);
        }
        return false;
      }
    }

    return true;
  }

  // Not licensed - show upgrade modal (unless quiet mode)
  if (!options?.quiet) {
    UpgradeModalPanel.show(context, authSession);
  }
  return false;
}

/**
 * Show the upgrade modal manually (for command palette)
 *
 * Works with both authenticated and unauthenticated users:
 * - Authenticated: Shows modal with their account info
 * - Unauthenticated: Shows modal with sign-in prompts
 *
 * @param validator - LicenseValidator instance
 * @param context - Extension context for showing modal
 */
export async function showUpgradeModal(
  validator: LicenseValidator,
  context: vscode.ExtensionContext
): Promise<void> {
  // Get session (may be null if not authenticated)
  const authSession = validator.getSession();

  // Show the modal - it handles both authenticated and unauthenticated users
  UpgradeModalPanel.show(context, authSession);
}

/**
 * Start authentication (unified connect)
 * Shows auth method picker for user to choose
 */
export async function connect(validator: LicenseValidator): Promise<void> {
  // Show quick pick with auth options
  const option = await vscode.window.showQuickPick([
    { label: 'Google', description: 'Sign in with Google', provider: 'google' as const },
    { label: 'GitHub', description: 'Sign in with GitHub', provider: 'github' as const },
    { label: 'Wallet', description: 'Connect any wallet (NEAR, Ethereum, Solana, etc.)', provider: 'wallet' as const },
  ], { placeHolder: 'Choose sign-in method' });

  if (option) {
    if (option.provider === 'wallet') {
      // Opens multi-chain wallet connection page
      await validator.getAuthManager().startWalletAuth();
    } else {
      await validator.getAuthManager().startOAuth(option.provider);
    }
  }
}

/**
 * Disconnect / logout (unified disconnect)
 */
export async function disconnect(validator: LicenseValidator): Promise<void> {
  log('license', 'disconnect - before logout', { isAuthenticated: validator.isAuthenticated() });
  await validator.logout();
  log('license', 'disconnect - after logout', { isAuthenticated: validator.isAuthenticated() });
  vscode.window.showInformationMessage('Signed out successfully');
}

/**
 * Start wallet authentication
 * @deprecated Use connect() for unified auth flow
 */
export async function connectWallet(validator: LicenseValidator): Promise<void> {
  await validator.startAuth();
}

/**
 * Disconnect wallet / logout
 * @deprecated Use disconnect() for unified auth flow
 */
export async function disconnectWallet(validator: LicenseValidator): Promise<void> {
  await validator.logout();
  vscode.window.showInformationMessage('Disconnected from NEAR wallet');
}
