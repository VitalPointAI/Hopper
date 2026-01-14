import * as vscode from 'vscode';
import { LicenseValidator } from '../../licensing/validator';

/**
 * Result metadata returned by the SpecFlow chat participant
 */
export interface ISpecflowResult extends vscode.ChatResult {
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
}

/**
 * Command handler function signature
 */
export type CommandHandler = (ctx: CommandContext) => Promise<ISpecflowResult>;

/**
 * Registry mapping command names to handlers
 */
export type CommandRegistry = Map<string, CommandHandler>;
