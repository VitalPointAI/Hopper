import * as vscode from 'vscode';
// LicenseValidator kept for per-command gating in 02-02
import { LicenseValidator } from '../licensing/validator';

/**
 * Result metadata returned by the SpecFlow chat participant
 */
interface ISpecflowResult extends vscode.ChatResult {
  metadata?: {
    lastCommand?: string;
    phaseNumber?: number;
  };
}

/**
 * Create and register the @specflow chat participant
 *
 * The participant forwards prompts to the selected language model
 * and streams responses. Phase 2+ features require a Pro license.
 *
 * @param context - Extension context for resource paths and subscriptions
 * @param licenseValidator - License validator for phase gating
 * @returns Disposable for the chat participant
 */
export function createSpecflowParticipant(
  context: vscode.ExtensionContext,
  licenseValidator: LicenseValidator
): vscode.Disposable {
  // Verify Chat API is available
  if (!vscode.chat || !vscode.chat.createChatParticipant) {
    console.warn('VSCode Chat API not available - chat participant disabled');
    // Return a no-op disposable
    return { dispose: () => {} };
  }

  // Define the chat request handler
  const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
  ): Promise<ISpecflowResult> => {
    // Note: License gating is per-command, implemented in 02-02 (slash command routing)
    // Basic chat conversations are free for all users

    // Show progress while processing
    stream.progress('Processing your request...');

    // Build messages for the model
    // Note: Use User messages for system instructions (System messages not supported)
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(
        'You are SpecFlow, a model-agnostic structured planning assistant for VSCode. ' +
        'Help users plan and execute software projects using the GSD (Get Shit Done) framework. ' +
        'Be concise and actionable.'
      ),
      vscode.LanguageModelChatMessage.User(request.prompt)
    ];

    try {
      // Forward request to the selected model
      const response = await request.model.sendRequest(messages, {}, token);

      // Stream response fragments
      for await (const fragment of response.text) {
        // Check for cancellation before each write
        if (token.isCancellationRequested) {
          break;
        }
        stream.markdown(fragment);
      }

      return {
        metadata: {
          lastCommand: 'chat'
        }
      };
    } catch (err) {
      // Handle LanguageModelError specifically
      if (err instanceof vscode.LanguageModelError) {
        stream.markdown(`**Error:** ${err.message}\n\nPlease check your model connection and try again.`);
        return {
          metadata: {
            lastCommand: 'error'
          }
        };
      }

      // Re-throw unknown errors
      throw err;
    }
  };

  // Create the chat participant with the exact ID from package.json
  const participant = vscode.chat.createChatParticipant(
    'specflow.chat-participant',
    handler
  );

  // Set icon path (optional - will use default if not found)
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');

  // Set up follow-up provider for suggested next actions
  participant.followupProvider = {
    provideFollowups(
      result: ISpecflowResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken
    ): vscode.ChatFollowup[] {
      // Note: Per-command license follow-ups will be added in 02-02
      return [
        { prompt: '/help', label: 'Show commands' },
        { prompt: '/progress', label: 'Check progress' }
      ];
    }
  };

  return participant;
}
