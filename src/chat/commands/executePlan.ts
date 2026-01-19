import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import {
  parsePlanMd,
  ExecutionTask,
  AutoExecutionTask,
  CheckpointVerifyTask,
  CheckpointDecisionTask,
  ExecutionState,
  checkGitRepo,
  stageFiles,
  commit,
  generateCommitMessage,
  saveSummary,
  SummaryConfig,
  TaskCommitInfo,
  isScaffoldingTask,
  extractScaffoldingCommand,
  executeScaffoldingWithProtection
} from '../executor';
import { clearHandoffAfterCompletion } from './resumeWork';
import { updateStateAfterExecution, setCurrentAgentId, clearCurrentAgentId } from '../state';
import {
  ConfigManager,
  shouldPauseAtCheckpoint,
  shouldConfirmTask,
  confirmTaskExecution,
  getModeDescription
} from '../../config';
import { getLogger } from '../../logging';
import { logTaskFailure, TaskFailure } from '../issues/autoLog';

/**
 * Patterns that indicate a transient error which should be retried.
 * These are temporary failures that may succeed on retry.
 */
const TRANSIENT_ERROR_PATTERNS = [
  /rate limit/i,
  /timeout/i,
  /network/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /503/i,
  /429/i,
];

/**
 * Check if an error message indicates a transient failure that should be retried.
 */
function isTransientError(error: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(error));
}

/**
 * Patterns that indicate a verify step failure in tool output.
 * These are command failures that appear in "successful" tool results.
 */
const VERIFY_FAILURE_PATTERNS = [
  /npm error/i,
  /npm ERR!/i,
  /test failed/i,
  /tests? failed/i,
  /FAIL\s+/,
  /Error:/,
  /error TS\d+:/i,  // TypeScript errors
  /build failed/i,
  /compilation failed/i,
  /exit code [1-9]/i,
  /non-zero exit/i,
  /command failed/i,
  /ENOENT/i,  // File not found
  /Cannot find module/i,
  /SyntaxError/i,
  /TypeError/i,
  /ReferenceError/i,
];

/**
 * Detect if tool output indicates a verify step failure.
 * Returns failure info if patterns match, otherwise indicates success.
 */
function detectVerifyFailure(toolOutput: string): { failed: boolean; reason?: string } {
  for (const pattern of VERIFY_FAILURE_PATTERNS) {
    const match = toolOutput.match(pattern);
    if (match) {
      // Extract a meaningful snippet around the match
      const matchIndex = toolOutput.indexOf(match[0]);
      const snippetStart = Math.max(0, matchIndex - 20);
      const snippetEnd = Math.min(toolOutput.length, matchIndex + match[0].length + 80);
      const snippet = toolOutput.slice(snippetStart, snippetEnd).trim();

      return {
        failed: true,
        reason: snippet.length > 100 ? snippet.slice(0, 100) + '...' : snippet
      };
    }
  }

  return { failed: false };
}

/**
 * Format a tool invocation message with contextual information.
 * Provides user-friendly descriptions for file and directory operations.
 */
function formatToolMessage(toolName: string, input: Record<string, unknown>, workspaceRoot?: string): { start: string; complete: string } {
  // Helper to make paths relative and readable
  const formatPath = (fullPath: string): string => {
    if (workspaceRoot && fullPath.startsWith(workspaceRoot)) {
      return fullPath.slice(workspaceRoot.length + 1); // +1 for trailing slash
    }
    return fullPath;
  };

  // Helper to get file extension description
  const getFileType = (filePath: string): string => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      'ts': 'TypeScript',
      'tsx': 'TypeScript React',
      'js': 'JavaScript',
      'jsx': 'JavaScript React',
      'json': 'JSON',
      'md': 'Markdown',
      'css': 'CSS',
      'scss': 'SCSS',
      'html': 'HTML',
      'yaml': 'YAML',
      'yml': 'YAML',
      'py': 'Python',
      'go': 'Go',
      'rs': 'Rust',
      'java': 'Java',
      'sql': 'SQL',
      'sh': 'Shell script',
      'bash': 'Bash script'
    };
    return types[ext || ''] || 'file';
  };

  // Helper to estimate content size
  const getContentSize = (content: string): string => {
    const lines = content.split('\n').length;
    if (lines === 1) {
      return '1 line';
    }
    return `${lines} lines`;
  };

  switch (toolName) {
    case 'hopper_createFile': {
      const filePath = input.filePath as string || 'unknown';
      const content = input.content as string || '';
      const relativePath = formatPath(filePath);
      const fileType = getFileType(filePath);
      const size = getContentSize(content);
      return {
        start: `**Creating ${fileType}:** \`${relativePath}\` (${size})`,
        complete: `Created \`${relativePath}\``
      };
    }

    case 'hopper_createDirectory': {
      const dirPath = input.dirPath as string || 'unknown';
      const relativePath = formatPath(dirPath);
      return {
        start: `**Creating directory:** \`${relativePath}/\``,
        complete: `Created directory \`${relativePath}/\``
      };
    }

    case 'copilot_editFile':
    case 'vscode_editFile': {
      const filePath = input.filePath as string || input.path as string || 'unknown';
      const relativePath = formatPath(filePath);
      return {
        start: `**Editing:** \`${relativePath}\``,
        complete: `Edited \`${relativePath}\``
      };
    }

    case 'copilot_readFile':
    case 'vscode_readFile': {
      const filePath = input.filePath as string || input.path as string || 'unknown';
      const relativePath = formatPath(filePath);
      return {
        start: `*Reading \`${relativePath}\`...*`,
        complete: `*Read \`${relativePath}\`*`
      };
    }

    case 'hopper_runInTerminal': {
      const command = input.command as string || 'unknown';
      const name = input.name as string;
      const displayName = name || command.split(' ')[0];
      return {
        start: `**Starting terminal:** \`${displayName}\`\n   Command: \`${command}\``,
        complete: `Terminal \`${displayName}\` started (running in background)`
      };
    }

    case 'hopper_waitForPort': {
      const port = input.port as number || 0;
      const host = input.host as string || 'localhost';
      return {
        start: `**Waiting for port:** ${host}:${port}`,
        complete: `Port ${host}:${port} is ready`
      };
    }

    case 'hopper_httpHealthCheck': {
      const url = input.url as string || 'unknown';
      return {
        start: `**Health check:** ${url}`,
        complete: `Health check passed: ${url}`
      };
    }

    default:
      return {
        start: `*Executing tool: ${toolName}...*`,
        complete: `*Tool ${toolName} completed.*`
      };
  }
}

