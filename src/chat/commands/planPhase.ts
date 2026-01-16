import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import {
  PlanConfig,
  TaskConfig,
  savePlan,
  planExists,
  getNextPlanNumber
} from '../generators';

/**
 * System prompt for generating plan tasks from phase requirements
 */
const TASK_GENERATION_PROMPT = `You are helping create an execution plan for a software project phase.

Based on the project context and phase goal, generate 2-3 specific, actionable tasks.

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
- Target 2-3 tasks maximum (split into multiple plans if more needed)
- Use "auto" type for all tasks unless visual verification or decision is needed
- Use "checkpoint:human-verify" sparingly - only for visual/interactive verification
- Use "checkpoint:decision" only when user choice affects implementation
- File paths must be specific (src/api/auth.ts, not "auth file")
- Actions must be detailed with what, how, and what to avoid
- Verify must be executable (npm test, curl, etc.)
- Done criteria must be measurable

Always return valid JSON.`;

/**
 * Parse phase information from ROADMAP.md
 */
interface ParsedPhase {
  number: number;
  name: string;
  goal: string;
  dirName: string;
  dependsOn?: number;
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

    phases.push({
      number,
      name,
      goal,
      dirName,
      dependsOn: phases.length > 0 ? phases[phases.length - 1].number : undefined
    });
  }

  return phases;
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

  // Parse phase number from prompt
  const promptText = request.prompt.trim();
  let targetPhaseNum: number | undefined;

  if (promptText) {
    // Check for invalid input (non-numeric)
    if (!/^[\d.]+$/.test(promptText)) {
      stream.markdown('## Invalid Argument\n\n');
      stream.markdown(`"${promptText}" is not a valid phase number.\n\n`);
      stream.markdown('**Usage:** `/plan-phase [phase-number]`\n\n');
      stream.markdown('**Examples:**\n');
      stream.markdown('- `/plan-phase 1` - Plan for Phase 1\n');
      stream.markdown('- `/plan-phase 2.1` - Plan for inserted Phase 2.1\n');
      stream.markdown('- `/plan-phase` - Auto-detect next unplanned phase\n\n');
      stream.markdown('**Available phases:**\n');
      for (const p of phases) {
        stream.markdown(`- Phase ${p.number}: ${p.name}\n`);
      }
      stream.markdown('\n');
      return { metadata: { lastCommand: 'plan-phase' } };
    }

    // Try to parse as number (supports decimal like 1.5)
    const parsed = parseFloat(promptText);
    if (!isNaN(parsed)) {
      targetPhaseNum = parsed;
    }
  }

  // If no phase specified, show usage help
  if (targetPhaseNum === undefined) {
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/plan-phase <phase-number>`**\n\n');
    stream.markdown('Create a detailed execution plan for a specific phase.\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/plan-phase 1` - Plan for Phase 1\n');
    stream.markdown('- `/plan-phase 2` - Plan for Phase 2\n');
    stream.markdown('- `/plan-phase 1.5` - Plan for inserted Phase 1.5\n\n');
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

  // Get next plan number for this phase
  stream.progress('Checking existing plans...');
  const planNumber = await getNextPlanNumber(workspaceUri, targetPhase.dirName, targetPhase.number);

  // Check if plan already exists - offer options
  if (planNumber > 1) {
    const existingPlanUri = vscode.Uri.joinPath(
      workspaceUri,
      '.planning',
      'phases',
      targetPhase.dirName,
      `${targetPhase.number.toString().padStart(2, '0')}-${(planNumber - 1).toString().padStart(2, '0')}-PLAN.md`
    );

    stream.markdown(`**Note:** Phase ${targetPhase.number} already has ${planNumber - 1} plan(s).\n\n`);
    stream.markdown(`Creating **Plan ${planNumber}** for additional work in this phase.\n\n`);

    // Show reference to existing plan
    stream.markdown('**Existing plan:**\n');
    stream.reference(existingPlanUri);
    stream.markdown('\n\n');
  }

  stream.progress('Reading project context...');

  // Build context for LLM
  const contextParts: string[] = [];

  if (projectContext.projectMd) {
    contextParts.push('## PROJECT.md\n\n' + projectContext.projectMd);
  }

  contextParts.push(`\n\n## Target Phase\n\n**Phase ${targetPhase.number}: ${targetPhase.name}**\n\nGoal: ${targetPhase.goal}`);

  if (targetPhase.dependsOn) {
    const depPhase = phases.find(p => p.number === targetPhase.dependsOn);
    if (depPhase) {
      contextParts.push(`\n\nDepends on Phase ${depPhase.number}: ${depPhase.name}`);
    }
  }

  if (projectContext.stateMd) {
    contextParts.push('\n\n## Current State\n\n' + projectContext.stateMd);
  }

  const fullContext = contextParts.join('');

  stream.progress('Analyzing phase requirements...');

  try {
    // Build messages for LLM
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(TASK_GENERATION_PROMPT),
      vscode.LanguageModelChatMessage.User(`Project context:\n\n${fullContext}`)
    ];

    // Send to model
    stream.progress('Generating execution plan...');
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
      stream.markdown('## Unable to Generate Plan\n\n');
      stream.markdown('Could not parse task information from the model response.\n\n');
      stream.markdown('**Model output (preview):**\n```\n' + fullResponse.slice(0, 500) + '\n```\n\n');
      stream.markdown('**Suggestions:**\n');
      stream.markdown('- Try running the command again\n');
      stream.markdown('- Add more details to PROJECT.md\n\n');

      stream.button({
        command: 'hopper.chat-participant.plan-phase',
        title: 'Try Again'
      });

      return { metadata: { lastCommand: 'plan-phase' } };
    }

    // Build plan config
    const planConfig: PlanConfig = {
      phase: targetPhase.dirName,
      planNumber,
      phaseNumber: targetPhase.number,
      phaseName: targetPhase.name,
      objective: parsed.objective,
      purpose: parsed.purpose,
      output: parsed.output,
      tasks: parsed.tasks,
      verification: parsed.verification,
      successCriteria: parsed.successCriteria
    };

    // Show generated plan preview
    stream.markdown(`## Plan Preview\n\n`);
    stream.markdown(`**Phase ${targetPhase.number}: ${targetPhase.name}** - Plan ${planNumber}\n\n`);
    stream.markdown(`**Objective:** ${parsed.objective}\n\n`);
    stream.markdown(`**Tasks:**\n`);
    for (let i = 0; i < parsed.tasks.length; i++) {
      const task = parsed.tasks[i];
      stream.markdown(`${i + 1}. ${task.name}\n`);
    }
    stream.markdown('\n');

    // Save the plan
    stream.progress('Creating plan file...');
    const result = await savePlan(workspaceUri, targetPhase.dirName, planConfig);

    if (!result.success) {
      stream.markdown(`**Error:** ${result.error}\n`);
      return { metadata: { lastCommand: 'plan-phase' } };
    }

    // Success!
    stream.markdown('## Plan Created\n\n');

    if (result.filePath) {
      stream.markdown('**Created:**\n');
      stream.reference(result.filePath);
      stream.markdown('\n\n');

      stream.button({
        command: 'vscode.open',
        arguments: [result.filePath],
        title: 'Open PLAN.md'
      });
    }

    stream.markdown('\n### Next Steps\n\n');
    stream.markdown('Review the plan and use **/execute-plan** (coming in Phase 4) to execute it.\n\n');

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
