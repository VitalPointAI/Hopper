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
        'IMPORTANT: You are SpecFlow, a VSCode extension for model-agnostic structured planning. ' +
        'When users ask what you do or how to use you, explain that SpecFlow helps organize software projects ' +
        'through planning documents (PROJECT.md, ROADMAP.md, PLAN.md). ' +
        'Available slash commands: /new-project (start here), /create-roadmap, /plan-phase, /execute-plan, /progress, /help. ' +
        'Always suggest relevant commands. Be concise and actionable. ' +
        'If unsure what the user needs, suggest /help to see all commands.'
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
      // Each follow-up needs: command (slash command name), prompt (message text), label (button text)
      if (lastCmd === 'help') {
        return [
          { command: 'new-project', prompt: 'Initialize my project', label: 'Start new project' },
          { command: 'progress', prompt: 'Check my project progress', label: 'Check progress' }
        ];
      }

      if (lastCmd === 'new-project') {
        return [
          { command: 'create-roadmap', prompt: 'Create a roadmap for my project', label: 'Create roadmap' },
          { command: 'help', prompt: 'Show me all commands', label: 'Show commands' }
        ];
      }

      if (lastCmd === 'create-roadmap') {
        return [
          { command: 'plan-phase', prompt: 'Plan the next phase', label: 'Plan a phase' },
          { command: 'progress', prompt: 'Check my project progress', label: 'Check progress' }
        ];
      }

      if (lastCmd === 'plan-phase') {
        return [
          { command: 'execute-plan', prompt: 'Execute the plan', label: 'Execute plan' },
          { command: 'progress', prompt: 'Check my project progress', label: 'Check progress' }
        ];
      }

      if (lastCmd === 'execute-plan') {
        return [
          { command: 'progress', prompt: 'Check my project progress', label: 'Check progress' },
          { command: 'plan-phase', prompt: 'Plan the next phase', label: 'Plan next phase' }
        ];
      }

      if (lastCmd === 'progress') {
        return [
          { command: 'plan-phase', prompt: 'Plan the next phase', label: 'Plan a phase' },
          { command: 'execute-plan', prompt: 'Execute the plan', label: 'Execute plan' }
        ];
      }

      // Default suggestions for general chat or errors
      return [
        { command: 'help', prompt: 'Show me all available commands', label: 'Show commands' },
        { command: 'progress', prompt: 'Check my project progress', label: 'Check progress' }
      ];
    }
  };

  return participant;
}

// Re-export ISpecflowResult for external consumers
export type { ISpecflowResult } from './commands';
