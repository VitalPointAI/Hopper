import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Known scaffolding commands that require an empty directory.
 * These patterns are matched against task action text.
 */
const SCAFFOLDING_PATTERNS = [
  // JavaScript/TypeScript
  /\bcreate-next-app\b/i,
  /\bcreate-react-app\b/i,
  /\bcreate-vue\b/i,
  /\bcreate-svelte\b/i,
  /\bcreate-astro\b/i,
  /\bcreate-remix\b/i,
  /\bcreate-t3-app\b/i,
  /\bnpm init\b/i,
  /\bnpx init\b/i,
  /\byarn create\b/i,
  /\bpnpm create\b/i,
  /\bbun create\b/i,
  /\bnpm create\b/i,
  // Rust
  /\bcargo init\b/i,
  /\bcargo new\b/i,
  // Go
  /\bgo mod init\b/i,
  // Python
  /\bpoetry new\b/i,
  /\bdjango-admin startproject\b/i,
  /\bflask\b.*\binit\b/i,
  // .NET
  /\bdotnet new\b/i,
  // Ruby
  /\brails new\b/i,
  /\bbundle init\b/i,
  // PHP
  /\bcomposer create-project\b/i,
  /\blaravel new\b/i,
  // Mobile
  /\bnpx react-native init\b/i,
  /\bflutter create\b/i,
  /\bexpo init\b/i,
];

/**
 * Check if a task action contains a scaffolding command.
 */
export function isScaffoldingTask(action: string): boolean {
  return SCAFFOLDING_PATTERNS.some(pattern => pattern.test(action));
}

/**
 * Extract the scaffolding command from task action text.
 * Returns the command that should be run, or null if not found.
 */
export function extractScaffoldingCommand(action: string): string | null {
  // Look for common command patterns
  // npx create-next-app@latest . --typescript
  // npm init -y
  // cargo init

  // Match commands anywhere in text (not just at line start)
  // Capture the command and its arguments until end of line or backtick
  const commandPatterns = [
    // npx commands - match until newline, backtick, or end
    /(npx\s+create-[\w-]+(?:@[\w.]+)?\s+[^\n`]+)/i,
    /(npx\s+[\w@/-]+\s+init[^\n`]*)/i,
    // npm/yarn/pnpm/bun create/init
    /(npm\s+(?:init|create)\s+[^\n`]+)/i,
    /(yarn\s+create\s+[^\n`]+)/i,
    /(pnpm\s+create\s+[^\n`]+)/i,
    /(bun\s+create\s+[^\n`]+)/i,
    // Rust
    /(cargo\s+(?:init|new)[^\n`]*)/i,
    // Go
    /(go\s+mod\s+init[^\n`]*)/i,
    // .NET
    /(dotnet\s+new[^\n`]+)/i,
    // Ruby
    /(rails\s+new[^\n`]+)/i,
    // PHP
    /(composer\s+create-project[^\n`]+)/i,
    // Mobile
    /(flutter\s+create[^\n`]+)/i,
    /(expo\s+init[^\n`]*)/i,
  ];

  for (const pattern of commandPatterns) {
    const match = action.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Result of scaffolding execution.
 */
export interface ScaffoldingResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Execute a scaffolding command with .planning/ protection.
 *
 * 1. Moves .planning/ to temp directory
 * 2. Runs the scaffolding command
 * 3. Moves .planning/ back
 *
 * This allows scaffolding tools that require empty directories to work.
 */
export async function executeScaffoldingWithProtection(
  workspaceUri: vscode.Uri,
  command: string,
  stream: vscode.ChatResponseStream
): Promise<ScaffoldingResult> {
  const workspacePath = workspaceUri.fsPath;
  const planningPath = path.join(workspacePath, '.planning');
  const tempPath = path.join(os.tmpdir(), `hopper-planning-${Date.now()}`);

  try {
    // Check if .planning exists
    const planningUri = vscode.Uri.file(planningPath);
    let hasPlanningDir = false;

    try {
      await vscode.workspace.fs.stat(planningUri);
      hasPlanningDir = true;
    } catch {
      // .planning doesn't exist, no need to move
    }

    // Step 1: Move .planning to temp if it exists
    if (hasPlanningDir) {
      stream.markdown('*Moving .planning/ aside for scaffolding...*\n\n');

      // Use fs.rename via shell for atomic move
      await execAsync(`mv "${planningPath}" "${tempPath}"`, { cwd: workspacePath });
    }

    // Step 2: Run scaffolding command
    stream.markdown(`**Running:** \`${command}\`\n\n`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspacePath,
        timeout: 120000, // 2 minute timeout for scaffolding
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });

      if (stdout) {
        // Truncate long output
        const truncated = stdout.length > 2000
          ? stdout.slice(0, 2000) + '\n...(truncated)'
          : stdout;
        stream.markdown('```\n' + truncated + '\n```\n\n');
      }
      if (stderr && !stderr.includes('npm WARN')) {
        stream.markdown('*stderr:* ' + stderr.slice(0, 500) + '\n\n');
      }
    } catch (execError) {
      // Scaffolding failed - still need to restore .planning
      const errorMsg = execError instanceof Error ? execError.message : String(execError);

      // Restore .planning before returning error
      if (hasPlanningDir) {
        try {
          await execAsync(`mv "${tempPath}" "${planningPath}"`, { cwd: workspacePath });
          stream.markdown('*Restored .planning/ after scaffolding failure.*\n\n');
        } catch (restoreError) {
          stream.markdown(`**Warning:** Could not restore .planning/ from ${tempPath}\n\n`);
        }
      }

      return {
        success: false,
        error: `Scaffolding command failed: ${errorMsg}`
      };
    }

    // Step 3: Move .planning back
    if (hasPlanningDir) {
      stream.markdown('*Restoring .planning/...*\n\n');
      await execAsync(`mv "${tempPath}" "${planningPath}"`, { cwd: workspacePath });
    }

    return {
      success: true,
      output: 'Scaffolding completed successfully'
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Try to restore .planning if something went wrong
    try {
      const tempExists = await execAsync(`test -d "${tempPath}" && echo exists`).then(() => true).catch(() => false);
      if (tempExists) {
        await execAsync(`mv "${tempPath}" "${planningPath}"`, { cwd: workspacePath });
        stream.markdown('*Restored .planning/ after error.*\n\n');
      }
    } catch {
      // Best effort restoration failed
    }

    return {
      success: false,
      error: errorMsg
    };
  }
}
