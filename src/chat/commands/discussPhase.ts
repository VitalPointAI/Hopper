import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * System prompt for initial phase vision question
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
 * Engages user in adaptive questioning to gather phase context:
 * 1. Validates phase number and checks if phase exists
 * 2. Checks if CONTEXT.md already exists
 * 3. Loads phase description from roadmap
 * 4. Presents initial vision question
 * 5. Since VSCode Chat doesn't support interactive questioning,
 *    we generate a context document based on available information
 *    and invite the user to provide more details in follow-up messages
 */
export async function handleDiscussPhase(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

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

    // No user context provided - generate initial question
    const questionMessages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(VISION_QUESTION_PROMPT),
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

    // Parse question
    let question: {
      question: string;
      interpretationOptions: string[];
      context: string;
    };

    try {
      const jsonStr = extractJsonFromResponse(questionText);
      question = JSON.parse(jsonStr);
    } catch {
      // Fallback
      question = {
        question: `How do you imagine ${targetPhase.name} working?`,
        interpretationOptions: [
          'Something simple and focused',
          'Something feature-rich',
          'Something that feels like [reference product]'
        ],
        context: 'Understanding your vision helps create a better plan.'
      };
    }

    // Present the phase and question
    stream.markdown('## Let\'s Discuss This Phase\n\n');
    stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n\n`);
    stream.markdown(`**Goal:** ${targetPhase.goal}\n\n`);

    stream.markdown('---\n\n');
    stream.markdown(`### ${question.question}\n\n`);
    stream.markdown(`*${question.context}*\n\n`);

    stream.markdown('**Some possibilities:**\n');
    for (const option of question.interpretationOptions) {
      stream.markdown(`- ${option}\n`);
    }
    stream.markdown('\n');

    stream.markdown('---\n\n');
    stream.markdown('### How to Respond\n\n');
    stream.markdown('Share your vision by running the command again with your thoughts:\n\n');
    stream.markdown(`\`/discuss-phase ${phaseNum} [your vision for this phase]\`\n\n`);
    stream.markdown('**Example:**\n');
    stream.markdown(`\`/discuss-phase ${phaseNum} I want it to feel calm and organized, not overwhelming. The main thing is seeing what needs attention at a glance.\`\n\n`);

    stream.markdown('### Or Skip to Planning\n\n');
    stream.markdown('If you\'re ready to plan without detailed context:\n\n');
    stream.button({
      command: 'hopper.chat-participant.plan-phase',
      arguments: [phaseNum],
      title: `Plan Phase ${phaseNum}`
    });

    return {
      metadata: {
        lastCommand: 'discuss-phase',
        phaseNumber: phaseNum,
        nextAction: 'provide-context'
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
