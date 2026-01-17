import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * Agent history entry structure
 */
interface AgentHistoryEntry {
  agent_id: string;
  task_description: string;
  phase: string;
  plan: string;
  segment: number | null;
  timestamp: string;
  status: 'spawned' | 'interrupted' | 'completed';
  completion_timestamp: string | null;
}

/**
 * Agent history file structure
 */
interface AgentHistory {
  version: string;
  max_entries: number;
  entries: AgentHistoryEntry[];
}

/**
 * Read file content from workspace
 */
async function readFileContent(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString('utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Check if file exists
 */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle /resume-task command
 *
 * Resumes an interrupted subagent execution using the Task tool's resume parameter.
 * This is distinct from /resume-work which restores session context for humans.
 */
export async function handleResumeTask(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, projectContext, extensionContext } = ctx;

  // Check if project exists
  if (!projectContext.hasPlanning || !projectContext.planningUri) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('No `.planning` directory found. Use **/new-project** to initialize.\n\n');
    stream.button({
      command: 'hopper.chat-participant.new-project',
      title: 'New Project'
    });
    return { metadata: { lastCommand: 'resume-task' } };
  }

  // Parse optional agent ID argument
  const agentIdArg = request.prompt.trim() || undefined;

  // Try to get agent ID from argument or current-agent-id.txt
  let agentId: string | undefined = agentIdArg;

  if (!agentId) {
    // Check for current-agent-id.txt
    const currentAgentUri = vscode.Uri.joinPath(projectContext.planningUri, 'current-agent-id.txt');
    const currentAgentContent = await readFileContent(currentAgentUri);

    if (currentAgentContent && currentAgentContent.trim()) {
      agentId = currentAgentContent.trim();
      stream.markdown(`Found interrupted agent: **${agentId}**\n\n`);
    }
  }

  if (!agentId) {
    // No agent to resume - check for incomplete plans instead
    stream.markdown('## No Active Agent Found\n\n');
    stream.markdown('No interrupted agent recorded in `.planning/current-agent-id.txt`.\n\n');
    stream.markdown('This could mean:\n');
    stream.markdown('- No subagent was spawned in the current plan\n');
    stream.markdown('- The last agent completed successfully\n');
    stream.markdown('- The tracking file was cleared\n\n');

    // Check for incomplete plans (PLAN without SUMMARY)
    stream.markdown('### Checking for Incomplete Plans...\n\n');

    const incompletePlans = await findIncompletePlans(projectContext.planningUri);

    if (incompletePlans.length > 0) {
      stream.markdown(`Found **${incompletePlans.length}** incomplete plan(s):\n\n`);
      for (const plan of incompletePlans.slice(0, 5)) {
        stream.markdown(`- ${plan.name}\n`);
      }
      if (incompletePlans.length > 5) {
        stream.markdown(`- ... and ${incompletePlans.length - 5} more\n`);
      }
      stream.markdown('\n');

      stream.markdown('To continue from an incomplete plan, use **/execute-plan**:\n\n');
      stream.button({
        command: 'hopper.chat-participant.execute-plan',
        arguments: [incompletePlans[0].path],
        title: `Execute ${incompletePlans[0].name}`
      });
    } else {
      stream.markdown('No incomplete plans found. All plans have been executed.\n\n');
      stream.button({
        command: 'hopper.chat-participant.progress',
        title: 'Check Progress'
      });
    }

    return { metadata: { lastCommand: 'resume-task' } };
  }

  // Validate agent exists in history
  const historyUri = vscode.Uri.joinPath(projectContext.planningUri, 'agent-history.json');
  const historyContent = await readFileContent(historyUri);

  if (!historyContent) {
    stream.markdown('## No Agent History Found\n\n');
    stream.markdown('Could not find `.planning/agent-history.json`.\n\n');
    stream.markdown('This file tracks spawned agents for resume capability.\n');
    stream.markdown('It should have been created during **/execute-plan**.\n\n');
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });
    return { metadata: { lastCommand: 'resume-task' } };
  }

  let history: AgentHistory;
  try {
    history = JSON.parse(historyContent);
  } catch {
    stream.markdown('## Error Reading Agent History\n\n');
    stream.markdown('Could not parse `.planning/agent-history.json`.\n\n');
    return { metadata: { lastCommand: 'resume-task' } };
  }

  // Find the agent entry
  const agentEntry = history.entries.find(e => e.agent_id === agentId);

  if (!agentEntry) {
    stream.markdown('## Agent Not Found\n\n');
    stream.markdown(`Agent ID **${agentId}** not found in history.\n\n`);

    // Show available agents
    const resumable = history.entries.filter(e => e.status === 'spawned' || e.status === 'interrupted');
    if (resumable.length > 0) {
      stream.markdown('**Available agents to resume:**\n\n');
      for (const entry of resumable.slice(0, 5)) {
        stream.markdown(`- \`${entry.agent_id}\` - ${entry.task_description} (${entry.status})\n`);
      }
      stream.markdown('\n');
    } else {
      stream.markdown('No resumable agents found. All agents have completed.\n\n');
    }

    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });

    return { metadata: { lastCommand: 'resume-task' } };
  }

  // Check agent status
  if (agentEntry.status === 'completed') {
    stream.markdown('## Agent Already Completed\n\n');
    stream.markdown(`**Agent ID:** ${agentId}\n`);
    stream.markdown(`**Task:** ${agentEntry.task_description}\n`);
    stream.markdown(`**Completed:** ${agentEntry.completion_timestamp}\n\n`);
    stream.markdown('This agent finished successfully. No resume needed.\n\n');
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Continue to Next'
    });
    return { metadata: { lastCommand: 'resume-task' } };
  }

  // Agent is resumable (status: spawned or interrupted)
  stream.markdown('## Resuming Agent\n\n');
  stream.markdown(`**Agent ID:** ${agentId}\n`);
  stream.markdown(`**Task:** ${agentEntry.task_description}\n`);
  stream.markdown(`**Phase:** ${agentEntry.phase}\n`);
  stream.markdown(`**Plan:** ${agentEntry.plan}\n`);
  stream.markdown(`**Status:** ${agentEntry.status}\n`);
  stream.markdown(`**Spawned:** ${agentEntry.timestamp}\n\n`);

  // Note: In the VSCode extension context, we cannot actually resume agents
  // because the Task tool is a Claude Code capability, not a VSCode API.
  // Instead, we guide the user to continue execution.

  stream.markdown('---\n\n');
  stream.markdown('### Resume Options\n\n');
  stream.markdown('Agent resume requires continuing the execution in a new context.\n\n');

  // Offer to execute the plan fresh
  const planPath = `.planning/phases/${agentEntry.phase}/${agentEntry.phase.split('-')[0]}-${agentEntry.plan.padStart(2, '0')}-PLAN.md`;

  stream.button({
    command: 'hopper.chat-participant.execute-plan',
    arguments: [planPath],
    title: 'Re-execute Plan'
  });

  stream.markdown(' ');

  stream.button({
    command: 'hopper.chat-participant.progress',
    title: 'Check Status First'
  });

  stream.markdown('\n\n');

  stream.markdown('**Note:** The original agent context may have expired. Re-executing the plan will start fresh.\n');
  stream.markdown('Any completed work from the interrupted session should be preserved in the codebase.\n\n');

  // Clear the current-agent-id.txt since we're guiding to re-execution
  try {
    const currentAgentUri = vscode.Uri.joinPath(projectContext.planningUri, 'current-agent-id.txt');
    await vscode.workspace.fs.writeFile(currentAgentUri, Buffer.from('', 'utf-8'));
  } catch {
    // Ignore errors clearing the file
  }

  return {
    metadata: {
      lastCommand: 'resume-task'
    }
  };
}

