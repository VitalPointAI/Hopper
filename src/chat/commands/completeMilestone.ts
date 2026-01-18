import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * System prompt for generating milestone summary
 */
const MILESTONE_SUMMARY_PROMPT = `You are helping generate a milestone completion summary.

Based on the phase summaries provided, generate a concise milestone summary.

Output your response as JSON with this exact structure:
{
  "accomplishments": ["Key accomplishment 1", "Key accomplishment 2", "Key accomplishment 3", "Key accomplishment 4"],
  "keyDecisions": ["Important decision 1", "Important decision 2"],
  "lessonsLearned": ["Lesson 1", "Lesson 2"],
  "technicalHighlights": "Brief description of major technical work"
}

Guidelines:
- accomplishments: 4-6 key things delivered in this milestone
- keyDecisions: 2-4 important architectural or technical decisions
- lessonsLearned: 1-3 insights for future work
- technicalHighlights: 1-2 sentence summary of technical scope

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
 * Check if all phases are complete
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
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Detect current milestone number from roadmap
 */
function detectCurrentMilestone(roadmapContent: string): number {
  const milestoneMatches = roadmapContent.match(/##\s*Milestone\s+(\d+)/gi);
  if (milestoneMatches && milestoneMatches.length > 0) {
    let highest = 0;
    for (const match of milestoneMatches) {
      const num = parseInt(match.replace(/##\s*Milestone\s+/i, ''));
      if (num > highest) {
        highest = num;
      }
    }
    return highest;
  }
  return 1;
}

/**
 * Generate milestone archive content
 */
function generateMilestoneArchive(
  milestoneNum: number,
  milestoneName: string,
  startDate: string,
  endDate: string,
  phases: ParsedPhaseInfo[],
  summary: {
    accomplishments: string[];
    keyDecisions: string[];
    lessonsLearned: string[];
    technicalHighlights: string;
  },
  phaseSummaries: Map<number, string>
): string {
  let archive = `# Milestone ${milestoneNum}: ${milestoneName}

**Started:** ${startDate}
**Completed:** ${endDate}
**Phases:** ${phases.length}
**Status:** Complete

## Summary

${summary.technicalHighlights}

## Accomplishments

`;

  for (const accomplishment of summary.accomplishments) {
    archive += `- ${accomplishment}\n`;
  }

  archive += `
## Key Decisions

`;

  for (const decision of summary.keyDecisions) {
    archive += `- ${decision}\n`;
  }

  archive += `
## Lessons Learned

`;

  for (const lesson of summary.lessonsLearned) {
    archive += `- ${lesson}\n`;
  }

  archive += `
## Phases Completed

`;

  for (const phase of phases) {
    archive += `### Phase ${phase.number}: ${phase.name}

**Goal:** ${phase.goal}

`;

    const phaseSummary = phaseSummaries.get(phase.number);
    if (phaseSummary) {
      // Extract accomplishments from summary
      const accomplishmentsMatch = phaseSummary.match(/## Accomplishments([\s\S]*?)(?=##|$)/);
      if (accomplishmentsMatch) {
        archive += `**Accomplishments:**\n${accomplishmentsMatch[1].trim()}\n\n`;
      }
    }
  }

  archive += `---
*Milestone archived: ${endDate}*
`;

  return archive;
}

/**
 * Update STATE.md for completed milestone
 */
function generateStateForCompletedMilestone(
  existingState: string,
  milestoneNum: number
): string {
  const date = getCurrentDate();

  let newState = existingState;

  // Update Current Position section
  const positionPattern = /## Current Position[\s\S]*?(?=## |$)/;
  const newPosition = `## Current Position

Phase: Milestone ${milestoneNum} complete
Plan: N/A
Status: Ready for next milestone
Last activity: ${date} - Completed Milestone ${milestoneNum}

Progress: ██████████ 100%

`;

  if (positionPattern.test(newState)) {
    newState = newState.replace(positionPattern, newPosition);
  }

  // Update Session Continuity
  const sessionPattern = /## Session Continuity[\s\S]*?(?=## |$)/;
  const newSession = `## Session Continuity

Last session: ${date}
Stopped at: Completed Milestone ${milestoneNum}
Resume file: None
Next: Create new milestone with /new-milestone

