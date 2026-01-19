import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * Discussion state for persistence and resume capability
 */
interface DiscussionState {
  phaseNum: number;
  phaseName: string;
  phaseGoal: string;
  questions: Array<{
    question: string;
    interpretationOptions: string[];
    context: string;
  }>;
  responses: Array<{
    questionIndex: number;
    selectedOption?: string;
    customResponse?: string;
  }>;
  currentQuestionIndex: number;
  startedAt: string;
  pausedAt?: string;
  waitingForResponse?: boolean;
}

/**
 * Get the storage key for discussion state
 */
function getDiscussionStateKey(phaseNum: number): string {
  return `hopper.discussionState.${phaseNum}`;
}

/**
 * Save discussion state to extension globalState
 */
async function saveDiscussionState(
  context: vscode.ExtensionContext,
  state: DiscussionState
): Promise<void> {
  const key = getDiscussionStateKey(state.phaseNum);
  await context.globalState.update(key, state);
  context.globalState.setKeysForSync([key]);
}

/**
 * Load discussion state from extension globalState
 */
function loadDiscussionState(
  context: vscode.ExtensionContext,
  phaseNum: number
): DiscussionState | undefined {
  const key = getDiscussionStateKey(phaseNum);
  return context.globalState.get<DiscussionState>(key);
}

/**
 * Clear discussion state from extension globalState
 */
async function clearDiscussionState(
  context: vscode.ExtensionContext,
  phaseNum: number
): Promise<void> {
  const key = getDiscussionStateKey(phaseNum);
  await context.globalState.update(key, undefined);
}

/**
 * Display a question with buttons for answer selection
 */
function displayQuestionWithButtons(
  stream: vscode.ChatResponseStream,
  question: { question: string; interpretationOptions: string[]; context: string },
  questionIndex: number,
  totalQuestions: number,
  phaseNum: number
): void {
  stream.markdown(`---\n\n`);
  stream.markdown(`### Question ${questionIndex + 1} of ${totalQuestions}\n\n`);
  stream.markdown(`**${question.question}**\n\n`);
  stream.markdown(`*${question.context}*\n\n`);

  // Show full option text as numbered markdown list
  stream.markdown('**Options:**\n\n');
  question.interpretationOptions.forEach((option, idx) => {
    stream.markdown(`${idx + 1}. ${option}\n`);
  });
  stream.markdown('\n');

  // Show short numbered buttons that correspond to the options above
  question.interpretationOptions.forEach((option, idx) => {
    stream.button({
      command: 'hopper.discussPhaseResponse',
      arguments: [phaseNum, questionIndex, option],
      title: String(idx + 1)
    });
    stream.markdown(' ');
  });

  // Other option for custom input
  stream.button({
    command: 'hopper.discussPhaseOther',
    arguments: [phaseNum, questionIndex],
    title: 'Other...'
  });
  stream.markdown(' ');

  stream.button({
    command: 'hopper.discussPhasePause',
    arguments: [phaseNum],
    title: '⏸ Pause'
  });
  stream.markdown('\n\n');
  stream.markdown('*Click a number to select that option, or type in chat for custom input.*\n\n');
}

/**
 * System prompt for generating multiple phase discussion questions
 */
const QUESTIONS_GENERATION_PROMPT = `You are helping gather context for a project phase before planning.

Your role is to be a thinking partner - help the user articulate their vision through collaborative thinking, not interrogation.

Based on the phase description, generate 3-5 questions that help understand the user's vision.

Output your response as JSON:
{
  "questions": [
    {
      "question": "Question 1 text (natural, conversational)",
      "interpretationOptions": ["Option A", "Option B", "Option C"],
      "context": "Brief context about why you're asking this"
    },
    {
      "question": "Question 2 text",
      "interpretationOptions": ["Option A", "Option B", "Option C"],
      "context": "Why asking"
    }
  ]
}

Guidelines:
- Generate 3-5 questions total
- Each question should have 2-4 interpretation options
- Ask about vision, feel, essential outcomes, boundaries
- DON'T ask about technical risks (you figure those out)
- DON'T ask about codebase patterns (you read the code)
- DON'T ask about success metrics (too corporate)
- Keep it natural and conversational
- First question should be about overall vision/feel
- Middle questions about specifics
- Last question about boundaries/out-of-scope

The user is the visionary, you are the builder.

Always return valid JSON.`;

