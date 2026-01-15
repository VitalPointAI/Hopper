import * as vscode from 'vscode';

/**
 * Configuration for generating PROJECT.md
 */
export interface ProjectConfig {
  /** Project name */
  name: string;
  /** Brief project description (2-3 sentences) */
  description: string;
  /** Core value - the ONE thing that matters most */
  coreValue: string;
  /** Active requirements being built toward */
  requirements: string[];
  /** Explicit boundaries - what we're NOT building */
  outOfScope: string[];
  /** Background context informing implementation */
  context: string;
  /** Hard constraints on implementation */
  constraints: string[];
}

/**
 * Result from a generator operation
 */
export interface GeneratorResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Path to created file (if successful) */
  filePath?: vscode.Uri;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Configuration for a single phase in the roadmap
 */
export interface PhaseConfig {
  /** Phase number (1-based) */
  number: number;
  /** Phase name (kebab-case, e.g., "foundation", "core-features") */
  name: string;
  /** What this phase delivers */
  goal: string;
  /** Phase number this depends on (undefined for first phase) */
  dependsOn?: number;
  /** Whether research is likely needed for this phase */
  researchLikely: boolean;
  /** Topics that need investigating (when researchLikely is true) */
  researchTopics?: string;
}

/**
 * Configuration for generating ROADMAP.md
 */
export interface RoadmapConfig {
  /** Project name */
  projectName: string;
  /** Overview paragraph describing the journey */
  overview: string;
  /** List of phases in the roadmap */
  phases: PhaseConfig[];
}

/**
 * Configuration for generating STATE.md
 */
export interface StateConfig {
  /** Project name */
  projectName: string;
  /** Core value from PROJECT.md */
  coreValue: string;
  /** Current phase number */
  currentPhase: number;
  /** Total number of phases */
  totalPhases: number;
}
