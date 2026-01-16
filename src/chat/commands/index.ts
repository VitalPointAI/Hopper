import * as vscode from 'vscode';
import { CommandHandler, CommandRegistry, ISpecflowResult, CommandContext } from './types';
import { formatContextForPrompt, truncateContent } from '../context/projectContext';
import { handleNewProject } from './newProject';
import { handleCreateRoadmap } from './createRoadmap';
import { handlePlanPhase } from './planPhase';

/**
 * Command definitions with descriptions for help output
 */
const COMMAND_DEFINITIONS = [
  { name: 'new-project', description: 'Initialize a new project with PROJECT.md' },
  { name: 'create-roadmap', description: 'Create roadmap with phases for the project' },
  { name: 'plan-phase', description: 'Create detailed execution plan for a phase' },
  { name: 'execute-plan', description: 'Execute a PLAN.md file' },
  { name: 'progress', description: 'Check project progress and current state' },
  { name: 'status', description: 'Show current project status and phase' },
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
 * Adapts message based on whether .planning folder exists
 */
async function helpHandler(ctx: CommandContext): Promise<ISpecflowResult> {
  // Check if project exists
  if (!ctx.projectContext.hasPlanning) {
    ctx.stream.markdown('## SpecFlow - No Project Found\n\n');
    ctx.stream.markdown('No SpecFlow project found in this workspace.\n\n');
    ctx.stream.markdown('Use **/new-project** to initialize a new project with PROJECT.md.\n\n');
    ctx.stream.button({
      command: 'specflow.chat-participant.new-project',
      title: 'Initialize Project'
    });
    return { metadata: { lastCommand: 'help' } };
  }

  // Project exists - show full command list
  ctx.stream.markdown('## SpecFlow Commands\n\n');

  for (const cmd of COMMAND_DEFINITIONS) {
    ctx.stream.markdown(`- **/${cmd.name}** - ${cmd.description}\n`);
  }

  ctx.stream.markdown('\n*Use the suggestions below to get started.*\n');

  return { metadata: { lastCommand: 'help' } };
}

/**
 * Status command handler - shows current project status with clickable references
 */
async function statusHandler(ctx: CommandContext): Promise<ISpecflowResult> {
  const { projectContext, licenseValidator } = ctx;

  // Show authentication status first
  ctx.stream.markdown('## Account Status\n\n');

  if (licenseValidator.isAuthenticated()) {
    const session = licenseValidator.getSession();
    if (session) {
      // Show user info based on auth type
      if (session.authType === 'wallet') {
        ctx.stream.markdown(`**Connected:** ${session.userId}\n`);
        ctx.stream.markdown(`**Auth:** NEAR Wallet\n\n`);
      } else {
        const displayInfo = session.email || session.displayName || session.userId;
        const providerLabel = session.provider === 'google' ? 'Google' :
                             session.provider === 'github' ? 'GitHub' :
                             session.provider === 'email' ? 'Email' : 'OAuth';
        ctx.stream.markdown(`**Connected:** ${displayInfo}\n`);
        ctx.stream.markdown(`**Auth:** ${providerLabel}\n\n`);
      }

      // Show license status
      const licenseStatus = await licenseValidator.checkLicense();
      if (licenseStatus?.isLicensed) {
        const expiryDate = licenseStatus.expiresAt
          ? new Date(licenseStatus.expiresAt).toLocaleDateString()
          : 'Unknown';
        ctx.stream.markdown(`**License:** Pro (expires ${expiryDate})\n\n`);
      } else {
        ctx.stream.markdown(`**License:** Free tier\n\n`);
        ctx.stream.button({
          command: 'specflow.showUpgradeModal',
          title: 'Upgrade to Pro'
        });
        ctx.stream.markdown('\n\n');
      }
    }
  } else {
    ctx.stream.markdown('**Not connected**\n\n');
    ctx.stream.button({
      command: 'specflow.connect',
      title: 'Connect'
    });
    ctx.stream.markdown('\n\n');
  }

  // Check if project exists
  if (!projectContext.hasPlanning) {
    ctx.stream.markdown('## No SpecFlow Project Found\n\n');
    ctx.stream.markdown('This workspace does not have a `.planning` directory.\n\n');
    ctx.stream.button({
      command: 'specflow.chat-participant.new-project',
      title: 'New Project'
    });
    return { metadata: { lastCommand: 'status' } };
  }

  // Project exists - show status
  ctx.stream.markdown('## Project Status\n\n');

  // Extract project name from PROJECT.md
  let projectName = 'Unknown Project';
  if (projectContext.projectMd) {
    const lines = projectContext.projectMd.split('\n');
    const firstHeading = lines.find(line => line.startsWith('#'));
    if (firstHeading) {
      projectName = firstHeading.replace(/^#+\s*/, '');
    }
  }

  ctx.stream.markdown(`**Project:** ${projectName}\n\n`);

  // Show current phase
  if (projectContext.currentPhase) {
    ctx.stream.markdown(`**Current Phase:** ${projectContext.currentPhase}\n\n`);
  }

  // Show clickable file references using stream.reference()
  if (projectContext.planningUri) {
    ctx.stream.markdown('### Planning Files\n\n');

    // Reference to PROJECT.md
    const projectUri = vscode.Uri.joinPath(projectContext.planningUri, 'PROJECT.md');
    ctx.stream.reference(projectUri);

    // Reference to ROADMAP.md
    const roadmapUri = vscode.Uri.joinPath(projectContext.planningUri, 'ROADMAP.md');
    ctx.stream.reference(roadmapUri);

    // Reference to STATE.md
    const stateUri = vscode.Uri.joinPath(projectContext.planningUri, 'STATE.md');
    ctx.stream.reference(stateUri);

    ctx.stream.markdown('\n');
  }

  // Show file tree of .planning directory using stream.filetree()
  if (projectContext.planningUri && projectContext.workspaceUri) {
    ctx.stream.markdown('### Folder Structure\n\n');

    try {
      // Read .planning directory to build file tree
      const entries = await vscode.workspace.fs.readDirectory(projectContext.planningUri);
      const tree: vscode.ChatResponseFileTree[] = [];

      for (const [name, type] of entries) {
        if (type === vscode.FileType.Directory) {
          // Read children for directories
          const subUri = vscode.Uri.joinPath(projectContext.planningUri, name);
          const subEntries = await vscode.workspace.fs.readDirectory(subUri);
          const children: vscode.ChatResponseFileTree[] = subEntries.slice(0, 5).map(([subName]) => ({
            name: subName
          }));
          if (subEntries.length > 5) {
            children.push({ name: `... (${subEntries.length - 5} more)` });
          }
          tree.push({ name, children });
        } else {
          tree.push({ name });
        }
      }

      ctx.stream.filetree(tree, projectContext.planningUri);
    } catch {
      ctx.stream.markdown('*Unable to read folder structure*\n');
    }

    ctx.stream.markdown('\n');
  }

  // Show STATE.md summary
  if (projectContext.stateMd) {
    ctx.stream.markdown('### Current State\n\n');
    // Show truncated state (already truncated in context, but further truncate for display)
    ctx.stream.markdown('```\n' + truncateContent(projectContext.stateMd, 500) + '\n```\n\n');
  }

  // Show active issues if any
  if (projectContext.issues && projectContext.issues.length > 0) {
    ctx.stream.markdown('### Active Issues\n\n');
    for (const issue of projectContext.issues.slice(0, 5)) {
      ctx.stream.markdown(`- ${issue}\n`);
    }
    if (projectContext.issues.length > 5) {
      ctx.stream.markdown(`- ... and ${projectContext.issues.length - 5} more\n`);
    }
    ctx.stream.markdown('\n');
  }

  return {
    metadata: {
      lastCommand: 'status',
      phaseNumber: projectContext.currentPhase ? parseInt(projectContext.currentPhase) : undefined
    }
  };
}

/**
 * Command registry - maps command names to handlers
 */
const registry: CommandRegistry = new Map();

// Register implemented handlers
registry.set('help', helpHandler);
registry.set('status', statusHandler);
registry.set('new-project', handleNewProject);
registry.set('create-roadmap', handleCreateRoadmap);
registry.set('plan-phase', handlePlanPhase);

// Register placeholder handlers for all other commands
for (const cmd of COMMAND_DEFINITIONS) {
  if (cmd.name !== 'help' && cmd.name !== 'status' && cmd.name !== 'new-project' && cmd.name !== 'create-roadmap' && cmd.name !== 'plan-phase') {
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
