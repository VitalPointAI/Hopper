import * as vscode from 'vscode';
import { LicenseValidator } from './validator';
import { UpgradeModalPanel } from './upgradeModal';

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
      'SpecFlow Pro requires wallet authentication to verify your license.',
      'Connect Wallet',
      'Learn More'
    );

    if (action === 'Connect Wallet') {
      await validator.startAuth();
    } else if (action === 'Learn More') {
      await vscode.env.openExternal(vscode.Uri.parse('https://specflow.dev/pro'));
    }

    return false;
  }

  // Get authenticated account ID
  const nearAccountId = validator.getAuthenticatedAccountId();
  if (!nearAccountId) {
    // This shouldn't happen if isAuthenticated() is true, but handle it
    console.error('Authenticated but no account ID');
    return false;
  }

  // Check license status
  const status = await validator.checkLicense();

  if (!status) {
    // Not authenticated (shouldn't reach here)
    return false;
  }

  if (status.isLicensed) {
    // Check if license is expired
    if (status.expiresAt && status.expiresAt < Date.now() / 1000) {
      // License expired - clear cache and recheck
      validator.clearCache(nearAccountId);
      const refreshedStatus = await validator.checkLicense();

      if (!refreshedStatus || !refreshedStatus.isLicensed) {
        // In quiet mode, just return false without showing dialogs
        if (!options?.quiet) {
          vscode.window.showWarningMessage(
            'Your SpecFlow Pro license has expired. Please renew to continue using Phase 2+ features.'
          );
          UpgradeModalPanel.show(context, nearAccountId);
        }
        return false;
      }
    }

    return true;
  }

  // Not licensed - show upgrade modal (unless quiet mode)
  if (!options?.quiet) {
    UpgradeModalPanel.show(context, nearAccountId);
  }
  return false;
}

/**
 * Show the upgrade modal manually (for command palette)
 *
 * @param validator - LicenseValidator instance
 * @param context - Extension context for showing modal
 */
export async function showUpgradeModal(
  validator: LicenseValidator,
  context: vscode.ExtensionContext
): Promise<void> {
  // Must be authenticated to show upgrade modal
  if (validator.isAuthenticated()) {
    const accountId = validator.getAuthenticatedAccountId();
    if (accountId) {
      UpgradeModalPanel.show(context, accountId);
      return;
    }
  }

  // Not authenticated - prompt to connect wallet
  const action = await vscode.window.showWarningMessage(
    'Please connect your NEAR wallet to view upgrade options.',
    'Connect Wallet',
    'Learn More'
  );

  if (action === 'Connect Wallet') {
    await validator.startAuth();
  } else if (action === 'Learn More') {
    await vscode.env.openExternal(vscode.Uri.parse('https://specflow.dev/pro'));
  }
}

/**
 * Start wallet authentication
 */
export async function connectWallet(validator: LicenseValidator): Promise<void> {
  await validator.startAuth();
}

/**
 * Disconnect wallet / logout
 */
export async function disconnectWallet(validator: LicenseValidator): Promise<void> {
  await validator.logout();
  vscode.window.showInformationMessage('Disconnected from NEAR wallet');
}
