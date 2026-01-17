import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * System prompt for generating phase content from user description
 */
const PHASE_GENERATION_PROMPT = `You are helping add a new phase to a project roadmap.

Based on the user's phase description and the existing roadmap context, generate a complete phase entry.

Output your response as JSON with this exact structure:
{
  "name": "kebab-case-name",
  "goal": "What this phase delivers (1-2 sentences)",
  "researchLikely": false,
  "researchTopics": null
}

Guidelines:
- name: Use kebab-case, 2-4 words max (e.g., "api-integration", "user-auth", "performance-tuning")
- goal: Clear, specific deliverable that describes what will be built
- researchLikely: true only if new external APIs, unfamiliar libraries, or major architectural decisions
- researchTopics: null unless researchLikely is true, then list specific topics

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

  // Match phase list items like "- [ ] **Phase 1: Foundation** - Goal here"
  // or "- [x] **Phase 1.5: Name** - INSERTED - Goal here"
  const phasePattern = /-\s*\[([x\s])\]\s*\*\*Phase\s+(\d+(?:\.\d+)?):?\s*([^*]+)\*\*\s*[-–]\s*(.+)/gi;
  let match;

  while ((match = phasePattern.exec(roadmapMd)) !== null) {
    const isComplete = match[1].toLowerCase() === 'x';
    const numStr = match[2];
    const number = parseFloat(numStr);
    const name = match[3].trim();
    let goal = match[4].trim();

    // Check if this is an inserted phase
    const isInserted = goal.toUpperCase().includes('INSERTED');
    if (isInserted) {
      // Remove "INSERTED - " prefix from goal
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
 * Find the highest integer phase number
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
 * Generate the phase list entry for ROADMAP.md
 */
function generatePhaseListEntry(phaseNum: number, name: string, goal: string): string {
  return `- [ ] **Phase ${phaseNum}: ${name}** - ${goal}`;
}

/**
 * Generate the phase details section for ROADMAP.md
 */
function generatePhaseDetails(
  phaseNum: number,
  name: string,
  goal: string,
  dependsOn: number,
  researchLikely: boolean,
  researchTopics?: string | null
): string {
  const dependsOnText = `Phase ${dependsOn}`;
  const research = researchLikely ? 'Likely' : 'Unlikely';
  const researchReason = researchLikely
    ? '(new integration or external APIs)'
    : '(established patterns)';

  let details = `### Phase ${phaseNum}: ${name}
**Goal**: ${goal}
**Depends on**: ${dependsOnText}
**Research**: ${research} ${researchReason}`;

  if (researchLikely && researchTopics) {
    details += `\n**Research topics**: ${researchTopics}`;
  }

  const paddedNum = phaseNum.toString().padStart(2, '0');
  details += `\n**Plans**: TBD

