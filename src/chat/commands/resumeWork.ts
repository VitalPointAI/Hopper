import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import { truncateContent } from '../context/projectContext';

/**
 * Handoff file data parsed from .continue-here.md
 */
interface HandoffData {
  path: string;
  phaseName: string;
  task: number;
  totalTasks: number;
  status: string;
  lastUpdated: string;
  currentState: string;
  completedWork: string;
  remainingWork: string;
  decisionsMade: string;
  blockers: string;
  context: string;
  nextAction: string;
}

/**
 * Search for .continue-here.md files in all phase directories
 *
 * @param planningUri - URI to .planning directory
 * @returns Array of handoff file paths and data
 */
async function findHandoffFiles(
  planningUri: vscode.Uri
): Promise<HandoffData[]> {
  const handoffs: HandoffData[] = [];
  const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');

  try {
    const phaseEntries = await vscode.workspace.fs.readDirectory(phasesUri);

    for (const [phaseName, phaseType] of phaseEntries) {
      if (phaseType !== vscode.FileType.Directory) continue;

      const phaseUri = vscode.Uri.joinPath(phasesUri, phaseName);
      const handoffUri = vscode.Uri.joinPath(phaseUri, '.continue-here.md');

      try {
        await vscode.workspace.fs.stat(handoffUri);
        const content = Buffer.from(await vscode.workspace.fs.readFile(handoffUri)).toString('utf-8');
        const parsed = parseHandoffFile(content, phaseName, `.planning/phases/${phaseName}/.continue-here.md`);
        if (parsed) {
          handoffs.push(parsed);
        }
      } catch {
        // No handoff file in this phase
      }
    }
  } catch {
    // phases directory doesn't exist
  }

  return handoffs;
}

/**
 * Parse handoff file content into structured data
 *
 * @param content - File content
 * @param phaseName - Phase directory name
 * @param path - File path
 * @returns Parsed handoff data or undefined
 */
function parseHandoffFile(content: string, phaseName: string, path: string): HandoffData | undefined {
  // Parse YAML frontmatter
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return undefined;

  const frontmatter = frontmatterMatch[1];

  // Extract frontmatter fields
  const taskMatch = frontmatter.match(/task:\s*(\d+)/);
  const totalMatch = frontmatter.match(/total_tasks:\s*(\d+)/);
  const statusMatch = frontmatter.match(/status:\s*(.+)/);
  const updatedMatch = frontmatter.match(/last_updated:\s*(.+)/);

  // Parse XML sections
  const extractSection = (tag: string): string => {
    const regex = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : '';
  };

  return {
    path,
    phaseName,
    task: taskMatch ? parseInt(taskMatch[1]) : 0,
    totalTasks: totalMatch ? parseInt(totalMatch[1]) : 0,
    status: statusMatch ? statusMatch[1].trim() : 'unknown',
    lastUpdated: updatedMatch ? updatedMatch[1].trim() : 'unknown',
    currentState: extractSection('current_state'),
    completedWork: extractSection('completed_work'),
    remainingWork: extractSection('remaining_work'),
    decisionsMade: extractSection('decisions_made'),
    blockers: extractSection('blockers'),
    context: extractSection('context'),
    nextAction: extractSection('next_action')
  };
}

/**
 * Find incomplete plans (PLAN without SUMMARY)
 *
 * @param planningUri - URI to .planning directory
 * @returns Array of incomplete plan info
 */
