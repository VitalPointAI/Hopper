import * as vscode from 'vscode';

/**
 * Session continuity information from STATE.md
 */
export interface SessionContinuity {
  /** Last session date (YYYY-MM-DD) */
  lastSession?: string;
  /** Description of where work stopped */
  stoppedAt?: string;
  /** Path to resume file if any */
  resumeFile?: string;
  /** Suggested next action */
  next?: string;
}

/**
 * Project context information read from .planning directory
 */
export interface ProjectContext {
  /** Whether .planning directory exists */
  hasPlanning: boolean;
  /** Workspace root URI for reference links */
  workspaceUri?: vscode.Uri;
  /** .planning directory URI for file tree display */
  planningUri?: vscode.Uri;
  /** PROJECT.md content (truncated if too long) */
  projectMd?: string;
  /** ROADMAP.md content (truncated if too long) */
  roadmapMd?: string;
  /** STATE.md content (truncated if too long) */
  stateMd?: string;
  /** Current phase number parsed from STATE.md */
  currentPhase?: string;
  /** Issues from ISSUES.md if exists */
  issues?: string[];
  /** Session continuity from STATE.md */
  sessionContinuity?: SessionContinuity;
  /** ID of currently running/interrupted agent */
  currentAgentId?: string;
}

/**
 * Truncate content with indicator if too long
 *
 * @param content - Content to truncate
 * @param maxLength - Maximum length (default 2000)
 * @returns Truncated content with indicator if needed
 */
export function truncateContent(content: string, maxLength: number = 2000): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength) + '\n...\n[truncated]';
}

/**
 * Read a file from workspace, returning undefined if not found
 *
 * @param uri - File URI to read
 * @returns File content as string, or undefined if not found
 */
async function readFileContent(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString('utf-8');
  } catch {
    // File doesn't exist or can't be read
    return undefined;
  }
}

/**
 * Parse current phase from STATE.md content
 *
 * Looks for pattern: "Phase: X of Y"
 *
 * @param stateMd - STATE.md content
 * @returns Phase number as string, or undefined if not found
 */
function parseCurrentPhase(stateMd: string): string | undefined {
  // Look for "Phase: X of Y" pattern
  const match = stateMd.match(/Phase:\s*(\d+(?:\.\d+)?)\s*of\s*\d+/);
  return match ? match[1] : undefined;
}

/**
 * Parse Session Continuity section from STATE.md
 *
 * Looks for patterns like:
 * Last session: 2026-01-18
 * Stopped at: Completed 07-04-PLAN.md
 * Resume file: None
 * Next: /execute-plan to continue
 *
 * @param stateMd - STATE.md content
 * @returns SessionContinuity object
 */
function parseSessionContinuity(stateMd: string): SessionContinuity | undefined {
  // Find Session Continuity section
  const sectionMatch = stateMd.match(/## Session Continuity\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!sectionMatch) {
    return undefined;
  }

  const section = sectionMatch[1];
  const continuity: SessionContinuity = {};

  // Parse each field
  const lastSessionMatch = section.match(/Last session:\s*(.+)/);
  if (lastSessionMatch) {
    continuity.lastSession = lastSessionMatch[1].trim();
  }

  const stoppedAtMatch = section.match(/Stopped at:\s*(.+)/);
  if (stoppedAtMatch) {
    continuity.stoppedAt = stoppedAtMatch[1].trim();
  }

  const resumeFileMatch = section.match(/Resume file:\s*(.+)/);
  if (resumeFileMatch) {
    const value = resumeFileMatch[1].trim();
    continuity.resumeFile = value.toLowerCase() === 'none' ? undefined : value;
  }

  const nextMatch = section.match(/Next:\s*(.+)/);
  if (nextMatch) {
    continuity.next = nextMatch[1].trim();
  }

  return continuity;
}

/**
 * Parse issues from ISSUES.md content
 *
 * Looks for patterns like: "- ISS-001: ..." or "- [ ] Issue..."
 *
 * @param issuesMd - ISSUES.md content
 * @returns Array of issue strings
 */
