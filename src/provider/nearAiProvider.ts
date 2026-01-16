/**
 * NEAR AI Language Model Chat Provider for VSCode
 *
 * Implements the LanguageModelChatProvider interface to register
 * NEAR AI models in VSCode's native model picker.
 *
 * Authentication: Uses API key stored in VSCode SecretStorage.
 * Models: Fetched dynamically from NEAR AI Cloud /v1/model/list endpoint.
 */

import * as vscode from 'vscode';
import OpenAI from 'openai';
import { createNearAiClient, fetchNearAiModels } from '../client/nearAiClient';
import { NEAR_AI_API_KEY_SECRET, isValidApiKeyFormat } from '../auth/nearAuth';
import { convertMessages } from './messageConverter';
import type { NearAiModel } from '../client/types';

export class NearAiChatModelProvider implements vscode.LanguageModelChatProvider {
  private client: OpenAI | null = null;
  private cachedModels: NearAiModel[] | null = null;

  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Get or create the OpenAI client
   * Throws if API key is not configured
   */
  private async getClient(): Promise<OpenAI> {
    if (!this.client) {
      const apiKey = await this.context.secrets.get(NEAR_AI_API_KEY_SECRET);
      if (!apiKey || !isValidApiKeyFormat(apiKey)) {
        throw new Error('NEAR AI API key not configured. Use "Hopper: Manage NEAR AI Connection" command.');
      }
      this.client = createNearAiClient(apiKey);
    }
    return this.client;
  }

  /**
   * Check if API key is configured
   */
  private async isApiKeyConfigured(): Promise<boolean> {
    const apiKey = await this.context.secrets.get(NEAR_AI_API_KEY_SECRET);
    return !!apiKey && isValidApiKeyFormat(apiKey);
  }

  /**
   * Clear cached client (called when API key changes)
   */
  public clearClient(): void {
    this.client = null;
  }

  /**
   * Provide information about available NEAR AI models
   */
  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    // Show warning if not configured (unless silent mode)
    const isConfigured = await this.isApiKeyConfigured();
    if (!isConfigured && !options.silent) {
      vscode.window.showWarningMessage(
        'NEAR AI API key not configured. Use "Hopper: Manage NEAR AI Connection" to set up.'
      );
    }

    // Fetch models from API (cached for performance)
    let models: NearAiModel[];
    try {
      if (!this.cachedModels) {
        this.cachedModels = await fetchNearAiModels();
      }
      models = this.cachedModels;
    } catch (error) {
      // Fall back to empty list if fetch fails
      console.error('Failed to fetch NEAR AI models:', error);
      models = [];
    }

    // Convert to VSCode format
    return models.map(model => ({
      id: `near-ai.${this.sanitizeModelId(model.modelId)}`,
      name: model.metadata.modelDisplayName || model.modelId,
      family: this.extractFamily(model.modelId),
      version: '1.0',
      maxInputTokens: model.metadata.contextLength || 32768,
      maxOutputTokens: Math.min(model.metadata.contextLength || 32768, 8192),
      tooltip: model.metadata.modelDescription || `NEAR AI: ${model.modelId}`,
      detail: this.formatPricing(model),
      capabilities: {
        // Enable tool calling - many NEAR AI models support it
        // This is required for models to appear in agent mode
        toolCalling: this.supportsToolCalling(model),
        imageInput: false
      }
    }));
  }

  /**
   * Handle a chat request by streaming response from NEAR AI
   */
  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Check if API key is configured - prompt user if not
    const isConfigured = await this.isApiKeyConfigured();
    if (!isConfigured) {
      const action = await vscode.window.showWarningMessage(
        'NEAR AI API key required to use this model.',
        'Set Up API Key',
        'Get API Key'
      );

      if (action === 'Set Up API Key') {
        await vscode.commands.executeCommand('hopper.manageNearAi');
      } else if (action === 'Get API Key') {
        await vscode.env.openExternal(vscode.Uri.parse('https://cloud.near.ai/'));
      }

      // Return a helpful message instead of throwing
      progress.report(new vscode.LanguageModelTextPart(
        '⚠️ **NEAR AI API key not configured.**\n\n' +
        'To use NEAR AI models:\n' +
        '1. Run command: `Hopper: Manage NEAR AI Connection`\n' +
        '2. Or get an API key at [cloud.near.ai](https://cloud.near.ai/)\n\n' +
        '_After setting up your API key, try your request again._'
      ));
      return;
    }

    const client = await this.getClient();
    const convertedMessages = convertMessages(messages);

    // Map VSCode model ID back to NEAR AI format
    const nearAiModelId = this.mapToNearAiModelId(model.id);

    try {
      const stream = await client.chat.completions.create({
        model: nearAiModelId,
        messages: convertedMessages,
        stream: true
      });

      for await (const chunk of stream) {
        // Check cancellation - abort stream if requested
        if (token.isCancellationRequested) {
          stream.controller.abort();
          break;
        }

        // Report content chunks immediately (don't buffer)
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          progress.report(new vscode.LanguageModelTextPart(content));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`NEAR AI request failed: ${message}`);
    }
  }

  /**
   * Estimate token count for text or messages
   * Uses simple heuristic: ~4 characters per token
   */
  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken
  ): Promise<number> {
    const str = typeof text === 'string'
      ? text
      : convertMessages([text]).map(m => m.content).join('');
    return Math.ceil(str.length / 4);
  }

  /**
   * Sanitize model ID for use in VSCode model picker
   * Replaces special characters with hyphens
   */
  private sanitizeModelId(modelId: string): string {
    return modelId.replace(/[\/\.]/g, '-').toLowerCase();
  }

  /**
   * Extract model family from model ID
   * e.g., "deepseek-ai/DeepSeek-V3.1" -> "deepseek"
   */
  private extractFamily(modelId: string): string {
    const parts = modelId.split('/');
    const name = parts[parts.length - 1].toLowerCase();
    // Extract first word as family
    const match = name.match(/^([a-z]+)/);
    return match ? match[1] : 'near-ai';
  }

  /**
   * Map VSCode model ID back to NEAR AI model ID
   */
  private mapToNearAiModelId(vscodeModelId: string): string {
    // Remove "near-ai." prefix
    const sanitizedId = vscodeModelId.replace(/^near-ai\./, '');

    // Find matching model in cache
    if (this.cachedModels) {
      const model = this.cachedModels.find(
        m => this.sanitizeModelId(m.modelId) === sanitizedId
      );
      if (model) {
        return model.modelId;
      }
    }

    // Fallback: reverse the sanitization
    return sanitizedId.replace(/-/g, '/');
  }

  /**
   * Format pricing info for model detail
   */
  private formatPricing(model: NearAiModel): string {
    const inputCost = model.inputCostPerToken.amount / Math.pow(10, model.inputCostPerToken.scale - 6);
    const outputCost = model.outputCostPerToken.amount / Math.pow(10, model.outputCostPerToken.scale - 6);
    return `$${inputCost.toFixed(2)}/M input, $${outputCost.toFixed(2)}/M output`;
  }

  /**
   * Check if model supports tool calling based on description
   * Many NEAR AI models support function calling/tool use
   */
  private supportsToolCalling(model: NearAiModel): boolean {
    const desc = model.metadata.modelDescription?.toLowerCase() || '';
    const name = model.modelId.toLowerCase();
    // Models that mention tool calling, function calling, or agent capabilities
    return desc.includes('tool') ||
           desc.includes('function call') ||
           desc.includes('agent') ||
           name.includes('deepseek') ||
           name.includes('glm') ||
           name.includes('qwen') ||
           name.includes('gpt');
  }
}
