import { TaskConfig } from '../generators/types';

/**
 * Execution status for a task
 */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Base task with common properties
 */
export interface BaseExecutionTask {
  /** Task number (1-based) */
  id: number;
  /** Task name */
  name: string;
  /** Task type: auto, checkpoint:human-verify, checkpoint:decision */
  type: TaskConfig['type'];
  /** Execution status */
  status: ExecutionStatus;
}

/**
 * Auto task - standard automated execution
 */
export interface AutoExecutionTask extends BaseExecutionTask {
  type: 'auto';
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
 * Checkpoint task for human verification
 * Used when Claude has completed work and human needs to confirm it works
 */
export interface CheckpointVerifyTask extends BaseExecutionTask {
  type: 'checkpoint:human-verify';
  /** What Claude built/automated */
  whatBuilt: string;
  /** Steps for human to verify */
  howToVerify: string[];
  /** Signal to continue execution */
  resumeSignal: string;
}

/**
 * Decision option with pros/cons
 */
export interface DecisionOption {
  id: string;
  name: string;
  pros: string;
  cons: string;
}

/**
 * Checkpoint task for human decision
 * Used when human must make a choice that affects implementation
 */
export interface CheckpointDecisionTask extends BaseExecutionTask {
  type: 'checkpoint:decision';
  /** What decision is being made */
  decision: string;
  /** Why this decision matters */
  context: string;
  /** Available options */
  options: DecisionOption[];
  /** Signal to continue execution */
  resumeSignal: string;
}

/**
 * Union type for all execution task types
 */
export type ExecutionTask = AutoExecutionTask | CheckpointVerifyTask | CheckpointDecisionTask;

/**
 * Legacy interface for backwards compatibility
 * @deprecated Use ExecutionTask union type instead
 */
export interface LegacyExecutionTask {
  /** Task number (1-based) */
  id: number;
  /** Task name */
  name: string;
  /** Task type: auto, checkpoint:human-verify, checkpoint:decision */
  type: TaskConfig['type'];
  /** Files this task will modify */
  files?: string[];
  /** What action to take */
  action: string;
  /** How to verify the task completed successfully */
  verify: string;
  /** Done criteria - acceptance conditions */
  done: string;
  /** Execution status */
  status: ExecutionStatus;
}

/**
 * Execution state for tracking progress across checkpoints
 * Stored in extension globalState when paused at checkpoint
 */
export interface ExecutionState {
  /** Path to the plan file being executed */
  planPath: string;
  /** Index of the current task (0-based) */
  currentTaskIndex: number;
  /** IDs of completed tasks */
  completedTasks: number[];
  /** Decisions made at checkpoint:decision tasks */
  decisions: Record<string, string>;
  /** Whether currently paused at a checkpoint */
  pausedAtCheckpoint: boolean;
  /** Type of checkpoint if paused */
  checkpointType?: 'human-verify' | 'decision';
  /** Timestamp when state was saved */
  savedAt: number;
}

/**
 * Parsed plan with execution metadata
 */
export interface ExecutionPlan {
  /** Phase identifier (e.g., "04-execution-commands") */
  phase: string;
  /** Plan number within phase */
  planNumber: number;
  /** Plan objective */
  objective: string;
  /** Why this plan matters */
  purpose: string;
  /** List of tasks to execute */
  tasks: ExecutionTask[];
  /** Verification checks before declaring complete */
  verification: string[];
  /** Success criteria for the plan */
  successCriteria: string[];
}

/**
 * Result of executing a single task
 */
export interface ExecutionResult {
  /** Task number that was executed */
  taskId: number;
  /** Whether the task succeeded */
  success: boolean;
  /** Output from execution (LLM response) */
  output?: string;
  /** Error message if failed */
  error?: string;
}
