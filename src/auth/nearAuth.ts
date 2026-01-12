/**
 * NEAR AI Cloud Auth Module
 *
 * Users get API keys from https://cloud.near.ai/ dashboard.
 * Keys are stored in VSCode SecretStorage (handled by extension).
 * This module provides utilities for the extension to use.
 *
 * Note: This module is pure Node.js with no VSCode dependencies
 * to maintain testability and reusability.
 */

/** Secret storage key name for VSCode SecretStorage */
export const NEAR_AI_API_KEY_SECRET = 'nearai.apiKey';

/**
 * Validate API key format (basic check)
 * NEAR AI keys appear to be standard format
 *
 * @param key - The API key to validate
 * @returns true if key has valid format
 */
export function isValidApiKeyFormat(key: string): boolean {
  return typeof key === 'string' && key.length > 0 && !key.includes(' ');
}

/**
 * Get instructions for obtaining API key
 *
 * @returns User-friendly instructions for getting a NEAR AI API key
 */
export function getApiKeyInstructions(): string {
  return `To get your NEAR AI API key:
1. Go to https://cloud.near.ai/
2. Sign in or create an account
3. Purchase credits in the "Credits" section
4. Go to "API Keys" section
5. Generate a new key
6. Copy the key and paste it when prompted`;
}
