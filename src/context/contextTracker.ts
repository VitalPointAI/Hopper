import * as vscode from 'vscode';

/**
 * Pie chart symbols for different fill levels (0-100%)
 * Using Unicode pie chart characters that show progressive fill
 */
const PIE_CHARTS = {
  0: '○',    // Empty circle
  12: '◔',   // Quarter filled (top-right)
  25: '◑',   // Half filled (right)
  37: '◕',   // Three-quarters filled
  50: '◑',   // Half filled
  62: '◕',   // Three-quarters filled
  75: '◕',   // Three-quarters filled
  87: '◕',   // Nearly full
  100: '●',  // Full circle
};

/**
 * Get the appropriate pie chart symbol for a percentage
 */
function getPieChart(percentage: number): string {
  if (percentage <= 0) return '○';
  if (percentage < 15) return '◔';
  if (percentage < 40) return '◑';
  if (percentage < 75) return '◕';
  return '●';
}

/**
 * Get color based on usage percentage
 */
function getStatusColor(percentage: number): string {
  if (percentage < 50) return 'statusBarItem.foreground';
  if (percentage < 75) return 'statusBarItem.warningForeground';
  return 'statusBarItem.errorForeground';
}

/**
 * Estimate token count from text
 * Rough approximation: ~4 characters per token for English text
 * This is an estimate - actual tokenization varies by model
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  // More accurate estimation considering:
  // - Whitespace and punctuation often become separate tokens
  // - Code has more symbols which tokenize differently
  const charCount = text.length;
  return Math.ceil(charCount / 3.5); // Slightly more conservative for code
}

/**
 * Context usage tracking for Hopper chat sessions
 */
export interface ContextUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxTokens: number;
  percentage: number;
}

/**
 * Context Tracker - tracks token usage across chat sessions
 */
export class ContextTracker {
  private statusBarItem: vscode.StatusBarItem;
  private inputTokens: number = 0;
  private outputTokens: number = 0;
  private maxTokens: number = 128000; // Default for GPT-4o
  private sessionStartTime: Date | null = null;

  constructor() {
    // Create status bar item (right side, high priority to be visible)
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.name = 'Hopper Context';
    this.statusBarItem.command = 'hopper.showContextDetails';
    this.updateStatusBar();
  }

  /**
   * Start a new session (resets counters)
   */
  startSession(maxTokens?: number): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.sessionStartTime = new Date();
    if (maxTokens) {
      this.maxTokens = maxTokens;
    }
    this.updateStatusBar();
    this.show();
  }

  /**
   * Track input tokens (user message, context, tool results)
   */
  addInput(text: string): void {
    const tokens = estimateTokens(text);
    this.inputTokens += tokens;
    this.updateStatusBar();
  }

  /**
   * Track output tokens (assistant response)
   */
  addOutput(text: string): void {
    const tokens = estimateTokens(text);
    this.outputTokens += tokens;
    this.updateStatusBar();
  }

  /**
   * Add raw token count (when we have actual counts)
   */
  addTokens(input: number, output: number): void {
    this.inputTokens += input;
    this.outputTokens += output;
    this.updateStatusBar();
  }

  /**
   * Get current usage statistics
   */
  getUsage(): ContextUsage {
    const totalTokens = this.inputTokens + this.outputTokens;
    const percentage = Math.min(100, Math.round((totalTokens / this.maxTokens) * 100));
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens,
      maxTokens: this.maxTokens,
      percentage,
    };
  }

  /**
   * Update the status bar display
   */
  private updateStatusBar(): void {
    const usage = this.getUsage();
    const pie = getPieChart(usage.percentage);

    // Format token counts (use K for thousands)
    const formatTokens = (n: number): string => {
      if (n >= 1000) {
        return `${(n / 1000).toFixed(1)}K`;
      }
      return String(n);
    };

    // Status bar text: pie chart + percentage
    this.statusBarItem.text = `${pie} ${usage.percentage}%`;

    // Tooltip with detailed breakdown
    const tooltipLines = [
      `**Hopper Context Usage**`,
      ``,
      `${pie} **${usage.percentage}%** used`,
      ``,
      `Input: ${formatTokens(usage.inputTokens)} tokens`,
      `Output: ${formatTokens(usage.outputTokens)} tokens`,
      `Total: ${formatTokens(usage.totalTokens)} / ${formatTokens(usage.maxTokens)}`,
    ];

    if (this.sessionStartTime) {
      const duration = Math.round((Date.now() - this.sessionStartTime.getTime()) / 1000 / 60);
      tooltipLines.push(``, `Session: ${duration} min`);
    }

    tooltipLines.push(``, `*Click for details*`);

    const tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));
    tooltip.isTrusted = true;
    this.statusBarItem.tooltip = tooltip;

    // Color based on usage level
    if (usage.percentage >= 90) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (usage.percentage >= 75) {
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.statusBarItem.backgroundColor = undefined;
    }
  }

  /**
   * Show the status bar item
   */
  show(): void {
    this.statusBarItem.show();
  }

  /**
   * Hide the status bar item
   */
  hide(): void {
    this.statusBarItem.hide();
  }

  /**
   * Reset the tracker
   */
  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.sessionStartTime = null;
    this.updateStatusBar();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}

