import * as vscode from 'vscode';
import { getLogger } from '../logging';

/**
 * Patterns that indicate a short conversational response that likely
 * refers to something in the previous assistant message.
 *
 * These are responses that don't make sense without context:
 * - Affirmatives: "yes", "yeah", "yep", "sure", "ok", "do it", "go ahead"
 * - Selections: "the first one", "option 2", "that one", "the second"
 * - Negatives: "no", "nope", "not that", "the other one"
 * - Clarifications: "yes but...", "no I meant..."
 */
const CONVERSATIONAL_RESPONSE_PATTERNS = [
  // Affirmatives
  /^(yes|yeah|yep|yup|sure|ok|okay|k|yea|aye|affirmative)[\s.,!]*$/i,
  /^(do it|go ahead|proceed|go for it|let's do it|sounds good|perfect|great)[\s.,!]*$/i,
  /^(please|please do|yes please|go)[\s.,!]*$/i,

  // Selections (numbered or positional)
  /^(the )?(first|second|third|fourth|1st|2nd|3rd|4th)( one)?[\s.,!]*$/i,
  /^(option|choice|number|#)?\s*[1-4][\s.,!]*$/i,
  /^(that one|this one|that|this)[\s.,!]*$/i,

  // Negatives that still need context
  /^(no|nope|nah|not that|neither|none)[\s.,!]*$/i,
  /^(the other|the other one|something else|different)[\s.,!]*$/i,

  // Short follow-ups that need context
  /^(and|also|but|however|actually|wait)/i,

  // Clarifications with affirmative/negative prefix
  /^(yes|no|yeah|nope),?\s+.{1,50}$/i,
];

/**
 * Minimum length threshold - responses shorter than this are likely contextual
 */
const SHORT_RESPONSE_THRESHOLD = 60;

/**
 * Result of analyzing a potential conversational follow-up
 */
export interface FollowupAnalysis {
  /** Whether this appears to be a conversational follow-up */
  isFollowup: boolean;
  /** The user's response */
  userResponse: string;
  /** The previous assistant message content (if available) */
  previousAssistantMessage: string | null;
  /** Confidence level: 'high' for pattern match, 'medium' for short response */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Extract the text content from the last assistant response in chat history
 */
function getLastAssistantMessage(history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>): string | null {
  // Walk backwards through history to find the last response turn
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];

    // Check if this is a response turn (assistant message)
    if ('response' in turn && Array.isArray(turn.response)) {
      const responseTurn = turn as vscode.ChatResponseTurn;

      // Extract text from all markdown parts
      let fullText = '';
      for (const part of responseTurn.response) {
        // ChatResponseMarkdownPart has a 'value' property that's a MarkdownString
        if ('value' in part && part.value && 'value' in part.value) {
          fullText += part.value.value;
        }
      }

      if (fullText.trim()) {
        return fullText;
      }
    }
  }

  return null;
}

/**
 * Check if a response matches conversational follow-up patterns
 */
function matchesFollowupPattern(response: string): boolean {
  const trimmed = response.trim();
  return CONVERSATIONAL_RESPONSE_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Analyze whether the current user input appears to be a conversational
 * follow-up to a previous assistant message that presented options or
 * asked a question.
 *
 * @param userPrompt - The current user input
 * @param chatHistory - The chat context history
 * @returns Analysis result with context if this is a follow-up
 */
export function analyzeForFollowup(
  userPrompt: string,
  chatHistory: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>
): FollowupAnalysis {
  const logger = getLogger();
  const trimmedPrompt = userPrompt.trim();

  // No history means no follow-up possible
  if (chatHistory.length === 0) {
    return {
      isFollowup: false,
      userResponse: trimmedPrompt,
      previousAssistantMessage: null,
      confidence: 'low'
    };
  }

  const lastAssistantMessage = getLastAssistantMessage(chatHistory);

  // No previous assistant message to follow up on
  if (!lastAssistantMessage) {
    return {
      isFollowup: false,
      userResponse: trimmedPrompt,
      previousAssistantMessage: null,
      confidence: 'low'
    };
  }

  // Check for explicit pattern match (high confidence)
  if (matchesFollowupPattern(trimmedPrompt)) {
    logger.info(`Conversational follow-up detected (pattern match): "${trimmedPrompt}"`);
    return {
      isFollowup: true,
      userResponse: trimmedPrompt,
      previousAssistantMessage: lastAssistantMessage,
      confidence: 'high'
    };
  }

  // Check for short response that's likely contextual (medium confidence)
  // Only if the previous message looks like it presented options or asked something
  const looksLikeOptionsOrQuestion =
    lastAssistantMessage.includes('?') ||
    /\d\.\s/.test(lastAssistantMessage) ||  // Numbered list
    /[-•]\s/.test(lastAssistantMessage) ||  // Bullet points
    /would you like|do you want|should I|which|choose/i.test(lastAssistantMessage);

  if (trimmedPrompt.length < SHORT_RESPONSE_THRESHOLD && looksLikeOptionsOrQuestion) {
    logger.info(`Conversational follow-up detected (short response to options): "${trimmedPrompt}"`);
    return {
      isFollowup: true,
      userResponse: trimmedPrompt,
      previousAssistantMessage: lastAssistantMessage,
      confidence: 'medium'
    };
  }

  return {
    isFollowup: false,
    userResponse: trimmedPrompt,
    previousAssistantMessage: lastAssistantMessage,
    confidence: 'low'
  };
}

/**
 * Build a prompt that includes conversation context for the LLM to
 * properly interpret a follow-up response.
 *
 * @param analysis - The follow-up analysis result
 * @param projectContextStr - Formatted project context string
 * @returns A prompt string that includes the necessary context
 */
export function buildFollowupPrompt(
  analysis: FollowupAnalysis,
  projectContextStr: string
): string {
  return `You are Hopper, a VSCode extension for structured project planning.

CONVERSATION CONTEXT:
The user is responding to your previous message. Here's what you said:

---
${analysis.previousAssistantMessage}
---

USER'S RESPONSE: "${analysis.userResponse}"

INSTRUCTIONS:
1. Interpret the user's response in the context of what you previously said
2. If the user is selecting an option you presented, acknowledge their choice and take the appropriate action
3. If the user is answering a question you asked, proceed based on their answer
4. If the user's response is unclear, ask for clarification about which specific option they mean
5. Be direct and action-oriented - don't repeat information they've already seen

AVAILABLE COMMANDS (use these when appropriate):
- /new-project - Initialize a new project with PROJECT.md
- /create-roadmap - Create a ROADMAP.md with phases
- /plan-phase - Create detailed plan for a phase
- /execute-plan - Execute a plan file
- /progress - Check and update project progress
- /status - View current project state
- /help - Show all commands

PROJECT CONTEXT:
${projectContextStr}

Respond appropriately to the user's selection or answer. If they selected an option that requires running a command, tell them you'll run it and suggest they use the appropriate slash command (you cannot run commands directly from this context).`;
}
