import * as vscode from 'vscode';
import { LicenseValidator } from './validator';
import { UpgradeModalPanel } from './upgradeModal';

/**
 * Check if the user has access to a specific phase
 *
 * Phase 1 is always free. Phase 2+ requires a valid license.
 *
 * @param phaseNumber - The phase number to check access for
 * @param validator - LicenseValidator instance
 * @param context - Extension context for showing modal
 * @returns true if access is granted, false if gated
 */
export async function checkPhaseAccess(
  phaseNumber: number,
  validator: LicenseValidator,
  context: vscode.ExtensionContext
): Promise<boolean> {
  // Phase 1 is always free
  if (phaseNumber <= 1) {
    return true;
  }

  // Get NEAR account ID
  const nearAccountId = validator.getNearAccountId();

  if (!nearAccountId) {
    // No NEAR account configured - prompt to set it up
    const action = await vscode.window.showWarningMessage(
      'SpecFlow Pro requires a NEAR account ID for license validation.',
      'Configure Account',
      'Learn More'
    );

    if (action === 'Configure Account') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'specflow.nearAccountId');
    } else if (action === 'Learn More') {
      await vscode.env.openExternal(vscode.Uri.parse('https://specflow.dev/pro'));
    }

    return false;
  }

  // Check license status
  const status = await validator.checkLicense(nearAccountId);

  if (status.isLicensed) {
    // Check if license is expired
    if (status.expiresAt && status.expiresAt < Date.now() / 1000) {
      // License expired - clear cache and recheck
      validator.clearCache(nearAccountId);
      const refreshedStatus = await validator.checkLicense(nearAccountId);

      if (!refreshedStatus.isLicensed) {
        vscode.window.showWarningMessage(
          'Your SpecFlow Pro license has expired. Please renew to continue using Phase 2+ features.'
        );
        UpgradeModalPanel.show(context, nearAccountId);
        return false;
      }
    }

    return true;
  }

  // Not licensed - show upgrade modal
  UpgradeModalPanel.show(context, nearAccountId);
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
  const nearAccountId = validator.getNearAccountId();

  if (!nearAccountId) {
    const action = await vscode.window.showWarningMessage(
      'Please configure your NEAR account ID first.',
      'Configure Account'
    );

    if (action === 'Configure Account') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'specflow.nearAccountId');
    }
    return;
  }

  UpgradeModalPanel.show(context, nearAccountId);
}
