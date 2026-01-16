import * as vscode from 'vscode';
import { PlanConfig, TaskConfig, GeneratorResult } from './types';

/**
 * Convert number to zero-padded string (e.g., 1 -> "01")
 */
function padNumber(num: number): string {
  return num.toString().padStart(2, '0');
}

/**
 * Format a single task in XML structure for PLAN.md
 *
 * @param task - Task configuration
 * @param index - Task index (0-based)
 * @returns Formatted XML task element
 */
export function formatTask(task: TaskConfig, index: number): string {
  const taskNum = index + 1;
  const filesLine = task.files && task.files.length > 0
    ? `  <files>${task.files.join(', ')}</files>\n`
    : '';

  return `<task type="${task.type}">
  <name>Task ${taskNum}: ${task.name}</name>
${filesLine}  <action>
${task.action}
  </action>
  <verify>${task.verify}</verify>
  <done>
${task.done}
  </done>
</task>`;
}

/**
 * Generate PLAN.md content following Hopper template
 *
 * @param config - Plan configuration
 * @returns Formatted PLAN.md content
 */
export function createPlanMd(config: PlanConfig): string {
  const {
    phase,
    planNumber,
    phaseNumber,
    phaseName,
    objective,
    purpose,
    output,
    tasks,
    verification,
    successCriteria
  } = config;

  // Format plan identifier (e.g., "03-01")
  const planId = `${padNumber(phaseNumber)}-${padNumber(planNumber)}`;

  // Format tasks
  const tasksXml = tasks
    .map((task, idx) => formatTask(task, idx))
    .join('\n\n');

  // Format verification checklist
  const verificationList = verification
    .map(v => `- [ ] ${v}`)
    .join('\n');

  // Format success criteria
  const successCriteriaList = successCriteria
    .map(c => `- ${c}`)
    .join('\n');

  // Phase directory name (e.g., "03-planning-commands")
  const phaseDir = phase;

  return `---
phase: ${phase}
plan: ${padNumber(planNumber)}
type: execute
---

<objective>
${objective}

Purpose: ${purpose}

Output: ${output}
</objective>

<execution_context>
Execute tasks sequentially, committing after each task completion.
Follow the plan's verification and success criteria.
Create SUMMARY.md after all tasks complete.
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
</context>

<tasks>

${tasksXml}

</tasks>

<verification>
Before declaring plan complete:
${verificationList}
</verification>

<success_criteria>
${successCriteriaList}
</success_criteria>

<output>
After completion, create \`.planning/phases/${phaseDir}/${planId}-SUMMARY.md\` following the summary template.
</output>
`;
}

/**
 * Save PLAN.md to the appropriate phase directory
 *
 * @param workspaceUri - Workspace root URI
 * @param phaseDir - Phase directory name (e.g., "03-planning-commands")
 * @param config - Plan configuration
 * @returns GeneratorResult with success status and file path
 */
export async function savePlan(
  workspaceUri: vscode.Uri,
  phaseDir: string,
  config: PlanConfig
): Promise<GeneratorResult> {
  try {
    const planId = `${padNumber(config.phaseNumber)}-${padNumber(config.planNumber)}`;
    const fileName = `${planId}-PLAN.md`;

    // Build path: .planning/phases/{phaseDir}/{planId}-PLAN.md
    const planUri = vscode.Uri.joinPath(
      workspaceUri,
      '.planning',
      'phases',
      phaseDir,
      fileName
    );

    // Generate content
    const content = createPlanMd(config);

    // Write file
    await vscode.workspace.fs.writeFile(
      planUri,
      Buffer.from(content, 'utf-8')
    );

    return {
      success: true,
      filePath: planUri
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to save plan: ${errorMessage}`
    };
  }
}

/**
 * Check if PLAN.md already exists for a given phase and plan number
 *
 * @param workspaceUri - Workspace root URI
 * @param phaseDir - Phase directory name
 * @param phaseNumber - Phase number
 * @param planNumber - Plan number within phase
 * @returns true if plan already exists
 */
export async function planExists(
  workspaceUri: vscode.Uri,
  phaseDir: string,
  phaseNumber: number,
  planNumber: number
): Promise<boolean> {
  try {
    const planId = `${padNumber(phaseNumber)}-${padNumber(planNumber)}`;
    const fileName = `${planId}-PLAN.md`;
    const planUri = vscode.Uri.joinPath(
      workspaceUri,
      '.planning',
      'phases',
      phaseDir,
      fileName
    );
    await vscode.workspace.fs.stat(planUri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the next available plan number for a phase
 *
 * @param workspaceUri - Workspace root URI
 * @param phaseDir - Phase directory name
 * @param phaseNumber - Phase number
 * @returns Next available plan number (1-based)
 */
export async function getNextPlanNumber(
  workspaceUri: vscode.Uri,
  phaseDir: string,
  phaseNumber: number
): Promise<number> {
  let planNum = 1;
  while (await planExists(workspaceUri, phaseDir, phaseNumber, planNum)) {
    planNum++;
  }
  return planNum;
}
