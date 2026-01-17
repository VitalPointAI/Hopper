import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * Parse phase information from ROADMAP.md content
 */
interface ParsedPhaseInfo {
  number: number;
  name: string;
  goal: string;
  isComplete: boolean;
  isInserted: boolean;
  /** Start position of phase list entry in content */
  listEntryStart?: number;
  /** End position of phase list entry in content */
  listEntryEnd?: number;
}

/**
 * Extract all phases from ROADMAP.md content with positions
 */
function parseRoadmapPhases(roadmapMd: string): ParsedPhaseInfo[] {
  const phases: ParsedPhaseInfo[] = [];

  // Match phase list items like "- [ ] **Phase 1: Foundation** - Goal here"
  const phasePattern = /-\s*\[([x\s])\]\s*\*\*Phase\s+(\d+(?:\.\d+)?):?\s*([^*]+)\*\*\s*[-–]\s*([^\n]+)/gi;
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

    // Find the start and end of this line
    const lineStart = roadmapMd.lastIndexOf('\n', match.index);
    const lineEnd = roadmapMd.indexOf('\n', match.index + match[0].length);

    phases.push({
      number,
      name,
      goal,
      isComplete,
      isInserted,
      listEntryStart: lineStart !== -1 ? lineStart : match.index,
      listEntryEnd: lineEnd !== -1 ? lineEnd : match.index + match[0].length
    });
  }

  return phases.sort((a, b) => a.number - b.number);
}

/**
 * Format phase number for display and directory naming
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
 * Find phases that depend on a given phase number
 */
function findDependentPhases(phases: ParsedPhaseInfo[], phaseNum: number): ParsedPhaseInfo[] {
  // For integer phases, the next integer phase depends on it
  // For decimal phases (N.X), only other decimals in same range might depend
  if (Number.isInteger(phaseNum)) {
    // Next integer phase and any decimals between them
    return phases.filter(p =>
      p.number > phaseNum && p.number < phaseNum + 1 ||
      p.number === phaseNum + 1
    );
  } else {
    // Decimal phases: only subsequent decimals in same integer range
    const intPart = Math.floor(phaseNum);
    return phases.filter(p =>
      p.number > phaseNum && p.number < intPart + 1
    );
  }
}

/**
 * Remove phase entry from phase list in ROADMAP.md content
 */
function removePhaseListEntry(content: string, phaseNum: number): string {
  // Match the specific phase line
  const phasePattern = new RegExp(
    `\\n-\\s*\\[[x\\s]\\]\\s*\\*\\*Phase\\s+${phaseNum.toString().replace('.', '\\.')}:[^\\n]+`,
    'i'
  );
  return content.replace(phasePattern, '');
}

/**
 * Remove phase details section from ROADMAP.md content
 */
function removePhaseDetails(content: string, phaseNum: number): string {
  // Match from ### Phase N: to the next ### or ## section
  const detailsPattern = new RegExp(
    `\\n### Phase ${phaseNum.toString().replace('.', '\\.')}:[^#]*?(?=\\n###|\\n## |$)`,
    'i'
  );
  return content.replace(detailsPattern, '');
}

/**
 * Remove phase from progress table in ROADMAP.md content
 */
function removeProgressTableRow(content: string, phaseNum: number): string {
  // Match the progress table row for this phase
  const rowPattern = new RegExp(
    `\\n\\| ${phaseNum}\\. [^|]+ \\| [^|]+ \\| [^|]+ \\| [^|]+ \\|`,
    'i'
  );
  return content.replace(rowPattern, '');
}

/**
 * Renumber phases in ROADMAP.md content after removing an integer phase
 */
