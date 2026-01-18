import * as vscode from 'vscode';
import { PlanningDepth, ExecutionMode, HopperConfig } from './types';

/**
 * QuickPick item with associated depth value.
 */
interface DepthQuickPickItem extends vscode.QuickPickItem {
  depth: PlanningDepth;
}

/**
 * QuickPick item with associated mode value.
 */
interface ModeQuickPickItem extends vscode.QuickPickItem {
  mode: ExecutionMode;
}

/**
 * Shows a QuickPick dialog for selecting planning depth.
 * @returns The selected depth, or undefined if cancelled
 */
export async function selectPlanningDepth(): Promise<PlanningDepth | undefined> {
  const items: DepthQuickPickItem[] = [
    {
      label: 'Quick',
      description: 'Minimal detail, fast generation',
      detail: 'Good for simple projects or prototypes.',
      depth: 'quick',
    },
    {
      label: '$(star-full) Standard (Recommended)',
      description: 'Balanced detail for most projects',
      detail: 'Clear phases and tasks. Default level.',
      depth: 'standard',
      picked: true,
    },
    {
      label: 'Comprehensive',
      description: 'Maximum detail with thorough analysis',
      detail: 'Best for complex projects requiring extensive planning.',
      depth: 'comprehensive',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Select Planning Depth',
    placeHolder: 'How detailed should project plans be?',
    ignoreFocusOut: true,
  });

  return selected?.depth;
}

/**
 * Shows a QuickPick dialog for selecting execution mode.
 * @returns The selected mode, or undefined if cancelled
 */
export async function selectExecutionMode(): Promise<ExecutionMode | undefined> {
  const items: ModeQuickPickItem[] = [
    {
      label: 'Yolo',
      description: 'No confirmations',
      detail: 'Auto-execute all tasks without pausing. Maximum speed.',
      mode: 'yolo',
    },
    {
      label: '$(star-full) Guided (Recommended)',
      description: 'Pause at checkpoints for review',
      detail: 'Auto tasks run, but checkpoints wait for approval.',
      mode: 'guided',
      picked: true,
    },
    {
      label: 'Manual',
      description: 'Confirm every task',
      detail: 'Maximum control. Each task waits for approval.',
      mode: 'manual',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Select Execution Mode',
    placeHolder: 'How should plans be executed?',
    ignoreFocusOut: true,
  });

  return selected?.mode;
}

/**
 * Displays the current configuration in a chat stream.
 * @param config The configuration to display
 * @param stream The chat response stream to write to
 */
export function showConfigurationSummary(
  config: HopperConfig,
  stream: vscode.ChatResponseStream
): void {
  const depthDescriptions: Record<PlanningDepth, string> = {
    quick: 'Minimal detail, fast generation',
    standard: 'Balanced detail for most projects',
    comprehensive: 'Maximum detail with thorough analysis',
  };

  const modeDescriptions: Record<ExecutionMode, string> = {
    yolo: 'Auto-execute without confirmations',
    guided: 'Pause at checkpoints for review',
    manual: 'Confirm every task before execution',
  };

  stream.markdown('### Configuration\n\n');
  stream.markdown('| Setting | Value | Description |\n');
  stream.markdown('|---------|-------|-------------|\n');
  stream.markdown(`| Planning Depth | **${config.planningDepth}** | ${depthDescriptions[config.planningDepth]} |\n`);
  stream.markdown(`| Execution Mode | **${config.executionMode}** | ${modeDescriptions[config.executionMode]} |\n`);
  stream.markdown('\n*Change settings anytime with `/configure`*\n\n');
}
