import * as vscode from 'vscode';
import { NearAiChatModelProvider } from './provider/nearAiProvider';
import { NEAR_AI_API_KEY_SECRET, isValidApiKeyFormat, getApiKeyInstructions } from './auth/nearAuth';

/**
 * Called when the extension is activated.
 * @param context - The extension context provided by VSCode
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('SpecFlow extension activated');

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