function renumberPhases(content: string, removedPhaseNum: number, phases: ParsedPhaseInfo[]): string {
  // Only renumber if we removed an integer phase
  if (!Number.isInteger(removedPhaseNum)) {
    return content;
  }

  // Find all integer phases after the removed one
  const phasesToRenumber = phases.filter(p =>
    Number.isInteger(p.number) && p.number > removedPhaseNum
  );

  let result = content;

  // Renumber from highest to lowest to avoid conflicts
  const sorted = [...phasesToRenumber].sort((a, b) => b.number - a.number);

  for (const phase of sorted) {
    const oldNum = phase.number;
    const newNum = oldNum - 1;

    // Replace in phase list: "**Phase N:" -> "**Phase N-1:"
    result = result.replace(
      new RegExp(`\\*\\*Phase ${oldNum}:`, 'g'),
      `**Phase ${newNum}:`
    );

    // Replace in phase details header: "### Phase N:" -> "### Phase N-1:"
    result = result.replace(
      new RegExp(`### Phase ${oldNum}:`, 'g'),
      `### Phase ${newNum}:`
    );

    // Replace in progress table: "| N. " -> "| N-1. "
    result = result.replace(
      new RegExp(`\\| ${oldNum}\\. `, 'g'),
      `| ${newNum}. `
    );

    // Replace "Depends on: Phase N" references
    result = result.replace(
      new RegExp(`\\*\\*Depends on\\*\\*: Phase ${oldNum}`, 'g'),
      `**Depends on**: Phase ${newNum}`
    );

    // Replace plan references: "NN-01:" -> "N(N-1)-01:"
    const oldPadded = oldNum.toString().padStart(2, '0');
    const newPadded = newNum.toString().padStart(2, '0');
    result = result.replace(
      new RegExp(`${oldPadded}-(\\d+):`, 'g'),
      `${newPadded}-$1:`
    );
  }

  // Update execution order line
  const executionOrderPattern = /Phases execute in numeric order: [\d\s\-→>]+/;
  const newOrder = phases
    .filter(p => p.number !== removedPhaseNum)
    .map(p => Number.isInteger(p.number) && p.number > removedPhaseNum ? p.number - 1 : p.number)
    .sort((a, b) => a - b)
    .join(' → ');
  result = result.replace(executionOrderPattern, `Phases execute in numeric order: ${newOrder}`);

  return result;
}

/**
 * Check if a phase directory is empty (no plans created)
 */
async function isPhaseDirectoryEmpty(workspaceUri: vscode.Uri, dirName: string): Promise<boolean> {
  try {
    const dirUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName);
    const entries = await vscode.workspace.fs.readDirectory(dirUri);
    return entries.length === 0;
  } catch {
    return true; // Directory doesn't exist = empty
  }
}

/**
 * Delete a phase directory if it's empty
 */
