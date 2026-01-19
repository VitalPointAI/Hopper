import * as vscode from 'vscode';

/**
 * Singleton output channel for Hopper debug logs
 */
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Initialize the Hopper output channel
 * Call this during extension activation
 */
export function initLogging(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Hopper');
  }
  return outputChannel;
}

/**
 * Get the output channel (creates if not exists)
 */
export function getOutputChannel(): vscode.OutputChannel {
  return initLogging();
}

/**
 * Log a message to the Hopper output channel
 * Also logs to console for developer tools access
 *
 * @param category - Category for the log (e.g., 'license', 'auth', 'rpc')
 * @param message - The log message
 * @param args - Additional data to log (will be JSON stringified)
 */
export function log(category: string, message: string, ...args: unknown[]): void {
  const channel = initLogging();
  const timestamp = new Date().toISOString();
  const formattedArgs = args.length > 0
    ? ' ' + args.map(a => {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }).join(' ')
    : '';

  const logLine = `[${timestamp}] [${category}] ${message}${formattedArgs}`;
  channel.appendLine(logLine);

  // Also log to console for developer tools
  console.log(`[Hopper:${category}] ${message}`, ...args);
}

/**
 * Log an error to the Hopper output channel
 *
 * @param category - Category for the log
 * @param message - The error message
 * @param error - The error object
 */
export function logError(category: string, message: string, error?: unknown): void {
  const channel = initLogging();
  const timestamp = new Date().toISOString();

  let errorStr = '';
  if (error instanceof Error) {
    errorStr = ` Error: ${error.message}`;
    if (error.stack) {
      errorStr += `\n${error.stack}`;
    }
  } else if (error) {
    errorStr = ` Error: ${String(error)}`;
  }

  const logLine = `[${timestamp}] [${category}] ERROR: ${message}${errorStr}`;
  channel.appendLine(logLine);

  // Also log to console
  console.error(`[Hopper:${category}] ${message}`, error);
}

/**
 * Show the Hopper output channel (brings it to focus)
 */
export function showOutputChannel(): void {
  const channel = initLogging();
  channel.show();
}
