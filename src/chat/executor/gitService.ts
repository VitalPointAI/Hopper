import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Result of a git commit operation
 */
export interface CommitResult {
  success: boolean;
  hash?: string;
  error?: string;
}

/**
 * Commit information from git log
 */
export interface CommitInfo {
  hash: string;
  message: string;
}

/**
 * Execute a git command in the workspace directory
 */
async function execGit(workspaceUri: vscode.Uri, command: string): Promise<{ stdout: string; stderr: string }> {
  const cwd = workspaceUri.fsPath;
  try {
    return await execAsync(`git ${command}`, { cwd, maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    // exec throws on non-zero exit code, but we want to handle that gracefully
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || execError.message || 'Unknown git error'
    };
  }
}

/**
 * Check if workspace is a git repository
 */
export async function checkGitRepo(workspaceUri: vscode.Uri): Promise<boolean> {
  try {
    const { stderr } = await execGit(workspaceUri, 'rev-parse --git-dir');
    return !stderr.includes('not a git repository');
  } catch {
    return false;
  }
}

/**
 * Get list of currently staged files
 */
export async function getStagedFiles(workspaceUri: vscode.Uri): Promise<string[]> {
  const { stdout, stderr } = await execGit(workspaceUri, 'diff --cached --name-only');
  if (stderr) {
    console.error('[Hopper Git] getStagedFiles error:', stderr);
    return [];
  }
  return stdout.trim().split('\n').filter(Boolean);
}

/**
 * Stage all changes (git add -A)
 */
export async function stageAll(workspaceUri: vscode.Uri): Promise<void> {
  const { stderr } = await execGit(workspaceUri, 'add -A');
  if (stderr) {
    console.error('[Hopper Git] stageAll error:', stderr);
    throw new Error(`Failed to stage changes: ${stderr}`);
  }
}

/**
 * Stage specific files
 * @param workspaceUri The workspace root URI
 * @param files Array of file paths (relative to workspace root)
 */
export async function stageFiles(workspaceUri: vscode.Uri, files: string[]): Promise<void> {
  if (files.length === 0) {
    return;
  }

  // Quote each file path to handle spaces
  const quotedFiles = files.map(f => `"${f}"`).join(' ');
  const { stderr } = await execGit(workspaceUri, `add ${quotedFiles}`);
  if (stderr) {
    console.error('[Hopper Git] stageFiles error:', stderr);
    throw new Error(`Failed to stage files: ${stderr}`);
  }
}

/**
 * Create a git commit with the given message
 * @param workspaceUri The workspace root URI
 * @param message Commit message
 * @returns Commit result with success status, hash (if successful), or error
 */
export async function commit(workspaceUri: vscode.Uri, message: string): Promise<CommitResult> {
  // Escape quotes in message for shell
  const escapedMessage = message.replace(/"/g, '\\"');
  const { stdout, stderr } = await execGit(workspaceUri, `commit -m "${escapedMessage}"`);

  // Check for "nothing to commit" which isn't really an error
  if (stderr.includes('nothing to commit') || stdout.includes('nothing to commit')) {
    return {
      success: false,
      error: 'Nothing to commit'
    };
  }

  // Check for actual errors
  if (stderr && !stdout) {
    return {
      success: false,
      error: stderr
    };
  }

  // Extract commit hash from output (usually first line contains it)
  // Format: "[branch hash] message" or "[(root-commit) hash] message"
  const hashMatch = stdout.match(/\[[\w-]+ ([a-f0-9]+)\]/);
  const hash = hashMatch ? hashMatch[1] : undefined;

  return {
    success: true,
    hash
  };
}

/**
 * Get recent commit history
 * @param workspaceUri The workspace root URI
 * @param count Number of commits to retrieve
 * @returns Array of commit info objects
 */
export async function getRecentCommits(workspaceUri: vscode.Uri, count: number): Promise<CommitInfo[]> {
  const { stdout, stderr } = await execGit(workspaceUri, `log --oneline -n ${count}`);

  if (stderr) {
    console.error('[Hopper Git] getRecentCommits error:', stderr);
    return [];
  }

  const lines = stdout.trim().split('\n').filter(Boolean);
  return lines.map(line => {
    const spaceIndex = line.indexOf(' ');
    if (spaceIndex === -1) {
      return { hash: line, message: '' };
    }
    return {
      hash: line.slice(0, spaceIndex),
      message: line.slice(spaceIndex + 1)
    };
  });
}

/**
 * Detect commit type from task name/content
 * @param taskName The task name
 * @param action Optional task action content
 * @returns Commit type prefix (feat, fix, refactor, docs)
 */
export function detectCommitType(taskName: string, action?: string): string {
  const lowerName = taskName.toLowerCase();
  const lowerAction = (action || '').toLowerCase();
  const combined = lowerName + ' ' + lowerAction;

  // Check for fix indicators
  if (combined.includes('fix') || combined.includes('bug') || combined.includes('error') || combined.includes('issue')) {
    return 'fix';
  }

  // Check for refactor indicators
  if (combined.includes('refactor') || combined.includes('restructure') || combined.includes('reorganize') || combined.includes('rename')) {
    return 'refactor';
  }

  // Check for docs indicators
  if (combined.includes('document') || combined.includes('readme') || combined.includes('summary') || combined.includes('comment')) {
    return 'docs';
  }

  // Default to feat for new functionality
  return 'feat';
}

/**
 * Generate a commit message following the pattern: {type}({phase}-{plan}): {description}
 * @param phase Phase identifier (e.g., "04-execution-commands")
 * @param planNumber Plan number
 * @param taskName Task name to use as description
 * @param action Optional task action for type detection
 * @returns Formatted commit message
 */
export function generateCommitMessage(phase: string, planNumber: number, taskName: string, action?: string): string {
  const type = detectCommitType(taskName, action);

  // Extract phase number from phase string (e.g., "04-execution-commands" -> "04")
  const phaseMatch = phase.match(/^(\d+)/);
  const phaseNum = phaseMatch ? phaseMatch[1] : phase.slice(0, 2);

  // Format plan number with leading zero
  const planNum = planNumber.toString().padStart(2, '0');

  // Clean up task name - remove "Task X:" prefix if present
  let description = taskName.replace(/^Task\s*\d+:\s*/i, '').trim();

  // Lowercase first letter for conventional commit style
  if (description.length > 0) {
    description = description.charAt(0).toLowerCase() + description.slice(1);
  }

  return `${type}(${phaseNum}-${planNum}): ${description}`;
}
