import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import { truncateContent } from '../context/projectContext';
import * as gitService from '../executor/gitService';

/**
 * Checkpoint state stored in globalState during execution
 */
interface CheckpointState {
  planPath: string;
  currentTaskIndex: number;
  totalTasks: number;
  taskName: string;
  type: 'verify' | 'decision' | 'action';
  phaseNum: string;
  planNum: string;
}

/**
 * Find the most recently modified phase directory
 *
 * @param planningUri - URI to .planning directory
 * @returns Phase directory info or undefined
 */
async function findMostRecentPhaseDir(
  planningUri: vscode.Uri
): Promise<{ uri: vscode.Uri; name: string } | undefined> {
  const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');
  let mostRecent: { uri: vscode.Uri; name: string; mtime: number } | undefined;

  try {
    const entries = await vscode.workspace.fs.readDirectory(phasesUri);

    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) continue;

      const phaseUri = vscode.Uri.joinPath(phasesUri, name);

      // Get most recent file in this phase
      const files = await vscode.workspace.fs.readDirectory(phaseUri);
      let phaseMtime = 0;

      for (const [fileName, fileType] of files) {
        if (fileType !== vscode.FileType.File) continue;
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(phaseUri, fileName));
          if (stat.mtime > phaseMtime) {
            phaseMtime = stat.mtime;
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }

      if (!mostRecent || phaseMtime > mostRecent.mtime) {
        mostRecent = { uri: phaseUri, name, mtime: phaseMtime };
      }
    }
  } catch {
    // phases directory doesn't exist
    return undefined;
  }

  return mostRecent ? { uri: mostRecent.uri, name: mostRecent.name } : undefined;
}

/**
 * Parse current position from STATE.md
 *
 * @param stateMd - STATE.md content
 * @returns Current phase and plan info
 */
function parseCurrentPosition(stateMd: string): {
  phase: string;
  planNum: string;
  totalPlans: string;
  status: string;
} | undefined {
  const phaseMatch = stateMd.match(/Phase:\s*(\d+(?:\.\d+)?)\s*of\s*(\d+)/);
  const planMatch = stateMd.match(/Plan:\s*(\d+)\s*of\s*(\d+)/);
  const statusMatch = stateMd.match(/Status:\s*(.+)/);

  if (!phaseMatch) return undefined;

  return {
    phase: phaseMatch[1],
    planNum: planMatch ? planMatch[1] : '0',
    totalPlans: planMatch ? planMatch[2] : '0',
    status: statusMatch ? statusMatch[1].trim() : 'Unknown'
  };
}

/**
 * Get recent SUMMARY.md file content from phase
 *
 * @param phaseUri - Phase directory URI
 * @returns Array of summary file info
 */
async function getRecentSummaries(
  phaseUri: vscode.Uri
): Promise<{ name: string; content: string }[]> {
  const summaries: { name: string; content: string; mtime: number }[] = [];

  try {
    const entries = await vscode.workspace.fs.readDirectory(phaseUri);

    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('-SUMMARY.md')) continue;

      try {
        const fileUri = vscode.Uri.joinPath(phaseUri, name);
        const stat = await vscode.workspace.fs.stat(fileUri);
        const content = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf-8');
        summaries.push({ name, content, mtime: stat.mtime });
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    return [];
  }

  // Sort by mtime descending
  summaries.sort((a, b) => b.mtime - a.mtime);
  return summaries.slice(0, 3).map(s => ({ name: s.name, content: s.content }));
}

/**
 * Get current plan content and remaining tasks
 *
 * @param phaseUri - Phase directory URI
 * @param position - Current position info
 * @returns Plan info or undefined
 */
async function getCurrentPlanInfo(
  phaseUri: vscode.Uri,
  position: { phase: string; planNum: string }
): Promise<{
  planName: string;
  totalTasks: number;
  remainingTasks: string[];
} | undefined> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(phaseUri);

    // Find PLAN files without matching SUMMARY
    const planFiles = entries
      .filter(([name]) => name.endsWith('-PLAN.md'))
      .map(([name]) => name)
      .sort();

    const summaryFiles = entries
      .filter(([name]) => name.endsWith('-SUMMARY.md'))
      .map(([name]) => name.replace('-SUMMARY.md', ''))
      .sort();

    // Find first unexecuted plan
    let currentPlan: string | undefined;
    for (const plan of planFiles) {
      const planBase = plan.replace('-PLAN.md', '');
      if (!summaryFiles.includes(planBase)) {
        currentPlan = plan;
        break;
      }
    }

    if (!currentPlan) return undefined;

    // Read plan content
    const planUri = vscode.Uri.joinPath(phaseUri, currentPlan);
    const planContent = Buffer.from(await vscode.workspace.fs.readFile(planUri)).toString('utf-8');

    // Parse tasks
    const taskMatches = planContent.matchAll(/<task[^>]*type="[^"]*"[^>]*>[\s\S]*?<name>([^<]+)<\/name>/g);
    const tasks = Array.from(taskMatches).map(m => m[1].trim());

    return {
      planName: currentPlan.replace('-PLAN.md', ''),
      totalTasks: tasks.length,
      remainingTasks: tasks
    };
  } catch {
    return undefined;
  }
}

