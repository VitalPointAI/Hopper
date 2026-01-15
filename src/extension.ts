import * as vscode from 'vscode';
import { NearAiChatModelProvider } from './provider/nearAiProvider';
import { NEAR_AI_API_KEY_SECRET, isValidApiKeyFormat, getApiKeyInstructions } from './auth/nearAuth';
import { LicenseValidator } from './licensing/validator';
import { checkPhaseAccess, showUpgradeModal, connect, disconnect } from './licensing/phaseGate';
import { UpgradeModalPanel } from './licensing/upgradeModal';
import { trackActivation } from './telemetry/telemetryService';
import { createSpecflowParticipant } from './chat/specflowParticipant';
import { AuthType, AuthProvider } from './licensing/types';

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

  // Register unified connect command with auth method picker
  const connectCommand = vscode.commands.registerCommand(
    'specflow.connect',
    async () => {
      if (licenseValidator) {
        // Show quick pick with auth options
        const option = await vscode.window.showQuickPick([
          { label: 'Google', description: 'Sign in with Google', provider: 'google' as const },
          { label: 'GitHub', description: 'Sign in with GitHub', provider: 'github' as const },
          { label: 'NEAR Wallet', description: 'Sign in with NEAR wallet', provider: 'wallet' as const },
        ], { placeHolder: 'Choose sign-in method' });

        if (option) {
          if (option.provider === 'wallet') {
            await licenseValidator.startAuth();
          } else {
            await licenseValidator.getAuthManager().startOAuth(option.provider);
          }
        }
      }
    }
  );
  context.subscriptions.push(connectCommand);

  // Register unified disconnect command
  const disconnectCommand = vscode.commands.registerCommand(
    'specflow.disconnect',
    async () => {
      if (licenseValidator) {
        await disconnect(licenseValidator);
      }
    }
  );
  context.subscriptions.push(disconnectCommand);

  // Backward-compatible aliases for old command names
  const connectWalletCommand = vscode.commands.registerCommand(
    'specflow.connectWallet',
    async () => {
      if (licenseValidator) {
        await connect(licenseValidator);
      }
    }
  );
  context.subscriptions.push(connectWalletCommand);

  // Direct wallet auth command (no picker) - used by upgrade modal for crypto payments
  const startWalletAuthCommand = vscode.commands.registerCommand(
    'specflow.startWalletAuth',
    async () => {
      if (licenseValidator) {
        await licenseValidator.startAuth();
      }
    }
  );
  context.subscriptions.push(startWalletAuthCommand);

  const disconnectWalletCommand = vscode.commands.registerCommand(
    'specflow.disconnectWallet',
    async () => {
      if (licenseValidator) {
        await disconnect(licenseValidator);
      }
    }
  );
  context.subscriptions.push(disconnectWalletCommand);

  // Register chat participant command wrappers for stream.button() calls
  // These commands open the chat panel and send the appropriate slash command
  // to the @specflow chat participant
  const chatParticipantCommands = [
    { id: 'specflow.chat-participant.new-project', command: '/new-project' },
    { id: 'specflow.chat-participant.create-roadmap', command: '/create-roadmap' },
    { id: 'specflow.chat-participant.plan-phase', command: '/plan-phase' },
    { id: 'specflow.chat-participant.status', command: '/status' },
    { id: 'specflow.chat-participant.progress', command: '/progress' },
    { id: 'specflow.chat-participant.help', command: '/help' }
  ];

  for (const { id, command } of chatParticipantCommands) {
    const disposable = vscode.commands.registerCommand(id, async () => {
      try {
        // Open the chat panel with the query pre-filled
        // The query parameter populates the chat input with the specified text
        // Using @specflow with the command triggers the chat participant
        await vscode.commands.executeCommand('workbench.action.chat.open', {
          query: `@specflow ${command}`
        });
      } catch (err) {
        // Fallback: show guidance if the chat command isn't available
        vscode.window.showInformationMessage(
          `Use @specflow ${command} in the chat panel to run this command.`
        );
      }
    });
    context.subscriptions.push(disposable);
  }

  // Register URI handler for auth callbacks (both OAuth and wallet)
  const uriHandler = vscode.window.registerUriHandler({
    handleUri: async (uri: vscode.Uri) => {
      console.log('Received URI callback:', uri.toString());

      if (uri.path === '/auth-callback') {
        // Parse query parameters
        const params = new URLSearchParams(uri.query);

        // Check for error first
        const error = params.get('error');
        if (error) {
          vscode.window.showErrorMessage(`Authentication failed: ${error}`);
          return;
        }

        // Parse session data (both OAuth and wallet callbacks send these)
        const userId = params.get('user_id') ?? params.get('account_id');
        const authType = (params.get('auth_type') as AuthType) ?? 'wallet';
        const provider = (params.get('provider') as AuthProvider) ?? 'near';
        const token = params.get('token');
        const expiresAt = params.get('expires_at');
        const displayName = params.get('display_name');
        const email = params.get('email');

        // Legacy wallet callback support (signature verification)
        const signature = params.get('signature');
        const publicKey = params.get('public_key');

        if (userId && licenseValidator) {
          let success = false;

          // If token is provided, use it directly (server already verified)
          if (token && expiresAt) {
            success = await licenseValidator.handleAuthCallbackWithToken({
              userId,
              authType,
              provider,
              token,
              expiresAt: parseInt(expiresAt, 10),
              displayName: displayName ?? undefined,
              email: email ?? undefined,
            });
          } else if (signature && publicKey) {
            // Fallback to legacy signature verification for wallet
            success = await licenseValidator.handleAuthCallback(
              userId,
              signature,
              publicKey
            );
          }

          if (success) {
            // Refresh license status after authentication
            await licenseValidator.checkLicense();

            // Check for pending payment to resume
            const pendingPayment = context.globalState.get<'stripe' | 'crypto'>('specflow.pendingPayment');
            if (pendingPayment) {
              // Clear pending payment first
              await context.globalState.update('specflow.pendingPayment', undefined);

              // Show upgrade modal with new auth session to complete payment
              const authSession = licenseValidator.getSession();
              UpgradeModalPanel.show(context, authSession);

              // If this was a crypto payment and user now has wallet auth, start checkout
              if (pendingPayment === 'crypto' && authSession?.authType === 'wallet') {
                vscode.window.showInformationMessage(
                  'Wallet connected! Click "Pay with Crypto" to complete your subscription.'
                );
              }
            }
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
