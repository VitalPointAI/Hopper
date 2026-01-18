import * as vscode from 'vscode';

/**
 * State update types for different operations
 */
export interface StateUpdate {
  /** Update current position (phase, plan, status) */
  position?: {
    phase: number;
    totalPhases: number;
    phaseName: string;
    plan: number;
    totalPlans: number;
    status: 'In progress' | 'Complete' | 'Paused';
  };
  /** Update last activity */
  lastActivity?: {
    date: string;  // YYYY-MM-DD
    description: string;  // e.g., "Completed 04-02-PLAN.md"
  };
  /** Update session continuity */
  session?: {
    lastSession?: string;  // YYYY-MM-DD
    stoppedAt?: string;    // Description of where stopped
    resumeFile?: string;   // Path or "None"
    next?: string;         // Suggested next action
  };
  /** Update verification status */
  verification?: {
    plan: string;          // e.g., "04-02"
    date: string;          // YYYY-MM-DD
    passed: number;
    failed: number;
    partial: number;
    skipped: number;
  };
  /** Add a decision to the decisions table */
  decision?: {
    phase: string;
    decision: string;
    rationale: string;
  };
  /** Update progress percentage */
  progress?: number;  // 0-100
}

/**
 * Read STATE.md content
 */
async function readState(planningUri: vscode.Uri): Promise<string | undefined> {
  try {
    const stateUri = vscode.Uri.joinPath(planningUri, 'STATE.md');
    const content = await vscode.workspace.fs.readFile(stateUri);
    return Buffer.from(content).toString('utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Write STATE.md content
 */
async function writeState(planningUri: vscode.Uri, content: string): Promise<void> {
  const stateUri = vscode.Uri.joinPath(planningUri, 'STATE.md');
  await vscode.workspace.fs.writeFile(stateUri, Buffer.from(content, 'utf-8'));
}

/**
 * Generate progress bar string
 */
function generateProgressBar(percentage: number): string {
  const filled = Math.round(percentage / 5);  // 20 chars total
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Update Current Position section
 */
function updatePositionSection(content: string, position: StateUpdate['position']): string {
  if (!position) return content;

  const positionPattern = /## Current Position\s*\n([\s\S]*?)(?=\n## |\n$)/;
  const match = content.match(positionPattern);

  if (!match) return content;

  const newPosition = `## Current Position

Phase: ${position.phase} of ${position.totalPhases} (${position.phaseName})
Plan: ${position.plan} of ${position.totalPlans}${position.status === 'Complete' ? ' complete' : ''}
Status: ${position.status}
`;

  return content.replace(positionPattern, newPosition);
}

/**
 * Update Last activity line
 */
function updateLastActivity(content: string, activity: StateUpdate['lastActivity']): string {
  if (!activity) return content;

  const activityPattern = /Last activity:.*\n/;
  const newActivity = `Last activity: ${activity.date} — ${activity.description}\n`;

  if (activityPattern.test(content)) {
    return content.replace(activityPattern, newActivity);
  }

  // Insert after Status line if not found
  const statusPattern = /(Status:.*\n)/;
  return content.replace(statusPattern, `$1${newActivity}`);
}

/**
 * Update Progress bar
 */
function updateProgressBar(content: string, percentage: number): string {
  const progressPattern = /Progress:.*\n/;
  const bar = generateProgressBar(percentage);
  const newProgress = `Progress: ${bar} ${percentage}%\n`;

  if (progressPattern.test(content)) {
    return content.replace(progressPattern, newProgress);
  }

  // Insert after Last activity if not found
  const activityPattern = /(Last activity:.*\n)/;
  return content.replace(activityPattern, `$1\n${newProgress}`);
}

/**
 * Update Session Continuity section
 */
function updateSessionSection(content: string, session: StateUpdate['session']): string {
  if (!session) return content;

  const sessionPattern = /## Session Continuity\s*\n([\s\S]*?)(?=\n## |\n$)/;
  const match = content.match(sessionPattern);

  if (!match) {
    // Add section at end if missing
    const newSection = `
## Session Continuity

Last session: ${session.lastSession || new Date().toISOString().split('T')[0]}
Stopped at: ${session.stoppedAt || 'Unknown'}
Resume file: ${session.resumeFile || 'None'}
Next: ${session.next || 'Continue with /progress'}
`;
    return content + newSection;
  }

  // Update individual fields
  let sectionContent = match[0];

  if (session.lastSession) {
    sectionContent = sectionContent.replace(
      /Last session:.*\n/,
      `Last session: ${session.lastSession}\n`
    );
  }

  if (session.stoppedAt) {
    sectionContent = sectionContent.replace(
      /Stopped at:.*\n/,
      `Stopped at: ${session.stoppedAt}\n`
    );
  }

  if (session.resumeFile !== undefined) {
    sectionContent = sectionContent.replace(
      /Resume file:.*\n/,
      `Resume file: ${session.resumeFile}\n`
    );
  }

  if (session.next) {
    sectionContent = sectionContent.replace(
      /Next:.*\n?/,
      `Next: ${session.next}\n`
    );
  }

  return content.replace(sessionPattern, sectionContent);
}

/**
 * Add decision to Decisions table
 */
function addDecision(content: string, decision: StateUpdate['decision']): string {
  if (!decision) return content;

  // Find the decisions table
  const tablePattern = /(\| Phase \| Decision \| Rationale \|\n\|[-|]+\|\n)([\s\S]*?)(?=\n###|\n## |$)/;
  const match = content.match(tablePattern);

  if (!match) return content;

  const newRow = `| ${decision.phase} | ${decision.decision} | ${decision.rationale} |\n`;
  const existingRows = match[2];

  // Add new row at the end of the table
  return content.replace(
    tablePattern,
    `$1${existingRows}${newRow}`
  );
}

/**
 * Update STATE.md with the provided updates
 *
 * @param planningUri - URI to .planning directory
 * @param updates - State updates to apply
 * @returns true if update succeeded, false otherwise
 */
export async function updateState(
  planningUri: vscode.Uri,
  updates: StateUpdate
): Promise<boolean> {
  try {
    let content = await readState(planningUri);

    if (!content) {
      console.warn('[Hopper] STATE.md not found, cannot update');
      return false;
    }

    // Apply each update type
    if (updates.position) {
      content = updatePositionSection(content, updates.position);
    }

    if (updates.lastActivity) {
      content = updateLastActivity(content, updates.lastActivity);
    }

    if (updates.progress !== undefined) {
      content = updateProgressBar(content, updates.progress);
    }

    if (updates.session) {
      content = updateSessionSection(content, updates.session);
    }

    if (updates.decision) {
      content = addDecision(content, updates.decision);
    }

    await writeState(planningUri, content);
    return true;
  } catch (err) {
    console.error('[Hopper] Failed to update STATE.md:', err);
    return false;
  }
}

/**
 * Quick helper to update just last activity and session
 */
export async function updateLastActivityAndSession(
  planningUri: vscode.Uri,
  description: string,
  next?: string
): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];

  return updateState(planningUri, {
    lastActivity: {
      date: today,
      description
    },
    session: {
      lastSession: today,
      stoppedAt: description,
      next: next || 'Continue with /progress'
    }
  });
}

/**
 * Update state after plan execution completes
 */
export async function updateStateAfterExecution(
  planningUri: vscode.Uri,
  phase: number,
  totalPhases: number,
  phaseName: string,
  plan: number,
  totalPlans: number,
  planFileName: string,
  durationMinutes?: number
): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const isPhaseComplete = plan >= totalPlans;
  const overallProgress = Math.round(((phase - 1 + (plan / totalPlans)) / totalPhases) * 100);

  return updateState(planningUri, {
    position: {
      phase,
      totalPhases,
      phaseName,
      plan,
      totalPlans,
      status: isPhaseComplete ? 'Complete' : 'In progress'
    },
    lastActivity: {
      date: today,
      description: `Completed ${planFileName}${durationMinutes ? ` (${durationMinutes} min)` : ''}`
    },
    progress: overallProgress,
    session: {
      lastSession: today,
      stoppedAt: `Completed ${planFileName}`,
      resumeFile: 'None',
      next: isPhaseComplete
        ? `/verify-work ${phase} to verify, then /plan-phase ${phase + 1}`
        : `/execute-plan to continue Phase ${phase}`
    }
  });
}

/**
 * Update state after verification completes
 */
export async function updateStateAfterVerification(
  planningUri: vscode.Uri,
  plan: string,
  passed: number,
  failed: number,
  partial: number,
  skipped: number
): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const total = passed + failed + partial + skipped;
  const allPassed = failed === 0 && partial === 0;

  return updateState(planningUri, {
    lastActivity: {
      date: today,
      description: `Verified ${plan}: ${passed}/${total} passed${allPassed ? ' ✓' : ''}`
    },
    session: {
      lastSession: today,
      stoppedAt: `Verified ${plan}${allPassed ? ' (all tests passed)' : ` (${failed} failed, ${partial} partial)`}`,
      next: allPassed
        ? '/execute-plan to continue'
        : `/plan-fix ${plan} to address ${failed + partial} issues`
    }
  });
}

/**
 * Write current agent ID to tracking file
 * Used to detect interrupted executions
 */
export async function setCurrentAgentId(
  planningUri: vscode.Uri,
  agentId: string
): Promise<void> {
  const agentIdUri = vscode.Uri.joinPath(planningUri, 'current-agent-id.txt');
  await vscode.workspace.fs.writeFile(agentIdUri, Buffer.from(agentId, 'utf-8'));
}

/**
 * Clear current agent ID (execution completed successfully)
 */
export async function clearCurrentAgentId(
  planningUri: vscode.Uri
): Promise<void> {
  const agentIdUri = vscode.Uri.joinPath(planningUri, 'current-agent-id.txt');
  try {
    await vscode.workspace.fs.delete(agentIdUri);
  } catch {
    // File doesn't exist, that's fine
  }
}