/**
 * System prompt for initial phase vision question (legacy, kept for fallback)
 */
const VISION_QUESTION_PROMPT = `You are helping gather context for a project phase before planning.

Your role is to be a thinking partner - help the user articulate their vision through collaborative thinking, not interrogation.

Based on the phase description, generate an initial question that helps the user describe their vision.

Output your response as JSON:
{
  "question": "The question to ask (natural, conversational)",
  "interpretationOptions": ["Option A - one way to interpret", "Option B - another interpretation", "Option C - third possibility"],
  "context": "Brief context about why you're asking this"
}

Guidelines:
- Ask about vision, feel, essential outcomes
- DON'T ask about technical risks (you figure those out)
- DON'T ask about codebase patterns (you read the code)
- DON'T ask about success metrics (too corporate)
- Keep it natural and conversational

The user is the visionary, you are the builder.

Always return valid JSON.`;

/**
 * System prompt for synthesizing context from discussion
 */
const CONTEXT_SYNTHESIS_PROMPT = `You are helping create a context document from a phase discussion.

Based on the conversation, synthesize the user's vision into structured context.

Output your response as JSON:
{
  "vision": "How the user imagines this phase working - the 'pitch' version",
  "essential": ["Essential thing 1", "Essential thing 2", "Essential thing 3"],
  "outOfScope": ["Not doing X", "Deferred Y", "Explicitly excluding Z"],
  "specificIdeas": "Any specific references, behaviors, or interactions mentioned",
  "additionalNotes": "Anything else relevant that doesn't fit above"
}

Guidelines:
- Vision should read like a founder describing their product
- Essential items should be the non-negotiables
- Out of scope should be explicit exclusions
- Specific ideas capture references to products they like, specific behaviors
- Keep it about VISION, not technical specs

Always return valid JSON.`;

/**
 * System prompt for merging new context with existing context
 */
const CONTEXT_MERGE_PROMPT = `You are helping merge new context into an existing context document.

The user has provided additional thoughts about a phase. Merge them with the existing context, preserving what was there while incorporating the new information.

Output your response as JSON:
{
  "vision": "Updated vision that incorporates both existing and new thoughts",
  "essential": ["Merged list of essential items - keep existing, add new, remove duplicates"],
  "outOfScope": ["Merged list of out-of-scope items"],
  "specificIdeas": "Combined specific ideas from both sources",
  "additionalNotes": "Combined additional notes"
}

Guidelines:
- PRESERVE existing context - don't discard it
- INTEGRATE new information naturally
- If new info contradicts old, prefer the new (user changed their mind)
- Remove duplicates but keep all unique items
- The merged vision should feel cohesive, not like two separate things stapled together

Always return valid JSON.`;

/**
 * Parse phase information from ROADMAP.md content
 */
interface ParsedPhaseInfo {
  number: number;
  name: string;
  goal: string;
  isComplete: boolean;
  isInserted: boolean;
}

/**
 * Extract all phases from ROADMAP.md content
 */
function parseRoadmapPhases(roadmapMd: string): ParsedPhaseInfo[] {
  const phases: ParsedPhaseInfo[] = [];

  const phasePattern = /-\s*\[([x\s])\]\s*\*\*Phase\s+(\d+(?:\.\d+)?):?\s*([^*]+)\*\*\s*[-–]\s*(.+)/gi;
  let match;

  while ((match = phasePattern.exec(roadmapMd)) !== null) {
    const isComplete = match[1].toLowerCase() === 'x';
    const numStr = match[2];
    const number = parseFloat(numStr);
    const name = match[3].trim();
    let goal = match[4].trim();

    const isInserted = goal.toUpperCase().includes('INSERTED');
    if (isInserted) {
      goal = goal.replace(/INSERTED\s*[-–]?\s*/i, '').trim();
    }

    phases.push({
      number,
      name,
      goal,
      isComplete,
      isInserted
    });
  }

  return phases.sort((a, b) => a.number - b.number);
}

/**
 * Format phase number for directory naming
 */
function formatPhaseNumber(phaseNum: number): string {
  if (Number.isInteger(phaseNum)) {
    return phaseNum.toString().padStart(2, '0');
  }
  const intPart = Math.floor(phaseNum);
  const decimalPart = Math.round((phaseNum - intPart) * 10);
  return `${intPart.toString().padStart(2, '0')}.${decimalPart}`;
}

