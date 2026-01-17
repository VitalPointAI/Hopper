import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import { parsePlanMd, ExecutionPlan, ExecutionTask } from '../executor';

/**
 * Build a prompt for executing a single task (agent mode)
 */
function buildTaskPrompt(task: ExecutionTask, planContext: string, supportsTools: boolean): string {
  const filesLine = task.files && task.files.length > 0
    ? `**Files to modify:** ${task.files.join(', ')}\n\n`
    : '';

  const agentInstruction = supportsTools
    ? `Execute this task by making the necessary file changes. Create or modify files as needed. Do not just describe what to do - actually implement it.`
    : `Provide the complete implementation for this task. Show the full file contents that should be created or modified.`;

  return `You are an AI assistant executing a task from a Hopper plan.

**Task:** ${task.name}

${filesLine}**Action to perform:**
${task.action}

**Done when:**
${task.done}

**Verification:**
${task.verify}

**Project context:**
${planContext}

${agentInstruction}`;
}

/**
 * Parse current phase info from STATE.md
 * Returns phase number, directory name, and current plan number
 */
interface CurrentPhaseInfo {
  phaseNumber: number;
  phaseName: string;
  phaseDir: string;
}

/**
 * Extract current phase information from STATE.md content
 */
function parseCurrentPhaseFromState(stateMd: string, roadmapMd?: string): CurrentPhaseInfo | null {
  // Look for "Phase: X.Y (Phase Name)" or similar patterns
  // Common pattern: "Phase: 1.5.3 (Rebrand to Hopper)"
  const phaseMatch = stateMd.match(/Phase:\s*(\d+(?:\.\d+)*)\s*(?:\(([^)]+)\))?/);
  if (!phaseMatch) {
    return null;
  }

  const phaseNumber = parseFloat(phaseMatch[1]);
  let phaseName = phaseMatch[2]?.trim() || '';

  // If no name from STATE.md, try to get from ROADMAP.md
  if (!phaseName && roadmapMd) {
    // Match phase in roadmap: "**Phase X: Name**"
    const roadmapPattern = new RegExp(`\\*\\*Phase\\s+${phaseMatch[1]}:?\\s*([^*]+)\\*\\*`, 'i');
    const roadmapMatch = roadmapMd.match(roadmapPattern);
    if (roadmapMatch) {
      phaseName = roadmapMatch[1].trim();
    }
  }

  // Generate directory name from phase number and name
  const phaseNumStr = phaseMatch[1].replace(/\./g, '.');
  const nameSlug = phaseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const phaseDir = `${phaseNumStr.padStart(2, '0')}-${nameSlug}`;

  return {
    phaseNumber,
    phaseName,
    phaseDir
  };
}

/**
 * Find the latest unexecuted PLAN.md in a phase directory
 * A plan is unexecuted if it doesn't have a matching SUMMARY.md
 */
async function findLatestUnexecutedPlan(
  workspaceUri: vscode.Uri,
  phaseDir: string
): Promise<vscode.Uri | null> {
  const phasePath = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', phaseDir);

  try {
    const entries = await vscode.workspace.fs.readDirectory(phasePath);

    // Find all PLAN.md files
    const planFiles = entries
      .filter(([name]) => name.endsWith('-PLAN.md'))
      .map(([name]) => name)
      .sort();

    // For each plan, check if there's a matching SUMMARY.md
    for (const planFile of planFiles) {
      const summaryFile = planFile.replace('-PLAN.md', '-SUMMARY.md');
      const hasSummary = entries.some(([name]) => name === summaryFile);

      if (!hasSummary) {
        // Found an unexecuted plan
        return vscode.Uri.joinPath(phasePath, planFile);
      }
    }

    // All plans have summaries
    return null;
  } catch {
    // Phase directory doesn't exist or can't be read
    return null;
  }
}

/**
 * Extract phase number from plan phase identifier
 * e.g., "04-execution-commands" -> 4, "01.5.3-rebrand" -> 1.53
 */
function extractPhaseNumber(phase: string): number {
  const match = phase.match(/^(\d+(?:\.\d+)*)/);
  if (match) {
    return parseFloat(match[1]);
  }
  return 1;
}

