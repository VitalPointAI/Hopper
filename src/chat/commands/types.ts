import * as vscode from 'vscode';
import { LicenseValidator } from '../../licensing/validator';
import { ProjectContext } from '../context/projectContext';

/**
 * Result metadata returned by the Hopper chat participant
 */
export interface IHopperResult extends vscode.ChatResult {
  metadata?: {
    lastCommand?: string;
    phaseNumber?: number;
  };
}

/**
 * Context passed to each command handler
 */
export interface CommandContext {
  request: vscode.ChatRequest;
  context: vscode.ChatContext;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  licenseValidator: LicenseValidator;
  projectContext: ProjectContext;
  /** Extension context for globalState access (execution state persistence) */
  extensionContext: vscode.ExtensionContext;
}

/**
 * Command handler function signature
 */
export type CommandHandler = (ctx: CommandContext) => Promise<IHopperResult>;

/**
 * Registry mapping command names to handlers
 */
export type CommandRegistry = Map<string, CommandHandler>;
