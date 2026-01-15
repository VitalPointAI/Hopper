import * as vscode from 'vscode';
import { NearAiChatModelProvider } from './provider/nearAiProvider';
import { NEAR_AI_API_KEY_SECRET, isValidApiKeyFormat, getApiKeyInstructions } from './auth/nearAuth';
import { LicenseValidator } from './licensing/validator';
import { checkPhaseAccess, showUpgradeModal, connectWallet, disconnectWallet } from './licensing/phaseGate';
import { trackActivation } from './telemetry/telemetryService';
import { createSpecflowParticipant } from './chat/specflowParticipant';

// Export license validator for use by chat participant
let licenseValidator: LicenseValidator | undefined;

/**
 * Called when the extension is activated.
 * @param context - The extension context provided by VSCode
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('SpecFlow extension activated');

  // Track activation telemetry (async, non-blocking)
  trackActivation(context).catch(() => {
    // Silently ignore telemetry errors
  });

  // Initialize license validator
  licenseValidator = new LicenseValidator(context);

  // Create and register the NEAR AI language model provider
  const provider = new NearAiChatModelProvider(context);
  const providerDisposable = vscode.lm.registerLanguageModelChatProvider(
    'near-ai',  // Must match vendor in package.json
    provider
  );
  context.subscriptions.push(providerDisposable);

  // Create and register the @specflow chat participant
  try {
    const chatParticipant = createSpecflowParticipant(context, licenseValidator);
    context.subscriptions.push(chatParticipant);
    console.log('SpecFlow chat participant registered');
  } catch (err) {
    console.error('Failed to register chat participant:', err);
    // Don't crash - chat participant is optional, extension can still work
  }

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

  // Register connect wallet command
  const connectCommand = vscode.commands.registerCommand(
    'specflow.connectWallet',
    async () => {
      if (licenseValidator) {
        await connectWallet(licenseValidator);
      }
    }
  );
  context.subscriptions.push(connectCommand);

  // Register disconnect wallet command
  const disconnectCommand = vscode.commands.registerCommand(
    'specflow.disconnectWallet',
    async () => {
      if (licenseValidator) {
        await disconnectWallet(licenseValidator);
      }
    }
  );
  context.subscriptions.push(disconnectCommand);

  // Register placeholder command for chat participant buttons (Phase 3 commands)
  // These commands are referenced by stream.button() in /help and /status
  // They provide user feedback until the actual commands are implemented
  const newProjectPlaceholder = vscode.commands.registerCommand(
    'specflow.chat-participant.new-project',
    () => {
      vscode.window.showInformationMessage(
        'The /new-project command will be available in Phase 3. Use @specflow /new-project in the chat.'
      );
    }
  );
  context.subscriptions.push(newProjectPlaceholder);

  // Register URI handler for wallet auth callback
  const uriHandler = vscode.window.registerUriHandler({
    handleUri: async (uri: vscode.Uri) => {
      console.log('Received URI callback:', uri.toString());

      if (uri.path === '/auth-callback') {
        // Parse query parameters
        const params = new URLSearchParams(uri.query);
        const accountId = params.get('account_id');
        const signature = params.get('signature');
        const publicKey = params.get('public_key');

        if (accountId && signature && publicKey && licenseValidator) {
          const success = await licenseValidator.handleAuthCallback(
            accountId,
            signature,
            publicKey
          );

          if (success) {
            // Refresh license status after authentication
            await licenseValidator.checkLicense();
          }
        } else {
          vscode.window.showErrorMessage(
            'Invalid authentication callback. Missing required parameters.'
          );
        }
      }
    }
  });
  context.subscriptions.push(uriHandler);
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
