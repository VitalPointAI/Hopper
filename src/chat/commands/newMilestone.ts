import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * System prompt for generating milestone details from user description
 */
const MILESTONE_GENERATION_PROMPT = `You are helping create a new milestone for a project.

Based on the user's milestone name/description and the existing roadmap context, generate milestone details.

Output your response as JSON with this exact structure:
{
  "name": "Milestone Name (e.g., 'v2.0 Features', 'Performance Release')",
  "goal": "What this milestone delivers (1-2 sentences)",
  "suggestedPhases": [
    { "name": "phase-name", "goal": "What this phase delivers" }
  ]
}

Guidelines:
- name: Clear, versioned or thematic milestone name
- goal: High-level milestone objective
- suggestedPhases: 3-5 initial phases that make sense for this milestone
- Phase names should be kebab-case, 2-4 words

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
 * Get the highest integer phase number
 */
function getHighestPhaseNumber(phases: ParsedPhaseInfo[]): number {
  let highest = 0;
  for (const phase of phases) {
    if (Number.isInteger(phase.number) && phase.number > highest) {
      highest = phase.number;
    }
  }
  return highest;
}

/**
 * Check if all phases in current milestone are complete
 */
function areAllPhasesComplete(phases: ParsedPhaseInfo[]): boolean {
  return phases.length > 0 && phases.every(p => p.isComplete);
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
 * Convert phase name to kebab-case directory name
 */
function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Detect milestone number from roadmap
 * Returns 1 if no milestone marker found, otherwise increments
 */
function detectMilestoneNumber(roadmapContent: string): number {
  // Look for milestone markers like "## Milestone 1:" or "### Milestone 2:"
  const milestoneMatches = roadmapContent.match(/##\s*Milestone\s+(\d+)/gi);
  if (milestoneMatches && milestoneMatches.length > 0) {
    let highest = 0;
    for (const match of milestoneMatches) {
      const num = parseInt(match.replace(/##\s*Milestone\s+/i, ''));
      if (num > highest) {
        highest = num;
      }
    }
    return highest + 1;
  }
  return 1;
}

/**
 * Generate new milestone section for ROADMAP.md
 */
function generateMilestoneSection(
  milestoneNum: number,
  name: string,
  goal: string,
  startingPhaseNum: number,
  phases: { name: string; goal: string }[]
): string {
  const date = getCurrentDate();

  let section = `\n## Milestone ${milestoneNum}: ${name}

**Goal:** ${goal}
**Started:** ${date}
**Status:** In progress

### Phases

`;

  for (let i = 0; i < phases.length; i++) {
    const phaseNum = startingPhaseNum + i;
    const phase = phases[i];
    section += `- [ ] **Phase ${phaseNum}: ${phase.name}** - ${phase.goal}\n`;
  }

  section += `\n### Phase Details\n`;

  for (let i = 0; i < phases.length; i++) {
    const phaseNum = startingPhaseNum + i;
    const phase = phases[i];
    const dependsOn = i === 0 ? 'Previous milestone' : `Phase ${startingPhaseNum + i - 1}`;
    const paddedNum = phaseNum.toString().padStart(2, '0');

    section += `
#### Phase ${phaseNum}: ${phase.name}
**Goal**: ${phase.goal}
**Depends on**: ${dependsOn}
**Research**: TBD
**Plans**: TBD

Plans:
- [ ] ${paddedNum}-01: Initial plan (TBD)
`;
  }

  return section;
}

/**
 * Update STATE.md for new milestone
 */