// Singleton instance
let contextTrackerInstance: ContextTracker | null = null;

/**
 * Get the global context tracker instance
 */
export function getContextTracker(): ContextTracker {
  if (!contextTrackerInstance) {
    contextTrackerInstance = new ContextTracker();
  }
  return contextTrackerInstance;
}

/**
 * Register context tracker and related commands
 */
export function registerContextTracker(context: vscode.ExtensionContext): ContextTracker {
  const tracker = getContextTracker();

  // Register command to show detailed context info
  const showDetailsCommand = vscode.commands.registerCommand(
    'hopper.showContextDetails',
    async () => {
      const usage = tracker.getUsage();
      const pie = getPieChart(usage.percentage);

      const formatTokens = (n: number): string => {
        if (n >= 1000) {
          return `${(n / 1000).toFixed(1)}K`;
        }
        return String(n);
      };

      // Show quick pick with options
      const selected = await vscode.window.showQuickPick([
        {
          label: `${pie} Context Usage: ${usage.percentage}%`,
          description: `${formatTokens(usage.totalTokens)} / ${formatTokens(usage.maxTokens)} tokens`,
          detail: `Input: ${formatTokens(usage.inputTokens)} | Output: ${formatTokens(usage.outputTokens)}`,
        },
        {
          label: '$(refresh) Reset Context Counter',
          description: 'Start fresh token counting',
        },
        {
          label: '$(eye-closed) Hide Status Bar',
          description: 'Hide the context indicator',
        },
      ], {
        title: 'Hopper Context Usage',
        placeHolder: 'Token usage for current session (estimates)',
      });

      if (selected?.label.includes('Reset')) {
        tracker.reset();
        vscode.window.showInformationMessage('Context counter reset.');
      } else if (selected?.label.includes('Hide')) {
        tracker.hide();
        vscode.window.showInformationMessage('Context indicator hidden. Use command palette to show again.');
      }
    }
  );
  context.subscriptions.push(showDetailsCommand);

  // Register command to show the status bar
  const showCommand = vscode.commands.registerCommand(
    'hopper.showContextIndicator',
    () => {
      tracker.show();
    }
  );
  context.subscriptions.push(showCommand);

  // Register command to reset
  const resetCommand = vscode.commands.registerCommand(
    'hopper.resetContext',
    () => {
      tracker.reset();
      vscode.window.showInformationMessage('Context counter reset.');
    }
  );
  context.subscriptions.push(resetCommand);

  // Add tracker to disposables
  context.subscriptions.push({ dispose: () => tracker.dispose() });

  return tracker;
}
