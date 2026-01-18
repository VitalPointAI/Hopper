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

// Track created terminals for potential cleanup
const managedTerminals: Map<string, vscode.Terminal> = new Map();

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
    const { command, name, cwd } = options.input;

    try {
      if (!command) {
        throw new Error('command is required');
      }

      // Generate a terminal name if not provided
      const terminalName = name || `Hopper: ${command.split(' ')[0]}`;

      // Check if a terminal with this name already exists
      const existingTerminal = vscode.window.terminals.find(t => t.name === terminalName);
      if (existingTerminal) {
        // Dispose the existing terminal before creating a new one
        existingTerminal.dispose();
        managedTerminals.delete(terminalName);
        // Brief delay to allow disposal
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Determine working directory
      let workingDir = cwd;
      if (!workingDir) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          workingDir = workspaceFolders[0].uri.fsPath;
        }
      }

      // Create the terminal
      const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd: workingDir,
      });

      // Track the terminal
      managedTerminals.set(terminalName, terminal);

      // Show the terminal (but don't take focus away from chat)
      terminal.show(true); // preserveFocus = true

      // Send the command
      terminal.sendText(command);

      console.log(`[Hopper] Started terminal "${terminalName}" with command: ${command}`);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Terminal "${terminalName}" started with command: ${command}\n\n` +
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

  // Clean up managed terminals when extension deactivates
  context.subscriptions.push({
    dispose: () => {
      for (const terminal of managedTerminals.values()) {
        try {
          terminal.dispose();
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
