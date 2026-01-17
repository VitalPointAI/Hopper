import { TaskConfig } from '../generators/types';

/**
 * Execution status for a task
 */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Parsed task with execution status tracking
 */
export interface ExecutionTask {
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
