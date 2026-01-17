/**
 * Message format converter between VSCode and OpenAI formats
 *
 * VSCode's LanguageModelChatRequestMessage uses a different structure
 * than the OpenAI API. This module handles the conversion.
 */

import * as vscode from 'vscode';

/**
 * Convert VSCode chat messages to OpenAI format
 *
 * @param messages - VSCode format messages
 * @returns OpenAI format messages
 */
export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[]
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  return messages.map(msg => ({
    role: mapRole(msg.role),
    content: extractTextContent(msg.content as readonly (vscode.LanguageModelTextPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelToolCallPart)[])
  }));
}

/**
 * Map VSCode message role to OpenAI role
 */
function mapRole(role: vscode.LanguageModelChatMessageRole): 'user' | 'assistant' | 'system' {
  switch (role) {
    case vscode.LanguageModelChatMessageRole.User:
      return 'user';
    case vscode.LanguageModelChatMessageRole.Assistant:
      return 'assistant';
    default:
      return 'user';
  }
}

/**
 * Extract text content from VSCode message parts
 *
 * VSCode messages can contain multiple parts (text, tool results, tool calls).
 * We extract just the text parts for the API.
 */
function extractTextContent(
  content: readonly (vscode.LanguageModelTextPart | vscode.LanguageModelToolResultPart | vscode.LanguageModelToolCallPart)[]
): string {
  return content
    .filter((part): part is vscode.LanguageModelTextPart =>
      part instanceof vscode.LanguageModelTextPart)
    .map(part => part.value)
    .join('');
}
