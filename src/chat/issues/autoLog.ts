import * as vscode from 'vscode';

/**
 * Information about a task failure for automatic issue logging.
 */
export interface TaskFailure {
  planPath: string;
  taskId: number;
  taskName: string;
  error: string;
  phase: string;
  planNumber: string;
  timestamp: Date;
  /** The complete tool output captured during execution */
  fullOutput?: string;
  /** The specific verify step output if available */
  verifyOutput?: string;
  /** Files that were being modified when failure occurred */
  files?: string[];
}

/**
 * Result of attempting to log a task failure as an issue.
 */
export interface AutoLogResult {
  success: boolean;
  issueId?: string;
  error?: string;
}

/**
 * Generate a unique issue ID for an execution failure.
 * Format: EXE-{phase}-{plan}-{task} (e.g., EXE-09-02-01)
 */
function generateIssueId(phase: string, planNumber: string, taskId: number): string {
  // Extract phase number from phase identifier (e.g., "09-useability-and-skills" -> "09")
  const phaseMatch = phase.match(/^(\d+(?:\.\d+)*)/);
  const phaseNum = phaseMatch ? phaseMatch[1].padStart(2, '0') : '00';
  const taskNum = String(taskId).padStart(2, '0');
  return `EXE-${phaseNum}-${planNumber}-${taskNum}`;
}

/**
 * Check if an issue with the given ID already exists in ISSUES.md.
 */
function issueExists(content: string, issueId: string): boolean {
  return content.includes(issueId);
}

/**
 * Create the plan-specific ISSUES.md template.
 */
function createIssuesTemplate(phase: string, planNumber: string): string {
  const dateStr = new Date().toISOString().split('T')[0];
  return `# Execution Issues: Phase ${phase} Plan ${planNumber}

**Created:** ${dateStr}
**Source:** Automatic logging during /execute-plan

## Open Issues

## Resolved Issues

---

*Phase: ${phase}*
*Plan: ${planNumber}*
*Last updated: ${dateStr}*
`;
}

/**
 * Truncate string to max length, adding ellipsis if truncated.
 */
function truncateOutput(output: string, maxLength: number = 2000): string {
  if (output.length <= maxLength) {
    return output;
  }
  return output.slice(0, maxLength) + '\n...[truncated]';
}

/**
 * Format a task failure as an issue entry for ISSUES.md.
 */
function formatIssueEntry(failure: TaskFailure, issueId: string): string {
  const dateStr = failure.timestamp.toISOString().split('T')[0];
  const planFile = failure.planPath.split('/').pop() || failure.planPath;

  // Build affected files section if available
  const affectedFilesSection = failure.files && failure.files.length > 0
    ? `- **Affected Files:** ${failure.files.join(', ')}\n`
    : '';

  // Build full error output section if available
  let fullOutputSection = '';
  if (failure.fullOutput) {
    const truncatedOutput = truncateOutput(failure.fullOutput);
    fullOutputSection = `
**Full Error Output:**
\`\`\`
${truncatedOutput}
\`\`\`

`;
  }

  // Build suggested fix based on whether we have error context
  const suggestedFix = failure.fullOutput
    ? 'See error output above for root cause. Check test output for specific failing assertions.'
    : 'Review error, adjust plan or retry manually';

  return `### ${issueId}: Task failure in ${planFile}

- **Discovered:** Execution of ${planFile} (${dateStr})
- **Type:** Execution Failure
- **Task:** "${failure.taskName}"
- **Description:** Task failed: ${failure.error}
- **Impact:** Blocking (task did not complete)
${affectedFilesSection}${fullOutputSection}- **Suggested fix:** ${suggestedFix}
- **Phase:** ${failure.phase}
- **Task ID:** ${failure.taskId}

`;
}

/**
 * Log a task failure to plan-specific ISSUES.md file.
 *
 * Creates the file in the phase directory if it doesn't exist.
 * Format: .planning/phases/{phase-dir}/{phase}-{plan}-ISSUES.md
 * Generates a unique issue ID in EXE-{phase}-{plan}-{task} format.
 * Checks for duplicates before adding.
 *
 * @param workspaceUri The workspace root URI
 * @param failure Information about the failed task
 * @returns Result with success status and issue ID if created
 */
export async function logTaskFailure(
  workspaceUri: vscode.Uri,
  failure: TaskFailure
): Promise<AutoLogResult> {
  try {
    // Extract phase directory from planPath
    // e.g., "/path/.planning/phases/09-useability-and-skills/09-02-PLAN.md"
    const pathParts = failure.planPath.split('/');
    const planFile = pathParts[pathParts.length - 1]; // "09-02-PLAN.md"
    const phaseDir = pathParts[pathParts.length - 2]; // "09-useability-and-skills"

    // Extract phase-plan prefix from plan file (e.g., "09-02" from "09-02-PLAN.md")
    const planPrefix = planFile.replace(/-PLAN\.md$/, '');

    // Build issues file path: .planning/phases/{phaseDir}/{phase}-{plan}-ISSUES.md
    const issuesPath = vscode.Uri.joinPath(
      workspaceUri,
      '.planning',
      'phases',
      phaseDir,
      `${planPrefix}-ISSUES.md`
    );

    // Generate issue ID
    const issueId = generateIssueId(failure.phase, failure.planNumber, failure.taskId);

    // Try to read existing ISSUES.md
    let content: string;
    try {
      const existingContent = await vscode.workspace.fs.readFile(issuesPath);
      content = Buffer.from(existingContent).toString('utf-8');
    } catch {
      // File doesn't exist - create template
      content = createIssuesTemplate(failure.phase, failure.planNumber);
    }

    // Check for duplicate
    if (issueExists(content, issueId)) {
      return {
        success: false,
        error: `Issue ${issueId} already exists`
      };
    }

    // Format the new issue entry
    const issueEntry = formatIssueEntry(failure, issueId);

    // Insert after "## Open Issues" header
    const openHeader = '## Open Issues';
    const headerIndex = content.indexOf(openHeader);

    if (headerIndex === -1) {
      // Header not found - append before footer
      content = content.replace(/---\s*\n\s*\*Phase:.*$/s,
        `${issueEntry}\n---\n\n*Phase: ${failure.phase}*\n*Plan: ${failure.planNumber}*\n*Last updated: ${new Date().toISOString().split('T')[0]}*\n`);
    } else {
      // Insert after the header line
      const insertPos = headerIndex + openHeader.length;
      content = content.slice(0, insertPos) + '\n\n' + issueEntry + content.slice(insertPos);
    }

    // Update the "Last updated" date
    content = content.replace(
      /\*Last updated:.*\*/,
      `*Last updated: ${new Date().toISOString().split('T')[0]}*`
    );

    // Write back to file
    await vscode.workspace.fs.writeFile(issuesPath, Buffer.from(content, 'utf-8'));

    return {
      success: true,
      issueId
    };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to log issue: ${errorMsg}`
    };
  }
}
