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

/**
 * Configuration for an auto task in a plan
 */
export interface TaskConfig {
  /** Task name (action-oriented) */
  name: string;
  /** Task type: auto for automatic, or checkpoint types for user interaction */
  type: 'auto' | 'checkpoint:human-verify' | 'checkpoint:decision';
  /** Files this task will modify */
  files?: string[];
  /** What action to take */
  action: string;
  /** How to verify the task completed successfully */
  verify: string;
  /** Done criteria - acceptance conditions */
  done: string;
}

/**
 * Configuration for checkpoint:human-verify task
 */
export interface CheckpointVerifyConfig {
  /** What was built that needs verification */
  whatBuilt: string;
  /** Steps to verify the work */
  howToVerify: string[];
  /** How to resume after verification */
  resumeSignal: string;
}

/**
 * Decision option for checkpoint:decision task
 */
export interface DecisionOption {
  /** Option identifier */
  id: string;
  /** Option name */
  name: string;
  /** Benefits of this option */
  pros: string;
  /** Drawbacks of this option */
  cons: string;
}

/**
 * Configuration for checkpoint:decision task
 */
export interface CheckpointDecisionConfig {
  /** What decision needs to be made */
  decision: string;
  /** Why this decision matters */
  context: string;
  /** Available options */
  options: DecisionOption[];
  /** How to indicate choice */
  resumeSignal: string;
}

/**
 * Configuration for generating PLAN.md
 */
export interface PlanConfig {
  /** Phase identifier (e.g., "01-foundation") */
  phase: string;
  /** Plan number within phase */
  planNumber: number;
  /** Phase number for display */
  phaseNumber: number;
  /** Phase name for display */
  phaseName: string;
  /** What this plan accomplishes */
  objective: string;
  /** Why this plan matters */
  purpose: string;
  /** What artifacts will be created */
  output: string;
  /** List of tasks to execute */
  tasks: TaskConfig[];
  /** Verification checks before declaring complete */
  verification: string[];
  /** Success criteria for the plan */
  successCriteria: string[];
}