/**
 * Execute a chat request with tool calling loop.
 * Handles invoking tools when the model requests them.
 *
 * @param model The language model to use
 * @param messages The conversation messages
 * @param tools Available tools for the model to use
 * @param stream The chat response stream to write to
 * @param token Cancellation token
 * @param toolInvocationToken Token from chat request for proper UI integration (required for file operations)
 * @param workspaceRoot Optional workspace root for relative path formatting
 * @returns Object containing concatenated tool output text for verification analysis
 */
async function executeWithTools(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[],
  tools: vscode.LanguageModelChatTool[],
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  toolInvocationToken?: vscode.ChatParticipantToolToken,
  workspaceRoot?: string
): Promise<{ toolOutput: string }> {
  const logger = getLogger();

  // Log tool availability diagnostics
  logger.info(`executeWithTools: ${tools.length} tools available`);
  if (tools.length > 0) {
    const toolNames = tools.slice(0, 10).map(t => t.name).join(', ');
    logger.info(`Available tools (first 10): ${toolNames}`);
  } else {
    logger.warn('WARNING: No tools passed to executeWithTools - model cannot make changes');
  }

  // Allow up to 50 tool iterations per task - complex tasks may need many operations
  const MAX_ITERATIONS = 50;
  let iteration = 0;

  // Accumulate tool output text for verify failure detection
  const toolOutputParts: string[] = [];

  while (iteration < MAX_ITERATIONS && !token.isCancellationRequested) {
    iteration++;

    // Use explicit tool mode - Auto allows model to decide when to use tools
    const response = await model.sendRequest(
      messages,
      { tools, toolMode: vscode.LanguageModelChatToolMode.Auto },
      token
    );

    let hasToolCalls = false;
    const toolResults: vscode.LanguageModelToolResultPart[] = [];
    const toolCallParts: vscode.LanguageModelToolCallPart[] = [];

    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        stream.markdown(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        hasToolCalls = true;
        toolCallParts.push(part);

        // Format contextual tool message
        const toolInput = part.input as Record<string, unknown>;
        const toolMsg = formatToolMessage(part.name, toolInput, workspaceRoot);

        // Show tool invocation in stream with context
        stream.markdown(`\n\n${toolMsg.start}\n\n`);

        // Retry logic for transient failures
        const MAX_RETRIES = 2; // 3 total attempts
        let lastError: string | undefined;
        let toolResult: vscode.LanguageModelToolResult | undefined;

        for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
          // Check for cancellation before each attempt
          if (token.isCancellationRequested) {
            break;
          }

          try {
            // Log tool invocation to output channel
            const logger = getLogger();
            if (attempt === 1) {
              logger.toolStart(part.name, part.input);
            } else {
              logger.warn(`Retry ${attempt}/${MAX_RETRIES + 1} for ${part.name}: ${lastError}`);
              stream.markdown(`*Retry ${attempt}/${MAX_RETRIES + 1}...*\n\n`);
            }

            // Invoke the tool with toolInvocationToken for proper chat UI integration
            // The token is required for file operations like copilot_createFile
            toolResult = await vscode.lm.invokeTool(
              part.name,
              {
                input: part.input,
                toolInvocationToken
              },
              token
            );

            // Log successful completion
            logger.toolComplete(part.name, 'success');
            lastError = undefined;
            break; // Success - exit retry loop

          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            lastError = errorMsg;

            // Check if this is a transient error that should be retried
            if (isTransientError(errorMsg) && attempt <= MAX_RETRIES && !token.isCancellationRequested) {
              // Exponential backoff: 1s, 2s
              const delay = attempt * 1000;
              getLogger().warn(`Transient error in ${part.name}, retrying in ${delay}ms: ${errorMsg}`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }

            // Non-transient error or max retries reached
            if (attempt > MAX_RETRIES) {
              getLogger().error(`Tool ${part.name} failed after ${MAX_RETRIES + 1} attempts: ${errorMsg}`);
            } else {
              getLogger().error(`Tool ${part.name} failed (non-retryable): ${errorMsg}`);
            }
            break;
          }
        }

        // Process result or error
        if (toolResult && !lastError) {
          // Collect tool result for next iteration
          // invokeTool returns LanguageModelToolResult, we need its content array
          toolResults.push(
            new vscode.LanguageModelToolResultPart(part.callId, toolResult.content)
          );

          // Capture tool output text for verify failure detection
          for (const contentPart of toolResult.content) {
            if (contentPart instanceof vscode.LanguageModelTextPart) {
              toolOutputParts.push(contentPart.value);
            }
          }

          stream.markdown(`${toolMsg.complete}\n\n`);
        } else {
          // Report error - also capture for verify failure detection
          const errorText = `Error: ${lastError || 'Unknown error'}`;
          toolOutputParts.push(errorText);

          stream.markdown(`**Failed:** ${part.name} - ${lastError || 'Unknown error'}\n\n`);

          toolResults.push(
            new vscode.LanguageModelToolResultPart(
              part.callId,
              [new vscode.LanguageModelTextPart(errorText)]
            )
          );
        }
      }
    }

    // If no tool calls, we're done
    if (!hasToolCalls) {
      // Log diagnostic warning on first iteration - model didn't use any tools
      if (iteration === 1) {
        logger.warn(`No tool calls on first iteration. Tools available: ${tools.length}`);
        if (tools.length > 0) {
          const firstFiveTools = tools.slice(0, 5).map(t => t.name).join(', ');
          logger.warn(`First 5 tools: ${firstFiveTools}`);
          logger.warn('Model may be outputting text suggestions instead of using tools.');
        }
      }
      break;
    }

    // Add assistant message with tool calls to history
    // Add tool results as user message for next iteration
    messages.push(
      vscode.LanguageModelChatMessage.Assistant(toolCallParts),
      vscode.LanguageModelChatMessage.User(toolResults)
    );
  }

  if (iteration >= MAX_ITERATIONS) {
    stream.markdown('\n\n**Warning:** Maximum tool iterations (50) reached.\n\n');
    stream.markdown('The task may be incomplete. You can:\n');
    stream.markdown('- Run **/execute-plan** again to continue where it left off\n');
    stream.markdown('- Use **/verify-work** to check what was completed\n');
    stream.markdown('- Check the task manually and mark it complete if done\n\n');
  }

  // Return accumulated tool output for verify failure detection
  return { toolOutput: toolOutputParts.join('\n') };
}

/**
 * Get execution state storage key for a plan
 */
function getStateKey(planPath: string): string {
  return `hopper.executionState.${planPath}`;
}

/**
 * Save execution state to extension globalState
 */
async function saveExecutionState(
  context: vscode.ExtensionContext,
  state: ExecutionState
): Promise<void> {
  const key = getStateKey(state.planPath);
  await context.globalState.update(key, state);
}

/**
 * Load execution state from extension globalState
 */
