export { ConfigManager } from './configManager';
export type {
  PlanningDepth,
  ExecutionMode,
  HopperConfig
} from './types';
export { DEFAULT_CONFIG, createDefaultConfig } from './types';
export {
  selectPlanningDepth,
  selectExecutionMode,
  showConfigurationSummary
} from './selectionUI';
export {
  getProjectExtractionPrompt,
  getPhaseExtractionPrompt,
  getPlanGenerationPrompt
} from './prompts';
export {
  shouldPauseAtCheckpoint,
  shouldConfirmTask,
  confirmTaskExecution,
  getModeDescription
} from './executionGates';
