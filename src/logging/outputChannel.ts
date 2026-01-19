import * as vscode from 'vscode';

/**
 * Singleton HopperLogger class for structured output channel logging.
 * Provides timestamped, categorized logging with auto-show on errors.
 */
export class HopperLogger {
  private static instance: HopperLogger | undefined;
  private outputChannel: vscode.OutputChannel;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Hopper');
  }

  /**
   * Get the singleton logger instance
   */
  static getInstance(): HopperLogger {
    if (!HopperLogger.instance) {
      HopperLogger.instance = new HopperLogger();
    }
    return HopperLogger.instance;
  }

  /**
   * Get the underlying output channel (for disposal registration)
   */
  getOutputChannel(): vscode.OutputChannel {
    return this.outputChannel;
  }

  /**
   * Format timestamp for log entries [HH:MM:SS]
   */
  private formatTimestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `[${hours}:${minutes}:${seconds}]`;
  }

  /**
   * Log an informational message
   */
  info(message: string): void {
    const line = `${this.formatTimestamp()} [INFO] ${message}`;
    this.outputChannel.appendLine(line);
    console.log(`[Hopper] ${message}`);
  }

  /**
   * Log a warning message
   */
  warn(message: string): void {
    const line = `${this.formatTimestamp()} [WARN] ${message}`;
    this.outputChannel.appendLine(line);
    console.warn(`[Hopper] ${message}`);
  }

  /**
   * Log an error message and auto-show the output channel
   */
  error(message: string): void {
    const line = `${this.formatTimestamp()} [ERROR] ${message}`;
    this.outputChannel.appendLine(line);
    console.error(`[Hopper] ${message}`);
    // Auto-show on errors so user sees the problem
    this.outputChannel.show(true); // true preserves focus on current editor
  }

  /**
   * Log a success message
   */
  success(message: string): void {
    const line = `${this.formatTimestamp()} [SUCCESS] ${message}`;
    this.outputChannel.appendLine(line);
    console.log(`[Hopper] ${message}`);
  }

  /**
   * Log the start of a tool invocation
   */
  toolStart(toolName: string, input: unknown): void {
    const inputStr = typeof input === 'object'
      ? JSON.stringify(input, null, 2).slice(0, 500) // Truncate large inputs
      : String(input);
    const line = `${this.formatTimestamp()} [TOOL] Starting: ${toolName}`;
    this.outputChannel.appendLine(line);
    this.outputChannel.appendLine(`  Input: ${inputStr}`);
    console.log(`[Hopper:Tool] Starting ${toolName}`, input);
  }

  /**
   * Log successful completion of a tool invocation
   */
  toolComplete(toolName: string, result: string): void {
    const line = `${this.formatTimestamp()} [TOOL] Completed: ${toolName}`;
    this.outputChannel.appendLine(line);
    if (result && result !== 'success') {
      const truncated = result.length > 200 ? result.slice(0, 200) + '...' : result;
      this.outputChannel.appendLine(`  Result: ${truncated}`);
    }
    console.log(`[Hopper:Tool] Completed ${toolName}`, result);
  }

  /**
   * Log a tool error and auto-show the output channel
   */
  toolError(toolName: string, error: string | Error): void {
    const errorMsg = error instanceof Error ? error.message : error;
    const line = `${this.formatTimestamp()} [TOOL] [ERROR] Failed: ${toolName}`;
    this.outputChannel.appendLine(line);
    this.outputChannel.appendLine(`  Error: ${errorMsg}`);
    console.error(`[Hopper:Tool] Failed ${toolName}:`, errorMsg);
    // Auto-show on errors so user sees the problem
    this.outputChannel.show(true);
  }

  /**
   * Log a categorized message (for backwards compatibility)
   */
  log(category: string, message: string, ...args: unknown[]): void {
    const formattedArgs = args.length > 0
      ? ' ' + args.map(a => {
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        }).join(' ')
      : '';

    const line = `${this.formatTimestamp()} [${category.toUpperCase()}] ${message}${formattedArgs}`;
    this.outputChannel.appendLine(line);
    console.log(`[Hopper:${category}] ${message}`, ...args);
  }

  /**
   * Log an error with category (for backwards compatibility)
   */
  logError(category: string, message: string, error?: unknown): void {
    let errorStr = '';
    if (error instanceof Error) {
      errorStr = ` Error: ${error.message}`;
    } else if (error) {
      errorStr = ` Error: ${String(error)}`;
    }

    const line = `${this.formatTimestamp()} [${category.toUpperCase()}] ERROR: ${message}${errorStr}`;
    this.outputChannel.appendLine(line);
    console.error(`[Hopper:${category}] ${message}`, error);
    // Auto-show on errors
    this.outputChannel.show(true);
  }

  /**
   * Show the output channel (brings it to focus)
   */
  show(): void {
    this.outputChannel.show();
  }
}
