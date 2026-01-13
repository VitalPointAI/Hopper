import * as vscode from 'vscode';
import { NearAiChatModelProvider } from './provider/nearAiProvider';
import { NEAR_AI_API_KEY_SECRET, isValidApiKeyFormat, getApiKeyInstructions } from './auth/nearAuth';
import { LicenseValidator } from './licensing/validator';
import { checkPhaseAccess, showUpgradeModal } from './licensing/phaseGate';

// Export license validator for use by chat participant
let licenseValidator: LicenseValidator | undefined;

/**
 * Called when the extension is activated.
 * @param context - The extension context provided by VSCode
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('SpecFlow extension activated');

  // Initialize license validator
  licenseValidator = new LicenseValidator(context);

  // Create and register the NEAR AI language model provider
  const provider = new NearAiChatModelProvider(context);
  const providerDisposable = vscode.lm.registerLanguageModelChatProvider(
    'near-ai',  // Must match vendor in package.json
    provider
  );
  context.subscriptions.push(providerDisposable);

  // Register the management command for API key setup
  const manageCommand = vscode.commands.registerCommand(
    'specflow.manageNearAi',
    async () => {
      const apiKey = await context.secrets.get(NEAR_AI_API_KEY_SECRET);
      const isConfigured = !!apiKey && isValidApiKeyFormat(apiKey);

      if (isConfigured) {
        // Show status with option to update or remove
        const action = await vscode.window.showInformationMessage(
          'NEAR AI is configured.',
          'Update API Key',
          'Remove API Key'
        );

        if (action === 'Update API Key') {
          await promptForApiKey(context, provider);
        } else if (action === 'Remove API Key') {
          await context.secrets.delete(NEAR_AI_API_KEY_SECRET);
          provider.clearClient();
          vscode.window.showInformationMessage('NEAR AI API key removed.');
        }
      } else {
        // Prompt for API key setup
        await promptForApiKey(context, provider);
      }
    }
  );
  context.subscriptions.push(manageCommand);

  // Register the upgrade modal command
  const upgradeCommand = vscode.commands.registerCommand(
    'specflow.showUpgradeModal',
    async () => {
      if (licenseValidator) {
        await showUpgradeModal(licenseValidator, context);
      }
    }
  );
  context.subscriptions.push(upgradeCommand);
}

/**
 * Prompt user for API key input
 */
async function promptForApiKey(
  context: vscode.ExtensionContext,
  provider: NearAiChatModelProvider
): Promise<void> {
  const instructions = getApiKeyInstructions();

  // Show instructions with option to proceed
  const proceed = await vscode.window.showInformationMessage(
    'NEAR AI requires an API key from cloud.near.ai',
    { modal: true, detail: instructions },
    'Enter API Key',
    'Open cloud.near.ai'
  );

  if (proceed === 'Open cloud.near.ai') {
    vscode.env.openExternal(vscode.Uri.parse('https://cloud.near.ai/'));
    return;
  }

  if (proceed !== 'Enter API Key') {
    return;
  }

  // Get API key from user
  const apiKey = await vscode.window.showInputBox({
    title: 'NEAR AI API Key',
    prompt: 'Enter your NEAR AI API key',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value) {
        return 'API key is required';
      }
      if (!isValidApiKeyFormat(value)) {
        return 'Invalid API key format';
      }
      return null;
    }
  });

  if (apiKey) {
    await context.secrets.store(NEAR_AI_API_KEY_SECRET, apiKey);
    provider.clearClient();
    vscode.window.showInformationMessage('NEAR AI API key saved successfully.');
  }
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Cleanup handled by disposables
}

/**
 * Get the license validator instance
 * For use by chat participant to check phase access
 */
export function getLicenseValidator(): LicenseValidator | undefined {
  return licenseValidator;
}

/**
 * Check if user has access to a specific phase
 * Convenience export for chat participant integration
 *
 * @param phaseNumber - Phase to check access for (1 is always free, 2+ requires license)
 * @param context - Extension context for showing upgrade modal
 */
export async function checkPhaseAccessFromExtension(
  phaseNumber: number,
  context: vscode.ExtensionContext
): Promise<boolean> {
  if (!licenseValidator) {
    console.error('License validator not initialized');
    return false;
  }
  return checkPhaseAccess(phaseNumber, licenseValidator, context);
}

// Re-export checkPhaseAccess for direct import
export { checkPhaseAccess } from './licensing/phaseGate';
