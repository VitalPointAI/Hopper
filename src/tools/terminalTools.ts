import * as vscode from 'vscode';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';

/**
 * Input schema for hopper_runInTerminal tool
 */
interface RunInTerminalInput {
  command: string;
  name?: string;
  cwd?: string;
  keepAlive?: boolean;  // If true, don't dispose existing terminal - create with unique suffix
}

/**
 * Input schema for hopper_waitForPort tool
 */
interface WaitForPortInput {
  port: number;
  host?: string;
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Input schema for hopper_httpHealthCheck tool
 */
interface HttpHealthCheckInput {
  url: string;
  expectedStatus?: number;
  timeoutMs?: number;
  intervalMs?: number;
  maxRetries?: number;
}

/**
 * Metadata for a managed terminal
 */
interface ManagedTerminalInfo {
  terminal: vscode.Terminal;
  type: 'server' | 'command';  // server = long-running, don't auto-dispose; command = one-shot
  command: string;
  createdAt: number;
  keepAlive: boolean;
}

// Track created terminals with metadata for lifecycle management
const managedTerminals: Map<string, ManagedTerminalInfo> = new Map();

/**
 * Tool to run a command in a new VSCode terminal.
 * Returns immediately after spawning, allowing the agent to continue.
 * Use with hopper_waitForPort or hopper_httpHealthCheck to verify readiness.
 */
export class HopperRunInTerminalTool implements vscode.LanguageModelTool<RunInTerminalInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RunInTerminalInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { command, name, cwd, keepAlive = false } = options.input;

    try {
      if (!command) {
        throw new Error('command is required');
      }

      // Generate a terminal name if not provided
      let terminalName = name || `Hopper: ${command.split(' ')[0]}`;

      // Check if a terminal with this name already exists
      const existingTerminal = vscode.window.terminals.find(t => t.name === terminalName);
      const existingInfo = managedTerminals.get(terminalName);

      if (existingTerminal) {
        if (keepAlive || (existingInfo && existingInfo.keepAlive)) {
          // Don't dispose - create with unique suffix instead
          const suffix = Date.now().toString(36).slice(-4);
          terminalName = `${terminalName} (${suffix})`;
          console.log(`[Hopper] Existing terminal kept alive, creating new: ${terminalName}`);
        } else {
          // Dispose the existing terminal before creating a new one
          existingTerminal.dispose();
          managedTerminals.delete(terminalName);
          // Brief delay to allow disposal
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Determine working directory
      let workingDir = cwd;
      if (!workingDir) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          workingDir = workspaceFolders[0].uri.fsPath;
        }
      }

      // Determine terminal type based on command patterns
      // Server commands: npm run dev, npm start, yarn dev, python -m http.server, etc.
      const isServerCommand = /\b(dev|start|serve|watch|server|listen)\b/i.test(command) ||
        /\bpython\s+-m\s+(http\.server|flask)/i.test(command) ||
        /\bnode\s+.*server/i.test(command);
      const terminalType: 'server' | 'command' = keepAlive || isServerCommand ? 'server' : 'command';

      // Create the terminal
      const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd: workingDir,
      });

      // Track the terminal with metadata
      managedTerminals.set(terminalName, {
        terminal,
        type: terminalType,
        command,
        createdAt: Date.now(),
        keepAlive: keepAlive || isServerCommand
      });

      // Show the terminal (but don't take focus away from chat)
      terminal.show(true); // preserveFocus = true

      // Send the command
      terminal.sendText(command);

      console.log(`[Hopper] Started terminal "${terminalName}" (type: ${terminalType}) with command: ${command}`);

      const typeNote = terminalType === 'server'
        ? `This is a long-running process that will persist across tasks.`
        : `This is a one-shot command that can be cleaned up after execution.`;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Terminal "${terminalName}" started with command: ${command}\n\n` +
          `Type: ${terminalType}. ${typeNote}\n\n` +
          `The command is running in the background. Use hopper_waitForPort or hopper_httpHealthCheck ` +
          `to verify the process is ready before proceeding.`
        )
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Hopper] Failed to run in terminal: ${errorMsg}`);
      throw new Error(`Failed to run in terminal: ${errorMsg}`);
    }
  }
}

/**
 * Tool to wait for a port to become available.
 * Useful for verifying dev servers and other network services are ready.
 */
