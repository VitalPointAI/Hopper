import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import {
  PlanConfig,
  TaskConfig,
  savePlan,
  getNextPlanNumber
} from '../generators';
import { updateLastActivityAndSession } from '../state';

/**
 * System prompt for analyzing phase scope and determining plan breakdown
 */
const PHASE_ANALYSIS_PROMPT = `You are helping break down a software project phase into discrete, manageable plans.

Analyze the phase goal and project context to determine how many separate plans are needed.
Each plan should contain 2-3 closely related tasks that can be completed in one focused session.

Output your response as JSON with this exact structure:
{
  "plans": [
    {
      "title": "Short descriptive title for this plan",
      "items": ["First work item", "Second work item", "Third work item (optional)"]
    }
  ],
  "reasoning": "Brief explanation of why you divided the work this way"
}

Guidelines:
- Each plan should have 2-3 work items (tasks)
- Group related work together (e.g., all API work in one plan, all UI work in another)
- Order plans by dependency (foundational work first)
- A typical phase needs 2-4 plans
- Simple phases may need only 1 plan
- Complex phases may need up to 6 plans
- Each work item should be a concrete, actionable piece of work

Always return valid JSON.`;

/**
 * System prompt for generating plan tasks from phase requirements
 */
const TASK_GENERATION_PROMPT = `You are helping create an execution plan for a software project phase.

Based on the project context, phase goal, and the specific plan items provided, generate tasks that cover the work items listed.

Output your response as JSON with this exact structure:
{
  "objective": "What this plan accomplishes (1-2 sentences)",
  "purpose": "Why this matters for the project",
  "output": "What artifacts will be created",
  "tasks": [
    {
      "name": "Action-oriented task name",
      "type": "auto",
      "files": ["path/to/file.ts", "another/file.ts"],
      "action": "Detailed instructions for what to do, how to do it, and what to avoid",
      "verify": "Specific command or check to prove task completed (e.g., npm test, curl endpoint)",
      "done": "Measurable acceptance criteria - specific conditions for completion"
    }
  ],
  "verification": [
    "npm run build succeeds",
    "Tests pass",
    "Specific behavior works"
  ],
  "successCriteria": [
    "All tasks completed",
    "All verification checks pass",
    "Specific outcome achieved"
  ]
}

Guidelines:
- Generate ONE task for EACH plan item provided
- If 3 plan items are provided, generate exactly 3 tasks
- If no specific plan items are listed, generate 3-5 tasks based on the phase goal
- Use "auto" type for all tasks unless visual verification or decision is needed
- Use "checkpoint:human-verify" sparingly - only for visual/interactive verification
- Use "checkpoint:decision" only when user choice affects implementation
- File paths must be specific (src/api/auth.ts, not "auth file")
- Actions must be detailed with what, how, and what to avoid
- Verify must be executable (npm test, curl, etc.)
- Done criteria must be measurable

Always return valid JSON.`;

/**
 * Maximum tasks per plan - plans are split into batches of this size
 */
const MAX_TASKS_PER_PLAN = 3;

/**
 * Parse phase information from ROADMAP.md
 */
interface ParsedPhase {
  number: number;
  name: string;
  goal: string;
  dirName: string;
  dependsOn?: number;
  planItems: string[];  // The specific plan items listed under this phase
}

/**
 * Extract phases from ROADMAP.md content
 */
