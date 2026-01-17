import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Input schema for hopper_createFile tool
 */
interface CreateFileInput {
  filePath: string;
  content: string;
}

/**
 * Input schema for hopper_createDirectory tool
 */
interface CreateDirectoryInput {
  dirPath: string;
}

/**
 * Custom file creation tool that uses VSCode's native workspace.fs API.
 * This bypasses the buggy copilot_createFile tool.
 */
export class HopperCreateFileTool implements vscode.LanguageModelTool<CreateFileInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CreateFileInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { filePath, content } = options.input;

    try {
      // Validate input
      if (!filePath) {
        throw new Error('filePath is required');
      }
      if (content === undefined || content === null) {
        throw new Error('content is required');
      }

      // Ensure path is absolute
      if (!path.isAbsolute(filePath)) {
        throw new Error(`filePath must be absolute. Received: ${filePath}`);
      }

      const uri = vscode.Uri.file(filePath);

      // Ensure parent directory exists
      const parentDir = vscode.Uri.file(path.dirname(filePath));
      try {
        await vscode.workspace.fs.stat(parentDir);
      } catch {
        // Parent doesn't exist, create it recursively
        await vscode.workspace.fs.createDirectory(parentDir);
      }

      // Write the file
      const contentBuffer = Buffer.from(content, 'utf-8');
      await vscode.workspace.fs.writeFile(uri, contentBuffer);

      console.log(`[Hopper] Created file: ${filePath}`);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Successfully created file: ${filePath}`)
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Hopper] Failed to create file: ${errorMsg}`);
      throw new Error(`Failed to create file ${filePath}: ${errorMsg}`);
    }
  }
}

/**
 * Custom directory creation tool that uses VSCode's native workspace.fs API.
 */
export class HopperCreateDirectoryTool implements vscode.LanguageModelTool<CreateDirectoryInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CreateDirectoryInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { dirPath } = options.input;

    try {
      // Validate input
      if (!dirPath) {
        throw new Error('dirPath is required');
      }

      // Ensure path is absolute
      if (!path.isAbsolute(dirPath)) {
        throw new Error(`dirPath must be absolute. Received: ${dirPath}`);
      }

      const uri = vscode.Uri.file(dirPath);

      // Create directory (recursive)
      await vscode.workspace.fs.createDirectory(uri);

      console.log(`[Hopper] Created directory: ${dirPath}`);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Successfully created directory: ${dirPath}`)
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Hopper] Failed to create directory: ${errorMsg}`);
      throw new Error(`Failed to create directory ${dirPath}: ${errorMsg}`);
    }
  }
}

/**
 * Register all Hopper file tools
 */
export function registerFileTools(context: vscode.ExtensionContext): void {
  // Register hopper_createFile tool
  const createFileTool = vscode.lm.registerTool(
    'hopper_createFile',
    new HopperCreateFileTool()
  );
  context.subscriptions.push(createFileTool);
  console.log('[Hopper] Registered hopper_createFile tool');

  // Register hopper_createDirectory tool
  const createDirTool = vscode.lm.registerTool(
    'hopper_createDirectory',
    new HopperCreateDirectoryTool()
  );
  context.subscriptions.push(createDirTool);
  console.log('[Hopper] Registered hopper_createDirectory tool');
}
