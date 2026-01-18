export { parsePlanMd, parseTasksXml } from './planParser';
export type {
  ExecutionTask,
  AutoExecutionTask,
  CheckpointVerifyTask,
  CheckpointDecisionTask,
  DecisionOption,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStatus,
  ExecutionState
} from './types';

// Git service exports
export {
  checkGitRepo,
  getStagedFiles,
  stageAll,
  stageFiles,
  commit,
  getRecentCommits,
  detectCommitType,
  generateCommitMessage
} from './gitService';
export type { CommitResult, CommitInfo } from './gitService';

// Summary generator exports
export { createSummaryMd, saveSummary } from './summaryGenerator';
export type { SummaryConfig, SummaryGeneratorResult, TaskCommitInfo } from './summaryGenerator';

// Scaffolding helper exports
export {
  isScaffoldingTask,
  extractScaffoldingCommand,
  executeScaffoldingWithProtection
} from './scaffolding';
export type { ScaffoldingResult } from './scaffolding';