/**
 * Convert phase name to kebab-case directory name
 */
function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract JSON from response, handling markdown code blocks
 */
function extractJsonFromResponse(response: string): string {
  const jsonBlockMatch = response.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }

  const codeBlockMatch = response.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  const jsonObjectMatch = response.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    return jsonObjectMatch[0];
  }

  return response.trim();
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Generate CONTEXT.md content from synthesized discussion
 */
function generateContextMarkdown(
  phaseNum: number,
  phaseName: string,
  context: {
    vision: string;
    essential: string[];
    outOfScope: string[];
    specificIdeas: string;
    additionalNotes: string;
  }
): string {
  const date = getCurrentDate();

  let content = `# Phase ${phaseNum}: ${phaseName} - Context

**Gathered:** ${date}
**Status:** Ready for planning

<vision>
## How This Should Work

${context.vision}

</vision>

<essential>
## What Must Be Nailed

`;

  for (const item of context.essential) {
    content += `- ${item}\n`;
  }

  content += `
</essential>

<boundaries>
## What's Out of Scope

`;

  for (const item of context.outOfScope) {
    content += `- ${item}\n`;
  }

  content += `
</boundaries>

<specifics>
## Specific Ideas

${context.specificIdeas || 'No specific requirements - open to standard approaches'}

</specifics>

<notes>
## Additional Context

${context.additionalNotes || 'No additional notes'}

</notes>

---

*Phase: ${formatPhaseNumber(phaseNum)}-${toKebabCase(phaseName)}*
*Context gathered: ${date}*
`;

  return content;
}

/**
 * Handle /discuss-phase command
 *
 * Engages user in adaptive questioning to gather phase context using
 * button-based flow (like verify-work) for non-blocking interaction:
 * 1. Validates phase number and checks if phase exists
 * 2. Checks if CONTEXT.md already exists
 * 3. Loads phase description from roadmap
 * 4. Generates 3-5 questions about user's vision
 * 5. Presents questions one at a time with button options
 * 6. After all questions answered, synthesizes into CONTEXT.md
 */
