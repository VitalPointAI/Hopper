import * as vscode from 'vscode';
import { LicenseValidator } from '../licensing/validator';
import { getCommandHandler, IHopperResult, CommandContext } from './commands';
import { getProjectContext, formatContextForPrompt } from './context/projectContext';
import { getContextTracker } from '../context/contextTracker';
import { getLogger } from '../logging';

/**
 * Patterns that indicate the user wants direct action, not advice or workflow redirection.
 * These detect imperative requests like "fix this", "add a comment", "update the file", etc.
 */
const ACTION_INTENT_PATTERNS = [
  /^(fix|update|change|modify|edit|add|remove|delete|create|refactor)\s/i,
  /^(can you|please|could you)\s+(fix|update|change|add|remove|create)/i,
  /^(make|do|run|execute|implement)\s/i,
  /(fix this|do this|update this|change this)/i,
  /you (missed|forgot|skipped|didn't)/i,
];

/**
 * Detect if the user's prompt indicates they want direct action.
 * Returns true for imperative requests, false for questions or general conversation.
 */
function detectActionIntent(prompt: string): boolean {
  return ACTION_INTENT_PATTERNS.some(pattern => pattern.test(prompt.trim()));
}

/**
 * Create and register the @hopper chat participant
 *
 * The participant routes slash commands to handlers and forwards
 * general prompts to the selected language model.
 *
 * @param context - Extension context for resource paths and subscriptions
 * @param licenseValidator - License validator for per-command gating
 * @returns Disposable for the chat participant
 */
export function createHopperParticipant(
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
  ): Promise<IHopperResult> => {
    // Get context tracker and start/show session
    const contextTracker = getContextTracker();
    contextTracker.show();

    // Track user input
    contextTracker.addInput(request.prompt);

    // Show progress while loading context
    stream.progress('Loading project context...');

    // Fetch project context from .planning files
    const projectContext = await getProjectContext();

    // Track project context if available
    if (projectContext.hasPlanning) {
      const formattedContext = formatContextForPrompt(projectContext);
      contextTracker.addInput(formattedContext);
    }

    // Route slash commands to handlers
    if (request.command) {
      const commandHandler = getCommandHandler(request.command);

      if (commandHandler) {
        // Build command context with project context
        const ctx: CommandContext = {
          request,
          context: chatContext,
          stream,
          token,
          licenseValidator,
          projectContext,
          extensionContext: context
        };

        return commandHandler(ctx);
      }

      // Unknown command - show error
      stream.markdown(`**Unknown command:** /${request.command}\n\nUse **/help** to see available commands.\n`);
      return { metadata: { lastCommand: 'error' } };
    }

    // No command - check for action intent
    const logger = getLogger();
    const hasActionIntent = detectActionIntent(request.prompt);

    if (hasActionIntent) {
      logger.info(`Action intent detected: "${request.prompt.slice(0, 50)}..."`);
    }

    // Build messages for the model with Hopper context
    const messages: vscode.LanguageModelChatMessage[] = [];

    // Base system instructions (as User message since System not supported)
    let systemPrompt = 'IMPORTANT: You are Hopper, a VSCode extension for model-agnostic structured planning. ' +
      'When users ask what you do or how to use you, explain that Hopper helps organize software projects ' +
      'through planning documents (PROJECT.md, ROADMAP.md, PLAN.md). ' +
      'Available slash commands: /new-project (start here), /create-roadmap, /plan-phase, /execute-plan, /progress, /status, /help. ' +
      'Always suggest relevant commands. Be concise and actionable. ' +
      'If unsure what the user needs, suggest /help to see all commands.';

    // Include project context if available
    if (projectContext.hasPlanning) {
      const formattedContext = formatContextForPrompt(projectContext);
      systemPrompt += '\n\nThe user is working on a project with Hopper planning. Here is the current state:\n' + formattedContext;
    } else {
      systemPrompt += '\n\nNo Hopper project found in this workspace. Suggest /new-project to initialize.';
    }

    messages.push(vscode.LanguageModelChatMessage.User(systemPrompt));
    messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

    // Track the system prompt as input
    contextTracker.addInput(systemPrompt);

    try {
      // Forward request to the selected model
      const response = await request.model.sendRequest(messages, {}, token);

      // Stream response fragments and track output
      let outputText = '';
      for await (const fragment of response.text) {
        // Check for cancellation before each write
        if (token.isCancellationRequested) {
          break;
        }
        stream.markdown(fragment);
        outputText += fragment;
      }

      // Track the complete output
      contextTracker.addOutput(outputText);

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
    'hopper.chat-participant',
    handler
  );

  // Set icon path (optional - will use default if not found)
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');

  // Set up follow-up provider for contextual suggestions based on last command
  participant.followupProvider = {
    provideFollowups(
      result: IHopperResult,
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

      if (lastCmd === 'status') {
        return [
          { command: 'plan-phase', prompt: 'Plan the next phase', label: 'Plan a phase' },
          { command: 'progress', prompt: 'Check my project progress', label: 'Check progress' }
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

// Re-export IHopperResult for external consumers
export type { IHopperResult } from './commands';
