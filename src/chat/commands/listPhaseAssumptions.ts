import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * System prompt for surfacing assumptions about a phase
 */
const ASSUMPTIONS_PROMPT = `You are helping a user understand what Claude might assume about implementing a project phase.

Based on the phase description and project context, surface your assumptions about:
1. Technical approach - What technologies/patterns you'd default to
2. Implementation order - What order you'd tackle things
3. Scope boundaries - What you assume is in/out of scope
4. Risk areas - What might go wrong
5. Dependencies - What you assume needs to exist first

Output your response as JSON:
{
  "technicalApproach": {
    "technologies": ["Tech 1: why you'd use it", "Tech 2: why you'd use it"],
    "patterns": ["Pattern 1: when you'd apply it", "Pattern 2: when you'd apply it"],
    "mightBeWrong": "What could be wrong about these assumptions"
  },
  "implementationOrder": {
    "steps": ["Step 1: why first", "Step 2: why second", "Step 3: why third"],
    "mightBeWrong": "What could be wrong about this order"
  },
  "scopeBoundaries": {
    "inScope": ["Thing 1", "Thing 2", "Thing 3"],
    "outOfScope": ["Thing 1", "Thing 2"],
    "mightBeWrong": "What scope assumptions might be wrong"
  },
  "riskAreas": {
    "risks": ["Risk 1: why it matters", "Risk 2: why it matters"],
    "mightBeWrong": "What risk assumptions might be wrong"
  },
  "dependencies": {
    "assumed": ["Dependency 1: why needed", "Dependency 2: why needed"],
    "mightBeWrong": "What dependency assumptions might be wrong"
  },
  "overallConfidence": "HIGH|MEDIUM|LOW",
  "biggestUncertainty": "The single biggest thing that could change the approach"
}

Be honest about what you might get wrong. The goal is to help the user catch bad assumptions BEFORE planning.

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
 * Handle /list-phase-assumptions command
 *
 * Surfaces Claude's assumptions about a phase approach before planning:
 * 1. Validates phase number
 * 2. Analyzes phase description
 * 3. Surfaces assumptions about technical approach, implementation order,
 *    scope boundaries, risk areas, and dependencies
 * 4. Presents assumptions clearly for user review
 * 5. Does NOT create any files - purely informational
 */
export async function handleListPhaseAssumptions(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/list-phase-assumptions` again.\n');
    return { metadata: { lastCommand: 'list-phase-assumptions' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Roadmap Found\n\n');
    stream.markdown('Cannot list assumptions without ROADMAP.md.\n\n');
    stream.markdown('Use **/create-roadmap** to create your roadmap first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'list-phase-assumptions' } };
  }

  // Parse phase number from prompt
  const promptText = request.prompt.trim();
  if (!promptText) {
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/list-phase-assumptions <phase-number>`**\n\n');
    stream.markdown('Surface Claude\'s assumptions about a phase before planning.\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/list-phase-assumptions 3` - Show assumptions for Phase 3\n');
    stream.markdown('- `/list-phase-assumptions 2.1` - Show assumptions for Phase 2.1\n\n');
    stream.markdown('**Why use this:**\n');
    stream.markdown('- See what Claude thinks BEFORE planning begins\n');
    stream.markdown('- Catch wrong assumptions early\n');
    stream.markdown('- Understand what context might be missing\n\n');
    stream.markdown('**Note:** This command shows assumptions only - no files are created.\n');
    return { metadata: { lastCommand: 'list-phase-assumptions' } };
  }

  // Validate phase number
  if (!/^[\d.]+$/.test(promptText)) {
    stream.markdown('## Invalid Argument\n\n');
    stream.markdown(`"${promptText}" is not a valid phase number.\n\n`);
    stream.markdown('**Usage:** `/list-phase-assumptions <phase-number>`\n\n');
    return { metadata: { lastCommand: 'list-phase-assumptions' } };
  }

  const phaseNum = parseFloat(promptText);
  if (isNaN(phaseNum) || phaseNum < 1) {
    stream.markdown('## Invalid Phase Number\n\n');
    stream.markdown(`"${promptText}" is not a valid phase number.\n\n`);
    stream.markdown('Phase number must be a positive number (e.g., 3, 2.1).\n\n');
    return { metadata: { lastCommand: 'list-phase-assumptions' } };
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
    return { metadata: { lastCommand: 'list-phase-assumptions' } };
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
    return { metadata: { lastCommand: 'list-phase-assumptions' } };
  }

  stream.progress('Analyzing phase assumptions...');

  try {
    // Build context for assumption analysis
    const contextParts = [
      `Phase ${phaseNum}: ${targetPhase.name}`,
      `Goal: ${targetPhase.goal}`,
      '',
      'Project context:',
      projectContext.projectMd ? projectContext.projectMd.slice(0, 3000) : 'No project description available',
      '',
      'Other phases in roadmap:',
      ...phases.filter(p => p.number !== phaseNum).map(p => `- Phase ${p.number}: ${p.name} - ${p.goal}`)
    ];

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(ASSUMPTIONS_PROMPT),
      vscode.LanguageModelChatMessage.User(contextParts.join('\n'))
    ];

    const response = await request.model.sendRequest(messages, {}, token);

    let responseText = '';
    for await (const fragment of response.text) {
      if (token.isCancellationRequested) {
        stream.markdown('**Cancelled**\n');
        return { metadata: { lastCommand: 'list-phase-assumptions' } };
      }
      responseText += fragment;
    }

    // Parse assumptions
    let assumptions: {
      technicalApproach: {
        technologies: string[];
        patterns: string[];
        mightBeWrong: string;
      };
      implementationOrder: {
        steps: string[];
        mightBeWrong: string;
      };
      scopeBoundaries: {
        inScope: string[];
        outOfScope: string[];
        mightBeWrong: string;
      };
      riskAreas: {
        risks: string[];
        mightBeWrong: string;
      };
      dependencies: {
        assumed: string[];
        mightBeWrong: string;
      };
      overallConfidence: string;
      biggestUncertainty: string;
    };

    try {
      const jsonStr = extractJsonFromResponse(responseText);
      assumptions = JSON.parse(jsonStr);

      // Validate with defaults
      assumptions.technicalApproach = assumptions.technicalApproach || { technologies: [], patterns: [], mightBeWrong: '' };
      assumptions.implementationOrder = assumptions.implementationOrder || { steps: [], mightBeWrong: '' };
      assumptions.scopeBoundaries = assumptions.scopeBoundaries || { inScope: [], outOfScope: [], mightBeWrong: '' };
      assumptions.riskAreas = assumptions.riskAreas || { risks: [], mightBeWrong: '' };
      assumptions.dependencies = assumptions.dependencies || { assumed: [], mightBeWrong: '' };
      assumptions.overallConfidence = assumptions.overallConfidence || 'MEDIUM';
      assumptions.biggestUncertainty = assumptions.biggestUncertainty || 'Scope definition';
    } catch {
      stream.markdown('## Unable to Analyze Assumptions\n\n');
      stream.markdown('Could not parse assumptions from the model response.\n\n');
      stream.markdown('**Suggestions:**\n');
      stream.markdown('- Try running the command again\n');
      stream.markdown('- Add more details to PROJECT.md\n\n');
      stream.button({
        command: 'hopper.chat-participant.list-phase-assumptions',
        title: 'Try Again'
      });
      return { metadata: { lastCommand: 'list-phase-assumptions' } };
    }

    // Present assumptions
    stream.markdown('## Claude\'s Assumptions\n\n');
    stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n\n`);
    stream.markdown(`**Goal:** ${targetPhase.goal}\n\n`);
    stream.markdown(`**Overall Confidence:** ${assumptions.overallConfidence}\n\n`);

    stream.markdown('---\n\n');

    // Technical Approach
    stream.markdown('### Technical Approach\n\n');
    stream.markdown('**Technologies I\'d default to:**\n');
    for (const tech of assumptions.technicalApproach.technologies) {
      stream.markdown(`- ${tech}\n`);
    }
    stream.markdown('\n');

    if (assumptions.technicalApproach.patterns.length > 0) {
      stream.markdown('**Patterns I\'d apply:**\n');
      for (const pattern of assumptions.technicalApproach.patterns) {
        stream.markdown(`- ${pattern}\n`);
      }
      stream.markdown('\n');
    }

    if (assumptions.technicalApproach.mightBeWrong) {
      stream.markdown(`*What could be wrong:* ${assumptions.technicalApproach.mightBeWrong}\n\n`);
    }

    // Implementation Order
    stream.markdown('### Implementation Order\n\n');
    stream.markdown('**Steps I\'d take:**\n');
    for (let i = 0; i < assumptions.implementationOrder.steps.length; i++) {
      stream.markdown(`${i + 1}. ${assumptions.implementationOrder.steps[i]}\n`);
    }
    stream.markdown('\n');

    if (assumptions.implementationOrder.mightBeWrong) {
      stream.markdown(`*What could be wrong:* ${assumptions.implementationOrder.mightBeWrong}\n\n`);
    }

    // Scope Boundaries
    stream.markdown('### Scope Boundaries\n\n');
    stream.markdown('**What I assume is IN scope:**\n');
    for (const item of assumptions.scopeBoundaries.inScope) {
      stream.markdown(`- ${item}\n`);
    }
    stream.markdown('\n');

    stream.markdown('**What I assume is OUT of scope:**\n');
    for (const item of assumptions.scopeBoundaries.outOfScope) {
      stream.markdown(`- ${item}\n`);
    }
    stream.markdown('\n');

    if (assumptions.scopeBoundaries.mightBeWrong) {
      stream.markdown(`*What could be wrong:* ${assumptions.scopeBoundaries.mightBeWrong}\n\n`);
    }

    // Risk Areas
    stream.markdown('### Risk Areas\n\n');
    stream.markdown('**What might go wrong:**\n');
    for (const risk of assumptions.riskAreas.risks) {
      stream.markdown(`- ${risk}\n`);
    }
    stream.markdown('\n');

    if (assumptions.riskAreas.mightBeWrong) {
      stream.markdown(`*What could be wrong:* ${assumptions.riskAreas.mightBeWrong}\n\n`);
    }

    // Dependencies
    stream.markdown('### Dependencies\n\n');
    stream.markdown('**What I assume needs to exist:**\n');
    for (const dep of assumptions.dependencies.assumed) {
      stream.markdown(`- ${dep}\n`);
    }
    stream.markdown('\n');

    if (assumptions.dependencies.mightBeWrong) {
      stream.markdown(`*What could be wrong:* ${assumptions.dependencies.mightBeWrong}\n\n`);
    }

    // Biggest Uncertainty
    stream.markdown('---\n\n');
    stream.markdown('### Biggest Uncertainty\n\n');
    stream.markdown(`**${assumptions.biggestUncertainty}**\n\n`);

    // What to do next
    stream.markdown('---\n\n');
    stream.markdown('## What Do You Think?\n\n');
    stream.markdown('Are these assumptions correct? If not, you can:\n\n');

    stream.markdown('**1. Clarify your vision** with `/discuss-phase`\n');
    stream.button({
      command: 'hopper.chat-participant.discuss-phase',
      title: `Discuss Phase ${phaseNum}`
    });

    stream.markdown('\n\n**2. Research the domain** with `/research-phase`\n');
    stream.button({
      command: 'hopper.chat-participant.research-phase',
      title: `Research Phase ${phaseNum}`
    });

    stream.markdown('\n\n**3. Proceed to planning** if assumptions look good\n');
    stream.button({
      command: 'hopper.chat-participant.plan-phase',
      title: `Plan Phase ${phaseNum}`
    });

    return {
      metadata: {
        lastCommand: 'list-phase-assumptions',
        phaseNumber: phaseNum
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
    return { metadata: { lastCommand: 'list-phase-assumptions' } };
  }
}