function parseRoadmapPhases(roadmapMd: string): ParsedPhase[] {
  const phases: ParsedPhase[] = [];

  // Match phase list items like "- [ ] **Phase 1: Foundation** - Goal here"
  // or "- [x] **Phase 1: Foundation** - Goal here"
  const phasePattern = /-\s*\[[x\s]\]\s*\*\*Phase\s+(\d+(?:\.\d+)?):?\s*([^*]+)\*\*\s*[-–]\s*(.+)/gi;
  let match;

  while ((match = phasePattern.exec(roadmapMd)) !== null) {
    const numStr = match[1];
    const number = parseFloat(numStr);
    const name = match[2].trim();
    const goal = match[3].trim();

    // Generate directory name
    const dirName = `${numStr.padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

    // Extract plan items from Phase Details section
    const planItems = extractPlanItemsForPhase(roadmapMd, number);

    phases.push({
      number,
      name,
      goal,
      dirName,
      dependsOn: phases.length > 0 ? phases[phases.length - 1].number : undefined,
      planItems
    });
  }

  return phases;
}

/**
 * Extract plan items for a specific phase from the Phase Details section
 */
function extractPlanItemsForPhase(roadmapMd: string, phaseNumber: number): string[] {
  const planItems: string[] = [];

  // Find the Phase Details section for this phase
  // Look for "### Phase X:" or "### Phase X.Y:" header
  const phaseNumStr = phaseNumber.toString();
  const phaseHeaderPattern = new RegExp(
    `###\\s*Phase\\s+${phaseNumStr.replace('.', '\\.')}[:\\s]`,
    'i'
  );

  const headerMatch = roadmapMd.match(phaseHeaderPattern);
  if (!headerMatch || headerMatch.index === undefined) {
    return planItems;
  }

  // Get content from this phase header to the next phase header or end
  const startIndex = headerMatch.index;
  const nextHeaderMatch = roadmapMd.slice(startIndex + 1).match(/###\s*Phase\s+\d/i);
  const endIndex = nextHeaderMatch && nextHeaderMatch.index !== undefined
    ? startIndex + 1 + nextHeaderMatch.index
    : roadmapMd.length;

  const phaseSection = roadmapMd.slice(startIndex, endIndex);

  // Find the "Plans:" section and extract items
  // Match lines like "- [x] 01-01: Extension scaffolding" or "- [ ] 01.5-01: License contract"
  const planItemPattern = /-\s*\[[x\s]\]\s*[\d.]+[-–]\d+:\s*(.+)/gi;
  let itemMatch;

  while ((itemMatch = planItemPattern.exec(phaseSection)) !== null) {
    planItems.push(itemMatch[1].trim());
  }

  return planItems;
}

/**
 * Extract JSON from response, handling various markdown formats
 */
function extractJsonFromResponse(response: string): string {
  // Try to find JSON block in markdown
  const jsonBlockMatch = response.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }

  // Try generic code block
  const codeBlockMatch = response.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find JSON object directly
  const jsonObjectMatch = response.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    return jsonObjectMatch[0];
  }

  return response.trim();
}

/**
 * Parse phase analysis response
 */
interface ParsedPhaseAnalysis {
  plans: Array<{
    title: string;
    items: string[];
  }>;
  reasoning: string;
}

function parsePhaseAnalysis(response: string): ParsedPhaseAnalysis | null {
  try {
    const jsonStr = extractJsonFromResponse(response);
    const parsed = JSON.parse(jsonStr);

    // Validate structure
    if (!parsed.plans || !Array.isArray(parsed.plans) || parsed.plans.length === 0) {
      return null;
    }

    // Validate each plan has items
    for (const plan of parsed.plans) {
      if (!plan.items || !Array.isArray(plan.items) || plan.items.length === 0) {
        return null;
      }
    }

    return {
      plans: parsed.plans.map((p: { title?: string; items: string[] }) => ({
        title: p.title || 'Untitled plan',
        items: p.items
      })),
      reasoning: parsed.reasoning || ''
    };
  } catch {
    return null;
  }
}

/**
 * Parse LLM response into plan configuration
 */
interface ParsedPlanResponse {
  objective: string;
  purpose: string;
  output: string;
  tasks: TaskConfig[];
  verification: string[];
  successCriteria: string[];
}