function loadExecutionState(
  context: vscode.ExtensionContext,
  planPath: string
): ExecutionState | undefined {
  const key = getStateKey(planPath);
  return context.globalState.get<ExecutionState>(key);
}

/**
 * Clear execution state from extension globalState
 */
async function clearExecutionState(
  context: vscode.ExtensionContext,
  planPath: string
): Promise<void> {
  const key = getStateKey(planPath);
  await context.globalState.update(key, undefined);
}

/**
 * Key for tracking the currently active execution
 */
const ACTIVE_EXECUTION_KEY = 'hopper.activeExecution';

/**
 * Key for tracking recently cancelled executions (for resume with context)
 */
const CANCELLED_EXECUTION_KEY = 'hopper.cancelledExecution';

/**
 * Active execution info stored in globalState
 */
interface ActiveExecutionInfo {
  planPath: string;
  taskIndex: number;
  lastActivityTimestamp: number;
}

/**
 * Cancelled execution info stored in globalState
 * Used for "stop and resume with context" flow
 */
interface CancelledExecutionInfo {
  planPath: string;
  taskIndex: number;
  cancelledAt: number;
}

/**
 * Mark execution as actively running.
 * Called at the start of task execution loop.
 */
export async function setActiveExecution(
  context: vscode.ExtensionContext,
  planPath: string,
  taskIndex: number
): Promise<void> {
  const info: ActiveExecutionInfo = {
    planPath,
    taskIndex,
    lastActivityTimestamp: Date.now()
  };
  await context.globalState.update(ACTIVE_EXECUTION_KEY, info);
}

/**
 * Update the activity timestamp for active execution.
 * Called during tool calls to keep state fresh.
 */
export async function updateActiveExecutionTimestamp(
  context: vscode.ExtensionContext
): Promise<void> {
  const existing = context.globalState.get<ActiveExecutionInfo>(ACTIVE_EXECUTION_KEY);
  if (existing) {
    existing.lastActivityTimestamp = Date.now();
    await context.globalState.update(ACTIVE_EXECUTION_KEY, existing);
  }
}

/**
 * Clear active execution state.
 * Called when execution completes, is cancelled, or errors.
 */
export async function clearActiveExecution(
  context: vscode.ExtensionContext
): Promise<void> {
  await context.globalState.update(ACTIVE_EXECUTION_KEY, undefined);
}

/**
 * Get active execution info if any.
 * Returns undefined if no execution is active or if execution is stale.
 */
export function getActiveExecution(
  context: vscode.ExtensionContext
): ActiveExecutionInfo | undefined {
  return context.globalState.get<ActiveExecutionInfo>(ACTIVE_EXECUTION_KEY);
}

/**
 * Save cancelled execution state for potential resume with context.
 * Called when execution is cancelled (Stop button) to preserve position.
 */
export async function saveCancelledExecution(
  context: vscode.ExtensionContext,
  planPath: string,
  taskIndex: number
): Promise<void> {
  const info: CancelledExecutionInfo = {
    planPath,
    taskIndex,
    cancelledAt: Date.now()
  };
  await context.globalState.update(CANCELLED_EXECUTION_KEY, info);
}

/**
 * Get cancelled execution info if any and still recent.
 * Returns undefined if no cancelled execution or if older than 5 minutes.
 * The 5 minute window allows user to paste context and resume.
 */
export function getCancelledExecution(
  context: vscode.ExtensionContext
): CancelledExecutionInfo | undefined {
  const info = context.globalState.get<CancelledExecutionInfo>(CANCELLED_EXECUTION_KEY);
  if (!info) {
    return undefined;
  }

  // Only return if within resume window (5 minutes)
  const RESUME_WINDOW_MS = 300000; // 5 minutes
  if ((Date.now() - info.cancelledAt) > RESUME_WINDOW_MS) {
    return undefined;
  }

  return info;
}

/**
 * Clear cancelled execution state.
 * Called after successful resume or when stale.
 */
export async function clearCancelledExecution(
  context: vscode.ExtensionContext
): Promise<void> {
  await context.globalState.update(CANCELLED_EXECUTION_KEY, undefined);
}

/**
 * Key for storing mid-execution context from user pastes
 */
function getExecutionContextKey(planPath: string): string {
  return `hopper.executionContext.${planPath}`;
}

/**
 * Store context pasted by user during execution.
 * Will be picked up by the next task execution iteration.
 */
export async function storeExecutionContext(
  context: vscode.ExtensionContext,
  planPath: string,
  content: string
): Promise<void> {
  const key = getExecutionContextKey(planPath);
  await context.globalState.update(key, content);
}

/**
 * Get stored execution context if any.
 */
export function getExecutionContext(
  context: vscode.ExtensionContext,
  planPath: string
): string | undefined {
  const key = getExecutionContextKey(planPath);
  return context.globalState.get<string>(key);
}

/**
 * Clear stored execution context after it's been used.
 */
export async function clearExecutionContext(
  context: vscode.ExtensionContext,
  planPath: string
): Promise<void> {
  const key = getExecutionContextKey(planPath);
  await context.globalState.update(key, undefined);
}

/**
 * Type guard to check if a task is an auto task
 */
function isAutoTask(task: ExecutionTask): task is AutoExecutionTask {
  return task.type === 'auto';
}

/**
 * Type guard to check if a task is a human-verify checkpoint
 */
function isCheckpointVerify(task: ExecutionTask): task is CheckpointVerifyTask {
  return task.type === 'checkpoint:human-verify';
}

/**
 * Type guard to check if a task is a decision checkpoint
 */
function isCheckpointDecision(task: ExecutionTask): task is CheckpointDecisionTask {
  return task.type === 'checkpoint:decision';
}

/**
 * Render checkpoint:human-verify task
 */
function renderCheckpointVerify(
  task: CheckpointVerifyTask,
  taskIndex: number,
  totalTasks: number,
  stream: vscode.ChatResponseStream,
  planPath: string
): void {
  stream.markdown(`### Task ${taskIndex + 1}/${totalTasks}: Checkpoint - Verify Implementation\n\n`);
  stream.markdown('---\n\n');
  stream.markdown(`**What was built:** ${task.whatBuilt}\n\n`);

  if (task.howToVerify.length > 0) {
    stream.markdown('**Please verify:**\n');
    for (let i = 0; i < task.howToVerify.length; i++) {
      stream.markdown(`${i + 1}. ${task.howToVerify[i]}\n`);
    }
    stream.markdown('\n');
  }

  stream.markdown('---\n\n');

  // Add approve button
  stream.button({
    command: 'hopper.chat-participant.execute-plan',
    arguments: [planPath, 'approved'],
    title: 'Approve'
  });

  stream.markdown(' ');

  // Add report issue button
  stream.button({
    command: 'hopper.chat-participant.execute-plan',
    arguments: [planPath, 'issue'],
    title: 'Report Issue'
  });

  stream.markdown('\n\n');
  stream.markdown(`*${task.resumeSignal}*\n`);
}

