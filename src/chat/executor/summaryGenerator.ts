import * as vscode from 'vscode';
import { ExecutionTask, AutoExecutionTask } from './types';

/**
 * Result from a summary generator operation
 */
export interface SummaryGeneratorResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Path to created file (if successful) */
  filePath?: vscode.Uri;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Commit information for summary
 */
export interface TaskCommitInfo {
  taskId: number;
  hash: string;
  message: string;
}

/**
 * Configuration for generating SUMMARY.md
 */
export interface SummaryConfig {
  /** Phase identifier (e.g., "04-execution-commands") */
  phase: string;
  /** Plan number within phase */
  planNumber: number;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Start timestamp */
  startTime: Date;
  /** End timestamp */
  endTime: Date;
  /** Tasks from the plan */
  tasks: ExecutionTask[];
  /** Commits made during execution */
  commits: TaskCommitInfo[];
  /** Files created during execution */
  filesCreated: string[];
  /** Files modified during execution */
  filesModified: string[];
  /** Decisions made at checkpoints */
  decisions: Record<string, string>;
  /** Issues encountered (optional) */
  issues?: string[];
  /** Deviations from plan (optional) */
  deviations?: string[];
  /** Plan objective */
  objective: string;
}

/**
 * Type guard to check if a task is an auto task
 */
function isAutoTask(task: ExecutionTask): task is AutoExecutionTask {
  return task.type === 'auto';
}

/**
 * Format duration from milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}min`;
  } else if (minutes > 0) {
    return `${minutes}min`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Detect subsystem from task files
 */
function detectSubsystem(tasks: ExecutionTask[]): string {
  const allFiles: string[] = [];
  for (const task of tasks) {
    if (isAutoTask(task) && task.files) {
      allFiles.push(...task.files);
    }
  }

  const filePaths = allFiles.join(' ').toLowerCase();

  if (filePaths.includes('executor')) {
    return 'executor';
  }
  if (filePaths.includes('commands')) {
    return 'commands';
  }
  if (filePaths.includes('generators')) {
    return 'generators';
  }
  if (filePaths.includes('auth')) {
    return 'auth';
  }
  if (filePaths.includes('extension')) {
    return 'extension';
  }

  return 'core';
}

/**
 * Extract tags from task names
 */
function extractTags(tasks: ExecutionTask[]): string[] {
  const tags = new Set<string>();

  for (const task of tasks) {
    const nameLower = task.name.toLowerCase();

    // Extract keywords as tags
    if (nameLower.includes('git')) tags.add('git');
    if (nameLower.includes('commit')) tags.add('git-commit');
    if (nameLower.includes('summary')) tags.add('summary');
    if (nameLower.includes('generator')) tags.add('generator');
    if (nameLower.includes('service')) tags.add('service');
    if (nameLower.includes('command')) tags.add('command');
    if (nameLower.includes('integration')) tags.add('integration');
    if (nameLower.includes('execution')) tags.add('execution');
    if (nameLower.includes('plan')) tags.add('plan');
  }

  return Array.from(tags);
}

/**
 * Detect commit type from task name
 */
function detectCommitType(taskName: string): string {
  const lower = taskName.toLowerCase();
  if (lower.includes('fix') || lower.includes('bug')) return 'fix';
  if (lower.includes('refactor') || lower.includes('restructure')) return 'refactor';
  if (lower.includes('document') || lower.includes('summary')) return 'docs';
  return 'feat';
}

/**
 * Create SUMMARY.md content from config
 */
