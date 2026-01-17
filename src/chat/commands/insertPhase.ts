import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * System prompt for generating inserted phase content from user description
 */
const PHASE_GENERATION_PROMPT = `You are helping insert an urgent phase into a project roadmap.

Based on the user's phase description, generate a complete phase entry for urgent work.

Output your response as JSON with this exact structure:
{
  "name": "kebab-case-name",
  "goal": "What this phase delivers (1-2 sentences)",
  "researchLikely": false,
  "researchTopics": null
}

Guidelines:
- name: Use kebab-case, 2-4 words max (e.g., "critical-fix", "security-patch", "urgent-refactor")
- goal: Clear, specific deliverable that describes the urgent work
- researchLikely: Usually false for urgent insertions (fixing known issues)
- researchTopics: null unless research is truly needed

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
 * Find the next available decimal phase number after a given integer
 * E.g., if phase 3 exists and 3.1 exists, return 3.2
 */
function getNextDecimalPhase(phases: ParsedPhaseInfo[], afterPhase: number): number {
  // Find all decimal phases that start with the same integer
  const decimalPhases = phases.filter(p => {
    const intPart = Math.floor(p.number);
    return intPart === afterPhase && p.number !== afterPhase;
  });

  if (decimalPhases.length === 0) {
    return afterPhase + 0.1;
  }

  // Find the highest decimal
  const highest = Math.max(...decimalPhases.map(p => p.number));
  // Get the decimal part and increment
  const decimalPart = Math.round((highest - afterPhase) * 10);
  return afterPhase + (decimalPart + 1) / 10;
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
 * Generate the phase list entry for ROADMAP.md (for inserted phase)
 */
function generatePhaseListEntry(phaseNum: number, name: string, goal: string): string {
  return `- [ ] **Phase ${phaseNum}: ${name}** - INSERTED - ${goal}`;
}

/**
 * Generate the phase details section for ROADMAP.md (for inserted phase)
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

  let details = `### Phase ${phaseNum}: ${name} (INSERTED)
**Goal**: ${goal}
**Depends on**: ${dependsOnText}
**Research**: ${research} ${researchReason}`;

  if (researchLikely && researchTopics) {
    details += `\n**Research topics**: ${researchTopics}`;
  }

  // Format phase number for directory (e.g., 3.1 -> 03.1)
  const paddedNum = formatPhaseNumber(phaseNum);
  details += `\n**Plans**: TBD

Plans:
- [ ] ${paddedNum}-01: Initial plan (TBD)`;

  return details;
}

/**
 * Format phase number for display and directory naming
 * E.g., 3.1 -> "03.1", 10 -> "10"
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
 * Find the correct position to insert a phase in the list
 * Returns the index in the content string where to insert
 */
function findPhaseListInsertPosition(roadmapContent: string, afterPhaseNum: number, phases: ParsedPhaseInfo[]): number | null {
  // Find the phase that comes right after our insert position
  const phasesAfter = phases.filter(p => p.number > afterPhaseNum);
  if (phasesAfter.length === 0) {
    // Insert at end of phase list (before ## Phase Details)
    const match = roadmapContent.match(/\n## Phase Details/);
    return match?.index ?? null;
  }

  // Find the next phase in the list
  const nextPhase = phasesAfter[0];
  const nextPhasePattern = new RegExp(
    `-\\s*\\[[x\\s]\\]\\s*\\*\\*Phase\\s+${nextPhase.number.toString().replace('.', '\\.')}:`,
    'i'
  );
  const match = roadmapContent.match(nextPhasePattern);
  if (match?.index !== undefined) {
    // Find the start of this line
    const lineStart = roadmapContent.lastIndexOf('\n', match.index);
    return lineStart !== -1 ? lineStart : match.index;
  }

  return null;
}

/**
 * Find the correct position to insert phase details
 * Should be after the phase it depends on, before the next phase
 */
function findPhaseDetailsInsertPosition(roadmapContent: string, afterPhaseNum: number, phases: ParsedPhaseInfo[]): number | null {
  // Find phases with details sections after our insert position
  const phasesAfter = phases.filter(p => p.number > afterPhaseNum);

  if (phasesAfter.length === 0) {
    // Insert before ## Progress
    const match = roadmapContent.match(/\n## Progress/);
    return match?.index ?? null;
  }

  // Find the next phase's details section
  const nextPhase = phasesAfter[0];
  const nextPhasePattern = new RegExp(
    `### Phase ${nextPhase.number.toString().replace('.', '\\.')}:`,
    'i'
  );
  const match = roadmapContent.match(nextPhasePattern);
  if (match?.index !== undefined) {
    // Find the start of this line
    const lineStart = roadmapContent.lastIndexOf('\n', match.index);
    return lineStart !== -1 ? lineStart : match.index;
  }

  return null;
}