async function deletePhaseDirectoryIfEmpty(workspaceUri: vscode.Uri, dirName: string): Promise<boolean> {
  try {
    const isEmpty = await isPhaseDirectoryEmpty(workspaceUri, dirName);
    if (isEmpty) {
      const dirUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName);
      await vscode.workspace.fs.delete(dirUri, { recursive: true });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Handle /remove-phase command
 *
 * Removes a phase from the roadmap by:
 * 1. Validating phase exists and is NOT complete
 * 2. Checking for dependent phases (warn for integer, simple for decimal)
 * 3. Removing from phase list, details, and progress table
 * 4. Renumbering subsequent phases (for integer phases)
 * 5. Removing phase directory if empty
 */
export async function handleRemovePhase(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/remove-phase` again.\n');
    return { metadata: { lastCommand: 'remove-phase' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Roadmap Found\n\n');
    stream.markdown('Cannot remove phase without ROADMAP.md.\n\n');
    stream.markdown('Use **/create-roadmap** to create your roadmap first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'remove-phase' } };
  }

  // Parse phase number from prompt
  const promptText = request.prompt.trim();
  if (!promptText) {
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/remove-phase <phase-number>`**\n\n');
    stream.markdown('Remove a phase from your roadmap.\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/remove-phase 5` - Remove Phase 5 and renumber subsequent phases\n');
    stream.markdown('- `/remove-phase 3.1` - Remove inserted Phase 3.1 (no renumbering)\n\n');
    stream.markdown('**Restrictions:**\n');
    stream.markdown('- Cannot remove completed phases\n');
    stream.markdown('- Removing integer phases will renumber subsequent phases\n');
    stream.markdown('- Phase directories with plans will NOT be deleted\n\n');
    return { metadata: { lastCommand: 'remove-phase' } };
  }

  // Validate phase number format
  const phaseNum = parseFloat(promptText);
  if (isNaN(phaseNum) || phaseNum < 1) {
    stream.markdown('## Invalid Phase Number\n\n');
    stream.markdown(`"${promptText}" is not a valid phase number.\n\n`);
    stream.markdown('Phase number must be a positive number (e.g., 5, 3.1).\n\n');
    return { metadata: { lastCommand: 'remove-phase' } };
  }

  // Parse existing phases
  stream.progress('Reading roadmap...');
  const phases = parseRoadmapPhases(projectContext.roadmapMd);

  // Find the target phase
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
    return { metadata: { lastCommand: 'remove-phase' } };
  }

  // Check if phase is complete
  if (targetPhase.isComplete) {
    stream.markdown('## Cannot Remove Completed Phase\n\n');
    stream.markdown(`Phase ${phaseNum} (${targetPhase.name}) is already complete.\n\n`);
    stream.markdown('You cannot remove phases that have been completed.\n');
    stream.markdown('Completed work should remain in the roadmap for historical reference.\n\n');
    return { metadata: { lastCommand: 'remove-phase' } };
  }

  // Check for dependent phases
  const dependentPhases = findDependentPhases(phases, phaseNum);
  const isIntegerPhase = Number.isInteger(phaseNum);

  if (isIntegerPhase && dependentPhases.length > 0) {
    stream.markdown('## Warning: Dependent Phases Exist\n\n');
    stream.markdown(`Phase ${phaseNum} (${targetPhase.name}) has dependent phases:\n\n`);
    for (const dep of dependentPhases) {
      stream.markdown(`- Phase ${dep.number}: ${dep.name}\n`);
    }
    stream.markdown('\n');
    stream.markdown('**What will happen:**\n');
    stream.markdown(`- Phase ${phaseNum} will be removed\n`);
    stream.markdown('- Subsequent integer phases will be renumbered\n');
    stream.markdown('- Decimal phases between them will remain with their numbers\n\n');
  }

  stream.progress('Removing phase...');

  try {
    let roadmapContent = projectContext.roadmapMd;

    // 1. Remove phase list entry
    roadmapContent = removePhaseListEntry(roadmapContent, phaseNum);

    // 2. Remove phase details section
    roadmapContent = removePhaseDetails(roadmapContent, phaseNum);

    // 3. Remove progress table row
    roadmapContent = removeProgressTableRow(roadmapContent, phaseNum);

    // 4. Renumber subsequent phases (for integer phases only)
    if (isIntegerPhase) {
      roadmapContent = renumberPhases(roadmapContent, phaseNum, phases);
    }

    // Write updated ROADMAP.md
    const roadmapUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'ROADMAP.md');
    await vscode.workspace.fs.writeFile(
      roadmapUri,
      Buffer.from(roadmapContent, 'utf-8')
    );

    // 5. Try to delete phase directory if empty
    const dirName = `${formatPhaseNumber(phaseNum)}-${toKebabCase(targetPhase.name)}`;
    const dirDeleted = await deletePhaseDirectoryIfEmpty(workspaceUri, dirName);

    // Success!
    stream.markdown('## Phase Removed\n\n');
    stream.markdown(`**Removed:** Phase ${phaseNum}: ${targetPhase.name}\n\n`);

    if (isIntegerPhase && dependentPhases.length > 0) {
      stream.markdown('**Renumbered phases:**\n');
      for (const p of phases.filter(x => Number.isInteger(x.number) && x.number > phaseNum)) {
        stream.markdown(`- Phase ${p.number} → Phase ${p.number - 1}\n`);
      }
      stream.markdown('\n');
    }

    stream.markdown('**Files updated:**\n');
    stream.reference(roadmapUri);
    stream.markdown('\n\n');

    if (dirDeleted) {
      stream.markdown(`**Directory deleted:** \`.planning/phases/${dirName}/\`\n\n`);
    } else {
      stream.markdown(`**Note:** Phase directory \`.planning/phases/${dirName}/\` was NOT deleted (contains plans or other files).\n\n`);
    }

    stream.markdown('### Next Steps\n\n');
    stream.markdown('Use **/progress** to check your updated roadmap.\n\n');

    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });

    return {
      metadata: {
        lastCommand: 'remove-phase',
        phaseNumber: phaseNum
      }
    };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    stream.markdown(`**Error:** ${errorMessage}\n`);
    return { metadata: { lastCommand: 'remove-phase' } };
  }
}