/**
 * Resolve a short plan identifier to a full file URI.
 * Handles formats: 04-01, 04-01-PLAN, 04-01-FIX-PLAN, 04-01-PLAN.md
 * All resolve to the matching PLAN.md in .planning/phases/
 * Full paths (containing slash) are returned as-is.
 */
async function resolvePlanPath(
  workspaceUri: vscode.Uri,
  pathArg: string
): Promise<{ uri: vscode.Uri | null; availablePlans?: string[] }> {
  // If it's already a full path (contains '/'), use as-is
  if (pathArg.includes('/')) {
    if (pathArg.startsWith('/') || pathArg.includes(':')) {
      return { uri: vscode.Uri.file(pathArg) };
    }
    return { uri: vscode.Uri.joinPath(workspaceUri, pathArg) };
  }

  // Short identifier: normalize to plan filename
  let normalizedName = pathArg;

  // Strip .md if present
  if (normalizedName.endsWith('.md')) {
    normalizedName = normalizedName.slice(0, -3);
  }

  // Check if it already has -PLAN suffix (including -FIX-PLAN, etc.)
  if (!normalizedName.toUpperCase().includes('-PLAN')) {
    normalizedName = normalizedName + '-PLAN';
  }

  // Search for matching file in .planning/phases/*/
  const pattern = new vscode.RelativePattern(
    workspaceUri,
    `.planning/phases/*/${normalizedName}.md`
  );

  try {
    const files = await vscode.workspace.findFiles(pattern, null, 1);

    if (files.length > 0) {
      return { uri: files[0] };
    }

    // Not found - gather available plans to show in error message
    const allPlansPattern = new vscode.RelativePattern(
      workspaceUri,
      '.planning/phases/*/*-PLAN.md'
    );
    const allPlans = await vscode.workspace.findFiles(allPlansPattern, null, 20);
    const availablePlans = allPlans.map(f => {
      const parts = f.fsPath.split('/');
      return parts[parts.length - 1].replace('.md', '');
    }).sort();

    return { uri: null, availablePlans };
  } catch {
    return { uri: null };
  }
}

/**
 * Handle /execute-plan command
 *
 * Executes a PLAN.md file by:
 * 1. Parsing the plan path argument or auto-detecting from STATE.md
 * 2. Checking license for Phase 2+ plans
 * 3. Loading and parsing the PLAN.md file
 * 4. Executing each task sequentially via LLM
 * 5. Reporting progress and completion status
 */
