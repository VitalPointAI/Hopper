/**
 * Planning depth levels that control how detailed generated plans are.
 *
 * - `quick`: Minimal detail, fast to generate, good for simple or familiar projects.
 *   Produces concise PROJECT.md and ROADMAP.md with fewer phases and less research.
 *
 * - `standard`: Balanced detail, suitable for most projects.
 *   Default level with appropriate research recommendations and phase breakdown.
 *
 * - `comprehensive`: Maximum detail, thorough analysis, for complex projects.
 *   Produces detailed PROJECT.md with extensive context, more phases, and
 *   research recommendations for all unfamiliar areas.
 */
export type PlanningDepth = 'quick' | 'standard' | 'comprehensive';

/**
 * Execution control modes that determine confirmation behavior during plan execution.
 *
 * - `yolo`: No confirmations, auto-execute everything.
 *   Maximum automation, tasks execute without user intervention.
 *   Use when you trust the plan and want fastest execution.
 *
 * - `guided`: Confirm at checkpoints only.
 *   Balanced approach - auto tasks run automatically, but checkpoint tasks
 *   (human-verify, decision) pause for user input. Default mode.
 *
 * - `manual`: Confirm every task before execution.
 *   Maximum control - each task shows what will happen and waits for approval.
 *   Use when learning the system or working on critical code.
 */
export type ExecutionMode = 'yolo' | 'guided' | 'manual';

/**
 * Configuration for Hopper planning and execution behavior.
 * Stored in `.planning/config.json` in the workspace.
 */
export interface HopperConfig {
  /**
   * Planning depth level for document generation.
   * Affects PROJECT.md, ROADMAP.md, and PLAN.md detail level.
   * @default 'standard'
   */
  planningDepth: PlanningDepth;

  /**
   * Execution control mode for plan execution.
   * Determines when confirmations are required.
   * @default 'guided'
   */
  executionMode: ExecutionMode;

  /**
   * ISO timestamp when this config was created.
   */
  createdAt: string;

  /**
   * ISO timestamp when this config was last updated.
   */
  updatedAt: string;
}

/**
 * Default configuration values.
 * Used when no config file exists or when resetting to defaults.
 */
export const DEFAULT_CONFIG: Omit<HopperConfig, 'createdAt' | 'updatedAt'> = {
  planningDepth: 'standard',
  executionMode: 'guided',
};

/**
 * Creates a new HopperConfig with default values and current timestamps.
 */
export function createDefaultConfig(): HopperConfig {
  const now = new Date().toISOString();
  return {
    ...DEFAULT_CONFIG,
    createdAt: now,
    updatedAt: now,
  };
}
