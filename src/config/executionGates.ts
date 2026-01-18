import * as vscode from 'vscode';
import { ExecutionMode } from './types';

/**
 * Determines if execution should pause at a checkpoint based on execution mode.
 *
 * @param mode - The current execution mode
 * @param checkpointType - The type of checkpoint ('human-verify' or 'decision')
 * @returns true if execution should pause, false to auto-approve
 */
export function shouldPauseAtCheckpoint(
  mode: ExecutionMode,
  checkpointType: 'human-verify' | 'decision'
): boolean {
  switch (mode) {
    case 'yolo':
      // Yolo mode: auto-approve all checkpoints
      return false;
    case 'guided':
      // Guided mode: pause at all checkpoints
      return true;
    case 'manual':
      // Manual mode: pause at all checkpoints
      return true;
    default:
      // Default to guided behavior
      return true;
  }
}

/**
 * Determines if a task requires confirmation before execution based on execution mode.
 *
 * @param mode - The current execution mode
 * @param taskType - The type of task
 * @returns true if task needs confirmation, false to auto-execute
 */
export function shouldConfirmTask(
  mode: ExecutionMode,
  taskType: 'auto' | 'checkpoint:human-verify' | 'checkpoint:decision'
): boolean {
  switch (mode) {
    case 'yolo':
      // Yolo mode: never confirm, auto-execute everything
      return false;
    case 'guided':
      // Guided mode: only confirm checkpoints, not auto tasks
      return taskType !== 'auto';
    case 'manual':
      // Manual mode: confirm every task
      return true;
    default:
      // Default to guided behavior
      return taskType !== 'auto';
  }
}

/**
 * Task preview information for confirmation dialog.
 */
export interface TaskPreview {
  name: string;
  files?: string[];
  action: string;
}

/**
 * Shows a confirmation dialog for a task before execution.
 *
 * @param task - Task preview information
 * @param stream - Chat response stream for status messages
 * @returns true if user confirms execution, false if skipped
 */
export async function confirmTaskExecution(
  task: TaskPreview,
  stream: vscode.ChatResponseStream
): Promise<boolean> {
  // Build action summary (first 100 chars)
  const actionSummary = task.action.length > 100
    ? task.action.slice(0, 100) + '...'
    : task.action;

  // Show preview in stream
  stream.markdown('**Confirm task execution:**\n\n');
  stream.markdown(`- **Name:** ${task.name}\n`);
  if (task.files && task.files.length > 0) {
    stream.markdown(`- **Files:** ${task.files.join(', ')}\n`);
  }
  stream.markdown(`- **Action:** ${actionSummary}\n\n`);

  // Use modal dialog for confirmation
  const result = await vscode.window.showInformationMessage(
    `Execute task: ${task.name}?`,
    { modal: true, detail: `Action: ${actionSummary}` },
    'Execute',
    'Skip'
  );

  if (result === 'Execute') {
    stream.markdown('*Executing...*\n\n');
    return true;
  } else {
    stream.markdown('*Skipped by user.*\n\n');
    return false;
  }
}

/**
 * Returns a user-friendly description for the current execution mode.
 *
 * @param mode - The execution mode
 * @returns Human-readable description of the mode's behavior
 */
export function getModeDescription(mode: ExecutionMode): string {
  switch (mode) {
    case 'yolo':
      return 'Auto-executing all tasks without confirmation';
    case 'guided':
      return 'Pausing at checkpoints for review';
    case 'manual':
      return 'Confirming each task before execution';
    default:
      return 'Unknown mode';
  }
}
