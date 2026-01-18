import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import { truncateContent } from '../context/projectContext';

/**
 * Check for .continue-here.md handoff files in phase directories
 *
 * @param planningUri - URI to .planning directory
 * @returns Array of { phaseName, path } for found handoff files
 */
async function findHandoffFiles(
  planningUri: vscode.Uri
): Promise<{ phaseName: string; path: string }[]> {
  const handoffs: { phaseName: string; path: string }[] = [];
  const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');

  try {
    const phaseEntries = await vscode.workspace.fs.readDirectory(phasesUri);

    for (const [phaseName, phaseType] of phaseEntries) {
      if (phaseType !== vscode.FileType.Directory) continue;

      const handoffUri = vscode.Uri.joinPath(phasesUri, phaseName, '.continue-here.md');
      try {
        await vscode.workspace.fs.stat(handoffUri);
        handoffs.push({
          phaseName,
          path: `.planning/phases/${phaseName}/.continue-here.md`
        });
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
 * Find the most recent SUMMARY.md files in the phases directory
 *
 * @param planningUri - URI to .planning directory
 * @param limit - Maximum number of summaries to return
 * @returns Array of { path, content } objects for recent summaries
 */
async function getRecentSummaries(
  planningUri: vscode.Uri,
  limit: number = 3
): Promise<{ path: string; content: string }[]> {
  const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');
  const summaries: { path: string; content: string; mtime: number }[] = [];

  try {
    const phaseEntries = await vscode.workspace.fs.readDirectory(phasesUri);

    for (const [phaseName, phaseType] of phaseEntries) {
      if (phaseType !== vscode.FileType.Directory) continue;

      const phaseUri = vscode.Uri.joinPath(phasesUri, phaseName);
      const files = await vscode.workspace.fs.readDirectory(phaseUri);

      for (const [fileName, fileType] of files) {
        if (fileType !== vscode.FileType.File || !fileName.endsWith('-SUMMARY.md')) continue;

        const fileUri = vscode.Uri.joinPath(phaseUri, fileName);
        try {
          const stat = await vscode.workspace.fs.stat(fileUri);
          const content = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf-8');
          summaries.push({
            path: `${phaseName}/${fileName}`,
            content,
            mtime: stat.mtime
          });
        } catch {
          // Skip files that can't be read
        }
      }
    }
  } catch {
    // phases directory doesn't exist
    return [];
  }

  // Sort by modification time descending and return top N
  summaries.sort((a, b) => b.mtime - a.mtime);
  return summaries.slice(0, limit).map(s => ({ path: s.path, content: s.content }));
}

/**
 * Extract the one-liner summary from a SUMMARY.md file
 *
 * Looks for the bold line after the heading, like:
 * # Phase X: Name Summary
 * **JWT auth with refresh rotation...**
 *
 * @param content - SUMMARY.md content
 * @returns One-liner summary or undefined
 */
function extractSummaryOneLiner(content: string): string | undefined {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Find bold line that starts with **
    if (line.startsWith('**') && line.endsWith('**') && !line.includes(':')) {
      return line.replace(/^\*\*|\*\*$/g, '');
    }
    // Also check for lines after a heading
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
 * Extract phase and plan from SUMMARY.md path or content
 *
 * @param path - File path like "01-foundation/01-01-SUMMARY.md"
 * @returns Object with phase and plan numbers
 */
function extractPhaseAndPlan(path: string): { phase: string; plan: string } | undefined {
  const match = path.match(/(\d+(?:\.\d+)?)-\d+-SUMMARY\.md$/);
  if (!match) return undefined;

  const filename = path.split('/').pop() || '';
  const planMatch = filename.match(/^(\d+(?:\.\d+)?)-(\d+)/);
  if (!planMatch) return undefined;

  return { phase: planMatch[1], plan: planMatch[2] };
}

/**
 * Parse decisions from STATE.md content
 *
 * @param stateMd - STATE.md content
 * @returns Array of decision strings (limited)
 */
function parseDecisions(stateMd: string): string[] {
  const decisions: string[] = [];
  const lines = stateMd.split('\n');
  let inDecisionsTable = false;
  let headerPassed = false;

  for (const line of lines) {
    // Find the Decisions header
    if (line.includes('### Decisions') || line.includes('| Phase | Decision |')) {
      inDecisionsTable = true;
      continue;
    }

    // Skip table header separator
    if (inDecisionsTable && line.match(/^\|[-|]+\|$/)) {
      headerPassed = true;
      continue;
    }

    // Exit on next section
    if (inDecisionsTable && headerPassed && line.startsWith('#')) {
      break;
    }

    // Parse table row
    if (inDecisionsTable && headerPassed && line.startsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 2) {
        decisions.push(`${cells[0]}: ${cells[1]}`);
      }
    }
  }

  // Return last 5 decisions (most recent)
  return decisions.slice(-5);
}

/**
 * Parse progress bar from STATE.md content
 *
 * @param stateMd - STATE.md content
 * @returns Progress percentage or undefined
 */
function parseProgressPercent(stateMd: string): number | undefined {
  const match = stateMd.match(/Progress:\s*[█░]+\s*(\d+)%/);
  return match ? parseInt(match[1]) : undefined;
}

/**
 * Count plans and summaries in a phase directory
 *
 * @param phaseDirUri - URI to phase directory
 * @returns Object with counts
 */
async function countPhaseFiles(phaseDirUri: vscode.Uri): Promise<{
  plans: number;
  summaries: number;
  issues: number;
  fixes: number;
  fixSummaries: number;
  planFiles: string[];
  summaryFiles: string[];
  issueFiles: string[];
  fixFiles: string[];
}> {
  const result = {
    plans: 0,
    summaries: 0,
    issues: 0,
    fixes: 0,
    fixSummaries: 0,
    planFiles: [] as string[],
    summaryFiles: [] as string[],
    issueFiles: [] as string[],
    fixFiles: [] as string[]
  };

  try {
    const entries = await vscode.workspace.fs.readDirectory(phaseDirUri);

    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File) continue;

      if (name.endsWith('-PLAN.md') && !name.includes('-FIX')) {
        result.plans++;
        result.planFiles.push(name);
      } else if (name.endsWith('-SUMMARY.md') && !name.includes('-FIX')) {
        result.summaries++;
        result.summaryFiles.push(name);
      } else if (name.endsWith('-ISSUES.md')) {
        result.issues++;
        result.issueFiles.push(name);
      } else if (name.includes('-FIX') && name.endsWith('-PLAN.md')) {
        result.fixes++;
        result.fixFiles.push(name);
      } else if (name.includes('-FIX') && name.endsWith('-SUMMARY.md')) {
        result.fixSummaries++;
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return result;
}

/**
 * Find the current phase directory
 *
 * @param planningUri - URI to .planning directory
 * @param currentPhase - Current phase number (e.g., "4" or "1.5")
 * @returns URI to the phase directory or undefined
 */
async function findPhaseDirectory(
  planningUri: vscode.Uri,
  currentPhase: string
): Promise<{ uri: vscode.Uri; name: string } | undefined> {
  const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');

  try {
    const entries = await vscode.workspace.fs.readDirectory(phasesUri);

    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) continue;

      // Match phase number at start (e.g., "04-" or "01.5-")
      const normalizedPhase = currentPhase.padStart(2, '0');
      if (name.startsWith(`${normalizedPhase}-`) || name.startsWith(`${currentPhase}-`)) {
        return { uri: vscode.Uri.joinPath(phasesUri, name), name };
      }
    }
  } catch {
    // phases directory doesn't exist
  }

  return undefined;
}

/**
 * Find the first unexecuted plan in a phase
 *
 * @param planFiles - List of plan file names
 * @param summaryFiles - List of summary file names
 * @returns Name of first unexecuted plan or undefined
 */
function findFirstUnexecutedPlan(planFiles: string[], summaryFiles: string[]): string | undefined {
  const executedPlans = new Set(
    summaryFiles.map(s => s.replace('-SUMMARY.md', ''))
  );

  // Sort plan files for consistent ordering
  const sortedPlans = [...planFiles].sort();

  for (const plan of sortedPlans) {
    const planBase = plan.replace('-PLAN.md', '');
    if (!executedPlans.has(planBase)) {
      return plan;
    }
  }

  return undefined;
}

/**
 * Parse phase info from ROADMAP.md
 *
 * @param roadmapMd - ROADMAP.md content
 * @param phaseNum - Phase number to look up
 * @returns Phase name and goal
 */
function parsePhaseInfo(roadmapMd: string, phaseNum: string): { name: string; goal: string } | undefined {
  const lines = roadmapMd.split('\n');

  // Look for phase heading
  const phasePattern = new RegExp(`###\\s*Phase\\s*${phaseNum}[.:]?\\s*(.+)`, 'i');
  const listPattern = new RegExp(`-\\s*\\[.\\]\\s*\\*\\*Phase\\s*${phaseNum}[.:]?\\s*(.+?)\\*\\*`, 'i');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check heading format
    const headingMatch = line.match(phasePattern);
    if (headingMatch) {
      // Look for **Goal**: line after
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const goalMatch = lines[j].match(/\*\*Goal\*\*:\s*(.+)/);
        if (goalMatch) {
          return { name: headingMatch[1].trim(), goal: goalMatch[1].trim() };
        }
      }
      return { name: headingMatch[1].trim(), goal: '' };
    }

    // Check list item format
    const listMatch = line.match(listPattern);
    if (listMatch) {
      // Extract description after dash
      const dashMatch = listMatch[1].match(/(.+?)\s*-\s*(.+)/);
      if (dashMatch) {
        return { name: dashMatch[1].trim(), goal: dashMatch[2].trim() };
      }
      return { name: listMatch[1].trim(), goal: '' };
    }
  }

  return undefined;
}

/**
 * Count total phases in ROADMAP.md
 *
 * @param roadmapMd - ROADMAP.md content
 * @returns Total number of phases
 */
function countTotalPhases(roadmapMd: string): number {
  const lines = roadmapMd.split('\n');
  let count = 0;

  for (const line of lines) {
    // Match phase entries in various formats
    if (line.match(/^-\s*\[.\]\s*\*\*Phase\s*\d+/i) ||
        line.match(/^###\s*Phase\s*\d+/i)) {
      count++;
    }
  }

  return count;
}

/**
 * Get the next phase number after current
 *
 * @param roadmapMd - ROADMAP.md content
 * @param currentPhase - Current phase number
 * @returns Next phase number or undefined if at end
 */
function getNextPhase(roadmapMd: string, currentPhase: string): string | undefined {
  const lines = roadmapMd.split('\n');
  const phases: string[] = [];

  // Collect all phase numbers
  for (const line of lines) {
    const match = line.match(/Phase\s*(\d+(?:\.\d+)?)/i);
    if (match && !phases.includes(match[1])) {
      phases.push(match[1]);
    }
  }

  // Sort phases numerically
  phases.sort((a, b) => parseFloat(a) - parseFloat(b));

  // Find current and return next
  const idx = phases.indexOf(currentPhase);
  if (idx >= 0 && idx < phases.length - 1) {
    return phases[idx + 1];
  }

  return undefined;
}

/**
 * Generate visual progress bar
 *
 * @param percent - Progress percentage (0-100)
 * @param width - Width in characters
 * @returns Progress bar string
 */
function generateProgressBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Handle /progress command
 *
 * Shows rich project status and intelligently routes to next action.
 */
export async function handleProgress(ctx: CommandContext): Promise<IHopperResult> {
  const { projectContext, stream } = ctx;

  // Step 1: Verify planning structure exists
  if (!projectContext.hasPlanning || !projectContext.planningUri) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('No `.planning` directory found in this workspace.\n\n');
    stream.markdown('Run **/new-project** to start a new project.\n\n');
    stream.button({
      command: 'hopper.chat-participant.new-project',
      title: 'New Project'
    });
    return { metadata: { lastCommand: 'progress' } };
  }

  // Check for required files
  if (!projectContext.stateMd) {
    stream.markdown('## Missing STATE.md\n\n');
    stream.markdown('Project exists but `STATE.md` is missing.\n\n');
    stream.markdown('Run **/new-project** to reinitialize or create STATE.md manually.\n\n');
    return { metadata: { lastCommand: 'progress' } };
  }

  if (!projectContext.roadmapMd) {
    stream.markdown('## Missing ROADMAP.md\n\n');
    stream.markdown('Project exists but `ROADMAP.md` is missing.\n\n');
    stream.markdown('Run **/create-roadmap** to create the roadmap.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'progress' } };
  }

  // Step 2: Extract project name
  let projectName = 'Project';
  if (projectContext.projectMd) {
    const lines = projectContext.projectMd.split('\n');
    const firstHeading = lines.find(line => line.startsWith('#'));
    if (firstHeading) {
      projectName = firstHeading.replace(/^#+\s*/, '');
    }
  }

  // Step 3: Parse progress from STATE.md
  const progressPercent = parseProgressPercent(projectContext.stateMd) || 0;
  const progressBar = generateProgressBar(progressPercent);

  // Calculate completed/total from roadmap or state
  let completedPlans = 0;
  let totalPlans = 0;

  // Parse from state "Plan: X of Y"
  const planMatch = projectContext.stateMd.match(/(\d+)\s+of\s+(\d+)\s+plans?\s+complete/i) ||
                   projectContext.stateMd.match(/Plan:\s*(\d+)\s+of\s+(\d+)/i);

  // Get phase info
  const currentPhase = projectContext.currentPhase || '1';
  const phaseDir = await findPhaseDirectory(projectContext.planningUri, currentPhase);

  // Step 4: Get recent summaries
  const recentSummaries = await getRecentSummaries(projectContext.planningUri, 3);

  // Step 5: Parse decisions
  const decisions = parseDecisions(projectContext.stateMd);

  // Step 6: Parse issues from context
  const issues = projectContext.issues || [];

  // Step 7: Get phase info from roadmap
  const phaseInfo = parsePhaseInfo(projectContext.roadmapMd, currentPhase);
  const totalPhases = countTotalPhases(projectContext.roadmapMd);

  // ============================================
  // RENDER STATUS REPORT
  // ============================================

  stream.markdown(`# ${projectName}\n\n`);
  stream.markdown(`**Progress:** [${progressBar}] ${progressPercent}%\n\n`);

  // Recent Work section
  if (recentSummaries.length > 0) {
    stream.markdown('## Recent Work\n\n');
    for (const summary of recentSummaries) {
      const info = extractPhaseAndPlan(summary.path);
      const oneLiner = extractSummaryOneLiner(summary.content);
      if (info && oneLiner) {
        stream.markdown(`- **Phase ${info.phase}, Plan ${info.plan}:** ${oneLiner}\n`);
      } else if (oneLiner) {
        stream.markdown(`- ${oneLiner}\n`);
      } else {
        stream.markdown(`- ${summary.path.replace('-SUMMARY.md', '')}\n`);
      }
    }
    stream.markdown('\n');
  }

  // Current Position section
  stream.markdown('## Current Position\n\n');
  stream.markdown(`**Phase:** ${currentPhase} of ${totalPhases}`);
  if (phaseInfo) {
    stream.markdown(` (${phaseInfo.name})`);
  }
  stream.markdown('\n');

  // Get plan counts for current phase
  let phaseCounts = { plans: 0, summaries: 0, issues: 0, fixes: 0, fixSummaries: 0, planFiles: [] as string[], summaryFiles: [] as string[], issueFiles: [] as string[], fixFiles: [] as string[] };
  if (phaseDir) {
    phaseCounts = await countPhaseFiles(phaseDir.uri);
    stream.markdown(`**Plan:** ${phaseCounts.summaries} of ${phaseCounts.plans} complete\n`);
  }

  // Check for CONTEXT.md
  if (phaseDir) {
    const contextUri = vscode.Uri.joinPath(phaseDir.uri, `${currentPhase.padStart(2, '0')}-CONTEXT.md`);
    try {
      await vscode.workspace.fs.stat(contextUri);
      stream.markdown(`**Context:** Gathered\n`);
    } catch {
      // No context file
    }
  }

  // Show session continuity info if available
  if (projectContext.sessionContinuity) {
    const session = projectContext.sessionContinuity;
    if (session.lastSession) {
      stream.markdown(`**Last session:** ${session.lastSession}\n`);
    }
    if (session.stoppedAt) {
      stream.markdown(`**Stopped at:** ${session.stoppedAt}\n`);
    }
  }
  stream.markdown('\n');

  // Key Decisions section
  if (decisions.length > 0) {
    stream.markdown('## Key Decisions Made\n\n');
    for (const decision of decisions.slice(-5)) {
      stream.markdown(`- ${decision}\n`);
    }
    stream.markdown('\n');
  }

  // Open Issues section
  if (issues.length > 0) {
    stream.markdown('## Open Issues\n\n');
    for (const issue of issues.slice(0, 5)) {
      stream.markdown(`- ${issue}\n`);
    }
    if (issues.length > 5) {
      stream.markdown(`- ... and ${issues.length - 5} more\n`);
    }
    stream.markdown('\n');
  }

  // What's Next section from roadmap
  const nextPhase = getNextPhase(projectContext.roadmapMd, currentPhase);
  if (nextPhase && phaseInfo) {
    const nextPhaseInfo = parsePhaseInfo(projectContext.roadmapMd, nextPhase);
    if (nextPhaseInfo) {
      stream.markdown('## What\'s Next\n\n');
      stream.markdown(`**Phase ${nextPhase}:** ${nextPhaseInfo.name}`);
      if (nextPhaseInfo.goal) {
        stream.markdown(` - ${nextPhaseInfo.goal}`);
      }
      stream.markdown('\n\n');
    }
  }

  // ============================================
  // INTELLIGENT ROUTING
  // ============================================

  // Step 1.5: Check for UAT issues without fixes
  const issuesWithoutFix: string[] = [];
  const fixesWithoutSummary: string[] = [];

  if (phaseDir) {
    for (const issueFile of phaseCounts.issueFiles) {
      const issueBase = issueFile.replace('-ISSUES.md', '');
      // Check if any FIX file exists for this issue
      const hasFixPlan = phaseCounts.fixFiles.some(f => f.startsWith(issueBase + '-FIX'));
      if (!hasFixPlan) {
        issuesWithoutFix.push(issueFile);
      }
    }

    for (const fixFile of phaseCounts.fixFiles) {
      const fixBase = fixFile.replace('-PLAN.md', '');
      // Check if summary exists for this fix
      const files = await vscode.workspace.fs.readDirectory(phaseDir.uri);
      const hasSummary = files.some(([name]) => name === `${fixBase}-SUMMARY.md`);
      if (!hasSummary) {
        fixesWithoutSummary.push(fixFile);
      }
    }
  }

  // Check for handoff files (paused work)
  const handoffs = await findHandoffFiles(projectContext.planningUri);

  stream.markdown('---\n\n');

  // Route -1: Interrupted agent exists (highest priority)
  if (projectContext.currentAgentId) {
    stream.markdown('## Interrupted Execution Detected\n\n');
    stream.markdown(`**Agent ID:** \`${projectContext.currentAgentId}\`\n\n`);
    stream.markdown('A previous plan execution was interrupted. You can:\n\n');
    stream.markdown('1. **Resume** the interrupted execution (if context is still valid)\n');
    stream.markdown('2. **Clear** the agent ID and continue with normal routing\n\n');

    stream.button({
      command: 'hopper.chat-participant.resume-task',
      arguments: [projectContext.currentAgentId],
      title: 'Resume Task'
    });
    stream.markdown(' ');
    stream.button({
      command: 'hopper.clearAgentId',
      title: 'Clear & Continue'
    });
    stream.markdown('\n\n');

    // Also show the STATE.md "Next" suggestion if available
    if (projectContext.sessionContinuity?.next) {
      stream.markdown(`**STATE.md suggests:** ${projectContext.sessionContinuity.next}\n\n`);
    }

    return { metadata: { lastCommand: 'progress', nextAction: 'resume-task', agentId: projectContext.currentAgentId } };
  }

  // Route 0: Handoff file exists (paused work from previous session)
  if (handoffs.length > 0) {
    const handoff = handoffs[0];

    stream.markdown('## Paused Work Detected\n\n');
    stream.markdown(`**Handoff file:** \`${handoff.path}\`\n\n`);
    stream.markdown('A previous session was paused. Use `/resume-work` to restore context.\n\n');

    stream.button({
      command: 'hopper.chat-participant.resume-work',
      title: 'Resume Work'
    });

    stream.markdown('\n\n');

    stream.markdown('**Also available:**\n');
    stream.markdown('- `/execute-plan [path]` - ignore handoff and execute a specific plan\n');
    stream.markdown('- `/pause-work` - update the handoff with current context\n\n');

    return { metadata: { lastCommand: 'progress', nextAction: 'resume-work', handoffPath: handoff.path } };
  }

  // Route A: Unexecuted fix plans exist
  if (fixesWithoutSummary.length > 0 && phaseDir) {
    const nextFix = fixesWithoutSummary[0];
    const fixPath = `.planning/phases/${phaseDir.name}/${nextFix}`;

    stream.markdown('## Next Up\n\n');
    stream.markdown(`**${nextFix.replace('-PLAN.md', '')}** - Execute fix plan\n\n`);
    stream.markdown(`\`/execute-plan ${fixPath}\`\n\n`);
    stream.markdown('*Tip: Use `/clear` first for a fresh context window*\n\n');

    stream.button({
      command: 'hopper.chat-participant.execute-plan',
      arguments: [fixPath],
      title: 'Execute Fix Plan'
    });
    stream.markdown('\n');

    return { metadata: { lastCommand: 'progress', nextAction: 'execute-fix', path: fixPath } };
  }

  // Route E: UAT issues need fix plans
  if (issuesWithoutFix.length > 0 && phaseDir) {
    const issueFile = issuesWithoutFix[0];
    const planNum = issueFile.match(/(\d+(?:\.\d+)?-\d+)/)?.[1] || '';

    stream.markdown('## UAT Issues Found\n\n');
    stream.markdown(`**${issueFile}** has issues without a fix plan.\n\n`);
    stream.markdown(`\`/plan-fix ${planNum}\`\n\n`);
    stream.markdown('*Tip: Use `/clear` first for a fresh context window*\n\n');

    // Note: plan-fix command not yet implemented
    stream.markdown('**Also available:**\n');
    stream.markdown('- `/execute-plan [path]` - continue with other work first\n');
    stream.markdown('- `/verify-work` - run more UAT testing\n\n');

    return { metadata: { lastCommand: 'progress', nextAction: 'plan-fix', issue: issueFile } };
  }

  // Route A: Unexecuted plans exist
  if (phaseCounts.summaries < phaseCounts.plans && phaseDir) {
    const nextPlan = findFirstUnexecutedPlan(phaseCounts.planFiles, phaseCounts.summaryFiles);
    if (nextPlan) {
      const planPath = `.planning/phases/${phaseDir.name}/${nextPlan}`;

      // Try to read objective from plan
      let objective = '';
      try {
        const planUri = vscode.Uri.joinPath(phaseDir.uri, nextPlan);
        const planContent = Buffer.from(await vscode.workspace.fs.readFile(planUri)).toString('utf-8');
        const objMatch = planContent.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/);
        if (objMatch) {
          const firstLine = objMatch[1].split('\n').find(l => l.trim())?.trim() || '';
          objective = firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine;
        }
      } catch {
        // Can't read plan
      }

      stream.markdown('## Next Up\n\n');
      stream.markdown(`**${nextPlan.replace('-PLAN.md', '')}**`);
      if (objective) {
        stream.markdown(` - ${objective}`);
      }
      stream.markdown('\n\n');
      stream.markdown(`\`/execute-plan ${planPath}\`\n\n`);
      stream.markdown('*Tip: Use `/clear` first for a fresh context window*\n\n');

      stream.button({
        command: 'hopper.chat-participant.execute-plan',
        arguments: [planPath],
        title: 'Execute Plan'
      });
      stream.markdown('\n\n');

      stream.markdown('**Also available:**\n');
      stream.markdown('- `/verify-work` - manual acceptance testing before continuing\n\n');

      return { metadata: { lastCommand: 'progress', nextAction: 'execute-plan', path: planPath } };
    }
  }

  // Route B: Phase needs planning (no plans exist)
  if (phaseCounts.plans === 0 && phaseDir) {
    stream.markdown('## Next Up\n\n');
    stream.markdown(`**Phase ${currentPhase}: ${phaseInfo?.name || 'Unknown'}**`);
    if (phaseInfo?.goal) {
      stream.markdown(` - ${phaseInfo.goal}`);
    }
    stream.markdown('\n\n');
    stream.markdown(`\`/plan-phase ${currentPhase}\`\n\n`);
    stream.markdown('*Tip: Use `/clear` first for a fresh context window*\n\n');

    stream.button({
      command: 'hopper.chat-participant.plan-phase',
      arguments: [currentPhase],
      title: 'Plan Phase'
    });
    stream.markdown('\n\n');

    stream.markdown('**Also available:**\n');
    stream.markdown('- `/discuss-phase` - gather context first\n');
    stream.markdown('- `/research-phase` - investigate unknowns\n\n');

    return { metadata: { lastCommand: 'progress', nextAction: 'plan-phase', phase: currentPhase } };
  }

  // Phase complete - check milestone status
  if (phaseCounts.summaries === phaseCounts.plans && phaseCounts.plans > 0) {
    // Route C: More phases remain
    if (nextPhase) {
      const nextPhaseInfo = parsePhaseInfo(projectContext.roadmapMd, nextPhase);

      stream.markdown('## Phase Complete\n\n');
      stream.markdown('## Next Up\n\n');
      stream.markdown(`**Phase ${nextPhase}: ${nextPhaseInfo?.name || 'Unknown'}**`);
      if (nextPhaseInfo?.goal) {
        stream.markdown(` - ${nextPhaseInfo.goal}`);
      }
      stream.markdown('\n\n');
      stream.markdown(`\`/plan-phase ${nextPhase}\`\n\n`);
      stream.markdown('*Tip: Use `/clear` first for a fresh context window*\n\n');

      stream.button({
        command: 'hopper.chat-participant.plan-phase',
        arguments: [nextPhase],
        title: 'Plan Next Phase'
      });
      stream.markdown('\n\n');

      stream.markdown('**Also available:**\n');
      stream.markdown(`- \`/verify-work ${currentPhase}\` - user acceptance test before continuing\n`);
      stream.markdown(`- \`/discuss-phase ${nextPhase}\` - gather context first\n`);
      stream.markdown(`- \`/research-phase ${nextPhase}\` - investigate unknowns\n\n`);

      return { metadata: { lastCommand: 'progress', nextAction: 'plan-phase', phase: nextPhase } };
    }

    // Route D: Milestone complete
    stream.markdown('## Milestone Complete\n\n');
    stream.markdown(`All ${totalPhases} phases finished!\n\n`);
    stream.markdown('## Next Up\n\n');
    stream.markdown('**Complete Milestone** - archive and prepare for next\n\n');
    stream.markdown('`/complete-milestone`\n\n');
    stream.markdown('*Tip: Use `/clear` first for a fresh context window*\n\n');

    stream.markdown('**Also available:**\n');
    stream.markdown('- `/verify-work` - user acceptance test before completing milestone\n\n');

    return { metadata: { lastCommand: 'progress', nextAction: 'complete-milestone' } };
  }

  // Fallback - use STATE.md "Next" suggestion if available
  if (projectContext.sessionContinuity?.next) {
    stream.markdown('## Suggested Next Action\n\n');
    stream.markdown(`From STATE.md: **${projectContext.sessionContinuity.next}**\n\n`);
    stream.markdown('*This suggestion was recorded from the last session.*\n\n');
    return { metadata: { lastCommand: 'progress', nextAction: 'state-suggestion', suggestion: projectContext.sessionContinuity.next } };
  }

  stream.markdown('## Status\n\n');
  stream.markdown('Unable to determine next action. Check your `.planning` directory structure.\n\n');

  return { metadata: { lastCommand: 'progress' } };
}