function parsePlanResponse(response: string): ParsedPlanResponse | null {
  try {
    const jsonStr = extractJsonFromResponse(response);
    const parsed = JSON.parse(jsonStr);

    // Validate structure
    if (!parsed.objective || !parsed.tasks || !Array.isArray(parsed.tasks)) {
      return null;
    }

    // Validate and clean tasks
    const tasks: TaskConfig[] = parsed.tasks.map((t: {
      name?: string;
      type?: string;
      files?: string[];
      action?: string;
      verify?: string;
      done?: string;
    }) => ({
      name: t.name || 'Unnamed task',
      type: (t.type === 'checkpoint:human-verify' || t.type === 'checkpoint:decision')
        ? t.type
        : 'auto',
      files: Array.isArray(t.files) ? t.files : undefined,
      action: t.action || 'Implement the task',
      verify: t.verify || 'Verify implementation',
      done: t.done || 'Task completed'
    }));

    return {
      objective: parsed.objective,
      purpose: parsed.purpose || 'Advance the project',
      output: parsed.output || 'Working implementation',
      tasks,
      verification: Array.isArray(parsed.verification) ? parsed.verification : ['Implementation complete'],
      successCriteria: Array.isArray(parsed.successCriteria) ? parsed.successCriteria : ['All tasks completed']
    };
  } catch {
    return null;
  }
}

/**
 * Check if dependent phases are complete based on STATE.md
 */
function checkDependenciesComplete(stateMd: string | undefined, targetPhaseNum: number): { complete: boolean; currentPhase: number } {
  if (!stateMd) {
    return { complete: false, currentPhase: 0 };
  }

  // Look for "Phase: X of Y" pattern
  const match = stateMd.match(/Phase:\s*(\d+(?:\.\d+)?)\s*of\s*\d+/);
  if (!match) {
    return { complete: false, currentPhase: 0 };
  }

  const currentPhase = parseFloat(match[1]);
  // Dependencies complete if current phase >= target phase - 1
  // (i.e., if we're at phase 2 or beyond, phase 1 is complete)
  return {
    complete: currentPhase >= targetPhaseNum - 1,
    currentPhase
  };
}

/**
 * Handle /plan-phase command
 *
 * Creates a PLAN.md file for a specific phase by:
 * 1. Parsing phase number from prompt
 * 2. Validating phase exists in ROADMAP.md
 * 3. Checking dependencies (warn but don't block)
 * 4. Using LLM to generate tasks
 * 5. Creating PLAN.md in phase directory
 */
