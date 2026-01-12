/**
 * NEAR AI Authentication Module
 *
 * Handles reading auth credentials from ~/.nearai/config.json
 * This matches the nearai CLI behavior for seamless integration.
 *
 * Note: This module is pure Node.js with no VSCode dependencies
 * to maintain testability and reusability.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { NearAiConfig } from '../client/types';

/**
 * Get auth signature from ~/.nearai/config.json
 *
 * NEAR AI expects the auth object to be JSON-stringified and used
 * as the API key in requests.
 *
 * @returns JSON-stringified auth object, or null if unavailable
 */
export function getAuthFromConfigFile(): string | null {
  try {
    const configPath = path.join(os.homedir(), '.nearai', 'config.json');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config: NearAiConfig = JSON.parse(configContent);

    if (!config.auth) {
      return null;
    }

    // NEAR AI expects JSON-stringified auth object as API key
    return JSON.stringify(config.auth);
  } catch {
    return null;
  }
}

/**
 * Check if NEAR AI auth is configured
 *
 * @returns true if valid auth credentials exist
 */
export function isAuthConfigured(): boolean {
  return getAuthFromConfigFile() !== null;
}

/**
 * Get config file path for user guidance
 *
 * @returns Path to the NEAR AI config file
 */
export function getConfigFilePath(): string {
  return path.join(os.homedir(), '.nearai', 'config.json');
}

// TODO: Future enhancement - Store auth in VSCode SecretStorage
// This would provide better security and allow users to authenticate
// without needing the nearai CLI installed. For now, config file
// auth maintains parity with the nearai CLI experience.
