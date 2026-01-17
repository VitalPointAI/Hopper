import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import { parsePlanMd, ExecutionPlan, ExecutionTask } from '../executor';

/**
 * Build a prompt for executing a single task
 */
function buildTaskPrompt(task: ExecutionTask, planContext: string): string {
  const filesLine = task.files && task.files.length > 0
    ? `Files to modify: ${task.files.join(', ')}\n\n`
    : '';

  return `You are executing a task from a Hopper plan.

Task: ${task.name}
${filesLine}Action:
${task.action}

Verification: ${task.verify}
Done when: ${task.done}

Project context:
${planContext}

Please implement this task. Show the code changes needed.`;
}

/**
 * Handle /execute-plan command
 *
 * Executes a PLAN.md file by:
 * 1. Parsing the plan path argument or auto-detecting from STATE.md
 * 2. Loading and parsing the PLAN.md file
 * 3. Executing each task sequentially via LLM
 * 4. Reporting progress and completion status
 */
export async function handleExecutePlan(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

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

  // Parse plan path from prompt
  const promptText = request.prompt.trim();
  let planUri: vscode.Uri | undefined;

  if (promptText) {
    // User provided a path
    stream.progress('Loading plan...');

    // Handle relative or absolute paths
    if (promptText.startsWith('/') || promptText.includes(':')) {
      planUri = vscode.Uri.file(promptText);
    } else {
      // Relative to workspace
      planUri = vscode.Uri.joinPath(workspaceUri, promptText);
    }
  } else {
    // Show usage help when no argument provided
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/execute-plan <path-to-plan>`**\n\n');
    stream.markdown('Execute a PLAN.md file by sending each task to the LLM.\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/execute-plan .planning/phases/04-execution-commands/04-01-PLAN.md`\n');
    stream.markdown('- `/execute-plan` (auto-detect coming in Task 3)\n\n');

    if (projectContext.planningUri) {
      stream.markdown('**Create a plan first:**\n\n');
      stream.button({
        command: 'hopper.chat-participant.plan-phase',
        title: 'Plan Phase'
      });
    }

    return { metadata: { lastCommand: 'execute-plan' } };
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
  const results: { taskId: number; success: boolean; name: string }[] = [];

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
      const prompt = buildTaskPrompt(task, planContext);

      // Send to LLM
      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(prompt)
      ];

      const response = await request.model.sendRequest(messages, {}, token);

      // Stream the response
      stream.markdown('**Implementation:**\n\n');
      for await (const fragment of response.text) {
        if (token.isCancellationRequested) {
          break;
        }
        stream.markdown(fragment);
      }

      stream.markdown('\n\n');

      // Show done criteria
      stream.markdown(`**Done when:** ${task.done}\n\n`);
      stream.markdown(`**Verify:** ${task.verify}\n\n`);

      stream.markdown('---\n\n');

      results.push({ taskId: task.id, success: true, name: task.name });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      stream.markdown(`**Error executing task:** ${errorMessage}\n\n`);

      if (error instanceof vscode.LanguageModelError) {
        stream.markdown('Model error occurred. Try again or check your model connection.\n\n');
      }

      stream.markdown('---\n\n');

      results.push({ taskId: task.id, success: false, name: task.name });
    }
  }

  // Show completion summary
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;

  stream.markdown('## Execution Complete\n\n');
  stream.markdown(`**Completed:** ${successCount}/${plan.tasks.length} tasks\n`);
  if (failedCount > 0) {
    stream.markdown(`**Failed:** ${failedCount} tasks\n`);
  }
  stream.markdown('\n');

  // Show task summary
  for (const result of results) {
    const icon = result.success ? 'Pass' : 'Fail';
    stream.markdown(`- [${icon}] Task ${result.taskId}: ${result.name}\n`);
  }

  stream.markdown('\n### Next Steps\n\n');
  stream.markdown('1. Review the implementation suggestions above\n');
  stream.markdown('2. Apply the changes to your codebase\n');
  stream.markdown('3. Run verification: check the plan\'s verification section\n');
  stream.markdown('4. Use `/progress` to update project state\n\n');

  stream.reference(planUri);

  return {
    metadata: {
      lastCommand: 'execute-plan'
    }
  };
}