Plans:
- [ ] ${paddedNum}-01: Initial plan (TBD)`;

  return details;
}

/**
 * Generate progress table row for ROADMAP.md
 */
function generateProgressRow(phaseNum: number, name: string): string {
  return `| ${phaseNum}. ${name} | 0/? | Not started | - |`;
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
 * Handle /add-phase command
 *
 * Adds a new phase to the end of the roadmap by:
 * 1. Parsing ROADMAP.md to find highest phase number
 * 2. Using LLM to generate phase details from user description
 * 3. Appending new phase to ROADMAP.md
 * 4. Creating phase directory
 */
export async function handleAddPhase(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/add-phase` again.\n');
    return { metadata: { lastCommand: 'add-phase' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Roadmap Found\n\n');
    stream.markdown('Cannot add phase without ROADMAP.md.\n\n');
    stream.markdown('Use **/create-roadmap** to create your roadmap first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'add-phase' } };
  }

  // Get phase description from prompt
  const description = request.prompt.trim();
  if (!description) {
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/add-phase <description>`**\n\n');
    stream.markdown('Add a new phase to the end of your roadmap.\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/add-phase Add user authentication with OAuth`\n');
    stream.markdown('- `/add-phase Performance optimization and caching`\n');
    stream.markdown('- `/add-phase API documentation and testing`\n\n');
    return { metadata: { lastCommand: 'add-phase' } };
  }

  // Read the FULL roadmap file (projectContext.roadmapMd may be truncated)
  stream.progress('Reading roadmap...');
  const roadmapUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'ROADMAP.md');
  let fullRoadmapContent: string;
  try {
    const roadmapBytes = await vscode.workspace.fs.readFile(roadmapUri);
    fullRoadmapContent = Buffer.from(roadmapBytes).toString('utf-8');
  } catch {
    stream.markdown('**Error:** Could not read ROADMAP.md\n');
    return { metadata: { lastCommand: 'add-phase' } };
  }
  const phases = parseRoadmapPhases(fullRoadmapContent);
  const highestPhase = getHighestPhaseNumber(phases);
  const newPhaseNum = highestPhase + 1;

  stream.progress('Generating phase details...');

  try {
    // Build context for LLM
    const contextParts = [
      `Current highest phase number: ${highestPhase}`,
      `New phase will be: Phase ${newPhaseNum}`,
      `User description: ${description}`,
      '',
      'Existing phases:',
      ...phases.map(p => `- Phase ${p.number}: ${p.name} - ${p.goal}`)
    ];

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(PHASE_GENERATION_PROMPT),
      vscode.LanguageModelChatMessage.User(contextParts.join('\n'))
    ];

    // Send to model
    const response = await request.model.sendRequest(messages, {}, token);

    // Collect full response
    let fullResponse = '';
    for await (const fragment of response.text) {
      if (token.isCancellationRequested) {
        stream.markdown('**Cancelled**\n');
        return { metadata: { lastCommand: 'add-phase' } };
      }
      fullResponse += fragment;
    }

    // Parse the response
    let parsed: { name: string; goal: string; researchLikely: boolean; researchTopics?: string | null };
    try {
      const jsonStr = extractJsonFromResponse(fullResponse);
      parsed = JSON.parse(jsonStr);
      if (!parsed.name || !parsed.goal) {
        throw new Error('Missing name or goal');
      }
    } catch {
      // Fallback: use description directly
      const words = description.split(/\s+/).slice(0, 4);
      parsed = {
        name: words.join('-').toLowerCase().replace(/[^a-z0-9-]/g, ''),
        goal: description,
        researchLikely: false,
        researchTopics: null
      };
    }

    // Generate content to add
    const phaseListEntry = generatePhaseListEntry(newPhaseNum, parsed.name, parsed.goal);
    const phaseDetails = generatePhaseDetails(
      newPhaseNum,
      parsed.name,
      parsed.goal,
      highestPhase,
      parsed.researchLikely,
      parsed.researchTopics
    );
    const progressRow = generateProgressRow(newPhaseNum, parsed.name);

    // Update ROADMAP.md (use full content, not truncated context)
    stream.progress('Updating roadmap...');
    let roadmapContent = fullRoadmapContent;

    // 1. Add to phase list (before ## Phase Details or after last phase entry)
    const phaseDetailsMatch = roadmapContent.match(/\n## Phase Details/);
    if (phaseDetailsMatch && phaseDetailsMatch.index !== undefined) {
      // Insert before ## Phase Details
      roadmapContent = roadmapContent.slice(0, phaseDetailsMatch.index) +
        '\n' + phaseListEntry +
        roadmapContent.slice(phaseDetailsMatch.index);
    } else {
      // Find last phase entry and add after it
      const lastPhaseMatch = roadmapContent.match(/-\s*\[[x\s]\]\s*\*\*Phase\s+\d+(?:\.\d+)?:[^*]+\*\*[^\n]+\n/g);
      if (lastPhaseMatch) {
        const lastEntry = lastPhaseMatch[lastPhaseMatch.length - 1];
        const lastEntryIndex = roadmapContent.lastIndexOf(lastEntry);
        roadmapContent = roadmapContent.slice(0, lastEntryIndex + lastEntry.length) +
          phaseListEntry + '\n' +
          roadmapContent.slice(lastEntryIndex + lastEntry.length);
      }
    }

    // 2. Add phase details before ## Progress section
    const progressMatch = roadmapContent.match(/\n## Progress/);
    if (progressMatch && progressMatch.index !== undefined) {
      roadmapContent = roadmapContent.slice(0, progressMatch.index) +
        '\n\n' + phaseDetails +
        roadmapContent.slice(progressMatch.index);
    } else {
      // Append to end
      roadmapContent += '\n\n' + phaseDetails;
    }

    // 3. Add to progress table (before the closing of the table or at end)
    const tableEndMatch = roadmapContent.match(/\| [^|]+ \| [^|]+ \| [^|]+ \| [^|]+ \|\n(?!\|)/);
    if (tableEndMatch && tableEndMatch.index !== undefined) {
      const insertIndex = tableEndMatch.index + tableEndMatch[0].length - 1; // Before the newline
      roadmapContent = roadmapContent.slice(0, insertIndex) +
        '\n' + progressRow +
        roadmapContent.slice(insertIndex);
    }

    // Write updated ROADMAP.md
    const roadmapUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'ROADMAP.md');
    await vscode.workspace.fs.writeFile(
      roadmapUri,
      Buffer.from(roadmapContent, 'utf-8')
    );

    // Create phase directory
    const dirName = `${newPhaseNum.toString().padStart(2, '0')}-${toKebabCase(parsed.name)}`;
    const phaseDirUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName);
    try {
      await vscode.workspace.fs.createDirectory(phaseDirUri);
    } catch {
      // Directory may already exist
    }

    // Success!
    stream.markdown('## Phase Added\n\n');
    stream.markdown(`**Phase ${newPhaseNum}: ${parsed.name}**\n\n`);
    stream.markdown(`**Goal:** ${parsed.goal}\n\n`);

    if (parsed.researchLikely) {
      stream.markdown(`**Research likely:** ${parsed.researchTopics || 'Yes'}\n\n`);
    }

    stream.markdown('**Files updated:**\n');
    stream.reference(roadmapUri);
    stream.markdown('\n\n');

    stream.markdown(`**Directory created:** \`.planning/phases/${dirName}/\`\n\n`);

    stream.markdown('### Next Steps\n\n');
    stream.markdown(`Type \`/plan-phase ${newPhaseNum}\` to create the execution plan.\n\n`);

    return {
      metadata: {
        lastCommand: 'add-phase',
        phaseNumber: newPhaseNum
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
    return { metadata: { lastCommand: 'add-phase' } };
  }
}