/**
 * Extract summary one-liner from SUMMARY.md content
 */
function extractOneLiner(content: string): string | undefined {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('**') && line.endsWith('**') && !line.includes(':')) {
      return line.replace(/^\*\*|\*\*$/g, '');
    }
    if (line.startsWith('#')) {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine?.startsWith('**') && nextLine.endsWith('**')) {
        return nextLine.replace(/^\*\*|\*\*$/g, '');
      }
    }
  }
  return undefined;
}

/**
 * Handle /pause-work command
 *
 * Creates .continue-here.md handoff file to preserve work state across sessions.
 */
export async function handlePauseWork(ctx: CommandContext): Promise<IHopperResult> {
  const { projectContext, stream, extensionContext, request } = ctx;

  // Step 1: Verify project exists
  if (!projectContext.hasPlanning || !projectContext.planningUri) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('No `.planning` directory found. Nothing to pause.\n\n');
    stream.button({
      command: 'hopper.chat-participant.new-project',
      title: 'New Project'
    });
    return { metadata: { lastCommand: 'pause-work' } };
  }

  if (!projectContext.stateMd) {
    stream.markdown('## Missing STATE.md\n\n');
    stream.markdown('Cannot determine current position without STATE.md.\n\n');
    return { metadata: { lastCommand: 'pause-work' } };
  }

  // Step 2: Parse current position
  const position = parseCurrentPosition(projectContext.stateMd);
  if (!position) {
    stream.markdown('## Unable to Parse Position\n\n');
    stream.markdown('Could not parse current phase/plan from STATE.md.\n\n');
    return { metadata: { lastCommand: 'pause-work' } };
  }

  // Step 3: Find current phase directory
  const phaseDir = await findMostRecentPhaseDir(projectContext.planningUri);
  if (!phaseDir) {
    stream.markdown('## No Phase Directory Found\n\n');
    stream.markdown('No phase directories exist in `.planning/phases/`.\n\n');
    return { metadata: { lastCommand: 'pause-work' } };
  }

  // Step 4: Get current plan info
  const planInfo = await getCurrentPlanInfo(phaseDir.uri, position);
  if (!planInfo) {
    stream.markdown('## No Active Work\n\n');
    stream.markdown('No unexecuted plans found in current phase. Nothing to pause.\n\n');
    stream.markdown('Use **/progress** to see next steps.\n\n');
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });
    return { metadata: { lastCommand: 'pause-work' } };
  }

  // Step 5: Check for checkpoint state (if mid-execution)
  const checkpointState = extensionContext.globalState.get<CheckpointState>('hopper.checkpointState');
  const currentTaskNum = checkpointState?.currentTaskIndex
    ? checkpointState.currentTaskIndex + 1
    : 0;

  // Step 6: Get recent work completed
  const recentSummaries = await getRecentSummaries(phaseDir.uri);
  const completedWork = recentSummaries.map(s => {
    const oneLiner = extractOneLiner(s.content);
    return `- ${s.name.replace('-SUMMARY.md', '')}: ${oneLiner || 'Completed'}`;
  });

  // Step 7: Build .continue-here.md content
  const timestamp = new Date().toISOString();
  const status = checkpointState ? 'in_progress' : 'ready_to_start';
  const taskStatus = currentTaskNum > 0
    ? `Task ${currentTaskNum} of ${planInfo.totalTasks}`
    : 'Not started';

  // Get user's additional context if provided
  const userContext = request.prompt.trim();

  const handoffContent = `---
phase: ${phaseDir.name}
task: ${currentTaskNum}
total_tasks: ${planInfo.totalTasks}
status: ${status}
last_updated: ${timestamp}
---

<current_state>
Phase: ${position.phase} - ${phaseDir.name}
Plan: ${planInfo.planName}
Position: ${taskStatus}
</current_state>

<completed_work>
${completedWork.length > 0 ? completedWork.join('\n') : '- No tasks completed this session'}
${currentTaskNum > 0 ? `- Task ${currentTaskNum}: In progress` : ''}
</completed_work>

<remaining_work>
${planInfo.remainingTasks.slice(currentTaskNum).map((t, i) =>
  `- Task ${currentTaskNum + i + 1}: ${t}`
).join('\n')}
</remaining_work>

<decisions_made>
${projectContext.stateMd?.includes('### Decisions')
  ? 'See STATE.md for accumulated decisions'
  : '- No decisions logged yet'}
</decisions_made>

<blockers>
- None currently
</blockers>

<context>
${userContext || 'Session paused for later resumption.'}
</context>

<next_action>
Start with: Resume plan execution at ${currentTaskNum > 0 ? `task ${currentTaskNum + 1}` : 'task 1'}
Run: /execute-plan .planning/phases/${phaseDir.name}/${planInfo.planName}-PLAN.md
</next_action>
`;

  // Step 8: Write handoff file
  const handoffUri = vscode.Uri.joinPath(phaseDir.uri, '.continue-here.md');
  await vscode.workspace.fs.writeFile(handoffUri, Buffer.from(handoffContent, 'utf-8'));

  // Step 9: Commit handoff file
  const workspaceUri = projectContext.workspaceUri;
  if (workspaceUri) {
    const isGitRepo = await gitService.checkGitRepo(workspaceUri);
    if (isGitRepo) {
      const handoffPath = `.planning/phases/${phaseDir.name}/.continue-here.md`;
      await gitService.stageFiles(workspaceUri, [handoffPath]);

      const commitMessage = `wip: ${phaseDir.name} paused at task ${currentTaskNum || 0}/${planInfo.totalTasks}`;
      const result = await gitService.commit(workspaceUri, commitMessage);

      if (result.success) {
        stream.markdown(`## Work Paused\n\n`);
        stream.markdown(`**Handoff created:** \`.planning/phases/${phaseDir.name}/.continue-here.md\`\n\n`);
        stream.markdown('### Current State\n\n');
        stream.markdown(`- **Phase:** ${position.phase} (${phaseDir.name})\n`);
        stream.markdown(`- **Plan:** ${planInfo.planName}\n`);
        stream.markdown(`- **Task:** ${currentTaskNum || 0} of ${planInfo.totalTasks}\n`);
        stream.markdown(`- **Status:** ${status}\n`);
        stream.markdown(`- **Committed:** ${result.hash || 'yes'}\n\n`);
        stream.markdown('---\n\n');
        stream.markdown('**To resume:** `/resume-work`\n\n');
        stream.button({
          command: 'hopper.chat-participant.resume-work',
          title: 'Resume Later'
        });
      } else {
        stream.markdown(`## Work Paused\n\n`);
        stream.markdown(`**Handoff created:** \`.planning/phases/${phaseDir.name}/.continue-here.md\`\n\n`);
        stream.markdown(`*Note: Could not commit (${result.error || 'unknown error'})*\n\n`);
        stream.markdown('### Current State\n\n');
        stream.markdown(`- **Phase:** ${position.phase} (${phaseDir.name})\n`);
        stream.markdown(`- **Plan:** ${planInfo.planName}\n`);
        stream.markdown(`- **Task:** ${currentTaskNum || 0} of ${planInfo.totalTasks}\n`);
        stream.markdown(`- **Status:** ${status}\n\n`);
        stream.markdown('---\n\n');
        stream.markdown('**To resume:** `/resume-work`\n\n');
      }
    } else {
      stream.markdown(`## Work Paused\n\n`);
      stream.markdown(`**Handoff created:** \`.planning/phases/${phaseDir.name}/.continue-here.md\`\n\n`);
      stream.markdown('*Note: Not a git repository, handoff not committed*\n\n');
      stream.markdown('### Current State\n\n');
      stream.markdown(`- **Phase:** ${position.phase} (${phaseDir.name})\n`);
      stream.markdown(`- **Plan:** ${planInfo.planName}\n`);
      stream.markdown(`- **Task:** ${currentTaskNum || 0} of ${planInfo.totalTasks}\n`);
      stream.markdown(`- **Status:** ${status}\n\n`);
      stream.markdown('---\n\n');
      stream.markdown('**To resume:** `/resume-work`\n\n');
    }
  } else {
    stream.markdown(`## Work Paused\n\n`);
    stream.markdown(`**Handoff created:** \`.planning/phases/${phaseDir.name}/.continue-here.md\`\n\n`);
    stream.markdown('---\n\n');
    stream.markdown('**To resume:** `/resume-work`\n\n');
  }

  return { metadata: { lastCommand: 'pause-work' } };
}