function parseIssues(issuesMd: string): string[] {
  const issues: string[] = [];
  const lines = issuesMd.split('\n');

  for (const line of lines) {
    // Match issue entries like "- ISS-001: ..." or list items
    const issueMatch = line.match(/^-\s+(ISS-\d+:.+)$/);
    if (issueMatch) {
      issues.push(issueMatch[1]);
    }
  }

  return issues;
}

/**
 * Get project context from .planning directory
 *
 * Reads PROJECT.md, ROADMAP.md, STATE.md, and ISSUES.md if they exist.
 * Returns context with hasPlanning=false if no .planning directory.
 *
 * @returns ProjectContext with available planning information
 */
export async function getProjectContext(): Promise<ProjectContext> {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { hasPlanning: false };
  }

  const workspaceUri = workspaceFolders[0].uri;
  const planningUri = vscode.Uri.joinPath(workspaceUri, '.planning');

  // Check if .planning directory exists
  try {
    const stat = await vscode.workspace.fs.stat(planningUri);
    if (stat.type !== vscode.FileType.Directory) {
      return { hasPlanning: false, workspaceUri };
    }
  } catch {
    // .planning directory doesn't exist
    return { hasPlanning: false, workspaceUri };
  }

  // Read planning files in parallel
  const [projectMdRaw, roadmapMdRaw, stateMdRaw, issuesMdRaw, agentIdRaw] = await Promise.all([
    readFileContent(vscode.Uri.joinPath(planningUri, 'PROJECT.md')),
    readFileContent(vscode.Uri.joinPath(planningUri, 'ROADMAP.md')),
    readFileContent(vscode.Uri.joinPath(planningUri, 'STATE.md')),
    readFileContent(vscode.Uri.joinPath(planningUri, 'ISSUES.md')),
    readFileContent(vscode.Uri.joinPath(planningUri, 'current-agent-id.txt'))
  ]);

  // Build context
  const context: ProjectContext = {
    hasPlanning: true,
    workspaceUri,
    planningUri,
    projectMd: projectMdRaw ? truncateContent(projectMdRaw) : undefined,
    roadmapMd: roadmapMdRaw ? truncateContent(roadmapMdRaw) : undefined,
    stateMd: stateMdRaw ? truncateContent(stateMdRaw) : undefined
  };

  // Parse current phase and session continuity from STATE.md
  if (stateMdRaw) {
    context.currentPhase = parseCurrentPhase(stateMdRaw);
    context.sessionContinuity = parseSessionContinuity(stateMdRaw);
  }

  // Parse issues from ISSUES.md
  if (issuesMdRaw) {
    context.issues = parseIssues(issuesMdRaw);
  }

  // Parse current agent ID (for interrupted execution tracking)
  if (agentIdRaw) {
    const agentId = agentIdRaw.trim();
    if (agentId) {
      context.currentAgentId = agentId;
    }
  }

  return context;
}

/**
 * Format project context for inclusion in LLM prompts
 *
 * Creates a structured markdown string with relevant project information.
 * Truncates content to prevent token limit issues.
 *
 * @param ctx - ProjectContext to format
 * @returns Formatted markdown string for prompt injection
 */
export function formatContextForPrompt(ctx: ProjectContext): string {
  if (!ctx.hasPlanning) {
    return '';
  }

  const parts: string[] = [];

  parts.push('## Project Context\n');

  // Add current phase if known
  if (ctx.currentPhase) {
    parts.push(`**Current Phase:** ${ctx.currentPhase}\n`);
  }

  // Add PROJECT.md summary
  if (ctx.projectMd) {
    // Extract just the first heading and description
    const lines = ctx.projectMd.split('\n');
    const projectName = lines[0]?.replace(/^#\s*/, '') || 'Unknown';
    parts.push(`**Project:** ${projectName}\n`);
  }

  // Add STATE.md content
  if (ctx.stateMd) {
    parts.push('\n### Current State\n');
    parts.push(truncateContent(ctx.stateMd, 1000));
    parts.push('\n');
  }

  // Add active issues if any
  if (ctx.issues && ctx.issues.length > 0) {
    parts.push('\n### Active Issues\n');
    for (const issue of ctx.issues.slice(0, 5)) {
      parts.push(`- ${issue}\n`);
    }
    if (ctx.issues.length > 5) {
      parts.push(`- ... and ${ctx.issues.length - 5} more\n`);
    }
  }

  return parts.join('');
}
