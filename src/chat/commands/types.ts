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
    /** Suggested next action for follow-up prompts */
    nextAction?: string;
    /** Path to handoff file if paused work exists */
    handoffPath?: string;
    /** Path to plan file for execution */
    planPath?: string | null;
    /** Generic path for file references */
    path?: string;
    /** Phase identifier */
    phase?: string;
    /** Issue reference */
    issue?: string;
    /** Test results from verify-work */
    testResults?: {
      passed: number;
      failed: number;
      partial: number;
      skipped: number;
    };
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
