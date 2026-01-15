import * as vscode from 'vscode';
import { PhaseConfig, RoadmapConfig, StateConfig, GeneratorResult } from './types';

/**
 * Convert number to zero-padded string (e.g., 1 -> "01")
 */
function padPhaseNumber(num: number): string {
  return num.toString().padStart(2, '0');
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
 * Generate ROADMAP.md content following GSD template
 *
 * @param config - Roadmap configuration
 * @returns Formatted ROADMAP.md content
 */
export function createRoadmapMd(config: RoadmapConfig): string {
  const { projectName, overview, phases } = config;

  // Build phases list
  const phasesList = phases
    .map(p => `- [ ] **Phase ${p.number}: ${p.name}** - ${p.goal}`)
    .join('\n');

  // Build phase details
  const phaseDetails = phases.map(phase => {
    const dependsOn = phase.dependsOn
      ? `Phase ${phase.dependsOn}`
      : 'Nothing (first phase)';
    const research = phase.researchLikely ? 'Likely' : 'Unlikely';
    const researchReason = phase.researchLikely
      ? '(new integration or external APIs)'
      : '(established patterns)';

    let details = `### Phase ${phase.number}: ${phase.name}
**Goal**: ${phase.goal}
**Depends on**: ${dependsOn}
**Research**: ${research} ${researchReason}`;

    if (phase.researchLikely && phase.researchTopics) {
      details += `\n**Research topics**: ${phase.researchTopics}`;
    }

    details += `\n**Plans**: TBD

Plans:
- [ ] ${padPhaseNumber(phase.number)}-01: Initial plan (TBD)`;

    return details;
  }).join('\n\n');

  // Build progress table
  const progressRows = phases
    .map(p => `| ${p.number}. ${p.name} | 0/? | Not started | - |`)
    .join('\n');

  return `# Roadmap: ${projectName}

## Overview

${overview}

## Domain Expertise

None

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

${phasesList}

## Phase Details

${phaseDetails}

## Progress

**Execution Order:**
Phases execute in numeric order: ${phases.map(p => p.number).join(' -> ')}

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
${progressRows}
`;
}

/**
 * Generate STATE.md content following GSD template
 *
 * @param config - State configuration
 * @returns Formatted STATE.md content
 */
export function createStateMd(config: StateConfig): string {
  const today = new Date().toISOString().split('T')[0];
  const todayWithTime = new Date().toISOString().replace('T', ' ').slice(0, 16);

  // Create progress bar (all empty for new project)
  const progressBar = '[░░░░░░░░░░] 0%';

  return `# Project State

## Project Reference

See: .planning/PROJECT.md (updated ${today})

**Core value:** ${config.coreValue}
**Current focus:** Phase 1 (ready to plan)

## Current Position

Phase: 1 of ${config.totalPhases} (Phase 1)
Plan: 0 of ? in current phase
Status: Ready to plan
Last activity: ${today} — Roadmap created

Progress: ${progressBar}

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- None yet

### Deferred Issues

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: ${todayWithTime}
Stopped at: Project roadmap created
Resume file: None
`;
}

/**
 * Create phase directories under .planning/phases/
 *
 * @param workspaceUri - Workspace root URI
 * @param phases - List of phase configurations
 */
export async function createPhaseDirectories(
  workspaceUri: vscode.Uri,
  phases: PhaseConfig[]
): Promise<void> {
  const phasesUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases');

  // Ensure phases directory exists
  try {
    await vscode.workspace.fs.createDirectory(phasesUri);
  } catch {
    // Directory may already exist
  }

  // Create directory for each phase
  for (const phase of phases) {
    const dirName = `${padPhaseNumber(phase.number)}-${toKebabCase(phase.name)}`;
    const phaseUri = vscode.Uri.joinPath(phasesUri, dirName);

    try {
      await vscode.workspace.fs.createDirectory(phaseUri);
    } catch {
      // Directory may already exist
    }
  }
}

/**
 * Save ROADMAP.md and STATE.md to workspace
 *
 * @param workspaceUri - Workspace root URI
 * @param roadmapConfig - Roadmap configuration
 * @param stateConfig - State configuration
 * @returns GeneratorResult with success status and file paths
 */
export async function saveRoadmap(
  workspaceUri: vscode.Uri,
  roadmapConfig: RoadmapConfig,
  stateConfig: StateConfig
): Promise<GeneratorResult> {
  try {
    const planningUri = vscode.Uri.joinPath(workspaceUri, '.planning');

    // Generate content
    const roadmapContent = createRoadmapMd(roadmapConfig);
    const stateContent = createStateMd(stateConfig);

    // Write ROADMAP.md
    const roadmapUri = vscode.Uri.joinPath(planningUri, 'ROADMAP.md');
    await vscode.workspace.fs.writeFile(
      roadmapUri,
      Buffer.from(roadmapContent, 'utf-8')
    );

    // Write STATE.md
    const stateUri = vscode.Uri.joinPath(planningUri, 'STATE.md');
    await vscode.workspace.fs.writeFile(
      stateUri,
      Buffer.from(stateContent, 'utf-8')
    );

    // Create phase directories
    await createPhaseDirectories(workspaceUri, roadmapConfig.phases);

    return {
      success: true,
      filePath: roadmapUri
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to create roadmap files: ${errorMessage}`
    };
  }
}

/**
 * Check if ROADMAP.md already exists in workspace
 *
 * @param workspaceUri - Workspace root URI
 * @returns true if ROADMAP.md exists
 */
export async function roadmapExists(workspaceUri: vscode.Uri): Promise<boolean> {
  try {
    const roadmapUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'ROADMAP.md');
    await vscode.workspace.fs.stat(roadmapUri);
    return true;
  } catch {
    return false;
  }
}
