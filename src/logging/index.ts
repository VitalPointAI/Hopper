import * as vscode from 'vscode';
import { HopperLogger } from './outputChannel';

/**
 * Get the singleton logger instance
 */
export function getLogger(): HopperLogger {
  return HopperLogger.getInstance();
}

/**
 * Initialize the Hopper output channel and return it for disposal registration.
 * Call this during extension activation.
 */
export function initLogging(): vscode.OutputChannel {
  const logger = getLogger();
  return logger.getOutputChannel();
}

/**
 * Log a message to the Hopper output channel (backwards compatible)
 */
export function log(category: string, message: string, ...args: unknown[]): void {
  getLogger().log(category, message, ...args);
}

/**
 * Log an error to the Hopper output channel (backwards compatible)
 */
export function logError(category: string, message: string, error?: unknown): void {
  getLogger().logError(category, message, error);
}

/**
 * Show the Hopper output channel
 */
export function showOutputChannel(): void {
  getLogger().show();
}

// Re-export the HopperLogger class for direct access
export { HopperLogger } from './outputChannel';
