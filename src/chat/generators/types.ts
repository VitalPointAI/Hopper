import * as vscode from 'vscode';

/**
 * Configuration for generating PROJECT.md
 */
export interface ProjectConfig {
  /** Project name */
  name: string;
  /** Brief project description (2-3 sentences) */
  description: string;
  /** Core value - the ONE thing that matters most */
  coreValue: string;
  /** Active requirements being built toward */
  requirements: string[];
  /** Explicit boundaries - what we're NOT building */
  outOfScope: string[];
  /** Background context informing implementation */
  context: string;
  /** Hard constraints on implementation */
  constraints: string[];
}

/**
 * Result from a generator operation
 */
export interface GeneratorResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Path to created file (if successful) */
  filePath?: vscode.Uri;
  /** Error message (if failed) */
  error?: string;
}
