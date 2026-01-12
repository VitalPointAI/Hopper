/**
 * NEAR AI Cloud Client using OpenAI SDK
 *
 * NEAR AI Cloud provides an OpenAI-compatible API endpoint.
 * Authentication uses standard Bearer token (API key from cloud.near.ai dashboard).
 *
 * API Reference: https://docs.near.ai/cloud/quickstart
 */

import OpenAI from 'openai';
import type { NearAiModel, NearAiModelsResponse } from './types';

/** NEAR AI Cloud API endpoint */
const NEAR_AI_BASE_URL = 'https://cloud-api.near.ai/v1';

/**
 * Create a NEAR AI client configured for the NEAR AI Cloud endpoint
 *
 * @param apiKey - API key from cloud.near.ai dashboard (standard Bearer token)
 * @returns Configured OpenAI client pointing to NEAR AI Cloud
 */
export function createNearAiClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey: apiKey,
    baseURL: NEAR_AI_BASE_URL,
  });
}

/**
 * Get the NEAR AI Cloud base URL
 */
export function getNearAiBaseUrl(): string {
  return NEAR_AI_BASE_URL;
}

/**
 * Fetch available models from NEAR AI Cloud
 *
 * @param apiKey - API key from cloud.near.ai dashboard
 * @returns Array of available models with pricing and metadata
 */
export async function fetchNearAiModels(apiKey: string): Promise<NearAiModel[]> {
  const response = await fetch(`${NEAR_AI_BASE_URL}/model/list`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }

  const data: NearAiModelsResponse = await response.json();
  return data.models ?? [];
}
