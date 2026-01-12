/**
 * Type definitions for NEAR AI Cloud client
 */

/**
 * Token cost from NEAR AI API
 */
export interface TokenCost {
  amount: number;
  scale: number;
  currency: string;
}

/**
 * Model metadata from NEAR AI API /v1/model/list endpoint
 */
export interface NearAiModelMetadata {
  modelDisplayName: string;
  modelDescription: string;
  contextLength: number;
  verifiable: boolean;
  modelIcon?: string;
  ownedBy: string;
  aliases?: string[];
}

/**
 * NEAR AI model definition from /v1/model/list API response
 */
export interface NearAiModel {
  /** Model ID, e.g., "deepseek-ai/DeepSeek-V3.1" */
  modelId: string;
  /** Cost per input token */
  inputCostPerToken: TokenCost;
  /** Cost per output token */
  outputCostPerToken: TokenCost;
  /** Model metadata */
  metadata: NearAiModelMetadata;
}

/**
 * Response from /v1/model/list endpoint
 */
export interface NearAiModelsResponse {
  models?: NearAiModel[];
  limit?: number;
  offset?: number;
  total?: number;
}
