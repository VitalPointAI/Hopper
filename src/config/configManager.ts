import * as vscode from 'vscode';
import { HopperConfig, createDefaultConfig } from './types';

/**
 * Manages Hopper configuration stored in .planning/config.json.
 * Provides CRUD operations for planning depth and execution mode settings.
 */
export class ConfigManager {
  /** Path to config file relative to workspace */
  private static readonly CONFIG_PATH = '.planning/config.json';

  private readonly workspaceUri: vscode.Uri;
  private readonly configUri: vscode.Uri;

  /**
   * Creates a new ConfigManager for the given workspace.
   * @param workspaceUri Root URI of the workspace
   */
  constructor(workspaceUri: vscode.Uri) {
    this.workspaceUri = workspaceUri;
    this.configUri = vscode.Uri.joinPath(workspaceUri, ConfigManager.CONFIG_PATH);
  }

  /**
   * Checks if the config file exists in the workspace.
   * @returns true if .planning/config.json exists
   */
  async configExists(): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.configUri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Loads configuration from .planning/config.json.
   * Returns default config if file doesn't exist or is invalid.
   * @returns The loaded or default HopperConfig
   */
  async loadConfig(): Promise<HopperConfig> {
    try {
      const fileContent = await vscode.workspace.fs.readFile(this.configUri);
      const content = new TextDecoder().decode(fileContent);
      const parsed = JSON.parse(content) as Partial<HopperConfig>;

      // Validate required fields exist and merge with defaults
      const config = createDefaultConfig();
      if (parsed.planningDepth && ['quick', 'standard', 'comprehensive'].includes(parsed.planningDepth)) {
        config.planningDepth = parsed.planningDepth;
      }
      if (parsed.executionMode && ['yolo', 'guided', 'manual'].includes(parsed.executionMode)) {
        config.executionMode = parsed.executionMode;
      }
      if (parsed.createdAt) {
        config.createdAt = parsed.createdAt;
      }
      if (parsed.updatedAt) {
        config.updatedAt = parsed.updatedAt;
      }

      return config;
    } catch (error) {
      // File doesn't exist or JSON parse error - return defaults
      if (error instanceof SyntaxError) {
        console.warn('Hopper: Invalid config.json, using defaults:', error.message);
      }
      return createDefaultConfig();
    }
  }

  /**
   * Saves configuration to .planning/config.json.
   * Updates the updatedAt timestamp automatically.
   * @param config The configuration to save
   */
  async saveConfig(config: HopperConfig): Promise<void> {
    // Update timestamp
    const configToSave: HopperConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
    };

    // Ensure .planning directory exists
    const planningDir = vscode.Uri.joinPath(this.workspaceUri, '.planning');
    try {
      await vscode.workspace.fs.stat(planningDir);
    } catch {
      await vscode.workspace.fs.createDirectory(planningDir);
    }

    // Write config file
    const content = JSON.stringify(configToSave, null, 2) + '\n';
    await vscode.workspace.fs.writeFile(this.configUri, new TextEncoder().encode(content));
  }

  /**
   * Updates specific configuration fields while preserving others.
   * @param partial Partial config with fields to update
   * @returns The merged and saved configuration
   */
  async updateConfig(partial: Partial<Omit<HopperConfig, 'createdAt' | 'updatedAt'>>): Promise<HopperConfig> {
    const current = await this.loadConfig();
    const updated: HopperConfig = {
      ...current,
      ...partial,
      createdAt: current.createdAt, // Preserve original creation time
    };
    await this.saveConfig(updated);
    return updated;
  }

  /**
   * Resets configuration to default values with fresh timestamps.
   * @returns The default configuration
   */
  async resetConfig(): Promise<HopperConfig> {
    const config = createDefaultConfig();
    await this.saveConfig(config);
    return config;
  }
}
