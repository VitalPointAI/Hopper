/**
 * Type definitions for NEAR AI client
 */

/**
 * Structure of ~/.nearai/config.json
 */
export interface NearAiConfig {
  auth: {
    account_id: string;
    public_key: string;
    signature: string;
    // May have additional fields like message, nonce, recipient
    [key: string]: unknown;
  };
}

/**
 * NEAR AI model definition
 */
export interface NearAiModel {
  /** Full model ID, e.g., "fireworks::accounts/fireworks/models/qwen2p5-72b-instruct" */
  id: string;
  /** Display name for UI */
  name: string;
  /** Provider name, e.g., "fireworks" */
  provider: string;
  /** Maximum input tokens supported */
  maxInputTokens: number;
  /** Maximum output tokens supported */
  maxOutputTokens: number;
}