/**
 * Render checkpoint:decision task
 */
function renderCheckpointDecision(
  task: CheckpointDecisionTask,
  taskIndex: number,
  totalTasks: number,
  stream: vscode.ChatResponseStream,
  planPath: string
): void {
  stream.markdown(`### Task ${taskIndex + 1}/${totalTasks}: Checkpoint - Decision Required\n\n`);
  stream.markdown('---\n\n');
  stream.markdown(`**Decision:** ${task.decision}\n\n`);

  if (task.context) {
    stream.markdown(`**Context:** ${task.context}\n\n`);
  }

  if (task.options.length > 0) {
    stream.markdown('**Options:**\n\n');
    for (const option of task.options) {
      stream.markdown(`**${option.id}: ${option.name}**\n`);
      if (option.pros) {
        stream.markdown(`- *Pros:* ${option.pros}\n`);
      }
      if (option.cons) {
        stream.markdown(`- *Cons:* ${option.cons}\n`);
      }
      stream.markdown('\n');
    }
  }

  stream.markdown('---\n\n');

  // Add button for each option
  for (const option of task.options) {
    stream.button({
      command: 'hopper.chat-participant.execute-plan',
      arguments: [planPath, `decision:${option.id}`],
      title: option.name
    });
    stream.markdown(' ');
  }

  stream.markdown('\n\n');
  stream.markdown(`*${task.resumeSignal}*\n`);
}

/**
 * Build a prompt for executing a single task (agent mode)
 */