export class HopperWaitForPortTool implements vscode.LanguageModelTool<WaitForPortInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<WaitForPortInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const {
      port,
      host = 'localhost',
      timeoutMs = 30000,
      intervalMs = 500
    } = options.input;

    try {
      if (!port || port < 1 || port > 65535) {
        throw new Error('port must be a valid port number (1-65535)');
      }

      console.log(`[Hopper] Waiting for port ${port} on ${host}...`);

      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        if (token.isCancellationRequested) {
          throw new Error('Operation cancelled');
        }

        const isOpen = await this.checkPort(host, port);
        if (isOpen) {
          const elapsed = Date.now() - startTime;
          console.log(`[Hopper] Port ${port} is ready after ${elapsed}ms`);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Port ${port} on ${host} is now accepting connections (waited ${elapsed}ms).`
            )
          ]);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }

      throw new Error(
        `Timeout waiting for port ${port} on ${host} after ${timeoutMs}ms`
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Hopper] Wait for port failed: ${errorMsg}`);
      throw new Error(`Failed waiting for port: ${errorMsg}`);
    }
  }

  private checkPort(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();

      const onError = () => {
        socket.destroy();
        resolve(false);
      };

      socket.setTimeout(1000);
      socket.once('error', onError);
      socket.once('timeout', onError);

      socket.connect(port, host, () => {
        socket.end();
        resolve(true);
      });
    });
  }
}

/**
 * Tool to perform HTTP health checks with retries.
 * Useful for verifying web servers and APIs are ready and responding.
 */
export class HopperHttpHealthCheckTool implements vscode.LanguageModelTool<HttpHealthCheckInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<HttpHealthCheckInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const {
      url,
      expectedStatus = 200,
      timeoutMs = 30000,
      intervalMs = 1000,
      maxRetries = 30
    } = options.input;

    try {
      if (!url) {
        throw new Error('url is required');
      }

      // Validate URL
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error(`Invalid URL: ${url}`);
      }

      console.log(`[Hopper] Starting health check for ${url}...`);

      const startTime = Date.now();
      let attempt = 0;
      let lastError: string | null = null;
      let lastStatus: number | null = null;

      while (attempt < maxRetries && Date.now() - startTime < timeoutMs) {
        if (token.isCancellationRequested) {
          throw new Error('Operation cancelled');
        }

        attempt++;

        try {
          const result = await this.makeRequest(parsedUrl, 5000);

          if (result.status === expectedStatus) {
            const elapsed = Date.now() - startTime;
            console.log(`[Hopper] Health check passed after ${attempt} attempts (${elapsed}ms)`);
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(
                `Health check passed for ${url}\n` +
                `- Status: ${result.status}\n` +
                `- Attempts: ${attempt}\n` +
                `- Time: ${elapsed}ms`
              )
            ]);
          }

          lastStatus = result.status;
          lastError = `Unexpected status ${result.status} (expected ${expectedStatus})`;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }

      throw new Error(
        `Health check failed for ${url} after ${attempt} attempts. ` +
        (lastStatus !== null ? `Last status: ${lastStatus}. ` : '') +
        (lastError ? `Error: ${lastError}` : '')
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Hopper] Health check failed: ${errorMsg}`);
      throw new Error(`Health check failed: ${errorMsg}`);
    }
  }

  private makeRequest(url: URL, timeoutMs: number): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
      const protocol = url.protocol === 'https:' ? https : http;

      const req = protocol.request(
        url,
        {
          method: 'GET',
          timeout: timeoutMs,
        },
        (res) => {
          // Consume response body to free up memory
          res.resume();
          resolve({ status: res.statusCode || 0 });
        }
      );

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }
}

/**
 * Input schema for hopper_disposeTerminal tool
 */
interface DisposeTerminalInput {
  name: string;
}

/**
 * Tool to explicitly dispose a terminal by name.
 * Useful for cleaning up server terminals when no longer needed.
 */
export class HopperDisposeTerminalTool implements vscode.LanguageModelTool<DisposeTerminalInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<DisposeTerminalInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { name } = options.input;

    try {
      if (!name) {
        throw new Error('name is required');
      }

      // Find terminal by exact name or partial match
      let terminalName: string | undefined;
      let terminalInfo: ManagedTerminalInfo | undefined;

      // Try exact match first
      if (managedTerminals.has(name)) {
        terminalName = name;
        terminalInfo = managedTerminals.get(name);
      } else {
        // Try partial match
        for (const [key, info] of managedTerminals.entries()) {
          if (key.includes(name) || name.includes(key)) {
            terminalName = key;
            terminalInfo = info;
            break;
          }
        }
      }

      if (!terminalName || !terminalInfo) {
        const available = Array.from(managedTerminals.keys());
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Terminal "${name}" not found in managed terminals.\n\n` +
            `Available terminals: ${available.length > 0 ? available.join(', ') : 'none'}`
          )
        ]);
      }

      // Dispose the terminal
      try {
        terminalInfo.terminal.dispose();
      } catch {
        // Terminal may already be disposed
      }
      managedTerminals.delete(terminalName);

      console.log(`[Hopper] Disposed terminal "${terminalName}"`);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Terminal "${terminalName}" has been disposed.\n\n` +
          `Command that was running: ${terminalInfo.command}`
        )
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Hopper] Failed to dispose terminal: ${errorMsg}`);
      throw new Error(`Failed to dispose terminal: ${errorMsg}`);
    }
  }
}

