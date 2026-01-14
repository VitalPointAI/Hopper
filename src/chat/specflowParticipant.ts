import * as vscode from 'vscode';
import { LicenseValidator } from '../licensing/validator';
import { getCommandHandler, isValidCommand, ISpecflowResult, CommandContext } from './commands';

/**
 * Create and register the @specflow chat participant
 *
 * The participant routes slash commands to handlers and forwards
 * general prompts to the selected language model.
 *
 * @param context - Extension context for resource paths and subscriptions
 * @param licenseValidator - License validator for per-command gating
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
    // Show progress while processing
    stream.progress('Processing your request...');

    // Route slash commands to handlers
    if (request.command) {
      const commandHandler = getCommandHandler(request.command);

      if (commandHandler) {
        // Build command context
        const ctx: CommandContext = {
          request,
          context: chatContext,
          stream,
          token,
          licenseValidator
        };

        return commandHandler(ctx);
      }

      // Unknown command - show error
      stream.markdown(`**Unknown command:** /${request.command}\n\nUse **/help** to see available commands.\n`);
      return { metadata: { lastCommand: 'error' } };
    }

    // No command - general chat assistance
    // Build messages for the model with SpecFlow context
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(
        'You are SpecFlow, a model-agnostic structured planning assistant for VSCode. ' +
        'Help the user understand the SpecFlow framework or suggest appropriate commands. ' +
        'Available commands: /new-project, /create-roadmap, /plan-phase, /execute-plan, /progress, /help. ' +
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
          lastCommand: undefined
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

  // Set up follow-up provider for contextual suggestions based on last command
  participant.followupProvider = {
    provideFollowups(
      result: ISpecflowResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken
    ): vscode.ChatFollowup[] {
      const lastCmd = result.metadata?.lastCommand;

      // Contextual suggestions based on last command
      if (lastCmd === 'help') {
        return [
          { prompt: '/new-project', label: 'Start new project' },
          { prompt: '/progress', label: 'Check progress' }
        ];
      }

      if (lastCmd === 'new-project') {
        return [
          { prompt: '/create-roadmap', label: 'Create roadmap' },
          { prompt: '/help', label: 'Show commands' }
        ];
      }

      if (lastCmd === 'create-roadmap') {
        return [
          { prompt: '/plan-phase', label: 'Plan a phase' },
          { prompt: '/progress', label: 'Check progress' }
        ];
      }

      if (lastCmd === 'plan-phase') {
        return [
          { prompt: '/execute-plan', label: 'Execute plan' },
          { prompt: '/progress', label: 'Check progress' }
        ];
      }

      if (lastCmd === 'execute-plan') {
        return [
          { prompt: '/progress', label: 'Check progress' },
          { prompt: '/plan-phase', label: 'Plan next phase' }
        ];
      }

      if (lastCmd === 'progress') {
        return [
          { prompt: '/plan-phase', label: 'Plan a phase' },
          { prompt: '/execute-plan', label: 'Execute plan' }
        ];
      }

      // Default suggestions for general chat or errors
      return [
        { prompt: '/help', label: 'Show commands' },
        { prompt: '/progress', label: 'Check progress' }
      ];
    }
  };

  return participant;
}

// Re-export ISpecflowResult for external consumers
export type { ISpecflowResult } from './commands';