/**
 * Find incomplete plans (PLAN without corresponding SUMMARY)
 */
async function findIncompletePlans(
  planningUri: vscode.Uri
): Promise<{ name: string; path: string }[]> {
  const incomplete: { name: string; path: string }[] = [];

  try {
    const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');
    const phases = await vscode.workspace.fs.readDirectory(phasesUri);

    for (const [phaseName, type] of phases) {
      if (type !== vscode.FileType.Directory) continue;

      const phaseDir = vscode.Uri.joinPath(phasesUri, phaseName);
      const files = await vscode.workspace.fs.readDirectory(phaseDir);

      // Find all PLAN.md files
      const planFiles = files
        .filter(([name]) => name.endsWith('-PLAN.md'))
        .map(([name]) => name);

      // Check each plan for corresponding SUMMARY
      for (const planFile of planFiles) {
        const summaryFile = planFile.replace('-PLAN.md', '-SUMMARY.md');
        const hasSummary = files.some(([name]) => name === summaryFile);

        if (!hasSummary) {
          const relativePath = `.planning/phases/${phaseName}/${planFile}`;
          incomplete.push({
            name: planFile.replace('.md', ''),
            path: relativePath
          });
        }
      }
    }
  } catch {
    // Phases directory doesn't exist
  }

  // Sort by name (which includes phase and plan numbers)
  incomplete.sort((a, b) => a.name.localeCompare(b.name));

  return incomplete;
}