async function findIncompletePlans(
  planningUri: vscode.Uri
): Promise<{ phaseName: string; planFile: string; planPath: string }[]> {
  const incomplete: { phaseName: string; planFile: string; planPath: string }[] = [];
  const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');

  try {
    const phaseEntries = await vscode.workspace.fs.readDirectory(phasesUri);

    for (const [phaseName, phaseType] of phaseEntries) {
      if (phaseType !== vscode.FileType.Directory) continue;

      const phaseUri = vscode.Uri.joinPath(phasesUri, phaseName);
      const files = await vscode.workspace.fs.readDirectory(phaseUri);

      const planFiles = files
        .filter(([name]) => name.endsWith('-PLAN.md') && !name.includes('-FIX'))
        .map(([name]) => name);

      const summaryFiles = files
        .filter(([name]) => name.endsWith('-SUMMARY.md') && !name.includes('-FIX'))
        .map(([name]) => name.replace('-SUMMARY.md', ''));

      for (const plan of planFiles) {
        const planBase = plan.replace('-PLAN.md', '');
        if (!summaryFiles.includes(planBase)) {
          incomplete.push({
            phaseName,
            planFile: plan,
            planPath: `.planning/phases/${phaseName}/${plan}`
          });
        }
      }
    }
  } catch {
    // phases directory doesn't exist
  }

  // Sort by phase/plan number
  incomplete.sort((a, b) => a.planPath.localeCompare(b.planPath));
  return incomplete;
}

/**
 * Delete handoff file after successful resume
 *
 * @param planningUri - URI to .planning directory
 * @param phaseName - Phase directory name
 */
async function deleteHandoffFile(planningUri: vscode.Uri, phaseName: string): Promise<void> {
  const handoffUri = vscode.Uri.joinPath(planningUri, 'phases', phaseName, '.continue-here.md');
  try {
    await vscode.workspace.fs.delete(handoffUri);
  } catch {
    // File may not exist or can't be deleted
  }
}

/**
 * Update STATE.md resume file field
 *
 * @param planningUri - URI to .planning directory
 * @param resumePath - Path to resume file or "None"
 */
async function updateStateResumeFile(planningUri: vscode.Uri, resumePath: string): Promise<void> {
  const stateUri = vscode.Uri.joinPath(planningUri, 'STATE.md');

  try {
    const content = Buffer.from(await vscode.workspace.fs.readFile(stateUri)).toString('utf-8');

    // Update Resume file field
    const updated = content.replace(
      /Resume file:\s*.*/,
      `Resume file: ${resumePath}`
    );

    if (updated !== content) {
      await vscode.workspace.fs.writeFile(stateUri, Buffer.from(updated, 'utf-8'));
    }
  } catch {
    // STATE.md doesn't exist or can't be updated
  }
}

/**
 * Handle /resume-work command
 *
 * Restores context from .continue-here.md and routes to appropriate next action.
 */