function buildTaskPrompt(task: AutoExecutionTask, planContext: string, supportsTools: boolean, workspaceRoot: string): string {
  const filesLine = task.files && task.files.length > 0
    ? `**Files to modify:** ${task.files.join(', ')}\n\n`
    : '';

  const agentInstruction = supportsTools
    ? `Execute this task by making the necessary file changes. Create or modify files as needed. Do not just describe what to do - actually implement it.`
    : `Provide the complete implementation for this task. Show the full file contents that should be created or modified.`;

  return `You are an AI assistant executing a task from a Hopper plan.

**CRITICAL: YOU MUST USE TOOLS TO COMPLETE THIS TASK**
You MUST use tools to complete this task. Do NOT just describe what to do - USE the tools to actually make changes.
Start by using tools immediately. Do not output planning text before using tools.
If you need to read files, use tools. If you need to edit files, use tools. If you need to run commands, use tools.

**CRITICAL: File Path Requirements**
All file paths MUST be absolute paths. The workspace root is: ${workspaceRoot}
When creating or modifying files, always use the full absolute path.
Example: Instead of "src/types/user.ts", use "${workspaceRoot}/src/types/user.ts"

**CRITICAL: Tool Selection**
For file operations, you MUST use the hopper_* tools (NOT copilot_* tools):
- Use hopper_createFile to create new files (with filePath and content)
- Use hopper_createDirectory to create directories (with dirPath)
These tools are reliable and work correctly with absolute paths.

**Long-Running Processes (dev servers, watch tasks, etc.)**
For commands that run continuously and don't exit (like dev servers), use these tools:
- Use hopper_runInTerminal to start the process in a separate terminal (returns immediately)
  - Parameters: command (required), name (optional terminal name), cwd (optional working directory)
- Use hopper_waitForPort to wait for a port to become available
  - Parameters: port (required), host (default: localhost), timeoutMs (default: 30000)
- Use hopper_httpHealthCheck to verify a URL is responding
  - Parameters: url (required), expectedStatus (default: 200), timeoutMs (default: 30000)

Example workflow for starting a dev server:
1. hopper_runInTerminal with command "npm run dev" and name "Dev Server"
2. hopper_waitForPort with port 3000 (or appropriate port)
3. Continue with remaining tasks once the server is ready

**Task:** ${task.name}

${filesLine}**Action to perform:**
${task.action}

**Done when:**
${task.done}

**Verification:**
${task.verify}

**Project context:**
${planContext}

${agentInstruction}

**REMINDER: USE TOOLS NOW. Do not just output text - invoke the tools to make changes.**`;
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
 * Count total phases in ROADMAP.md
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
 * Count plans and summaries in a phase directory
 */
async function countPhaseProgress(
  workspaceUri: vscode.Uri,
  phaseDir: string
): Promise<{ totalPlans: number; completedPlans: number }> {
  const phasePath = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', phaseDir);

  try {
    const entries = await vscode.workspace.fs.readDirectory(phasePath);

    // Count non-FIX plan files (NN-NN-PLAN.md pattern)
    const planFiles = entries
      .filter(([name]) => name.match(/^\d+-\d+-PLAN\.md$/))
      .map(([name]) => name);

    // Count completed plans (those with matching SUMMARY.md)
    const summaryFiles = entries
      .filter(([name]) => name.match(/^\d+-\d+-SUMMARY\.md$/))
      .map(([name]) => name);

    return {
      totalPlans: planFiles.length,
      completedPlans: summaryFiles.length
    };
  } catch {
    return { totalPlans: 0, completedPlans: 0 };
  }
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
  const logger = getLogger();

  // Log execution start
  logger.info(`Starting /execute-plan: ${ctx.request.prompt || 'auto-detect'}`);

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

  // Load execution mode from config
  const configManager = new ConfigManager(workspaceUri);
  const hopperConfig = await configManager.loadConfig();
  const executionMode = hopperConfig.executionMode;

  // Show plan overview
  stream.markdown(`## Executing Plan\n\n`);
  stream.markdown(`**Phase:** ${plan.phase}\n`);
  stream.markdown(`**Plan:** ${plan.planNumber}\n`);
  stream.markdown(`**Objective:** ${plan.objective}\n\n`);
  stream.markdown(`**Tasks:** ${plan.tasks.length}\n`);
  stream.markdown(`**Execution mode:** ${getModeDescription(executionMode)}\n\n`);

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
  const results: { taskId: number; success: boolean; name: string; files?: string[]; commitHash?: string }[] = [];

  // Track commit hashes for all tasks
  const taskCommits: { taskId: number; hash: string; message: string }[] = [];

  // Always enable agent mode - VSCode handles tool capability internally
  const usedAgentMode = true;

  // Check if workspace is a git repository
  const isGitRepo = await checkGitRepo(workspaceUri);
  const autoCommitEnabled = vscode.workspace.getConfiguration('hopper').get('autoCommit', true);

  if (isGitRepo) {
    stream.markdown(`**Git integration:** Enabled${autoCommitEnabled ? ' (auto-commit)' : ''}\n\n`);
  } else {
    stream.markdown('**Git integration:** Not available (not a git repository)\n\n');
  }

  // Track execution start time for summary generation
  const executionStartTime = new Date();

  // Set agent ID for interrupted execution tracking
  const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (projectContext.planningUri) {
    try {
      await setCurrentAgentId(projectContext.planningUri, executionId);
    } catch {
      // Non-fatal if we can't write the ID
    }
  }

  // Check for existing execution state (resuming from checkpoint)
  const planPath = planUri.fsPath;
  let existingState = loadExecutionState(ctx.extensionContext, planPath);
  let startTaskIndex = 0;

  // Parse resume signal from prompt if any (e.g., "approved", "decision:option-a")
  const resumeMatch = promptText.match(/\s+(approved|issue|decision:\w+)$/i);
  const resumeSignal = resumeMatch ? resumeMatch[1].toLowerCase() : null;

  if (existingState && existingState.pausedAtCheckpoint) {
    if (resumeSignal === 'approved') {
      // Checkpoint approved - resume from next task
      stream.markdown('**Checkpoint approved.** Resuming execution...\n\n');
      startTaskIndex = existingState.currentTaskIndex + 1;

      // Mark completed tasks
      for (const taskId of existingState.completedTasks) {
        const task = plan.tasks.find(t => t.id === taskId);
        if (task) {
          results.push({
            taskId,
            success: true,
            name: task.name,
            files: isAutoTask(task) ? task.files : undefined
          });
        }
      }

      // Clear the paused state
      existingState.pausedAtCheckpoint = false;
      existingState.checkpointType = undefined;
      await saveExecutionState(ctx.extensionContext, existingState);

    } else if (resumeSignal === 'issue') {
      // Issue reported - pause and ask for details
      stream.markdown('## Issue Reported\n\n');
      stream.markdown('Please describe the issue you encountered:\n\n');
      stream.markdown('Then run `/execute-plan` with `approved` when the issue is resolved.\n\n');

      stream.button({
        command: 'hopper.chat-participant.execute-plan',
        arguments: [planPath, 'approved'],
        title: 'Resume After Fix'
      });

      return { metadata: { lastCommand: 'execute-plan' } };

    } else if (resumeSignal?.startsWith('decision:')) {
      // Decision made - record and resume
      const decisionId = resumeSignal.replace('decision:', '');
      stream.markdown(`**Decision recorded:** ${decisionId}\n\n`);
      stream.markdown('Resuming execution...\n\n');

      // Record the decision
      existingState.decisions[`task-${existingState.currentTaskIndex + 1}`] = decisionId;
      startTaskIndex = existingState.currentTaskIndex + 1;

      // Mark completed tasks
      for (const taskId of existingState.completedTasks) {
        const task = plan.tasks.find(t => t.id === taskId);
        if (task) {
          results.push({
            taskId,
            success: true,
            name: task.name,
            files: isAutoTask(task) ? task.files : undefined
          });
        }
      }

      // Clear the paused state
      existingState.pausedAtCheckpoint = false;
      existingState.checkpointType = undefined;
      await saveExecutionState(ctx.extensionContext, existingState);

    } else {
      // No resume signal but we have paused state - show where we paused
      stream.markdown('## Execution Paused\n\n');
      stream.markdown(`Paused at task ${existingState.currentTaskIndex + 1} (checkpoint).\n\n`);
      stream.markdown('**Options:**\n');
      stream.markdown('- Click **Approve** to continue\n');
      stream.markdown('- Click **Report Issue** to describe a problem\n\n');

      // Re-render the checkpoint
      const pausedTask = plan.tasks[existingState.currentTaskIndex];
      if (isCheckpointVerify(pausedTask)) {
        renderCheckpointVerify(pausedTask, existingState.currentTaskIndex, plan.tasks.length, stream, planPath);
      } else if (isCheckpointDecision(pausedTask)) {
        renderCheckpointDecision(pausedTask, existingState.currentTaskIndex, plan.tasks.length, stream, planPath);
      }

      return { metadata: { lastCommand: 'execute-plan' } };
    }
  }

  // Execute tasks sequentially starting from startTaskIndex
  for (let i = startTaskIndex; i < plan.tasks.length; i++) {
    // Mark execution as active for this task (enables mid-execution context detection)
    await setActiveExecution(ctx.extensionContext, planPath, i);

    // Check for cancellation before each task
    if (token.isCancellationRequested) {
      // Save cancelled execution state for potential resume with context
      await saveCancelledExecution(ctx.extensionContext, planPath, i);

      // Clear active execution state
      await clearActiveExecution(ctx.extensionContext);

      stream.markdown('\n\n---\n\n');
      stream.markdown('## Execution Paused\n\n');
      stream.markdown(`Completed ${results.filter(r => r.success).length} of ${plan.tasks.length} tasks.\n\n`);
      stream.markdown(`**Paused at:** Task ${i + 1} (${plan.tasks[i]?.name || 'unknown'})\n\n`);

      for (const result of results) {
        stream.markdown(`- **Task ${result.taskId}:** ${result.name} - ${result.success ? 'Completed' : 'Failed'}\n`);
      }

      stream.markdown('\n---\n\n');
      stream.markdown('**Need to add context?** Paste your information and send it.\n');
      stream.markdown('I\'ll resume execution with your context incorporated.\n\n');
      stream.markdown('*This option is available for 5 minutes.*\n');

      return { metadata: { lastCommand: 'execute-plan' } };
    }

    const task = plan.tasks[i];
    stream.progress(`Executing task ${i + 1} of ${plan.tasks.length}...`);

    // Handle checkpoint tasks
    if (isCheckpointVerify(task)) {
      // Check if we should pause based on execution mode
      if (shouldPauseAtCheckpoint(executionMode, 'human-verify')) {
        // Save state and pause at human-verify checkpoint
        const state: ExecutionState = {
          planPath,
          currentTaskIndex: i,
          completedTasks: results.filter(r => r.success).map(r => r.taskId),
          decisions: existingState?.decisions || {},
          pausedAtCheckpoint: true,
          checkpointType: 'human-verify',
          savedAt: Date.now()
        };
        await saveExecutionState(ctx.extensionContext, state);

        // Render checkpoint UI
        renderCheckpointVerify(task, i, plan.tasks.length, stream, planPath);

        return { metadata: { lastCommand: 'execute-plan' } };
      } else {
        // Yolo mode: auto-approve checkpoint
        stream.markdown(`### Task ${i + 1}/${plan.tasks.length}: Checkpoint (auto-approved)\n\n`);
        stream.markdown(`**What was built:** ${task.whatBuilt}\n\n`);
        stream.markdown('*Auto-approved in yolo mode.*\n\n---\n\n');
        results.push({ taskId: task.id, success: true, name: task.whatBuilt });
        continue;
      }
    }

    if (isCheckpointDecision(task)) {
      // Check if we should pause based on execution mode
      if (shouldPauseAtCheckpoint(executionMode, 'decision')) {
        // Save state and pause at decision checkpoint
        const state: ExecutionState = {
          planPath,
          currentTaskIndex: i,
          completedTasks: results.filter(r => r.success).map(r => r.taskId),
          decisions: existingState?.decisions || {},
          pausedAtCheckpoint: true,
          checkpointType: 'decision',
          savedAt: Date.now()
        };
        await saveExecutionState(ctx.extensionContext, state);

        // Render decision UI
        renderCheckpointDecision(task, i, plan.tasks.length, stream, planPath);

        return { metadata: { lastCommand: 'execute-plan' } };
      } else {
        // Yolo mode: auto-select first option
        const firstOption = task.options[0];
        stream.markdown(`### Task ${i + 1}/${plan.tasks.length}: Decision (auto-selected)\n\n`);
        stream.markdown(`**Decision:** ${task.decision}\n`);
        stream.markdown(`**Selected:** ${firstOption?.name || 'first option'} (auto-selected in yolo mode)\n\n---\n\n`);
        if (firstOption) {
          existingState = existingState || { planPath, currentTaskIndex: 0, completedTasks: [], decisions: {}, pausedAtCheckpoint: false, savedAt: Date.now() };
          existingState.decisions[`task-${task.id}`] = firstOption.id;
        }
        results.push({ taskId: task.id, success: true, name: task.decision });
        continue;
      }
    }

    // Handle auto tasks
    if (isAutoTask(task)) {
      // Check if manual mode requires confirmation before auto tasks
      if (shouldConfirmTask(executionMode, 'auto')) {
        const confirmed = await confirmTaskExecution(
          { name: task.name, files: task.files, action: task.action },
          stream
        );
        if (!confirmed) {
          // User skipped this task
          results.push({ taskId: task.id, success: false, name: task.name });
          stream.markdown('---\n\n');
          continue;
        }
      }

      stream.markdown(`### Task ${task.id}/${plan.tasks.length}: ${task.name}\n\n`);

      if (task.files && task.files.length > 0) {
        stream.markdown(`**Files:** ${task.files.join(', ')}\n\n`);
      }

      // Check if this is a scaffolding task that needs special handling
      const isScaffolding = isScaffoldingTask(task.action);
      logger.info(`Task action: ${task.action.slice(0, 100)}...`);
      logger.info(`Is scaffolding task: ${isScaffolding}`);

      if (isScaffolding) {
        const scaffoldCommand = extractScaffoldingCommand(task.action);
        logger.info(`Extracted scaffold command: ${scaffoldCommand}`);
        if (scaffoldCommand) {
          stream.markdown('**Scaffolding detected** - protecting .planning/ directory\n\n');

          const scaffoldResult = await executeScaffoldingWithProtection(
            workspaceUri,
            scaffoldCommand,
            stream
          );

          if (scaffoldResult.success) {
            stream.markdown(`**Status:** Task ${task.id}/${plan.tasks.length} completed (scaffolding)\n\n`);
            stream.markdown('---\n\n');
            results.push({ taskId: task.id, success: true, name: task.name });
            continue;
          } else {
            stream.markdown(`**Error:** ${scaffoldResult.error}\n\n`);
            stream.markdown('---\n\n');
            results.push({ taskId: task.id, success: false, name: task.name });
            continue;
          }
        }
      }

      try {
        // Build prompt for this task
        let prompt = buildTaskPrompt(task, planContext, usedAgentMode, workspaceUri.fsPath);

        // Check for stored execution context (from user pasting during execution)
        const storedContext = getExecutionContext(ctx.extensionContext, planPath);
        if (storedContext) {
          // Append user-provided context to the prompt
          prompt += `\n\n**User-provided context:**\n${storedContext}\n\nUse this information to inform your implementation.`;
          // Clear after incorporating (one-time use)
          await clearExecutionContext(ctx.extensionContext, planPath);
          stream.markdown('*Using additional context from user...*\n\n');
          logger.info(`Incorporated stored context for task ${task.id}`);
        }

        // Get available tools from vscode.lm.tools
        const tools = vscode.lm.tools.filter(tool =>
          tool.tags.includes('workspace') ||
          tool.tags.includes('vscode') ||
          !tool.tags.length
        );

        // Select a model for execution
        const models = await vscode.lm.selectChatModels({
          vendor: 'copilot',
          family: 'gpt-4o'
        });

        if (models.length === 0) {
          throw new Error('No language model available. Please ensure GitHub Copilot is active.');
        }
        const model = models[0];

        // Build messages for the model
        const messages = [
          vscode.LanguageModelChatMessage.User(prompt)
        ];

        // Execute with manual tool orchestration
        stream.markdown('**Agent executing...**\n\n');

        const executionResult = await executeWithTools(model, messages, tools, stream, token, request.toolInvocationToken, workspaceUri.fsPath);

        stream.markdown('\n\n');

        // Show verification criteria after task execution
        if (task.verify) {
          stream.markdown(`**Verify:** ${task.verify}\n\n`);
        }
        if (task.done) {
          stream.markdown(`**Done when:** ${task.done}\n\n`);
        }

        // Check for verify step failures in tool output
        const verifyCheck = detectVerifyFailure(executionResult.toolOutput);

        if (verifyCheck.failed) {
          // Do NOT mark as completed - verify step failed
          logger.warn(`Task ${task.id} verify failed: ${verifyCheck.reason}`);
          stream.markdown(`**Verify failed:** ${verifyCheck.reason}\n\n`);
          stream.markdown(`**Status:** Task ${task.id}/${plan.tasks.length} FAILED (verify step)\n\n`);

          // In yolo mode, auto-log issue
          if (executionMode === 'yolo') {
            const failure: TaskFailure = {
              planPath,
              taskId: task.id,
              taskName: task.name,
              error: `Verify step failed: ${verifyCheck.reason}`,
              fullOutput: executionResult.toolOutput,
              verifyOutput: verifyCheck.reason,
              files: task.files?.filter(Boolean),
              phase: plan.phase,
              planNumber: String(plan.planNumber).padStart(2, '0'),
              timestamp: new Date()
            };

            const logResult = await logTaskFailure(workspaceUri, failure);
            if (logResult.success && logResult.issueId) {
              logger.warn(`Issue logged: ${logResult.issueId}`);
              stream.markdown(`*Issue logged: ${logResult.issueId}*\n\n`);
            } else if (logResult.error) {
              logger.warn(`Failed to log issue: ${logResult.error}`);
            }
          }

          stream.markdown('---\n\n');
          results.push({ taskId: task.id, success: false, name: task.name });
          continue;
        }

        stream.markdown(`**Status:** Task ${task.id}/${plan.tasks.length} completed\n\n`);
        logger.success(`Task ${task.id} completed: ${task.name}`);

        // Auto-commit after task completion if git is available and enabled
        let commitHash: string | undefined;
        // Filter to only valid file paths before staging (belt and suspenders - parser also filters)
        const validFiles = (task.files || []).filter(f =>
          !f.startsWith('[') &&
          !f.startsWith('{') &&
          f.trim().length > 0
        );

        if (isGitRepo && autoCommitEnabled && validFiles.length > 0) {
          try {
            // Stage the files that were modified by this task
            await stageFiles(workspaceUri, validFiles);

            // Generate commit message
            const commitMessage = generateCommitMessage(plan.phase, plan.planNumber, task.name, task.action);

            // Create commit
            const commitResult = await commit(workspaceUri, commitMessage);

            if (commitResult.success && commitResult.hash) {
              commitHash = commitResult.hash;
              taskCommits.push({ taskId: task.id, hash: commitResult.hash, message: commitMessage });
              stream.markdown(`**Committed:** \`${commitResult.hash}\` - ${commitMessage}\n\n`);
            } else if (commitResult.error === 'Nothing to commit') {
              stream.markdown('*No changes to commit for this task.*\n\n');
            } else if (commitResult.error) {
              stream.markdown(`*Commit skipped: ${commitResult.error}*\n\n`);
            }
          } catch (gitError) {
            // Git failures are non-fatal - warn but don't fail the task
            const gitErrorMsg = gitError instanceof Error ? gitError.message : String(gitError);
            logger.warn(`Git commit failed for task ${task.id}: ${gitErrorMsg}`);
            stream.markdown(`*Git commit failed: ${gitErrorMsg}*\n\n`);
          }
        }

        stream.markdown('---\n\n');

        // Track result with files info and commit hash
        results.push({ taskId: task.id, success: true, name: task.name, files: task.files, commitHash });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Log error to output channel (auto-shows)
        logger.error(`Task ${task.id} failed: ${task.name} - ${errorMessage}`);
        stream.markdown(`**Error executing task:** ${errorMessage}\n\n`);

        if (error instanceof vscode.LanguageModelError) {
          stream.markdown('Model error occurred. Try again or check your model connection.\n\n');
          stream.button({
            command: 'hopper.chat-participant.execute-plan',
            title: 'Retry'
          });
        }

        // In yolo mode, auto-log failed tasks to ISSUES.md
        // (In guided/manual mode, user is aware of failures interactively)
        if (executionMode === 'yolo') {
          // For exceptions, we use error message as fullOutput since there's no tool output
          const failure: TaskFailure = {
            planPath,
            taskId: task.id,
            taskName: task.name,
            error: errorMessage,
            fullOutput: errorMessage,
            files: task.files?.filter(Boolean),
            phase: plan.phase,
            planNumber: String(plan.planNumber).padStart(2, '0'),
            timestamp: new Date()
          };

          const logResult = await logTaskFailure(workspaceUri, failure);
          if (logResult.success && logResult.issueId) {
            logger.warn(`Issue logged: ${logResult.issueId}`);
            stream.markdown(`*Issue logged: ${logResult.issueId}*\n\n`);
          } else if (logResult.error) {
            logger.warn(`Failed to log issue: ${logResult.error}`);
          }
        }

        stream.markdown('---\n\n');
        results.push({ taskId: task.id, success: false, name: task.name });
      }
    }
  }

  // Clear execution state on completion
  await clearExecutionState(ctx.extensionContext, planPath);
  await clearActiveExecution(ctx.extensionContext);

  // Gather decisions made during execution
  const decisionsFromState = existingState?.decisions || {};

  // Show completion summary
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  const skippedCount = plan.tasks.length - results.length;

  // Collect all unique files from tasks
  const allFiles = new Set<string>();
  for (const result of results) {
    if (result.files) {
      for (const file of result.files) {
        allFiles.add(file);
      }
    }
  }

  // Log completion to output channel
  logger.info(`Plan execution complete: ${successCount}/${plan.tasks.length} tasks succeeded`);

  stream.markdown('## Execution Complete\n\n');
  stream.markdown(`**Plan:** ${plan.phase} - Plan ${plan.planNumber}\n`);
  stream.markdown(`**Agent mode:** ${usedAgentMode ? 'File modifications' : 'Suggestions only'}\n`);
  stream.markdown(`**Execution mode:** ${getModeDescription(executionMode)}\n`);
  stream.markdown(`**Tasks:** ${successCount}/${plan.tasks.length} completed`);
  if (failedCount > 0) {
    stream.markdown(`, ${failedCount} failed`);
  }
  if (skippedCount > 0) {
    stream.markdown(`, ${skippedCount} skipped`);
  }
  stream.markdown('\n');
  stream.markdown(`**Files touched:** ${allFiles.size}\n\n`);

  // Show task summary with status icons and commit hashes
  stream.markdown('### Task Summary\n\n');
  for (const task of plan.tasks) {
    const result = results.find(r => r.taskId === task.id);
    let icon: string;
    let status: string;
    let commitInfo = '';

    if (!result) {
      icon = '-';
      status = 'not executed';
    } else if (result.success) {
      icon = '+';
      status = 'completed';
      if (result.commitHash) {
        commitInfo = ` [\`${result.commitHash}\`]`;
      }
    } else {
      icon = 'x';
      status = 'failed';
    }

    stream.markdown(`${icon} **Task ${task.id}:** ${task.name} *(${status})*${commitInfo}\n`);
  }
  stream.markdown('\n');

  // Show decisions made (if any)
  if (Object.keys(decisionsFromState).length > 0) {
    stream.markdown('### Decisions Made\n\n');
    for (const [taskKey, decision] of Object.entries(decisionsFromState)) {
      stream.markdown(`- **${taskKey}:** ${decision}\n`);
    }
    stream.markdown('\n');
  }

  // Show files modified
  if (allFiles.size > 0) {
    stream.markdown('### Files Modified\n\n');
    for (const file of Array.from(allFiles).sort()) {
      stream.markdown(`- \`${file}\`\n`);
    }
    stream.markdown('\n');
  }

  // Show plan verification checklist
  if (plan.verification.length > 0) {
    stream.markdown('### Plan Verification\n\n');
    stream.markdown('*Verify manually before committing:*\n\n');
    for (const v of plan.verification) {
      stream.markdown(`- [ ] ${v}\n`);
    }
    stream.markdown('\n');
  }

  // Show success criteria
  if (plan.successCriteria.length > 0) {
    stream.markdown('### Success Criteria\n\n');
    for (const criterion of plan.successCriteria) {
      stream.markdown(`- [ ] ${criterion}\n`);
    }
    stream.markdown('\n');
  }

  // Generate SUMMARY.md if all tasks completed successfully
  const allTasksSucceeded = failedCount === 0 && skippedCount === 0;

  if (allTasksSucceeded) {
    stream.progress('Generating summary...');

    // Calculate execution end time and duration
    const executionEndTime = new Date();
    const durationMs = executionEndTime.getTime() - executionStartTime.getTime();

    // Categorize files as created or modified (simplified - assume all are modified)
    // In practice, you'd check if file existed before
    const filesCreated: string[] = [];
    const filesModified = Array.from(allFiles);

    // Build task commits array from results
    const commits: TaskCommitInfo[] = taskCommits;

    // Extract phase directory from plan path
    // e.g., "/path/.planning/phases/04-execution-commands/04-03-PLAN.md" -> "04-execution-commands"
    const pathParts = planPath.split('/');
    const phaseDir = pathParts[pathParts.length - 2] || plan.phase;

    // Build summary config
    const summaryConfig: SummaryConfig = {
      phase: plan.phase,
      planNumber: plan.planNumber,
      durationMs,
      startTime: executionStartTime,
      endTime: executionEndTime,
      tasks: plan.tasks,
      commits,
      filesCreated,
      filesModified,
      decisions: decisionsFromState,
      objective: plan.objective
    };

    // Save summary
    const summaryResult = await saveSummary(workspaceUri, phaseDir, plan.planNumber, summaryConfig);

    if (summaryResult.success && summaryResult.filePath) {
      stream.markdown('### Summary Generated\n\n');
      stream.markdown(`Created: \`${summaryResult.filePath.fsPath.replace(workspaceUri.fsPath, '.')}\`\n\n`);
      stream.reference(summaryResult.filePath);
      stream.markdown('\n\n');

      // Auto-commit the summary if git is available
      if (isGitRepo && autoCommitEnabled) {
        try {
          const summaryRelPath = summaryResult.filePath.fsPath.replace(workspaceUri.fsPath + '/', '');
          await stageFiles(workspaceUri, [summaryRelPath]);
          const phaseNum = plan.phase.match(/^(\d+)/)?.[1] || '00';
          const planNum = String(plan.planNumber).padStart(2, '0');
          const docCommitMessage = `docs(${phaseNum}-${planNum}): complete plan summary`;
          const docCommitResult = await commit(workspaceUri, docCommitMessage);

          if (docCommitResult.success && docCommitResult.hash) {
            stream.markdown(`**Summary committed:** \`${docCommitResult.hash}\` - ${docCommitMessage}\n\n`);
          }
        } catch (gitError) {
          const gitErrorMsg = gitError instanceof Error ? gitError.message : String(gitError);
          stream.markdown(`*Summary commit failed: ${gitErrorMsg}*\n\n`);
        }
      }
    } else {
      stream.markdown(`*Summary generation failed: ${summaryResult.error}*\n\n`);
    }

    // Clean up any handoff file from paused session now that plan is complete
    if (projectContext.planningUri) {
      await clearHandoffAfterCompletion(projectContext.planningUri, phaseDir);
    }

    // Update STATE.md with execution completion
    if (projectContext.planningUri && projectContext.roadmapMd) {
      try {
        const totalPhases = countTotalPhases(projectContext.roadmapMd);
        const phaseProgress = await countPhaseProgress(workspaceUri, phaseDir);
        const durationMinutes = Math.round(durationMs / 60000);

        // Extract phase name from phaseDir (e.g., "04-execution-commands" -> "execution-commands")
        const phaseName = phaseDir.replace(/^\d+(?:\.\d+)*-/, '').replace(/-/g, ' ');

        // Extract numeric phase from plan.phase (e.g., "04: Execution Commands" -> 4)
        const phaseNum = parseInt(plan.phase.match(/^(\d+)/)?.[1] || '0', 10);

        // Get plan file name for description (e.g., "04-03-PLAN.md")
        const planFileName = pathParts[pathParts.length - 1] || `${String(phaseNum).padStart(2, '0')}-${String(plan.planNumber).padStart(2, '0')}-PLAN.md`;

        await updateStateAfterExecution(
          projectContext.planningUri,
          phaseNum,
          totalPhases,
          phaseName,
          phaseProgress.completedPlans,  // Current completed count (includes this plan's summary)
          phaseProgress.totalPlans,
          planFileName,
          durationMinutes
        );

        // Clear agent ID - execution completed successfully
        await clearCurrentAgentId(projectContext.planningUri);
      } catch (stateErr) {
        logger.error(`Failed to update STATE.md: ${stateErr instanceof Error ? stateErr.message : String(stateErr)}`);
        // Don't fail the overall execution, just log the error
      }
    }
  }

  stream.markdown('### Next Steps\n\n');

  // Check if any tasks failed - show failure-specific next steps
  const hasFailures = failedCount > 0;

  if (hasFailures) {
    // Failure flow: Plan Fix is primary action
    stream.markdown('Some tasks failed during execution.\n\n');

    // Construct plan identifier using rawPlan to preserve FIX suffixes
    // e.g., phase "09-useability-and-skills" + rawPlan "02-FIX-FIX" -> "09-02-FIX-FIX"
    const phaseNum = plan.phase.match(/^(\d+)/)?.[1] || '00';
    const planIdentifier = `${phaseNum}-${plan.rawPlan}`;

    stream.markdown('1. **Plan fixes** to address the failed tasks\n');
    stream.button({
      command: 'hopper.chat-participant.plan-fix',
      arguments: [planIdentifier],
      title: 'Plan Fix'
    });

    stream.markdown('\n2. **Check progress** to see overall status\n');
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });
  } else {
    // Success flow: existing behavior
    if (usedAgentMode) {
      stream.markdown('1. **Review changes** made by the agent\n');
      stream.button({
        command: 'git.viewChanges',
        title: 'View Git Changes'
      });
      stream.markdown('\n2. **Verify** all criteria above\n');
      stream.markdown('3. **Commit** if verification passes\n');
    } else {
      stream.markdown('1. **Apply the changes** shown above to your codebase\n');
      stream.markdown('2. **Test** your changes\n');
      stream.markdown('3. **Commit** when ready\n');
    }

    stream.markdown('\n4. **Update progress** to track completion\n');
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });
  }

  stream.markdown('\n\n');
  stream.reference(planUri);

  return {
    metadata: {
      lastCommand: 'execute-plan',
      phaseNumber: phaseNumber
    }
  };
}