export async function handleDiscussPhase(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext, extensionContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/discuss-phase` again.\n');
    return { metadata: { lastCommand: 'discuss-phase' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Roadmap Found\n\n');
    stream.markdown('Cannot discuss phase without ROADMAP.md.\n\n');
    stream.markdown('Use **/create-roadmap** to create your roadmap first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'discuss-phase' } };
  }

  // Parse arguments - phase number and optional context
  const promptParts = request.prompt.trim().split(/\s+/);
  const phaseArg = promptParts[0];
  const userContext = promptParts.slice(1).join(' ');

  if (!phaseArg) {
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/discuss-phase <phase-number> [initial context]`**\n\n');
    stream.markdown('Gather context for a phase through collaborative discussion.\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/discuss-phase 3` - Start discussion for Phase 3\n');
    stream.markdown('- `/discuss-phase 3 I want it to feel like Linear` - With initial context\n\n');
    stream.markdown('**What we\'ll discuss:**\n');
    stream.markdown('- How you imagine this phase working\n');
    stream.markdown('- What\'s essential vs nice-to-have\n');
    stream.markdown('- What\'s explicitly out of scope\n');
    stream.markdown('- Any specific ideas or references\n\n');
    return { metadata: { lastCommand: 'discuss-phase' } };
  }

  // Validate phase number
  if (!/^[\d.]+$/.test(phaseArg)) {
    stream.markdown('## Invalid Argument\n\n');
    stream.markdown(`"${phaseArg}" is not a valid phase number.\n\n`);
    stream.markdown('**Usage:** `/discuss-phase <phase-number>`\n\n');
    return { metadata: { lastCommand: 'discuss-phase' } };
  }

  const phaseNum = parseFloat(phaseArg);
  if (isNaN(phaseNum) || phaseNum < 1) {
    stream.markdown('## Invalid Phase Number\n\n');
    stream.markdown(`"${phaseArg}" is not a valid phase number.\n\n`);
    stream.markdown('Phase number must be a positive number (e.g., 3, 2.1).\n\n');
    return { metadata: { lastCommand: 'discuss-phase' } };
  }

  // Read the FULL roadmap file
  stream.progress('Reading roadmap...');
  const roadmapUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'ROADMAP.md');
  let fullRoadmapContent: string;
  try {
    const roadmapBytes = await vscode.workspace.fs.readFile(roadmapUri);
    fullRoadmapContent = Buffer.from(roadmapBytes).toString('utf-8');
  } catch {
    stream.markdown('**Error:** Could not read ROADMAP.md\n');
    return { metadata: { lastCommand: 'discuss-phase' } };
  }

  const phases = parseRoadmapPhases(fullRoadmapContent);

  // Find target phase
  const targetPhase = phases.find(p => p.number === phaseNum);
  if (!targetPhase) {
    stream.markdown('## Phase Not Found\n\n');
    stream.markdown(`Phase ${phaseNum} does not exist in ROADMAP.md.\n\n`);
    stream.markdown('**Available phases:**\n');
    for (const p of phases) {
      const status = p.isComplete ? '[x]' : '[ ]';
      stream.markdown(`- ${status} Phase ${p.number}: ${p.name}\n`);
    }
    stream.markdown('\n');
    return { metadata: { lastCommand: 'discuss-phase' } };
  }

  // Check if CONTEXT.md already exists
  const dirName = `${formatPhaseNumber(phaseNum)}-${toKebabCase(targetPhase.name)}`;
  const contextFileName = `${formatPhaseNumber(phaseNum)}-CONTEXT.md`;
  const contextUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName, contextFileName);

  let existingContext = false;
  try {
    await vscode.workspace.fs.stat(contextUri);
    existingContext = true;
  } catch {
    // File doesn't exist, which is expected
  }

  // Load existing context if it exists (for merging)
  let existingContextContent: string | undefined;
  if (existingContext) {
    try {
      const existingBytes = await vscode.workspace.fs.readFile(contextUri);
      existingContextContent = Buffer.from(existingBytes).toString('utf-8');
    } catch {
      // Could not read existing file
    }
  }

  if (existingContext && !userContext) {
    stream.markdown('## Context Already Exists\n\n');
    stream.markdown(`Phase ${phaseNum} (${targetPhase.name}) already has context.\n\n`);
    stream.markdown('**Existing context:**\n');
    stream.reference(contextUri);
    stream.markdown('\n\n');
    stream.markdown('To add more context, run the command with your additional thoughts:\n');
    stream.markdown(`\`/discuss-phase ${phaseNum} [additional context to merge]\`\n\n`);
    stream.markdown('**Or proceed to next steps:**\n\n');
    stream.button({
      command: 'hopper.chat-participant.research-phase',
      arguments: [phaseNum],
      title: `Research Phase ${phaseNum}`
    });
    stream.markdown(' ');
    stream.button({
      command: 'hopper.chat-participant.plan-phase',
      arguments: [phaseNum],
      title: `Plan Phase ${phaseNum}`
    });
    return { metadata: { lastCommand: 'discuss-phase' } };
  }

  stream.progress('Preparing discussion...');

  try {
    // If user provided context, synthesize it (merging with existing if present)
    if (userContext) {
      const isMerging = !!existingContextContent;

      if (isMerging) {
        stream.markdown('## Merging Additional Context\n\n');
        stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n\n`);
        stream.markdown(`**Goal:** ${targetPhase.goal}\n\n`);
        stream.markdown('Merging your new context with existing...\n\n');
      } else {
        stream.markdown('## Capturing Context\n\n');
        stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n\n`);
        stream.markdown(`**Goal:** ${targetPhase.goal}\n\n`);
        stream.markdown('Processing your context...\n\n');
      }

      // Choose prompt based on whether we're merging or creating new
      const prompt = isMerging ? CONTEXT_MERGE_PROMPT : CONTEXT_SYNTHESIS_PROMPT;
      const userInput = isMerging
        ? `Phase: ${targetPhase.name}\nGoal: ${targetPhase.goal}\n\n--- EXISTING CONTEXT ---\n${existingContextContent}\n\n--- NEW INPUT TO MERGE ---\n${userContext}`
        : `Phase: ${targetPhase.name}\nGoal: ${targetPhase.goal}\n\nUser's input:\n${userContext}`;

      // Synthesize/merge context
      const synthesisMessages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(prompt),
        vscode.LanguageModelChatMessage.User(userInput)
      ];

      const synthesisResponse = await request.model.sendRequest(synthesisMessages, {}, token);

      let synthesisText = '';
      for await (const fragment of synthesisResponse.text) {
        if (token.isCancellationRequested) {
          stream.markdown('**Cancelled**\n');
          return { metadata: { lastCommand: 'discuss-phase' } };
        }
        synthesisText += fragment;
      }

      // Parse synthesis
      let context: {
        vision: string;
        essential: string[];
        outOfScope: string[];
        specificIdeas: string;
        additionalNotes: string;
      };

      try {
        const jsonStr = extractJsonFromResponse(synthesisText);
        context = JSON.parse(jsonStr);
        context.vision = context.vision || userContext;
        context.essential = context.essential || ['To be determined through further discussion'];
        context.outOfScope = context.outOfScope || ['To be determined'];
        context.specificIdeas = context.specificIdeas || '';
        context.additionalNotes = context.additionalNotes || '';
      } catch {
        // Fallback
        context = {
          vision: userContext,
          essential: ['To be determined through further discussion'],
          outOfScope: ['To be determined'],
          specificIdeas: '',
          additionalNotes: ''
        };
      }

      // Generate and save CONTEXT.md
      const contextContent = generateContextMarkdown(phaseNum, targetPhase.name, context);

      // Ensure phase directory exists
      const phaseDirUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName);
      try {
        await vscode.workspace.fs.createDirectory(phaseDirUri);
      } catch {
        // Directory may already exist
      }

      await vscode.workspace.fs.writeFile(
        contextUri,
        Buffer.from(contextContent, 'utf-8')
      );

      // Success!
      stream.markdown(isMerging ? '## Context Updated\n\n' : '## Context Captured\n\n');
      stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n\n`);
      stream.markdown('### Vision Summary\n\n');
      stream.markdown(`${context.vision}\n\n`);

      if (context.essential.length > 0) {
        stream.markdown('### What Must Be Nailed\n\n');
        for (const item of context.essential) {
          stream.markdown(`- ${item}\n`);
        }
        stream.markdown('\n');
      }

      stream.markdown(isMerging ? '**Updated:**\n' : '**Created:**\n');
      stream.reference(contextUri);
      stream.markdown('\n\n');

      stream.markdown('### Want to Add More?\n\n');
      stream.markdown('Run `/discuss-phase` again with additional context:\n');
      stream.markdown(`\`/discuss-phase ${phaseNum} [more details about your vision]\`\n\n`);

      stream.markdown('### Next Steps\n\n');
      stream.button({
        command: 'hopper.chat-participant.research-phase',
        arguments: [phaseNum],
        title: `Research Phase ${phaseNum}`
      });
      stream.markdown(' ');
      stream.button({
        command: 'hopper.chat-participant.plan-phase',
        arguments: [phaseNum],
        title: `Plan Phase ${phaseNum}`
      });

      return {
        metadata: {
          lastCommand: 'discuss-phase',
          phaseNumber: phaseNum
        }
      };
    }

    // Check for existing discussion state (resume capability)
    const savedState = loadDiscussionState(extensionContext, phaseNum);

    // If we have saved state that's complete (all questions answered), synthesize context
    if (savedState && savedState.currentQuestionIndex >= savedState.questions.length && savedState.responses.length > 0) {
      stream.progress('Synthesizing your responses...');

      // Collect all responses
      const allResponses = savedState.responses.map(r => {
        const q = savedState.questions[r.questionIndex];
        return `Q: ${q.question}\nA: ${r.selectedOption || r.customResponse || 'No answer'}`;
      }).join('\n\n');

      // Use LLM to synthesize into context
      const synthesisMessages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(CONTEXT_SYNTHESIS_PROMPT),
        vscode.LanguageModelChatMessage.User(`Phase: ${targetPhase.name}\nGoal: ${targetPhase.goal}\n\nDiscussion:\n${allResponses}`)
      ];

      const synthesisResponse = await request.model.sendRequest(synthesisMessages, {}, token);
      let synthesisText = '';
      for await (const fragment of synthesisResponse.text) {
        if (token.isCancellationRequested) {
          stream.markdown('**Cancelled**\n');
          return { metadata: { lastCommand: 'discuss-phase' } };
        }
        synthesisText += fragment;
      }

      // Parse synthesis
      let context: {
        vision: string;
        essential: string[];
        outOfScope: string[];
        specificIdeas: string;
        additionalNotes: string;
      };

      try {
        const jsonStr = extractJsonFromResponse(synthesisText);
        context = JSON.parse(jsonStr);
        context.vision = context.vision || 'Vision captured from discussion';
        context.essential = context.essential || ['To be refined'];
        context.outOfScope = context.outOfScope || ['To be determined'];
        context.specificIdeas = context.specificIdeas || '';
        context.additionalNotes = context.additionalNotes || '';
      } catch {
        context = {
          vision: 'Context gathered through discussion',
          essential: ['Captured from discussion'],
          outOfScope: ['To be determined'],
          specificIdeas: '',
          additionalNotes: ''
        };
      }

      // Generate and save CONTEXT.md
      const contextContent = generateContextMarkdown(phaseNum, targetPhase.name, context);
      const phaseDirUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName);
      try {
        await vscode.workspace.fs.createDirectory(phaseDirUri);
      } catch { /* Directory may already exist */ }

      await vscode.workspace.fs.writeFile(contextUri, Buffer.from(contextContent, 'utf-8'));
      await clearDiscussionState(extensionContext, phaseNum);

      stream.markdown('## Context Captured\n\n');
      stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n\n`);
      stream.markdown('### Vision Summary\n\n');
      stream.markdown(`${context.vision}\n\n`);

      if (context.essential.length > 0) {
        stream.markdown('### What Must Be Nailed\n\n');
        for (const item of context.essential) {
          stream.markdown(`- ${item}\n`);
        }
        stream.markdown('\n');
      }

      stream.markdown('**Created:**\n');
      stream.reference(contextUri);
      stream.markdown('\n\n');

      stream.markdown('### Next Steps\n\n');
      stream.button({
        command: 'hopper.chat-participant.research-phase',
        arguments: [phaseNum],
        title: `Research Phase ${phaseNum}`
      });
      stream.markdown(' ');
      stream.button({
        command: 'hopper.chat-participant.plan-phase',
        arguments: [phaseNum],
        title: `Plan Phase ${phaseNum}`
      });

      return { metadata: { lastCommand: 'discuss-phase', phaseNumber: phaseNum } };
    }

    // If we have saved state with questions, continue from current question
    if (savedState && savedState.questions.length > 0 && savedState.currentQuestionIndex < savedState.questions.length) {
      const isResuming = savedState.pausedAt || savedState.responses.length > 0;

      if (isResuming) {
        stream.markdown('## Resuming Discussion\n\n');
        stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n`);
        stream.markdown(`**Progress:** ${savedState.responses.length} of ${savedState.questions.length} questions answered\n\n`);

        // Show prior responses briefly
        if (savedState.responses.length > 0) {
          stream.markdown('### Prior Responses\n\n');
          for (const r of savedState.responses) {
            const q = savedState.questions[r.questionIndex];
            const answer = r.selectedOption || r.customResponse || 'No answer';
            const truncated = answer.length > 50 ? answer.substring(0, 47) + '...' : answer;
            stream.markdown(`- Q${r.questionIndex + 1}: ${truncated}\n`);
          }
          stream.markdown('\n');
        }
      } else {
        stream.markdown('## Let\'s Discuss This Phase\n\n');
        stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n`);
        stream.markdown(`**Goal:** ${targetPhase.goal}\n\n`);
        stream.markdown('Click the buttons below to share your vision. **You can type in chat anytime** for custom responses.\n\n');
      }

      // Display current question with buttons
      displayQuestionWithButtons(
        stream,
        savedState.questions[savedState.currentQuestionIndex],
        savedState.currentQuestionIndex,
        savedState.questions.length,
        phaseNum
      );

      // Mark as waiting for response
      savedState.waitingForResponse = true;
      await saveDiscussionState(extensionContext, savedState);

      return { metadata: { lastCommand: 'discuss-phase', phaseNumber: phaseNum, waitingForResponse: true } };
    }

    // No saved state - generate questions and start fresh
    stream.progress('Generating discussion questions...');

    const questionMessages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(QUESTIONS_GENERATION_PROMPT),
      vscode.LanguageModelChatMessage.User(`Phase: ${targetPhase.name}\nGoal: ${targetPhase.goal}`)
    ];

    const questionResponse = await request.model.sendRequest(questionMessages, {}, token);
    let questionText = '';
    for await (const fragment of questionResponse.text) {
      if (token.isCancellationRequested) {
        stream.markdown('**Cancelled**\n');
        return { metadata: { lastCommand: 'discuss-phase' } };
      }
      questionText += fragment;
    }

    // Parse questions
    let questions: Array<{ question: string; interpretationOptions: string[]; context: string }>;
    try {
      const jsonStr = extractJsonFromResponse(questionText);
      const parsed = JSON.parse(jsonStr);
      questions = parsed.questions || [];
      if (questions.length === 0) throw new Error('No questions');
    } catch {
      // Fallback questions
      questions = [
        {
          question: `How do you imagine ${targetPhase.name} working?`,
          interpretationOptions: ['Something simple and focused', 'Something feature-rich', 'Somewhere in between'],
          context: 'Understanding your vision helps create a better plan.'
        },
        {
          question: 'What\'s the most important thing to get right?',
          interpretationOptions: ['Performance and speed', 'User experience', 'Flexibility and extensibility'],
          context: 'Prioritizing helps make tradeoff decisions.'
        },
        {
          question: 'What should we explicitly NOT do in this phase?',
          interpretationOptions: ['Avoid over-engineering', 'Skip advanced features', 'Don\'t touch existing code'],
          context: 'Clear boundaries prevent scope creep.'
        }
      ];
    }

    // Create and save new discussion state
    const newState: DiscussionState = {
      phaseNum,
      phaseName: targetPhase.name,
      phaseGoal: targetPhase.goal,
      questions,
      responses: [],
      currentQuestionIndex: 0,
      startedAt: new Date().toISOString(),
      waitingForResponse: true
    };
    await saveDiscussionState(extensionContext, newState);

    // Present the phase and first question
    stream.markdown('## Let\'s Discuss This Phase\n\n');
    stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n`);
    stream.markdown(`**Goal:** ${targetPhase.goal}\n\n`);
    stream.markdown(`**${questions.length} questions** to help capture your vision.\n`);
    stream.markdown('Click buttons to answer, or type in chat for custom responses.\n\n');

    // Display first question with buttons
    displayQuestionWithButtons(stream, questions[0], 0, questions.length, phaseNum);

    return {
      metadata: {
        lastCommand: 'discuss-phase',
        phaseNumber: phaseNum,
        waitingForResponse: true
      }
    };

  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      stream.markdown(`**Model Error:** ${err.message}\n\n`);
      stream.markdown('Please check your model connection and try again.\n');
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err);
      stream.markdown(`**Error:** ${errorMessage}\n`);
    }
    return { metadata: { lastCommand: 'discuss-phase' } };
  }
}

