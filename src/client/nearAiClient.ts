/**
 * NEAR AI Client using OpenAI SDK
 *
 * NEAR AI provides an OpenAI-compatible API endpoint.
 * Authentication uses a JSON-stringified auth object from ~/.nearai/config.json
 */

import OpenAI from 'openai';
import type { NearAiModel } from './types';

/** NEAR AI API endpoint */
const NEAR_AI_BASE_URL = 'https://api.near.ai/v1';

/**
 * Available NEAR AI models
 *
 * Model ID format: provider::accounts/provider/models/model-name
 */
export const NEAR_AI_MODELS: NearAiModel[] = [
  {
    id: 'fireworks::accounts/fireworks/models/qwen2p5-72b-instruct',
    name: 'Qwen 2.5 72B Instruct',
    provider: 'fireworks',
    maxInputTokens: 32768,
    maxOutputTokens: 4096,
  },
  {
    id: 'fireworks::accounts/fireworks/models/llama-v3p1-70b-instruct',
    name: 'Llama 3.1 70B Instruct',
    provider: 'fireworks',
    maxInputTokens: 131072,
    maxOutputTokens: 4096,
  },
  {
    id: 'fireworks::accounts/fireworks/models/llama-v3p1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    provider: 'fireworks',
    maxInputTokens: 131072,
    maxOutputTokens: 4096,
  },
];

/**
 * Create a NEAR AI client configured for the NEAR AI endpoint
 *
 * @param authSignature - JSON-stringified auth object from config file
 * @returns Configured OpenAI client pointing to NEAR AI
 */
export function createNearAiClient(authSignature: string): OpenAI {
  return new OpenAI({
    apiKey: authSignature,
    baseURL: NEAR_AI_BASE_URL,
  });
}

/**
 * Get model by ID
 */
export function getModelById(modelId: string): NearAiModel | undefined {
  return NEAR_AI_MODELS.find((model) => model.id === modelId);
}

/**
 * Get default model
 */
export function getDefaultModel(): NearAiModel {
  return NEAR_AI_MODELS[0];
}
