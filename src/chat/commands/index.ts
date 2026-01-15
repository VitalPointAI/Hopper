import * as vscode from 'vscode';
import { CommandHandler, CommandRegistry, ISpecflowResult, CommandContext } from './types';

/**
 * Command definitions with descriptions for help output
 */
const COMMAND_DEFINITIONS = [
  { name: 'new-project', description: 'Initialize a new project with PROJECT.md' },
  { name: 'create-roadmap', description: 'Create roadmap with phases for the project' },
  { name: 'plan-phase', description: 'Create detailed execution plan for a phase' },
  { name: 'execute-plan', description: 'Execute a PLAN.md file' },
  { name: 'progress', description: 'Check project progress and current state' },
  { name: 'help', description: 'Show available SpecFlow commands' }
];

/**
 * Create placeholder handler for commands not yet implemented
 */
function createPlaceholderHandler(commandName: string, description: string): CommandHandler {
  return async (ctx: CommandContext): Promise<ISpecflowResult> => {
    ctx.stream.markdown(`**/${commandName}** - Coming in Phase 3!\n\nThis command will ${description.toLowerCase()}.\n`);
    return { metadata: { lastCommand: commandName } };
  };
}

/**
 * Help command handler - lists all available commands
 */
async function helpHandler(ctx: CommandContext): Promise<ISpecflowResult> {
  ctx.stream.markdown('## SpecFlow Commands\n\n');

  for (const cmd of COMMAND_DEFINITIONS) {
    ctx.stream.markdown(`- **/${cmd.name}** - ${cmd.description}\n`);
  }

  ctx.stream.markdown('\n*Use the suggestions below to get started.*\n');

  return { metadata: { lastCommand: 'help' } };
}

/**
 * Command registry - maps command names to handlers
 */
const registry: CommandRegistry = new Map();

// Register help handler
registry.set('help', helpHandler);

// Register placeholder handlers for all other commands
for (const cmd of COMMAND_DEFINITIONS) {
  if (cmd.name !== 'help') {
    registry.set(cmd.name, createPlaceholderHandler(cmd.name, cmd.description));
  }
}

/**
 * Get a command handler by name
 */
export function getCommandHandler(name: string): CommandHandler | undefined {
  return registry.get(name);
}

/**
 * Check if a command name is valid
 */
export function isValidCommand(name: string): boolean {
  return registry.has(name);
}

// Re-export types for consumer convenience
export type { ISpecflowResult, CommandContext, CommandHandler } from './types';