`;

  if (sessionPattern.test(newState)) {
    newState = newState.replace(sessionPattern, newSession);
  }

  return newState;
}

/**
 * Handle /complete-milestone command
 *
 * Archives completed milestone:
 * 1. Validates all phases are complete
 * 2. Generates milestone summary from SUMMARY.md files
 * 3. Creates milestone archive file
 * 4. Updates ROADMAP.md to mark milestone complete
 * 5. Updates STATE.md
 */
export async function handleCompleteMilestone(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/complete-milestone` again.\n');
    return { metadata: { lastCommand: 'complete-milestone' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('Cannot complete milestone without ROADMAP.md.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'complete-milestone' } };
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
    return { metadata: { lastCommand: 'complete-milestone' } };
  }

  const phases = parseRoadmapPhases(fullRoadmapContent);
  const milestoneNum = detectCurrentMilestone(fullRoadmapContent);

  // Check if all phases are complete
  if (!areAllPhasesComplete(phases)) {
    const incompletePhases = phases.filter(p => !p.isComplete);
    stream.markdown('## Milestone Not Ready\n\n');
    stream.markdown('Cannot complete milestone - some phases are not done.\n\n');
    stream.markdown('**Incomplete phases:**\n');
    for (const phase of incompletePhases) {
      stream.markdown(`- [ ] Phase ${phase.number}: ${phase.name}\n`);
    }
    stream.markdown('\n');

    const completePhases = phases.filter(p => p.isComplete);
    if (completePhases.length > 0) {
      stream.markdown('**Completed phases:**\n');
      for (const phase of completePhases) {
        stream.markdown(`- [x] Phase ${phase.number}: ${phase.name}\n`);
      }
      stream.markdown('\n');
    }

    stream.markdown('**Options:**\n\n');
    if (incompletePhases.length > 0) {
      const nextPhase = incompletePhases[0].number;
      stream.button({
        command: 'hopper.chat-participant.plan-phase',
        title: `Plan Phase ${nextPhase}`
      });
      stream.markdown(' ');
    }
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });

    return { metadata: { lastCommand: 'complete-milestone' } };
  }

  // Collect phase summaries
  stream.progress('Collecting phase summaries...');
  const phaseSummaries = new Map<number, string>();
  let combinedSummaryContent = '';

  const phasesDir = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases');
  try {
    const phaseDirs = await vscode.workspace.fs.readDirectory(phasesDir);

    for (const [dirName, type] of phaseDirs) {
      if (type !== vscode.FileType.Directory) continue;

      // Find SUMMARY.md files in this phase directory
      const phaseDir = vscode.Uri.joinPath(phasesDir, dirName);
      try {
        const files = await vscode.workspace.fs.readDirectory(phaseDir);
        for (const [fileName] of files) {
          if (fileName.endsWith('-SUMMARY.md') && !fileName.includes('-FIX')) {
            const summaryUri = vscode.Uri.joinPath(phaseDir, fileName);
            const summaryBytes = await vscode.workspace.fs.readFile(summaryUri);
            const summaryContent = Buffer.from(summaryBytes).toString('utf-8');

            // Extract phase number from filename
            const phaseNumMatch = fileName.match(/^(\d+(?:\.\d+)?)-/);
            if (phaseNumMatch) {
              const phaseNum = parseFloat(phaseNumMatch[1]);
              phaseSummaries.set(phaseNum, summaryContent);
              combinedSummaryContent += `\n---\n## Phase ${phaseNum}\n${summaryContent}\n`;
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    }
  } catch {
    stream.markdown('**Warning:** Could not read phase summaries\n');
  }

  // Generate milestone summary using LLM
  stream.progress('Generating milestone summary...');

  let summary: {
    accomplishments: string[];
    keyDecisions: string[];
    lessonsLearned: string[];
    technicalHighlights: string;
  };

  try {
    const contextParts = [
      `Milestone ${milestoneNum}`,
      `Phases completed: ${phases.length}`,
      '',
      'Phase summaries:',
      combinedSummaryContent.slice(0, 8000) // Limit context size
    ];

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(MILESTONE_SUMMARY_PROMPT),
      vscode.LanguageModelChatMessage.User(contextParts.join('\n'))
    ];

    const response = await request.model.sendRequest(messages, {}, token);

    let fullResponse = '';
    for await (const fragment of response.text) {
      if (token.isCancellationRequested) {
        stream.markdown('**Cancelled**\n');
        return { metadata: { lastCommand: 'complete-milestone' } };
      }
      fullResponse += fragment;
    }

    try {
      const jsonStr = extractJsonFromResponse(fullResponse);
      summary = JSON.parse(jsonStr);
    } catch {
      // Fallback
      summary = {
        accomplishments: phases.map(p => `Completed Phase ${p.number}: ${p.name}`),
        keyDecisions: ['See individual phase summaries'],
        lessonsLearned: ['Project completed successfully'],
        technicalHighlights: `Completed ${phases.length} phases across the milestone.`
      };
    }
  } catch {
    summary = {
      accomplishments: phases.map(p => `Completed Phase ${p.number}: ${p.name}`),
      keyDecisions: ['See individual phase summaries'],
      lessonsLearned: ['Project completed successfully'],
      technicalHighlights: `Completed ${phases.length} phases across the milestone.`
    };
  }

  // Create milestone archive
  stream.progress('Creating milestone archive...');
  const date = getCurrentDate();

  // Try to find start date from first phase summary or use current date
  let startDate = date;
  if (phaseSummaries.size > 0) {
    const firstPhase = Math.min(...Array.from(phaseSummaries.keys()));
    const firstSummary = phaseSummaries.get(firstPhase);
    if (firstSummary) {
      const dateMatch = firstSummary.match(/\*\*Started:\*\*\s*(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        startDate = dateMatch[1];
      }
    }
  }

  // Extract milestone name from roadmap
  let milestoneName = `Milestone ${milestoneNum}`;
  const milestoneNameMatch = fullRoadmapContent.match(new RegExp(`##\\s*Milestone\\s+${milestoneNum}:\\s*([^\\n]+)`));
  if (milestoneNameMatch) {
    milestoneName = milestoneNameMatch[1].trim();
  }

  const archiveContent = generateMilestoneArchive(
    milestoneNum,
    milestoneName,
    startDate,
    date,
    phases,
    summary,
    phaseSummaries
  );

  // Ensure milestones directory exists
  const milestonesDir = vscode.Uri.joinPath(workspaceUri, '.planning', 'milestones');
  try {
    await vscode.workspace.fs.createDirectory(milestonesDir);
  } catch {
    // Directory may exist
  }

  // Write archive file
  const archiveUri = vscode.Uri.joinPath(milestonesDir, `v${milestoneNum}.0-ROADMAP.md`);
  await vscode.workspace.fs.writeFile(
    archiveUri,
    Buffer.from(archiveContent, 'utf-8')
  );

  // Update ROADMAP.md - mark milestone complete
  stream.progress('Updating roadmap...');
  let updatedRoadmap = fullRoadmapContent;

  // Find and update milestone status
  const milestoneStatusPattern = new RegExp(
    `(##\\s*Milestone\\s+${milestoneNum}[^\\n]*\\n[\\s\\S]*?\\*\\*Status:\\*\\*)\\s*In progress`,
    'i'
  );
  if (milestoneStatusPattern.test(updatedRoadmap)) {
    updatedRoadmap = updatedRoadmap.replace(milestoneStatusPattern, `$1 Complete`);
  }

  // Add completed date if not present
  const completedPattern = new RegExp(
    `(##\\s*Milestone\\s+${milestoneNum}[^\\n]*\\n[\\s\\S]*?\\*\\*Started:\\*\\*[^\\n]+)`,
    'i'
  );
  if (completedPattern.test(updatedRoadmap) && !updatedRoadmap.includes('**Completed:**')) {
    updatedRoadmap = updatedRoadmap.replace(completedPattern, `$1\n**Completed:** ${date}`);
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
    stateContent = '# Project State\n\n';
  }

  const updatedState = generateStateForCompletedMilestone(stateContent, milestoneNum);
  await vscode.workspace.fs.writeFile(
    stateUri,
    Buffer.from(updatedState, 'utf-8')
  );

  // Success!
  stream.markdown('## Milestone Complete!\n\n');
  stream.markdown(`**Milestone ${milestoneNum}: ${milestoneName}**\n\n`);
  stream.markdown(`**Completed:** ${date}\n\n`);

  stream.markdown('### Summary\n\n');
  stream.markdown(`${summary.technicalHighlights}\n\n`);

  stream.markdown('### Accomplishments\n\n');
  for (const accomplishment of summary.accomplishments) {
    stream.markdown(`- ${accomplishment}\n`);
  }
  stream.markdown('\n');

  stream.markdown('### Key Decisions\n\n');
  for (const decision of summary.keyDecisions) {
    stream.markdown(`- ${decision}\n`);
  }
  stream.markdown('\n');

  stream.markdown('**Files created/updated:**\n');
  stream.reference(archiveUri);
  stream.markdown('\n');
  stream.reference(roadmapUri);
  stream.markdown('\n');
  stream.reference(stateUri);
  stream.markdown('\n\n');

  stream.markdown('### Next Steps\n\n');
  stream.button({
    command: 'hopper.chat-participant.new-milestone',
    title: 'Create New Milestone'
  });
  stream.markdown(' ');
  stream.button({
    command: 'hopper.chat-participant.discuss-milestone',
    title: 'Discuss Next Milestone'
  });

  return {
    metadata: {
      lastCommand: 'complete-milestone'
    }
  };
}