/**
 * Handle response button click from discuss-phase UI
 * Called when user clicks an option button or provides custom input
 */
export async function handleDiscussPhaseResponse(
  extensionContext: vscode.ExtensionContext,
  phaseNum: number,
  questionIndex: number,
  selectedOption?: string,
  customResponse?: string
): Promise<{ completed: boolean; message: string }> {
  // Load current state
  const state = loadDiscussionState(extensionContext, phaseNum);

  if (!state) {
    return { completed: false, message: 'No discussion state found. Run /discuss-phase to start.' };
  }

  // Record the response
  state.responses.push({
    questionIndex,
    selectedOption,
    customResponse
  });

  // Move to next question
  state.currentQuestionIndex = questionIndex + 1;
  state.waitingForResponse = false;
  await saveDiscussionState(extensionContext, state);

  if (state.currentQuestionIndex >= state.questions.length) {
    return { completed: true, message: `Question ${questionIndex + 1} answered. All questions complete! Creating context...` };
  }

  return { completed: false, message: `Question ${questionIndex + 1} answered. Continue with next question.` };
}

/**
 * Handle pause button click from discuss-phase UI
 * Saves state with timestamp for resume
 */
export async function handleDiscussPhasePause(
  extensionContext: vscode.ExtensionContext,
  phaseNum: number
): Promise<{ message: string }> {
  // Load current state
  const state = loadDiscussionState(extensionContext, phaseNum);

  if (!state) {
    return { message: 'No discussion state found. Run /discuss-phase to start.' };
  }

  state.pausedAt = new Date().toISOString();
  state.waitingForResponse = false;
  await saveDiscussionState(extensionContext, state);

  const completed = state.responses.length;
  const remaining = state.questions.length - completed;

  return {
    message: `Discussion paused. ${completed} answered, ${remaining} remaining. Run /discuss-phase ${phaseNum} to resume.`
  };
}