export async function handleResumeWork(ctx: CommandContext): Promise<IHopperResult> {
  const { projectContext, stream } = ctx;

  // Step 1: Verify project exists
  if (!projectContext.hasPlanning || !projectContext.planningUri) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('No `.planning` directory found. Nothing to resume.\n\n');
    stream.button({
      command: 'hopper.chat-participant.new-project',
      title: 'New Project'
    });
    return { metadata: { lastCommand: 'resume-work' } };
  }

  // Step 2: Search for handoff files
  const handoffs = await findHandoffFiles(projectContext.planningUri);

  if (handoffs.length > 0) {
    // Found handoff file(s) - display restored context
    const handoff = handoffs[0]; // Use most recent if multiple

    stream.markdown('## Session Restored\n\n');
    stream.markdown(`**Handoff found:** \`${handoff.path}\`\n\n`);

    stream.markdown('---\n\n');

    // Current State
    stream.markdown('### Where We Left Off\n\n');
    if (handoff.currentState) {
      stream.markdown('```\n' + handoff.currentState + '\n```\n\n');
    }
    stream.markdown(`**Task:** ${handoff.task} of ${handoff.totalTasks}\n`);
    stream.markdown(`**Status:** ${handoff.status}\n`);
    stream.markdown(`**Last Updated:** ${handoff.lastUpdated}\n\n`);

    // Completed Work
    if (handoff.completedWork && handoff.completedWork !== '- No tasks completed this session') {
      stream.markdown('### Completed Work\n\n');
      stream.markdown(handoff.completedWork + '\n\n');
    }

    // Remaining Work
    if (handoff.remainingWork) {
      stream.markdown('### Remaining Work\n\n');
      stream.markdown(handoff.remainingWork + '\n\n');
    }

    // Blockers
    if (handoff.blockers && !handoff.blockers.includes('None')) {
      stream.markdown('### Blockers\n\n');
      stream.markdown(handoff.blockers + '\n\n');
    }

    // Context
    if (handoff.context && handoff.context !== 'Session paused for later resumption.') {
      stream.markdown('### Context Notes\n\n');
      stream.markdown(handoff.context + '\n\n');
    }

    // Next Action
    if (handoff.nextAction) {
      stream.markdown('### Next Action\n\n');
      stream.markdown(handoff.nextAction + '\n\n');
    }

    stream.markdown('---\n\n');

    // Extract plan path from next action or construct it
    const planPathMatch = handoff.nextAction.match(/\/execute-plan\s+([^\s]+)/);
    const planPath = planPathMatch ? planPathMatch[1] : null;

    // Offer options
    stream.markdown('**Choose how to proceed:**\n\n');

    if (planPath) {
      stream.button({
        command: 'hopper.chat-participant.execute-plan',
        arguments: [planPath],
        title: 'Continue from Here'
      });
    } else {
      stream.button({
        command: 'hopper.chat-participant.progress',
        title: 'Continue from Here'
      });
    }

    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Start Fresh'
    });

    stream.markdown('\n\n');
    stream.markdown('*Tip: The handoff file will be deleted after the plan completes.*\n\n');

    // Update STATE.md resume file field
    await updateStateResumeFile(projectContext.planningUri, handoff.path);

    return {
      metadata: {
        lastCommand: 'resume-work',
        // @ts-expect-error - extending metadata
        handoffPath: handoff.path,
        planPath
      }
    };
  }

  // Step 3: No handoff file - check for incomplete plans
  const incomplete = await findIncompletePlans(projectContext.planningUri);

  if (incomplete.length > 0) {
    const next = incomplete[0];

    stream.markdown('## No Handoff File Found\n\n');
    stream.markdown('No `.continue-here.md` found, but there is incomplete work.\n\n');

    stream.markdown('---\n\n');

    stream.markdown('### Incomplete Plan\n\n');
    stream.markdown(`**Plan:** ${next.planFile.replace('-PLAN.md', '')}\n`);
    stream.markdown(`**Phase:** ${next.phaseName}\n`);
    stream.markdown(`**Path:** \`${next.planPath}\`\n\n`);

    stream.markdown('---\n\n');

    stream.markdown('**Choose how to proceed:**\n\n');

    stream.button({
      command: 'hopper.chat-participant.execute-plan',
      arguments: [next.planPath],
      title: 'Execute Plan'
    });

    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Start Fresh'
    });

    stream.markdown('\n\n');

    return {
      metadata: {
        lastCommand: 'resume-work',
        // @ts-expect-error - extending metadata
        planPath: next.planPath
      }
    };
  }

  // Step 4: Nothing to resume
  stream.markdown('## Nothing to Resume\n\n');
  stream.markdown('No handoff files or incomplete plans found.\n\n');
  stream.markdown('Use **/progress** to see current status and next steps.\n\n');

  stream.button({
    command: 'hopper.chat-participant.progress',
    title: 'Check Progress'
  });

  return { metadata: { lastCommand: 'resume-work' } };
}

/**
 * Clear handoff file after plan completion
 *
 * Call this from execute-plan after successful completion.
 *
 * @param planningUri - URI to .planning directory
 * @param phaseName - Phase directory name
 */
export async function clearHandoffAfterCompletion(
  planningUri: vscode.Uri,
  phaseName: string
): Promise<void> {
  await deleteHandoffFile(planningUri, phaseName);
  await updateStateResumeFile(planningUri, 'None');
}
