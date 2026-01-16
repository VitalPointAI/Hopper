import * as vscode from 'vscode';
import { NearAiChatModelProvider } from './provider/nearAiProvider';
import { NEAR_AI_API_KEY_SECRET, isValidApiKeyFormat, getApiKeyInstructions } from './auth/nearAuth';
import { LicenseValidator } from './licensing/validator';
import { checkPhaseAccess, showUpgradeModal, connect, disconnect } from './licensing/phaseGate';
import { UpgradeModalPanel } from './licensing/upgradeModal';
import { trackActivation } from './telemetry/telemetryService';
import { createHopperParticipant } from './chat/hopperParticipant';
import { AuthType, AuthProvider } from './licensing/types';

// Export license validator for use by chat participant
let licenseValidator: LicenseValidator | undefined;

/**
 * Called when the extension is activated.
 * @param context - The extension context provided by VSCode
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Hopper extension activated');

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

  // Create and register the @hopper chat participant
  try {
    const chatParticipant = createHopperParticipant(context, licenseValidator);
    context.subscriptions.push(chatParticipant);
    console.log('Hopper chat participant registered');
  } catch (err) {
    console.error('Failed to register chat participant:', err);
    // Don't crash - chat participant is optional, extension can still work
  }

  // Register the management command for API key setup
  const manageCommand = vscode.commands.registerCommand(
    'hopper.manageNearAi',
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
    'hopper.showUpgradeModal',
    async () => {
      if (licenseValidator) {
        await showUpgradeModal(licenseValidator, context);
      }
    }
  );
  context.subscriptions.push(upgradeCommand);

  // Register unified connect command with auth method picker
  const connectCommand = vscode.commands.registerCommand(
    'hopper.connect',
    async () => {
      if (licenseValidator) {
        // Show quick pick with auth options - wallet opens multi-chain page
        const option = await vscode.window.showQuickPick([
          { label: 'Google', description: 'Sign in with Google', provider: 'google' as const },
          { label: 'GitHub', description: 'Sign in with GitHub', provider: 'github' as const },
          { label: 'Wallet', description: 'Connect any wallet (NEAR, Ethereum, Solana, etc.)', provider: 'wallet' as const },
        ], { placeHolder: 'Choose sign-in method' });

        if (option) {
          if (option.provider === 'wallet') {
            // Opens multi-chain wallet connection page
            await licenseValidator.getAuthManager().startWalletAuth();
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
    'hopper.disconnect',
    async () => {
      if (licenseValidator) {
        await disconnect(licenseValidator);
      }
    }
  );
  context.subscriptions.push(disconnectCommand);

  // Backward-compatible aliases for old command names
  const connectWalletCommand = vscode.commands.registerCommand(
    'hopper.connectWallet',
    async () => {
      if (licenseValidator) {
        await connect(licenseValidator);
      }
    }
  );
  context.subscriptions.push(connectWalletCommand);

  // Direct wallet auth command (no picker) - used for general wallet connection
  const startWalletAuthCommand = vscode.commands.registerCommand(
    'hopper.startWalletAuth',
    async () => {
      if (licenseValidator) {
        await licenseValidator.startAuth();
      }
    }
  );
  context.subscriptions.push(startWalletAuthCommand);

  // Wallet auth with crypto payment - stays in browser for payment after auth
  const startWalletAuthForPaymentCommand = vscode.commands.registerCommand(
    'hopper.startWalletAuthForPayment',
    async () => {
      if (licenseValidator) {
        // Don't store pending payment - the browser will handle the entire flow
        await licenseValidator.startAuth({ payment: 'crypto' });
      }
    }
  );
  context.subscriptions.push(startWalletAuthForPaymentCommand);

  // OAuth auth with Stripe payment - stays in browser for checkout after auth
  const startOAuthForPaymentCommand = vscode.commands.registerCommand(
    'hopper.startOAuthForPayment',
    async () => {
      if (licenseValidator) {
        // Show quick pick for OAuth provider, then start OAuth with payment flag
        const option = await vscode.window.showQuickPick([
          { label: 'Google', description: 'Sign in with Google', provider: 'google' as const },
          { label: 'GitHub', description: 'Sign in with GitHub', provider: 'github' as const },
        ], { placeHolder: 'Choose sign-in method for Stripe checkout' });

        if (option) {
          // Don't store pending payment - the browser will handle the entire flow
          await licenseValidator.getAuthManager().startOAuth(option.provider, { payment: 'stripe' });
        }
      }
    }
  );
  context.subscriptions.push(startOAuthForPaymentCommand);

  const disconnectWalletCommand = vscode.commands.registerCommand(
    'hopper.disconnectWallet',
    async () => {
      if (licenseValidator) {
        await disconnect(licenseValidator);
      }
    }
  );
  context.subscriptions.push(disconnectWalletCommand);

  // Register chat participant command wrappers for stream.button() calls
  // These commands open the chat panel and send the appropriate slash command
  // to the @hopper chat participant
  const chatParticipantCommands = [
    { id: 'hopper.chat-participant.new-project', command: '/new-project' },
    { id: 'hopper.chat-participant.create-roadmap', command: '/create-roadmap' },
    { id: 'hopper.chat-participant.plan-phase', command: '/plan-phase' },
    { id: 'hopper.chat-participant.status', command: '/status' },
    { id: 'hopper.chat-participant.progress', command: '/progress' },
    { id: 'hopper.chat-participant.help', command: '/help' }
  ];

  for (const { id, command } of chatParticipantCommands) {
    const disposable = vscode.commands.registerCommand(id, async () => {
      try {
        // Open the chat panel with the query pre-filled
        // The query parameter populates the chat input with the specified text
        // Using @hopper with the command triggers the chat participant
        await vscode.commands.executeCommand('workbench.action.chat.open', {
          query: `@hopper ${command}`
        });
      } catch (err) {
        // Fallback: show guidance if the chat command isn't available
        vscode.window.showInformationMessage(
          `Use @hopper ${command} in the chat panel to run this command.`
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
        const userId = params.get('user_id') ?? params.get('account_id') ?? params.get('accountId');
        const authType = (params.get('auth_type') as AuthType) ?? 'wallet';
        const chain = params.get('chain') ?? 'near';
        // For wallet auth, use chain as provider; for oauth, use the provider param
        const provider = authType === 'wallet'
          ? (chain as AuthProvider)
          : (params.get('provider') as AuthProvider) ?? 'near';
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
              chain,
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
          } else if (authType === 'wallet' && !token) {
            // Payment success callback - create session from wallet info
            // This is for crypto payment completion where we get wallet info but no JWT
            success = await licenseValidator.handleAuthCallbackWithToken({
              userId,
              authType: 'wallet',
              provider,
              chain,
              token: '', // No token for payment callbacks
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
            });
          }

          if (success) {
            // Refresh license status after authentication
            await licenseValidator.checkLicense();

            // Check for pending payment to resume
            const pendingPayment = context.globalState.get<'stripe' | 'crypto'>('hopper.pendingPayment');
            if (pendingPayment) {
              // Clear pending payment first
              await context.globalState.update('hopper.pendingPayment', undefined);

              // Get auth session and determine checkout type
              const authSession = licenseValidator.getSession();

              // For crypto, only proceed if user has wallet auth
              // For stripe, proceed with any auth type
              const canProceed = pendingPayment === 'stripe' ||
                (pendingPayment === 'crypto' && authSession?.authType === 'wallet');

              if (canProceed) {
                // Show modal and auto-trigger checkout
                UpgradeModalPanel.show(context, authSession, pendingPayment);
              } else {
                // Crypto payment but user signed in with OAuth - show modal without auto-checkout
                vscode.window.showInformationMessage(
                  'Crypto payments require a NEAR wallet. Please use card payment or sign in with NEAR wallet.'
                );
                UpgradeModalPanel.show(context, authSession);
              }
            } else {
              // No pending payment - user connected for license verification
              // Auto-open chat with /status to show connection success and license info
              // This provides immediate feedback in the chat interface
              try {
                await vscode.commands.executeCommand('workbench.action.chat.open', {
                  query: '@hopper /status'
                });
              } catch {
                // Fallback to notification if chat command not available
                vscode.window.showInformationMessage('Connected successfully!');
              }
            }
          }
        } else {
          vscode.window.showErrorMessage(
            'Invalid authentication callback. Missing required parameters.'
          );
        }
      } else if (uri.path === '/payment-success') {
        // Handle successful crypto payment callback
        console.log('Payment success callback received');

        // Show progress notification while activating license
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Activating your Hopper Pro license...',
            cancellable: false,
          },
          async (progress) => {
            // Wait a moment for the backend to process the payment
            progress.report({ increment: 30, message: 'Verifying payment...' });
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Refresh license status
            progress.report({ increment: 50, message: 'Activating license...' });
            if (licenseValidator) {
              await licenseValidator.checkLicense();
            }

            progress.report({ increment: 20, message: 'Complete!' });
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        );

        // Auto-open chat with /status to show license confirmation and next steps
        // This provides immediate in-chat feedback consistent with auth callback
        try {
          await vscode.commands.executeCommand('workbench.action.chat.open', {
            query: '@hopper /status'
          });
        } catch {
          // Fallback to notification if chat command not available
          vscode.window.showInformationMessage(
            'Payment successful! Your Hopper Pro license is now active.'
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