export function createSummaryMd(config: SummaryConfig): string {
  const {
    phase,
    planNumber,
    durationMs,
    startTime,
    endTime,
    tasks,
    commits,
    filesCreated,
    filesModified,
    decisions,
    issues,
    deviations,
    objective
  } = config;

  const subsystem = detectSubsystem(tasks);
  const tags = extractTags(tasks);
  const duration = formatDuration(durationMs);

  // Extract phase number
  const phaseMatch = phase.match(/^(\d+)/);
  const phaseNum = phaseMatch ? phaseMatch[1] : '00';

  // Build YAML frontmatter
  const frontmatter = [
    '---',
    `phase: ${phase}`,
    `plan: ${String(planNumber).padStart(2, '0')}`,
    `subsystem: ${subsystem}`,
    `tags: [${tags.join(', ')}]`,
    '',
    '# Dependency graph',
    'requires:',
    planNumber > 1 ? `  - phase: ${phaseNum}-${String(planNumber - 1).padStart(2, '0')}` : '  - none',
    'provides:',
    ...tasks.map(t => `  - ${t.name}`),
    `affects: []`,
    '',
    '# Tech tracking',
    'tech-stack:',
    '  added: []',
    '  patterns: []',
    '',
    'key-files:',
    '  created:',
    ...filesCreated.map(f => `    - ${f}`),
    '  modified:',
    ...filesModified.map(f => `    - ${f}`),
    '',
    'key-decisions:',
    ...Object.entries(decisions).map(([key, value]) => `  - "${key}: ${value}"`),
    '',
    'issues-created: []',
    '',
    '# Metrics',
    `duration: ${duration}`,
    `completed: ${endTime.toISOString().split('T')[0]}`,
    '---',
    ''
  ].join('\n');

  // Extract phase name from phase identifier
  const phaseName = phase.replace(/^\d+-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Build markdown body
  const body = [
    `# Phase ${phaseNum} Plan ${String(planNumber).padStart(2, '0')}: Summary`,
    '',
    `**${objective}**`,
    '',
    '## Performance',
    '',
    `- **Duration:** ${duration}`,
    `- **Started:** ${startTime.toISOString()}`,
    `- **Completed:** ${endTime.toISOString()}`,
    `- **Tasks:** ${tasks.length}`,
    `- **Files modified:** ${filesCreated.length + filesModified.length}`,
    '',
    '## Accomplishments',
    '',
    ...tasks.map(t => `- ${t.name}`),
    '',
    '## Task Commits',
    '',
    'Each task was committed atomically:',
    '',
    ...tasks.map(task => {
      const taskCommit = commits.find(c => c.taskId === task.id);
      const type = detectCommitType(task.name);
      if (taskCommit) {
        return `${task.id}. **${task.name}** - \`${taskCommit.hash}\` (${type})`;
      }
      return `${task.id}. **${task.name}** - *no commit*`;
    }),
    '',
    '## Files Created/Modified',
    ''
  ];

  if (filesCreated.length > 0) {
    body.push('**Created:**');
    for (const file of filesCreated) {
      body.push(`- \`${file}\``);
    }
    body.push('');
  }

  if (filesModified.length > 0) {
    body.push('**Modified:**');
    for (const file of filesModified) {
      body.push(`- \`${file}\``);
    }
    body.push('');
  }

  // Decisions made
  if (Object.keys(decisions).length > 0) {
    body.push('## Decisions Made', '');
    for (const [key, value] of Object.entries(decisions)) {
      body.push(`- **${key}:** ${value}`);
    }
    body.push('');
  }

  // Deviations from plan
  body.push('## Deviations from Plan', '');
  if (deviations && deviations.length > 0) {
    for (const deviation of deviations) {
      body.push(`- ${deviation}`);
    }
  } else {
    body.push('None - plan executed as written.');
  }
  body.push('');

  // Issues encountered
  body.push('## Issues Encountered', '');
  if (issues && issues.length > 0) {
    for (const issue of issues) {
      body.push(`- ${issue}`);
    }
  } else {
    body.push('None');
  }
  body.push('');

  // Footer
  body.push(
    '---',
    `*Phase: ${phase}*`,
    `*Completed: ${endTime.toISOString().split('T')[0]}*`,
    ''
  );

  return frontmatter + body.join('\n');
}

/**
 * Save SUMMARY.md to the phase directory
 */
export async function saveSummary(
  workspaceUri: vscode.Uri,
  phaseDir: string,
  planNumber: number,
  config: SummaryConfig
): Promise<SummaryGeneratorResult> {
  try {
    // Generate summary content
    const content = createSummaryMd(config);

    // Build file path
    const phaseNum = phaseDir.match(/^(\d+)/)?.[1] || '00';
    const planNum = String(planNumber).padStart(2, '0');
    const fileName = `${phaseNum}-${planNum}-SUMMARY.md`;
    const filePath = vscode.Uri.joinPath(
      workspaceUri,
      '.planning',
      'phases',
      phaseDir,
      fileName
    );

    // Write file
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(filePath, encoder.encode(content));

    return {
      success: true,
      filePath
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