/**
 * Handle /insert-phase command
 *
 * Inserts an urgent phase between existing phases using decimal numbering by:
 * 1. Parsing arguments (after-phase-number, description)
 * 2. Validating the target phase exists and is complete
 * 3. Finding next available decimal (N.1, N.2, etc.)
 * 4. Using LLM to generate phase details
 * 5. Inserting in correct position in ROADMAP.md
 * 6. Creating phase directory
 */
export async function handleInsertPhase(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/insert-phase` again.\n');
    return { metadata: { lastCommand: 'insert-phase' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Roadmap Found\n\n');
    stream.markdown('Cannot insert phase without ROADMAP.md.\n\n');
    stream.markdown('Use **/create-roadmap** to create your roadmap first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'insert-phase' } };
  }

  // Parse arguments: first word should be phase number, rest is description
  const promptParts = request.prompt.trim().split(/\s+/);
  if (promptParts.length < 2 || !promptParts[0]) {
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/insert-phase <after-phase> <description>`**\n\n');
    stream.markdown('Insert an urgent phase after an existing completed phase.\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/insert-phase 3 Fix critical auth bug`\n');
    stream.markdown('- `/insert-phase 5 Add emergency security patch`\n');
    stream.markdown('- `/insert-phase 2 Hotfix database connection issue`\n\n');
    stream.markdown('**Note:** The target phase must be complete before inserting after it.\n');
    stream.markdown('Decimal numbering (3.1, 3.2) is used to avoid renumbering subsequent phases.\n\n');
    return { metadata: { lastCommand: 'insert-phase' } };
  }

  const afterPhaseStr = promptParts[0];
  const description = promptParts.slice(1).join(' ');

  // Validate phase number
  const afterPhaseNum = parseInt(afterPhaseStr, 10);
  if (isNaN(afterPhaseNum) || afterPhaseNum < 1) {
    stream.markdown('## Invalid Phase Number\n\n');
    stream.markdown(`"${afterPhaseStr}" is not a valid phase number.\n\n`);
    stream.markdown('Phase number must be a positive integer (e.g., 1, 2, 3).\n\n');
    return { metadata: { lastCommand: 'insert-phase' } };
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
    return { metadata: { lastCommand: 'insert-phase' } };
  }
  const phases = parseRoadmapPhases(fullRoadmapContent);

  // Find the target phase
  const targetPhase = phases.find(p => p.number === afterPhaseNum);
  if (!targetPhase) {
    stream.markdown('## Phase Not Found\n\n');
    stream.markdown(`Phase ${afterPhaseNum} does not exist in ROADMAP.md.\n\n`);
    stream.markdown('**Available phases:**\n');
    for (const p of phases) {
      const status = p.isComplete ? '[x]' : '[ ]';
      stream.markdown(`- ${status} Phase ${p.number}: ${p.name}\n`);
    }
    stream.markdown('\n');
    return { metadata: { lastCommand: 'insert-phase' } };
  }

  // Check if there's a next integer phase (otherwise use add-phase)
  const nextIntegerPhase = phases.find(p => Number.isInteger(p.number) && p.number === afterPhaseNum + 1);
  if (!nextIntegerPhase) {
    stream.markdown('## Use Add-Phase Instead\n\n');
    stream.markdown(`There is no Phase ${afterPhaseNum + 1} after Phase ${afterPhaseNum}.\n\n`);
    stream.markdown('Use **/add-phase** to add a new phase at the end of your roadmap.\n\n');
    stream.button({
      command: 'hopper.chat-participant.add-phase',
      title: 'Add Phase'
    });
    return { metadata: { lastCommand: 'insert-phase' } };
  }

  // Calculate new decimal phase number
  const newPhaseNum = getNextDecimalPhase(phases, afterPhaseNum);

  stream.progress('Generating phase details...');

  try {
    // Build context for LLM
    const contextParts = [
      `Inserting urgent phase after Phase ${afterPhaseNum}: ${targetPhase.name}`,
      `New phase will be: Phase ${newPhaseNum}`,
      `User description: ${description}`,
      '',
      'Context:',
      `- Phase ${afterPhaseNum} (${targetPhase.name}) is COMPLETE`,
      `- Phase ${afterPhaseNum + 1} (${nextIntegerPhase.name}) exists and needs this urgent work first`,
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
        return { metadata: { lastCommand: 'insert-phase' } };
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
      afterPhaseNum,
      parsed.researchLikely,
      parsed.researchTopics
    );
    const progressRow = generateProgressRow(newPhaseNum, parsed.name);

    // Update ROADMAP.md (use full content, not truncated context)
    stream.progress('Updating roadmap...');
    let roadmapContent = fullRoadmapContent;

    // 1. Insert in phase list at correct position
    const listInsertPos = findPhaseListInsertPosition(roadmapContent, afterPhaseNum, phases);
    if (listInsertPos !== null) {
      roadmapContent = roadmapContent.slice(0, listInsertPos) +
        '\n' + phaseListEntry +
        roadmapContent.slice(listInsertPos);
      // Re-parse positions since content changed
    }

    // 2. Insert phase details at correct position (need to re-find after list insert)
    const detailsInsertPos = findPhaseDetailsInsertPosition(roadmapContent, afterPhaseNum, phases);
    if (detailsInsertPos !== null) {
      roadmapContent = roadmapContent.slice(0, detailsInsertPos) +
        '\n\n' + phaseDetails +
        roadmapContent.slice(detailsInsertPos);
    }

    // 3. Add to progress table - find the row for the next phase and insert before it
    // Look for the progress table row pattern
    const progressTablePattern = new RegExp(
      `\\| ${afterPhaseNum + 1}\\. [^|]+ \\|`,
      'i'
    );
    const progressMatch = roadmapContent.match(progressTablePattern);
    if (progressMatch?.index !== undefined) {
      // Find the start of this line
      const lineStart = roadmapContent.lastIndexOf('\n', progressMatch.index);
      if (lineStart !== -1) {
        roadmapContent = roadmapContent.slice(0, lineStart) +
          '\n' + progressRow +
          roadmapContent.slice(lineStart);
      }
    }

    // Write updated ROADMAP.md
    const roadmapUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'ROADMAP.md');
    await vscode.workspace.fs.writeFile(
      roadmapUri,
      Buffer.from(roadmapContent, 'utf-8')
    );

    // Create phase directory
    const dirName = `${formatPhaseNumber(newPhaseNum)}-${toKebabCase(parsed.name)}`;
    const phaseDirUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName);
    try {
      await vscode.workspace.fs.createDirectory(phaseDirUri);
    } catch {
      // Directory may already exist
    }

    // Success!
    stream.markdown('## Phase Inserted\n\n');
    stream.markdown(`**Phase ${newPhaseNum}: ${parsed.name}** (INSERTED)\n\n`);
    stream.markdown(`**Goal:** ${parsed.goal}\n\n`);
    stream.markdown(`**Inserted after:** Phase ${afterPhaseNum} (${targetPhase.name})\n`);
    stream.markdown(`**Executes before:** Phase ${afterPhaseNum + 1} (${nextIntegerPhase.name})\n\n`);

    stream.markdown('**Files updated:**\n');
    stream.reference(roadmapUri);
    stream.markdown('\n\n');

    stream.markdown(`**Directory created:** \`.planning/phases/${dirName}/\`\n\n`);

    stream.markdown('### Next Steps\n\n');
    stream.markdown(`Type \`/plan-phase ${newPhaseNum}\` to create the execution plan for this urgent work.\n\n`);

    return {
      metadata: {
        lastCommand: 'insert-phase',
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
    return { metadata: { lastCommand: 'insert-phase' } };
  }
}
