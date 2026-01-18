import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * System prompt for generating initial milestone discussion question
 */
const MILESTONE_QUESTION_PROMPT = `You are helping gather context for a new project milestone.

Based on the previous milestone accomplishments and current project state, generate an initial question to understand what the user wants to build next.

Output your response as JSON:
{
  "question": "The question to ask (natural, conversational)",
  "featureOptions": ["Feature area A", "Feature area B", "Feature area C", "Feature area D"],
  "context": "Brief context about why you're asking this"
}

Guidelines:
- Ask about what they want to add, improve, or fix
- Feature options should be broad categories relevant to the project
- Keep it natural and conversational
- Focus on user value, not technical implementation

Always return valid JSON.`;

/**
 * System prompt for synthesizing milestone context from discussion
 */
const MILESTONE_CONTEXT_SYNTHESIS_PROMPT = `You are helping create a context document for a new milestone.

Based on the user's input about what they want to build, synthesize structured context.

Output your response as JSON:
{
  "vision": "The overarching vision for this milestone - what will it deliver?",
  "priorities": ["Priority 1", "Priority 2", "Priority 3"],
  "constraints": ["Constraint 1 (e.g., timeline, resources)", "Constraint 2"],
  "successCriteria": ["Success criterion 1", "Success criterion 2", "Success criterion 3"],
  "suggestedName": "Suggested milestone name (e.g., 'v2.0 Features', 'Performance Release')"
}

Guidelines:
- Vision should be a clear, compelling description of what this milestone achieves
- Priorities should be the most important things to deliver
- Constraints should be realistic limitations (timeline, resources, dependencies)
- Success criteria should be measurable outcomes
- Suggested name should be versioned or thematic

Always return valid JSON.`;

/**
 * Parse phase information from ROADMAP.md content
 */
interface ParsedPhaseInfo {
  number: number;
  name: string;
  goal: string;
  isComplete: boolean;
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

    // Remove INSERTED marker from goal
    goal = goal.replace(/INSERTED\s*[-–]?\s*/i, '').trim();

    phases.push({
      number,
      name,
      goal,
      isComplete
    });
  }

  return phases.sort((a, b) => a.number - b.number);
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
 * Generate MILESTONE-CONTEXT.md content
 */
function generateMilestoneContextMarkdown(
  context: {
    vision: string;
    priorities: string[];
    constraints: string[];
    successCriteria: string[];
    suggestedName: string;
  }
): string {
  const date = getCurrentDate();

  let content = `# Milestone Context

**Gathered:** ${date}
**Status:** Ready for milestone creation
**Suggested Name:** ${context.suggestedName}

## Vision

${context.vision}

## Priorities

`;

  for (const priority of context.priorities) {
    content += `1. ${priority}\n`;
  }

  content += `
## Constraints

`;

  for (const constraint of context.constraints) {
    content += `- ${constraint}\n`;
  }

  content += `
## Success Criteria

`;

  for (const criterion of context.successCriteria) {
    content += `- [ ] ${criterion}\n`;
  }

  content += `
---

*Context gathered: ${date}*
*Ready for: /new-milestone ${context.suggestedName}*
`;

  return content;
}

/**
 * Handle /discuss-milestone command
 *
 * Gathers context for the next milestone through collaborative thinking:
 * 1. Verifies current milestone status
 * 2. Presents context from previous work
 * 3. Asks about what user wants to build next
 * 4. Synthesizes into MILESTONE-CONTEXT.md
 * 5. Offers to proceed with /new-milestone
 */