function generateStateUpdate(
  existingState: string,
  milestoneNum: number,
  milestoneName: string,
  startingPhaseNum: number,
  totalPhases: number
): string {
  const date = getCurrentDate();

  // Update Current Position section
  let newState = existingState;

  // Replace the Current Position section
  const positionPattern = /## Current Position[\s\S]*?(?=## |$)/;
  const newPosition = `## Current Position

Phase: ${startingPhaseNum} of ${startingPhaseNum + totalPhases - 1} (${milestoneName})
Plan: Not started
Status: Ready to plan
Last activity: ${date} - Started Milestone ${milestoneNum}

Progress: ░░░░░░░░░░ 0%

`;

  if (positionPattern.test(newState)) {
    newState = newState.replace(positionPattern, newPosition);
  } else {
    // Add after Project Reference section
    const refPattern = /(## Project Reference[\s\S]*?)\n(?=## |$)/;
    if (refPattern.test(newState)) {
      newState = newState.replace(refPattern, `$1\n${newPosition}`);
    }
  }

  // Update Session Continuity
  const sessionPattern = /## Session Continuity[\s\S]*?(?=## |$)/;
  const newSession = `## Session Continuity

Last session: ${date}
Stopped at: Started Milestone ${milestoneNum}: ${milestoneName}
Resume file: None
Next: Plan Phase ${startingPhaseNum}

`;

  if (sessionPattern.test(newState)) {
    newState = newState.replace(sessionPattern, newSession);
  }

  return newState;
}

/**
 * Handle /new-milestone command
 *
 * Creates a new milestone in ROADMAP.md:
 * 1. Validates current milestone is complete (all phases done)
 * 2. Accepts milestone name/description as argument
 * 3. Creates new milestone section with phases
 * 4. Updates STATE.md for new milestone
 * 5. Creates phase directories
 */
export async function handleNewMilestone(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/new-milestone` again.\n');
    return { metadata: { lastCommand: 'new-milestone' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('Cannot create milestone without ROADMAP.md.\n\n');
    stream.markdown('Use **/create-roadmap** to create your project first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'new-milestone' } };
  }

  // Get milestone name from prompt
  const milestoneName = request.prompt.trim();
  if (!milestoneName) {
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/new-milestone <name or description>`**\n\n');
    stream.markdown('Create a new milestone with defined phases.\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/new-milestone v2.0 Features`\n');
    stream.markdown('- `/new-milestone Performance and Optimization Release`\n');
    stream.markdown('- `/new-milestone API Integration Phase`\n\n');
    stream.markdown('**What happens:**\n');
    stream.markdown('1. Validates previous milestone is complete\n');
    stream.markdown('2. Creates milestone section in ROADMAP.md\n');
    stream.markdown('3. Suggests initial phases for the milestone\n');
    stream.markdown('4. Updates STATE.md for new milestone\n');
    stream.markdown('5. Creates phase directories\n\n');
    return { metadata: { lastCommand: 'new-milestone' } };
  }

  // Read full roadmap
  stream.progress('Reading roadmap...');
  const roadmapUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'ROADMAP.md');
  let fullRoadmapContent: string;
  try {
    const roadmapBytes = await vscode.workspace.fs.readFile(roadmapUri);
    fullRoadmapContent = Buffer.from(roadmapBytes).toString('utf-8');
  } catch {
    stream.markdown('**Error:** Could not read ROADMAP.md\n');
    return { metadata: { lastCommand: 'new-milestone' } };
  }

  const phases = parseRoadmapPhases(fullRoadmapContent);

  // Check if current milestone is complete
  if (phases.length > 0 && !areAllPhasesComplete(phases)) {
    const incompletePhases = phases.filter(p => !p.isComplete);
    stream.markdown('## Current Milestone Not Complete\n\n');
    stream.markdown('Cannot create new milestone until all phases are complete.\n\n');
    stream.markdown('**Incomplete phases:**\n');
    for (const phase of incompletePhases) {
      stream.markdown(`- Phase ${phase.number}: ${phase.name}\n`);
    }
    stream.markdown('\n');
    stream.markdown('**Options:**\n\n');
    stream.button({
      command: 'hopper.chat-participant.complete-milestone',
      title: 'Complete Current Milestone'
    });
    stream.markdown(' ');
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });
    stream.markdown('\n\n');
    stream.markdown('*If phases are done but not marked complete, update ROADMAP.md.*\n');
    return { metadata: { lastCommand: 'new-milestone' } };
  }

  stream.progress('Generating milestone details...');

  try {
    // Determine milestone and phase numbers
    const milestoneNum = detectMilestoneNumber(fullRoadmapContent);
    const highestPhase = getHighestPhaseNumber(phases);
    const startingPhaseNum = highestPhase + 1;

    // Build context for LLM
    const contextParts = [
      `Milestone name/description: ${milestoneName}`,
      `This will be Milestone ${milestoneNum}`,
      `Starting phase number: ${startingPhaseNum}`,
      '',
      'Previous phases (for context):',
      ...phases.slice(-5).map(p => `- Phase ${p.number}: ${p.name} - ${p.goal}`)
    ];

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(MILESTONE_GENERATION_PROMPT),
      vscode.LanguageModelChatMessage.User(contextParts.join('\n'))
    ];

    const response = await request.model.sendRequest(messages, {}, token);

    let fullResponse = '';
    for await (const fragment of response.text) {
      if (token.isCancellationRequested) {
        stream.markdown('**Cancelled**\n');
        return { metadata: { lastCommand: 'new-milestone' } };
      }
      fullResponse += fragment;
    }

    // Parse the response
    let parsed: {
      name: string;
      goal: string;
      suggestedPhases: { name: string; goal: string }[];
    };

    try {
      const jsonStr = extractJsonFromResponse(fullResponse);
      parsed = JSON.parse(jsonStr);
      if (!parsed.name || !parsed.goal || !parsed.suggestedPhases) {
        throw new Error('Missing required fields');
      }
    } catch {
      // Fallback
      parsed = {
        name: milestoneName,
        goal: `Deliver ${milestoneName} functionality`,
        suggestedPhases: [
          { name: 'foundation', goal: 'Set up foundation for milestone' },
          { name: 'core-features', goal: 'Implement core features' },
          { name: 'polish', goal: 'Polish and finalize' }
        ]
      };
    }

    // Generate milestone section
    const milestoneSection = generateMilestoneSection(
      milestoneNum,
      parsed.name,
      parsed.goal,
      startingPhaseNum,
      parsed.suggestedPhases
    );

    // Update ROADMAP.md
    stream.progress('Updating roadmap...');

    // Append milestone section before Progress table or at end
    let updatedRoadmap = fullRoadmapContent;
    const progressMatch = updatedRoadmap.match(/\n## Progress\n/);
    if (progressMatch && progressMatch.index !== undefined) {
      updatedRoadmap = updatedRoadmap.slice(0, progressMatch.index) +
        milestoneSection +
        updatedRoadmap.slice(progressMatch.index);
    } else {
      updatedRoadmap += milestoneSection;
    }

    await vscode.workspace.fs.writeFile(
      roadmapUri,
      Buffer.from(updatedRoadmap, 'utf-8')
    );

    // Update STATE.md
    stream.progress('Updating state...');
    const stateUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'STATE.md');
    let stateContent: string;
    try {
      const stateBytes = await vscode.workspace.fs.readFile(stateUri);
      stateContent = Buffer.from(stateBytes).toString('utf-8');
    } catch {
      stateContent = '# Project State\n\n## Project Reference\n\nSee: .planning/PROJECT.md\n\n';
    }

    const updatedState = generateStateUpdate(
      stateContent,
      milestoneNum,
      parsed.name,
      startingPhaseNum,
      parsed.suggestedPhases.length
    );

    await vscode.workspace.fs.writeFile(
      stateUri,
      Buffer.from(updatedState, 'utf-8')
    );

    // Create phase directories
    stream.progress('Creating phase directories...');
    for (let i = 0; i < parsed.suggestedPhases.length; i++) {
      const phaseNum = startingPhaseNum + i;
      const phase = parsed.suggestedPhases[i];
      const dirName = `${phaseNum.toString().padStart(2, '0')}-${toKebabCase(phase.name)}`;
      const phaseDirUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName);
      try {
        await vscode.workspace.fs.createDirectory(phaseDirUri);
      } catch {
        // Directory may already exist
      }
    }

    // Success!
    stream.markdown('## Milestone Created\n\n');
    stream.markdown(`**Milestone ${milestoneNum}: ${parsed.name}**\n\n`);
    stream.markdown(`**Goal:** ${parsed.goal}\n\n`);

    stream.markdown('### Phases\n\n');
    for (let i = 0; i < parsed.suggestedPhases.length; i++) {
      const phaseNum = startingPhaseNum + i;
      const phase = parsed.suggestedPhases[i];
      stream.markdown(`- **Phase ${phaseNum}: ${phase.name}** - ${phase.goal}\n`);
    }
    stream.markdown('\n');

    stream.markdown('**Files updated:**\n');
    stream.reference(roadmapUri);
    stream.markdown('\n');
    stream.reference(stateUri);
    stream.markdown('\n\n');

    stream.markdown('### Next Steps\n\n');
    stream.button({
      command: 'hopper.chat-participant.discuss-phase',
      arguments: [startingPhaseNum],
      title: `Discuss Phase ${startingPhaseNum}`
    });
    stream.markdown(' ');
    stream.button({
      command: 'hopper.chat-participant.plan-phase',
      arguments: [startingPhaseNum],
      title: `Plan Phase ${startingPhaseNum}`
    });

    return {
      metadata: {
        lastCommand: 'new-milestone',
        phaseNumber: startingPhaseNum
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
    return { metadata: { lastCommand: 'new-milestone' } };
  }
}