/**
 * Clean up temporary (non-keepAlive) terminals.
 * Call this at the end of plan execution to dispose one-shot command terminals
 * while keeping server terminals running.
 * @returns List of terminals that were cleaned up
 */
export function cleanupTemporaryTerminals(): string[] {
  const cleaned: string[] = [];

  for (const [name, info] of managedTerminals.entries()) {
    if (!info.keepAlive && info.type === 'command') {
      try {
        info.terminal.dispose();
        cleaned.push(name);
        console.log(`[Hopper] Cleaned up temporary terminal: ${name}`);
      } catch {
        // Terminal may already be disposed
      }
      managedTerminals.delete(name);
    }
  }

  return cleaned;
}

/**
 * Get list of active server terminals.
 * Useful for showing which terminals remain active after plan execution.
 */
export function getActiveServerTerminals(): Array<{ name: string; command: string; createdAt: number }> {
  const servers: Array<{ name: string; command: string; createdAt: number }> = [];

  for (const [name, info] of managedTerminals.entries()) {
    if (info.type === 'server' || info.keepAlive) {
      servers.push({
        name,
        command: info.command,
        createdAt: info.createdAt
      });
    }
  }

  return servers;
}

/**
 * Register all Hopper terminal tools
 */
export function registerTerminalTools(context: vscode.ExtensionContext): void {
  // Register hopper_runInTerminal tool
  const runInTerminalTool = vscode.lm.registerTool(
    'hopper_runInTerminal',
    new HopperRunInTerminalTool()
  );
  context.subscriptions.push(runInTerminalTool);
  console.log('[Hopper] Registered hopper_runInTerminal tool');

  // Register hopper_waitForPort tool
  const waitForPortTool = vscode.lm.registerTool(
    'hopper_waitForPort',
    new HopperWaitForPortTool()
  );
  context.subscriptions.push(waitForPortTool);
  console.log('[Hopper] Registered hopper_waitForPort tool');

  // Register hopper_httpHealthCheck tool
  const healthCheckTool = vscode.lm.registerTool(
    'hopper_httpHealthCheck',
    new HopperHttpHealthCheckTool()
  );
  context.subscriptions.push(healthCheckTool);
  console.log('[Hopper] Registered hopper_httpHealthCheck tool');

  // Register hopper_disposeTerminal tool
  const disposeTerminalTool = vscode.lm.registerTool(
    'hopper_disposeTerminal',
    new HopperDisposeTerminalTool()
  );
  context.subscriptions.push(disposeTerminalTool);
  console.log('[Hopper] Registered hopper_disposeTerminal tool');

  // Clean up managed terminals when extension deactivates
  context.subscriptions.push({
    dispose: () => {
      for (const info of managedTerminals.values()) {
        try {
          info.terminal.dispose();
        } catch {
          // Ignore errors during cleanup
        }
      }
      managedTerminals.clear();
    }
  });
}

/**
 * Get all managed terminal names (for debugging/status)
 */
export function getManagedTerminals(): string[] {
  return Array.from(managedTerminals.keys());
}

/**
 * Get detailed info about all managed terminals
 */
export function getManagedTerminalInfo(): Array<{
  name: string;
  type: 'server' | 'command';
  command: string;
  keepAlive: boolean;
  runningFor: number;
}> {
  const now = Date.now();
  return Array.from(managedTerminals.entries()).map(([name, info]) => ({
    name,
    type: info.type,
    command: info.command,
    keepAlive: info.keepAlive,
    runningFor: Math.round((now - info.createdAt) / 1000)  // seconds
  }));
}