export async function handleDiscussMilestone(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/discuss-milestone` again.\n');
    return { metadata: { lastCommand: 'discuss-milestone' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('Cannot discuss milestone without ROADMAP.md.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'discuss-milestone' } };
  }

  // Get user input from prompt
  const userInput = request.prompt.trim();

  // Read full roadmap
  stream.progress('Reading project context...');
  const roadmapUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'ROADMAP.md');
  let fullRoadmapContent: string;
  try {
    const roadmapBytes = await vscode.workspace.fs.readFile(roadmapUri);
    fullRoadmapContent = Buffer.from(roadmapBytes).toString('utf-8');
  } catch {
    stream.markdown('**Error:** Could not read ROADMAP.md\n');
    return { metadata: { lastCommand: 'discuss-milestone' } };
  }

  const phases = parseRoadmapPhases(fullRoadmapContent);
  const completedPhases = phases.filter(p => p.isComplete);
  const incompletePhases = phases.filter(p => !p.isComplete);

  try {
    // If user provided context, synthesize it directly
    if (userInput) {
      stream.markdown('## Capturing Milestone Context\n\n');
      stream.markdown('Processing your input...\n\n');

      // Build context for synthesis
      const contextParts = [
        'Project context:',
        `- Completed phases: ${completedPhases.length}`,
        `- Recent accomplishments: ${completedPhases.slice(-3).map(p => p.name).join(', ')}`,
        '',
        `User's input for next milestone:`,
        userInput
      ];

      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(MILESTONE_CONTEXT_SYNTHESIS_PROMPT),
        vscode.LanguageModelChatMessage.User(contextParts.join('\n'))
      ];

      const response = await request.model.sendRequest(messages, {}, token);

      let fullResponse = '';
      for await (const fragment of response.text) {
        if (token.isCancellationRequested) {
          stream.markdown('**Cancelled**\n');
          return { metadata: { lastCommand: 'discuss-milestone' } };
        }
        fullResponse += fragment;
      }

      // Parse synthesis
      let context: {
        vision: string;
        priorities: string[];
        constraints: string[];
        successCriteria: string[];
        suggestedName: string;
      };

      try {
        const jsonStr = extractJsonFromResponse(fullResponse);
        context = JSON.parse(jsonStr);
        context.vision = context.vision || userInput;
        context.priorities = context.priorities || ['To be defined'];
        context.constraints = context.constraints || ['None specified'];
        context.successCriteria = context.successCriteria || ['Milestone delivered'];
        context.suggestedName = context.suggestedName || 'Next Release';
      } catch {
        context = {
          vision: userInput,
          priorities: ['To be defined through planning'],
          constraints: ['None specified'],
          successCriteria: ['Milestone delivered successfully'],
          suggestedName: 'Next Release'
        };
      }

      // Generate and save MILESTONE-CONTEXT.md
      const contextContent = generateMilestoneContextMarkdown(context);

      const contextUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'MILESTONE-CONTEXT.md');
      await vscode.workspace.fs.writeFile(
        contextUri,
        Buffer.from(contextContent, 'utf-8')
      );

      // Success!
      stream.markdown('## Milestone Context Captured\n\n');

      stream.markdown('### Vision\n\n');
      stream.markdown(`${context.vision}\n\n`);

      stream.markdown('### Priorities\n\n');
      for (const priority of context.priorities) {
        stream.markdown(`1. ${priority}\n`);
      }
      stream.markdown('\n');

      stream.markdown('### Success Criteria\n\n');
      for (const criterion of context.successCriteria) {
        stream.markdown(`- ${criterion}\n`);
      }
      stream.markdown('\n');

      stream.markdown('**Suggested milestone name:** ' + context.suggestedName + '\n\n');

      stream.markdown('**Created:**\n');
      stream.reference(contextUri);
      stream.markdown('\n\n');

      stream.markdown('### Ready to Create Milestone?\n\n');
      stream.button({
        command: 'hopper.chat-participant.new-milestone',
        title: `Create "${context.suggestedName}"`
      });
      stream.markdown('\n\n');

      stream.markdown('### Want to Add More Context?\n\n');
      stream.markdown('Run `/discuss-milestone` again with additional details:\n');
      stream.markdown('`/discuss-milestone [more details about your vision]`\n');

      return {
        metadata: {
          lastCommand: 'discuss-milestone',
          nextAction: 'new-milestone'
        }
      };
    }

    // No user input - generate initial question
    stream.progress('Preparing discussion...');

    // Build context for question generation
    const contextParts = [
      'Project status:',
      `- Total phases: ${phases.length}`,
      `- Completed: ${completedPhases.length}`,
      `- In progress: ${incompletePhases.length}`,
      '',
      'Recent completed phases:',
      ...completedPhases.slice(-5).map(p => `- Phase ${p.number}: ${p.name} - ${p.goal}`)
    ];

    if (incompletePhases.length > 0) {
      contextParts.push('', 'Current work:', ...incompletePhases.map(p => `- Phase ${p.number}: ${p.name} - ${p.goal}`));
    }

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(MILESTONE_QUESTION_PROMPT),
      vscode.LanguageModelChatMessage.User(contextParts.join('\n'))
    ];

    const response = await request.model.sendRequest(messages, {}, token);

    let fullResponse = '';
    for await (const fragment of response.text) {
      if (token.isCancellationRequested) {
        stream.markdown('**Cancelled**\n');
        return { metadata: { lastCommand: 'discuss-milestone' } };
      }
      fullResponse += fragment;
    }

    // Parse question
    let question: {
      question: string;
      featureOptions: string[];
      context: string;
    };

    try {
      const jsonStr = extractJsonFromResponse(fullResponse);
      question = JSON.parse(jsonStr);
    } catch {
      question = {
        question: 'What do you want to build in the next milestone?',
        featureOptions: [
          'New features',
          'Performance improvements',
          'Bug fixes and stability',
          'Developer experience'
        ],
        context: 'Understanding your goals helps create a focused milestone.'
      };
    }

    // Present project status and question
    stream.markdown('## Let\'s Plan the Next Milestone\n\n');

    // Show project status
    stream.markdown('### Current Status\n\n');
    stream.markdown(`**Phases completed:** ${completedPhases.length}\n`);
    if (incompletePhases.length > 0) {
      stream.markdown(`**In progress:** ${incompletePhases.length}\n`);
    }
    stream.markdown('\n');

    if (completedPhases.length > 0) {
      stream.markdown('**Recent accomplishments:**\n');
      for (const phase of completedPhases.slice(-3)) {
        stream.markdown(`- Phase ${phase.number}: ${phase.name}\n`);
      }
      stream.markdown('\n');
    }

    stream.markdown('---\n\n');

    // Present the question
    stream.markdown(`### ${question.question}\n\n`);
    stream.markdown(`*${question.context}*\n\n`);

    stream.markdown('**Some areas to consider:**\n');
    for (const option of question.featureOptions) {
      stream.markdown(`- ${option}\n`);
    }
    stream.markdown('\n');

    stream.markdown('---\n\n');

    stream.markdown('### How to Respond\n\n');
    stream.markdown('Share your vision by running the command again with your thoughts:\n\n');
    stream.markdown('`/discuss-milestone [what you want to build next]`\n\n');
    stream.markdown('**Example:**\n');
    stream.markdown('`/discuss-milestone I want to add real-time collaboration features and improve the mobile experience`\n\n');

    stream.markdown('### Or Skip Directly to Milestone Creation\n\n');
    stream.markdown('If you already know what you want:\n\n');
    stream.button({
      command: 'hopper.chat-participant.new-milestone',
      title: 'Create New Milestone'
    });

    return {
      metadata: {
        lastCommand: 'discuss-milestone',
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
    return { metadata: { lastCommand: 'discuss-milestone' } };
  }
}
