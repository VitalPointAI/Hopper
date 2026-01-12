/**
 * NEAR AI Cloud Client using OpenAI SDK
 *
 * NEAR AI Cloud provides an OpenAI-compatible API endpoint.
 * Authentication uses standard Bearer token (API key from cloud.near.ai dashboard).
 *
 * API Reference: https://docs.near.ai/cloud/quickstart
 */

import OpenAI from 'openai';

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