export async function handlePlanPhase(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext, licenseValidator } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/plan-phase` again.\n');
    return { metadata: { lastCommand: 'plan-phase' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Roadmap Found\n\n');
    stream.markdown('Cannot create plan without ROADMAP.md.\n\n');
    stream.markdown('Use **/create-roadmap** to create your roadmap first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'plan-phase' } };
  }

  // Parse phases from roadmap
  stream.progress('Reading roadmap...');
  const phases = parseRoadmapPhases(projectContext.roadmapMd);
  if (phases.length === 0) {
    stream.markdown('## Unable to Parse Phases\n\n');
    stream.markdown('Could not find phases in ROADMAP.md.\n\n');
    stream.markdown('Ensure your ROADMAP.md has phases in the format:\n');
    stream.markdown('`- [ ] **Phase 1: Name** - Goal`\n\n');

    if (projectContext.planningUri) {
      const roadmapUri = vscode.Uri.joinPath(projectContext.planningUri, 'ROADMAP.md');
      stream.button({
        command: 'vscode.open',
        arguments: [roadmapUri],
        title: 'Edit ROADMAP.md'
      });
    }

    return { metadata: { lastCommand: 'plan-phase' } };
  }

  // Parse phase number from prompt (may include keywords like "additional")
  const promptText = request.prompt.trim();
  const promptParts = promptText.split(/\s+/);
  const phaseArg = promptParts[0];
  let targetPhaseNum: number | undefined;

  if (phaseArg) {
    // Check for invalid input (non-numeric first argument)
    if (!/^[\d.]+$/.test(phaseArg)) {
      stream.markdown('## Invalid Argument\n\n');
      stream.markdown(`"${phaseArg}" is not a valid phase number.\n\n`);
      stream.markdown('**Usage:** `/plan-phase <phase-number> [additional]`\n\n');
      stream.markdown('**Examples:**\n');
      stream.markdown('- `/plan-phase 1` - Plan for Phase 1\n');
      stream.markdown('- `/plan-phase 2.1` - Plan for inserted Phase 2.1\n');
      stream.markdown('- `/plan-phase 1 additional` - Create additional plan for Phase 1\n\n');
      stream.markdown('**Available phases:**\n');
      for (const p of phases) {
        stream.markdown(`- Phase ${p.number}: ${p.name}\n`);
      }
      stream.markdown('\n');
      return { metadata: { lastCommand: 'plan-phase' } };
    }

    // Try to parse as number (supports decimal like 1.5)
    const parsed = parseFloat(phaseArg);
    if (!isNaN(parsed)) {
      targetPhaseNum = parsed;
    }
  }

  // If no phase specified, show usage help
  if (targetPhaseNum === undefined) {
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/plan-phase <phase-number> [additional]`**\n\n');
    stream.markdown('Create a detailed execution plan for a specific phase.\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/plan-phase 1` - Plan for Phase 1\n');
    stream.markdown('- `/plan-phase 2` - Plan for Phase 2\n');
    stream.markdown('- `/plan-phase 1.5` - Plan for inserted Phase 1.5\n');
    stream.markdown('- `/plan-phase 1 additional` - Create additional plan for Phase 1\n\n');
    stream.markdown('**Available phases:**\n');
    for (const p of phases) {
      stream.markdown(`- Phase ${p.number}: ${p.name}\n`);
    }
    stream.markdown('\n');
    return { metadata: { lastCommand: 'plan-phase' } };
  }

  // Find target phase
  const targetPhase = phases.find(p => p.number === targetPhaseNum);
  if (!targetPhase) {
    stream.markdown('## Invalid Phase Number\n\n');
    stream.markdown(`Phase ${targetPhaseNum} does not exist in ROADMAP.md.\n\n`);
    stream.markdown('**Available phases:**\n');
    for (const p of phases) {
      stream.markdown(`- Phase ${p.number}: ${p.name}\n`);
    }
    stream.markdown('\n');
    return { metadata: { lastCommand: 'plan-phase' } };
  }

  // Check license - Phase 1 is free, Phase 2+ requires Pro license
  if (targetPhaseNum >= 2) {
    // Ensure auth manager is initialized before checking
    await licenseValidator.ensureInitialized();

    // Debug: Log auth state
    const isAuth = licenseValidator.isAuthenticated();
    const session = licenseValidator.getSession();
    console.log('[planPhase] Auth check - isAuthenticated:', isAuth, 'session:', session ? `${session.userId} (${session.authType})` : 'null');

    // First check authentication
    if (!isAuth) {
      stream.markdown('## Pro License Required\n\n');
      stream.markdown(`Planning **Phase ${targetPhaseNum}** requires a Hopper Pro license.\n\n`);
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
      return { metadata: { lastCommand: 'plan-phase' } };
    }

    // Then check license status
    const licenseStatus = await licenseValidator.checkLicense();
    if (!licenseStatus?.isLicensed) {
      stream.markdown('## Pro License Required\n\n');
      stream.markdown(`Planning **Phase ${targetPhaseNum}** requires a Pro license.\n\n`);
      stream.markdown('Phase 1 is free. Upgrade to Pro to unlock:\n');
      stream.markdown('- Planning and execution for Phase 2+\n');
      stream.markdown('- Full session management features\n\n');
      stream.button({
        command: 'hopper.showUpgradeModal',
        title: 'Upgrade to Pro'
      });
      return { metadata: { lastCommand: 'plan-phase' } };
    }
  }

  // Check if dependent phases are complete (warning only, non-blocking)
  if (targetPhase.dependsOn) {
    const depCheck = checkDependenciesComplete(projectContext.stateMd, targetPhaseNum!);
    if (!depCheck.complete && depCheck.currentPhase < targetPhase.dependsOn) {
      stream.markdown(`**Warning:** Planning Phase ${targetPhaseNum} ahead of schedule.\n`);
      stream.markdown(`Phase ${targetPhase.dependsOn} (${phases.find(p => p.number === targetPhase.dependsOn)?.name || 'dependency'}) may not be complete.\n\n`);
    }
  }

  // Get next plan number for this phase (will be used after we determine how many plans needed)
  stream.progress('Checking existing plans...');
  const existingPlanCount = await getNextPlanNumber(workspaceUri, targetPhase.dirName, targetPhase.number) - 1;

  stream.progress('Reading project context...');

  // Build base context for LLM (without plan items - those are added per batch)
  const baseContextParts: string[] = [];

  if (projectContext.projectMd) {
    baseContextParts.push('## PROJECT.md\n\n' + projectContext.projectMd);
  }

  baseContextParts.push(`\n\n## Target Phase\n\n**Phase ${targetPhase.number}: ${targetPhase.name}**\n\nGoal: ${targetPhase.goal}`);

  if (targetPhase.dependsOn) {
    const depPhase = phases.find(p => p.number === targetPhase.dependsOn);
    if (depPhase) {
      baseContextParts.push(`\n\nDepends on Phase ${depPhase.number}: ${depPhase.name}`);
    }
  }

  if (projectContext.stateMd) {
    baseContextParts.push('\n\n## Current State\n\n' + projectContext.stateMd);
  }

  // Check for RESEARCH.md (from /research-phase) - comprehensive ecosystem research with live docs
  // Extract phase number prefix from dirName (e.g., "08" from "08-fix-improperly-built-functions")
  const phaseNumPrefix = targetPhase.dirName.split('-')[0];
  const researchFileName = `${phaseNumPrefix}-RESEARCH.md`;
  const researchUri = vscode.Uri.joinPath(
    workspaceUri,
    '.planning',
    'phases',
    targetPhase.dirName,
    researchFileName
  );

  let hasResearch = false;
  try {
    const researchBytes = await vscode.workspace.fs.readFile(researchUri);
    const researchContent = Buffer.from(researchBytes).toString('utf-8');
    baseContextParts.push('\n\n## Phase Research\n\nComprehensive research was conducted for this phase:\n\n' + researchContent.slice(0, 4000));
    stream.markdown('*Using research from RESEARCH.md*\n\n');
    hasResearch = true;
  } catch {
    // No research file
  }

  // Check for DISCOVERY.md (from /discovery-phase) - quick version/syntax verification
  const discoveryUri = vscode.Uri.joinPath(
    workspaceUri,
    '.planning',
    'phases',
    targetPhase.dirName,
    'DISCOVERY.md'
  );

  let hasDiscovery = false;
  try {
    const discoveryBytes = await vscode.workspace.fs.readFile(discoveryUri);
    const discoveryContent = Buffer.from(discoveryBytes).toString('utf-8');
    baseContextParts.push('\n\n## Discovery Research\n\nThe following discovery was conducted for this phase:\n\n' + discoveryContent.slice(0, 3000));
    stream.markdown('*Using discovery from DISCOVERY.md*\n\n');
    hasDiscovery = true;
  } catch {
    // No discovery file
  }

  // Show tips if no research exists and phase might benefit
  if (!hasResearch && !hasDiscovery) {
    const goalLower = targetPhase.goal.toLowerCase();
    const isSpecializedDomain =
      goalLower.includes('3d') ||
      goalLower.includes('audio') ||
      goalLower.includes('game') ||
      goalLower.includes('ml') ||
      goalLower.includes('real-time') ||
      goalLower.includes('graphics');

    const usesExternalLibs =
      goalLower.includes('api') ||
      goalLower.includes('integration') ||
      goalLower.includes('library') ||
      goalLower.includes('framework') ||
      goalLower.includes('external');

    if (isSpecializedDomain) {
      stream.markdown(`*Tip: Run \`/research-phase ${targetPhase.number}\` for ecosystem guidance, patterns, and pitfalls (fetches live docs).*\n\n`);
    } else if (usesExternalLibs) {
      stream.markdown(`*Tip: Run \`/discovery-phase ${targetPhase.number}\` to verify current library versions and syntax.*\n\n`);
    }
  }

  // Check for codebase mapping and load relevant documents
  const codebaseDir = vscode.Uri.joinPath(workspaceUri, '.planning', 'codebase');
  try {
    const codebaseEntries = await vscode.workspace.fs.readDirectory(codebaseDir);
    if (codebaseEntries.length > 0) {
      // Determine which docs to load based on phase goal keywords
      const goalLower = targetPhase.goal.toLowerCase();
      const docsToLoad: string[] = [];

      // Always include CONVENTIONS.md for coding context
      docsToLoad.push('CONVENTIONS.md');

      // UI phases
      if (goalLower.includes('ui') || goalLower.includes('frontend') ||
          goalLower.includes('component') || goalLower.includes('interface')) {
        docsToLoad.push('STRUCTURE.md');
      }

      // API phases
      if (goalLower.includes('api') || goalLower.includes('endpoint') ||
          goalLower.includes('route') || goalLower.includes('backend')) {
        docsToLoad.push('ARCHITECTURE.md');
      }

      // Database phases
      if (goalLower.includes('database') || goalLower.includes('schema') ||
          goalLower.includes('migration') || goalLower.includes('model')) {
        docsToLoad.push('ARCHITECTURE.md', 'STACK.md');
      }

      // Testing phases
      if (goalLower.includes('test') || goalLower.includes('spec') ||
          goalLower.includes('coverage') || goalLower.includes('quality')) {
        docsToLoad.push('TESTING.md');
      }

      // Integration phases
      if (goalLower.includes('integration') || goalLower.includes('external') ||
          goalLower.includes('service') || goalLower.includes('third-party')) {
        docsToLoad.push('INTEGRATIONS.md');
      }

      // Refactoring phases
      if (goalLower.includes('refactor') || goalLower.includes('debt') ||
          goalLower.includes('cleanup') || goalLower.includes('improve')) {
        docsToLoad.push('CONCERNS.md');
      }

      // Remove duplicates
      const uniqueDocs = [...new Set(docsToLoad)];

      // Load each codebase document
      let codebaseContextAdded = false;
      for (const docName of uniqueDocs) {
        try {
          const docUri = vscode.Uri.joinPath(codebaseDir, docName);
          const docBytes = await vscode.workspace.fs.readFile(docUri);
          const docContent = Buffer.from(docBytes).toString('utf-8');
          baseContextParts.push(`\n\n## Codebase: ${docName}\n\n${docContent.slice(0, 2000)}`);
          codebaseContextAdded = true;
        } catch {
          // Doc doesn't exist
        }
      }

      if (codebaseContextAdded) {
        stream.markdown('*Using codebase mapping context*\n\n');
      }
    }
  } catch {
    // No codebase directory - suggest mapping for complex projects
    const isComplexProject = projectContext.projectMd && projectContext.projectMd.length > 1000;
    if (isComplexProject) {
      stream.markdown('*Tip: Run `/map-codebase` to generate codebase documentation for better planning.*\n\n');
    }
  }

  const baseContext = baseContextParts.join('');

  // Batch plan items into groups of MAX_TASKS_PER_PLAN
  const planItems = targetPhase.planItems;
  let batches: string[][] = [];

  if (planItems.length === 0) {
    // No specific items in roadmap - use LLM to analyze phase and determine plan breakdown
    stream.progress('Analyzing phase scope...');

    const analysisMessages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(PHASE_ANALYSIS_PROMPT),
      vscode.LanguageModelChatMessage.User(`Project context:\n\n${baseContext}\n\nAnalyze this phase and break it down into discrete plans with 2-3 work items each.`)
    ];

    try {
      const analysisResponse = await request.model.sendRequest(analysisMessages, {}, token);
      let analysisText = '';
      for await (const fragment of analysisResponse.text) {
        if (token.isCancellationRequested) {
          stream.markdown('**Cancelled**\n');
          return { metadata: { lastCommand: 'plan-phase' } };
        }
        analysisText += fragment;
      }

      const analysis = parsePhaseAnalysis(analysisText);
      if (analysis && analysis.plans.length > 0) {
        // Use LLM-determined plan breakdown
        stream.markdown(`*Phase analysis: ${analysis.plans.length} plans identified*\n\n`);
        if (analysis.reasoning) {
          stream.markdown(`> ${analysis.reasoning}\n\n`);
        }
        batches = analysis.plans.map(p => p.items);
      } else {
        // Fallback: create single batch with empty array
        console.warn('[planPhase] Failed to parse phase analysis, falling back to single plan');
        batches.push([]);
      }
    } catch (err) {
      // Fallback on error
      console.error('[planPhase] Phase analysis failed:', err);
      batches.push([]);
    }
  } else {
    // Split pre-defined items into batches of MAX_TASKS_PER_PLAN
    for (let i = 0; i < planItems.length; i += MAX_TASKS_PER_PLAN) {
      batches.push(planItems.slice(i, i + MAX_TASKS_PER_PLAN));
    }
  }

  const totalPlans = batches.length;

  // Check if all plans already exist
  if (existingPlanCount >= totalPlans) {
    // All plans for this phase already exist
    const firstPlanUri = vscode.Uri.joinPath(
      workspaceUri,
      '.planning',
      'phases',
      targetPhase.dirName,
      `${targetPhase.number.toString().padStart(2, '0')}-01-PLAN.md`
    );

    stream.markdown('## Plans Already Exist\n\n');
    stream.markdown(`Phase ${targetPhase.number} (${targetPhase.name}) already has ${existingPlanCount} plan(s).\n\n`);
    stream.markdown('**Options:**\n');
    stream.markdown(`- Edit the existing plans directly\n`);
    stream.markdown(`- Delete the plan files and run \`/plan-phase ${targetPhaseNum}\` again to regenerate\n\n`);

    stream.button({
      command: 'vscode.open',
      arguments: [firstPlanUri],
      title: 'Open First Plan'
    });
    stream.markdown(' ');
    stream.button({
      command: 'hopper.chat-participant.execute-plan',
      title: 'Execute Plan'
    });
    return { metadata: { lastCommand: 'plan-phase', phaseNumber: targetPhase.number } };
  }

  // Some or all plans need to be created
  const plansToCreate = totalPlans - existingPlanCount;
  if (existingPlanCount > 0) {
    stream.markdown(`*${existingPlanCount} plan(s) already exist, creating ${plansToCreate} more*\n\n`);
  } else if (totalPlans > 1) {
    stream.markdown(`**Creating ${totalPlans} plans** for Phase ${targetPhase.number}\n\n`);
  }

  stream.progress('Generating execution plans...');

  const createdPlans: vscode.Uri[] = [];
  let currentPlanNumber = existingPlanCount + 1;

  try {
    // Start from the first batch that doesn't have a plan yet
    for (let batchIndex = existingPlanCount; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const isMultiplePlans = plansToCreate > 1;
      const planIndexInRun = batchIndex - existingPlanCount + 1;

      if (isMultiplePlans) {
        stream.progress(`Generating plan ${planIndexInRun} of ${plansToCreate}...`);
      } else {
        stream.progress('Generating execution plan...');
      }

      // Build context with this batch's items
      let batchContext = baseContext;
      if (batch.length > 0) {
        batchContext += `\n\n### Plan Items for This Plan\n\nGenerate tasks for these ${batch.length} items:\n`;
        batch.forEach((item, index) => {
          batchContext += `${index + 1}. ${item}\n`;
        });
        batchContext += `\nIMPORTANT: Generate exactly ${batch.length} tasks, one for each item above.`;
      }

      // Build messages for LLM
      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(TASK_GENERATION_PROMPT),
        vscode.LanguageModelChatMessage.User(`Project context:\n\n${batchContext}`)
      ];

      // Send to model
      const response = await request.model.sendRequest(messages, {}, token);

      // Collect full response
      let fullResponse = '';
      for await (const fragment of response.text) {
        if (token.isCancellationRequested) {
          stream.markdown('**Cancelled**\n');
          return { metadata: { lastCommand: 'plan-phase' } };
        }
        fullResponse += fragment;
      }

      // Parse the response
      const parsed = parsePlanResponse(fullResponse);

      if (!parsed) {
        stream.markdown(`## Unable to Generate Plan ${batchIndex + 1}\n\n`);
        stream.markdown('Could not parse task information from the model response.\n\n');
        stream.markdown('**Model output (preview):**\n```\n' + fullResponse.slice(0, 500) + '\n```\n\n');
        stream.markdown('**Suggestions:**\n');
        stream.markdown('- Try running the command again\n');
        stream.markdown('- Add more details to PROJECT.md\n\n');

        stream.button({
          command: 'hopper.chat-participant.plan-phase',
          arguments: [targetPhaseNum],
          title: 'Try Again'
        });

        return { metadata: { lastCommand: 'plan-phase' } };
      }

      // Build plan config
      const planConfig: PlanConfig = {
        phase: targetPhase.dirName,
        planNumber: currentPlanNumber,
        phaseNumber: targetPhase.number,
        phaseName: targetPhase.name,
        objective: parsed.objective,
        purpose: parsed.purpose,
        output: parsed.output,
        tasks: parsed.tasks,
        verification: parsed.verification,
        successCriteria: parsed.successCriteria
      };

      // Save the plan
      stream.progress(`Creating plan file ${batchIndex + 1} of ${totalPlans}...`);
      const result = await savePlan(workspaceUri, targetPhase.dirName, planConfig);

      if (!result.success) {
        stream.markdown(`**Error:** ${result.error}\n`);
        return { metadata: { lastCommand: 'plan-phase' } };
      }

      if (result.filePath) {
        createdPlans.push(result.filePath);
      }

      currentPlanNumber++;
    }

    // Success! Show summary
    if (createdPlans.length === 1) {
      stream.markdown('## Plan Created\n\n');
      stream.markdown('**Created:**\n');
      stream.reference(createdPlans[0]);
      stream.markdown('\n\n');

      stream.button({
        command: 'vscode.open',
        arguments: [createdPlans[0]],
        title: 'Open PLAN.md'
      });
    } else {
      stream.markdown(`## ${createdPlans.length} Plans Created\n\n`);
      stream.markdown('**Created files:**\n');
      for (const planUri of createdPlans) {
        stream.reference(planUri);
        stream.markdown('\n');
      }
      stream.markdown('\n');

      stream.button({
        command: 'vscode.open',
        arguments: [createdPlans[0]],
        title: 'Open First Plan'
      });
    }

    stream.markdown('\n### Next Steps\n\n');
    stream.markdown('Review the plan(s) and use **/execute-plan** to execute them in order.\n\n');

    // Update STATE.md with planning activity
    if (projectContext.planningUri) {
      try {
        const planCount = createdPlans.length;
        const description = planCount === 1
          ? `Created plan for Phase ${targetPhase.number}`
          : `Created ${planCount} plans for Phase ${targetPhase.number}`;
        await updateLastActivityAndSession(
          projectContext.planningUri,
          description,
          `/execute-plan to begin Phase ${targetPhase.number}`
        );
      } catch (stateErr) {
        console.error('[Hopper] Failed to update STATE.md after planning:', stateErr);
        // Don't fail the planning, just log the error
      }
    }

    return {
      metadata: {
        lastCommand: 'plan-phase',
        phaseNumber: targetPhase.number
      }
    };

  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      stream.markdown(`**Model Error:** ${err.message}\n\n`);
      stream.markdown('Please check your model connection and try again.\n');
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err);
      stream.markdown(`**Error:** ${errorMessage}\n`);
    }
    return { metadata: { lastCommand: 'plan-phase' } };
  }
}