export async function handleExecutePlan(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext, licenseValidator } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/execute-plan` again.\n');
    return { metadata: { lastCommand: 'execute-plan' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if planning exists
  if (!projectContext.hasPlanning) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('Cannot execute plan without a Hopper project.\n\n');
    stream.markdown('Use **/new-project** to initialize a project first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.new-project',
      title: 'Initialize Project'
    });
    return { metadata: { lastCommand: 'execute-plan' } };
  }

  // Check for ROADMAP.md
  if (!projectContext.roadmapMd) {
    stream.markdown('## No Roadmap Found\n\n');
    stream.markdown('Cannot execute plans without ROADMAP.md.\n\n');
    stream.markdown('Use **/create-roadmap** to create your roadmap first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'execute-plan' } };
  }

  // Parse plan path from prompt or auto-detect
  stream.progress('Loading plan...');
  const promptText = request.prompt.trim();
  let planUri: vscode.Uri | undefined;

  if (promptText) {
    // User provided a path - resolve it (handles short identifiers like "04-01")
    const resolved = await resolvePlanPath(workspaceUri, promptText);

    if (resolved.uri) {
      planUri = resolved.uri;
    } else {
      // Plan not found - show helpful error
      stream.markdown('## Plan Not Found\n\n');
      stream.markdown(`Could not find plan matching: **${promptText}**\n\n`);

      if (resolved.availablePlans && resolved.availablePlans.length > 0) {
        stream.markdown('**Available plans:**\n');
        for (const plan of resolved.availablePlans.slice(0, 10)) {
          stream.markdown(`- \`${plan}\`\n`);
        }
        if (resolved.availablePlans.length > 10) {
          stream.markdown(`- ... and ${resolved.availablePlans.length - 10} more\n`);
        }
        stream.markdown('\n');
      }

      stream.markdown('**Usage examples:**\n');
      stream.markdown('- `/execute-plan 04-01` - short identifier\n');
      stream.markdown('- `/execute-plan 04-01-PLAN` - with suffix\n');
      stream.markdown('- `/execute-plan .planning/phases/04-name/04-01-PLAN.md` - full path\n\n');

      stream.button({
        command: 'hopper.chat-participant.plan-phase',
        title: 'Create a Plan'
      });

      return { metadata: { lastCommand: 'execute-plan' } };
    }
  } else {
    // Auto-detect plan from STATE.md
    stream.progress('Auto-detecting current plan...');

    if (!projectContext.stateMd) {
      stream.markdown('## No State Found\n\n');
      stream.markdown('Cannot auto-detect plan without STATE.md.\n\n');
      stream.markdown('**Options:**\n');
      stream.markdown('- Provide an explicit path: `/execute-plan .planning/phases/XX-name/XX-YY-PLAN.md`\n');
      stream.markdown('- Create a roadmap to generate STATE.md\n\n');
      stream.button({
        command: 'hopper.chat-participant.create-roadmap',
        title: 'Create Roadmap'
      });
      return { metadata: { lastCommand: 'execute-plan' } };
    }

    const phaseInfo = parseCurrentPhaseFromState(projectContext.stateMd, projectContext.roadmapMd);

    if (!phaseInfo) {
      stream.markdown('## Unable to Detect Phase\n\n');
      stream.markdown('Could not parse current phase from STATE.md.\n\n');
      stream.markdown('**Provide an explicit path:**\n');
      stream.markdown('`/execute-plan .planning/phases/XX-name/XX-YY-PLAN.md`\n\n');
      return { metadata: { lastCommand: 'execute-plan' } };
    }

    // Find unexecuted plan in current phase directory
    const detectedPlan = await findLatestUnexecutedPlan(workspaceUri, phaseInfo.phaseDir);

    if (!detectedPlan) {
      stream.markdown('## No Plan Found\n\n');
      stream.markdown(`No unexecuted plans found for Phase ${phaseInfo.phaseNumber}${phaseInfo.phaseName ? ` (${phaseInfo.phaseName})` : ''}.\n\n`);
      stream.markdown('**Options:**\n');
      stream.markdown('- Create a plan with `/plan-phase`\n');
      stream.markdown('- Provide an explicit path: `/execute-plan <path>`\n\n');
      stream.button({
        command: 'hopper.chat-participant.plan-phase',
        title: 'Plan Phase'
      });
      return { metadata: { lastCommand: 'execute-plan' } };
    }

    planUri = detectedPlan;
    stream.markdown(`**Auto-detected:** ${planUri.fsPath.replace(workspaceUri.fsPath, '.')}\n\n`);
  }

  // Try to load the plan file
  let planContent: string;
  try {
    const contentBytes = await vscode.workspace.fs.readFile(planUri);
    planContent = Buffer.from(contentBytes).toString('utf-8');
  } catch (error) {
    stream.markdown('## Plan Not Found\n\n');
    stream.markdown(`Could not read plan file: ${planUri.fsPath}\n\n`);
    stream.markdown('**Check that:**\n');
    stream.markdown('- The path is correct\n');
    stream.markdown('- The file exists\n\n');

    stream.button({
      command: 'hopper.chat-participant.plan-phase',
      title: 'Create a Plan'
    });

    return { metadata: { lastCommand: 'execute-plan' } };
  }

  // Parse the plan
  stream.progress('Parsing tasks...');
  const plan = parsePlanMd(planContent);

  if (!plan) {
    stream.markdown('## Unable to Parse Plan\n\n');
    stream.markdown('The plan file could not be parsed.\n\n');
    stream.markdown('**Expected format:**\n');
    stream.markdown('- YAML frontmatter with `phase:` and `plan:`\n');
    stream.markdown('- `<objective>` section\n');
    stream.markdown('- `<tasks>` section with `<task type="...">` elements\n\n');

    stream.reference(planUri);
    stream.markdown('\n\n');

    stream.button({
      command: 'vscode.open',
      arguments: [planUri],
      title: 'Open Plan File'
    });

    return { metadata: { lastCommand: 'execute-plan' } };
  }

  // License gating: Phase 2+ requires Pro license
  const phaseNumber = extractPhaseNumber(plan.phase);
  if (phaseNumber >= 2) {
    stream.progress('Checking license...');

    // Ensure auth manager is initialized
    await licenseValidator.ensureInitialized();

    // Check authentication first
    if (!licenseValidator.isAuthenticated()) {
      stream.markdown('## Pro License Required\n\n');
      stream.markdown(`Executing **Phase ${phaseNumber}** plans requires a Hopper Pro license.\n\n`);
      stream.markdown('**Already have a license?** Connect to verify it.\n\n');
      stream.button({
        command: 'hopper.connect',
        title: 'Connect'
      });
      stream.markdown('\n**Need a license?** Upgrade to unlock Phase 2+ features.\n\n');
      stream.button({
        command: 'hopper.showUpgradeModal',
        title: 'Get Pro License'
      });
      return { metadata: { lastCommand: 'execute-plan' } };
    }

    // Check license status
    const licenseStatus = await licenseValidator.checkLicense();
    if (!licenseStatus?.isLicensed) {
      stream.markdown('## Pro License Required\n\n');
      stream.markdown(`Executing **Phase ${phaseNumber}** plans requires a Pro license.\n\n`);
      stream.markdown('Phase 1 plans are free. Upgrade to Pro to unlock:\n');
      stream.markdown('- Execution for Phase 2+ plans\n');
      stream.markdown('- Full session management features\n\n');
      stream.button({
        command: 'hopper.showUpgradeModal',
        title: 'Upgrade to Pro'
      });
      return { metadata: { lastCommand: 'execute-plan' } };
    }
  }

  // Show plan overview
  stream.markdown(`## Executing Plan\n\n`);
  stream.markdown(`**Phase:** ${plan.phase}\n`);
  stream.markdown(`**Plan:** ${plan.planNumber}\n`);
  stream.markdown(`**Objective:** ${plan.objective}\n\n`);
  stream.markdown(`**Tasks:** ${plan.tasks.length}\n\n`);

  stream.reference(planUri);
  stream.markdown('\n\n---\n\n');

  // Build context for tasks
  const contextParts: string[] = [];
  if (projectContext.projectMd) {
    contextParts.push('## PROJECT.md\n\n' + projectContext.projectMd.slice(0, 1000));
  }
  if (projectContext.stateMd) {
    contextParts.push('\n\n## STATE.md\n\n' + projectContext.stateMd.slice(0, 500));
  }
  const planContext = contextParts.join('');

  // Track execution results
  const results: { taskId: number; success: boolean; name: string; files?: string[] }[] = [];

  // Check if model supports tool calling once before the loop
  // This ensures consistent mode indicator throughout execution
  // @ts-ignore - supportsToolCalling may not be in all VSCode versions
  const supportsTools = Boolean(request.model.supportsToolCalling);
  const usedAgentMode = supportsTools;

  // Execute tasks sequentially
  for (let i = 0; i < plan.tasks.length; i++) {
    // Check for cancellation before each task
    if (token.isCancellationRequested) {
      stream.markdown('\n\n---\n\n');
      stream.markdown('## Execution Cancelled\n\n');
      stream.markdown(`Completed ${results.filter(r => r.success).length} of ${plan.tasks.length} tasks before cancellation.\n\n`);

      for (const result of results) {
        stream.markdown(`- **Task ${result.taskId}:** ${result.name} - ${result.success ? 'Completed' : 'Failed'}\n`);
      }

      return { metadata: { lastCommand: 'execute-plan' } };
    }

    const task = plan.tasks[i];
    stream.progress(`Executing task ${i + 1} of ${plan.tasks.length}...`);

    stream.markdown(`### Task ${task.id}/${plan.tasks.length}: ${task.name}\n\n`);

    if (task.files && task.files.length > 0) {
      stream.markdown(`**Files:** ${task.files.join(', ')}\n\n`);
    }

    try {
      // Build prompt for this task
      const prompt = buildTaskPrompt(task, planContext, supportsTools);

      // Send to LLM with tool options if supported
      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(prompt)
      ];

      // Request options - enable tools if available
      const requestOptions: vscode.LanguageModelChatRequestOptions = {};
      if (supportsTools) {
        // Empty tools array enables built-in VSCode tools (file editing, terminal, etc.)
        // @ts-ignore - tools may not be in all VSCode versions
        requestOptions.tools = [];
      }

      const response = await request.model.sendRequest(messages, requestOptions, token);

      // Stream the response
      if (supportsTools) {
        stream.markdown('**Agent executing...**\n\n');
      } else {
        stream.markdown('**Implementation (apply manually):**\n\n');
      }

      for await (const fragment of response.text) {
        if (token.isCancellationRequested) {
          break;
        }
        stream.markdown(fragment);
      }

      stream.markdown('\n\n');

      // Show completion status
      if (supportsTools) {
        stream.markdown(`**Status:** Executed via agent mode\n\n`);
      } else {
        stream.markdown(`**Done when:** ${task.done}\n\n`);
        stream.markdown(`**Verify:** ${task.verify}\n\n`);
      }

      stream.markdown('---\n\n');

      // Track result with files info
      results.push({ taskId: task.id, success: true, name: task.name, files: task.files });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      stream.markdown(`**Error executing task:** ${errorMessage}\n\n`);

      if (error instanceof vscode.LanguageModelError) {
        stream.markdown('Model error occurred. Try again or check your model connection.\n\n');
        stream.button({
          command: 'hopper.chat-participant.execute-plan',
          title: 'Retry'
        });
      }

      stream.markdown('---\n\n');

      results.push({ taskId: task.id, success: false, name: task.name });
    }
  }

  // Show completion summary
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  const skippedCount = plan.tasks.length - results.length;

  stream.markdown('## Execution Complete\n\n');
  stream.markdown(`**Mode:** ${usedAgentMode ? 'Agent (file modifications)' : 'Suggestions (manual apply)'}\n`);
  stream.markdown(`**Completed:** ${successCount}/${plan.tasks.length} tasks\n`);
  if (failedCount > 0) {
    stream.markdown(`**Failed:** ${failedCount} tasks\n`);
  }
  if (skippedCount > 0) {
    stream.markdown(`**Skipped:** ${skippedCount} tasks\n`);
  }
  stream.markdown('\n');

  // Show task summary with files
  stream.markdown('### Task Summary\n\n');
  for (const result of results) {
    const icon = result.success ? '✓' : '✗';
    stream.markdown(`${icon} **Task ${result.taskId}:** ${result.name}\n`);
    if (result.files && result.files.length > 0) {
      for (const file of result.files) {
        stream.markdown(`   - \`${file}\`\n`);
      }
    }
  }

  stream.markdown('\n### Next Steps\n\n');

  if (usedAgentMode) {
    // Agent mode: files were modified, focus on review
    stream.markdown('1. **Review changes** made by the agent\n');
    stream.button({
      command: 'git.viewChanges',
      title: 'View Git Changes'
    });
    stream.markdown('\n2. **Run verification** from the plan:\n');
  } else {
    // Manual mode: user needs to apply changes
    stream.markdown('1. **Apply the changes** shown above to your codebase\n');
    stream.markdown('2. **Run verification** from the plan:\n');
  }

  if (plan.verification.length > 0) {
    for (const v of plan.verification) {
      stream.markdown(`   - [ ] ${v}\n`);
    }
  }

  stream.markdown('\n');
  if (usedAgentMode) {
    stream.markdown('3. **Commit** if verification passes\n');
  } else {
    stream.markdown('3. **Test** your changes\n');
    stream.markdown('4. **Commit** when ready\n');
  }

  stream.markdown('\n');
  stream.reference(planUri);

  return {
    metadata: {
      lastCommand: 'execute-plan',
      phaseNumber: phaseNumber
    }
  };
}
