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
  timestamp: Date;
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
 * Format: EXE-{phase number}-{task id} (e.g., EXE-09-01)
 */
function generateIssueId(phase: string, taskId: number): string {
  // Extract phase number from phase identifier (e.g., "09-useability-and-skills" -> "09")
  const phaseMatch = phase.match(/^(\d+(?:\.\d+)*)/);
  const phaseNum = phaseMatch ? phaseMatch[1] : '00';
  const taskNum = String(taskId).padStart(2, '0');
  return `EXE-${phaseNum}-${taskNum}`;
}

/**
 * Check if an issue with the given ID already exists in ISSUES.md.
 */
function issueExists(content: string, issueId: string): boolean {
  return content.includes(issueId);
}

/**
 * Create the ISSUES.md template if it doesn't exist.
 */
function createIssuesTemplate(): string {
  return `# Project Issues Log

Enhancements discovered during execution. Not critical - address in future phases.

## Open Enhancements

## Closed Enhancements

---

*Last updated: ${new Date().toISOString().split('T')[0]}*
`;
}

/**
 * Format a task failure as an issue entry for ISSUES.md.
 */
function formatIssueEntry(failure: TaskFailure, issueId: string): string {
  const dateStr = failure.timestamp.toISOString().split('T')[0];
  const planFile = failure.planPath.split('/').pop() || failure.planPath;

  return `### ${issueId}: Task failure in ${planFile}

- **Discovered:** Execution of ${planFile} (${dateStr})
- **Type:** Execution Failure
- **Description:** Task "${failure.taskName}" failed: ${failure.error}
- **Impact:** Blocking (task did not complete)
- **Suggested fix:** Review error, adjust plan or retry manually
- **Phase:** ${failure.phase}
- **Task ID:** ${failure.taskId}

`;
}

/**
 * Log a task failure to .planning/ISSUES.md automatically.
 *
 * Creates the file if it doesn't exist.
 * Generates a unique issue ID in EXE-{phase}-{task} format.
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
  const issuesPath = vscode.Uri.joinPath(workspaceUri, '.planning', 'ISSUES.md');

  try {
    // Generate issue ID
    const issueId = generateIssueId(failure.phase, failure.taskId);

    // Try to read existing ISSUES.md
    let content: string;
    try {
      const existingContent = await vscode.workspace.fs.readFile(issuesPath);
      content = Buffer.from(existingContent).toString('utf-8');
    } catch {
      // File doesn't exist - create template
      content = createIssuesTemplate();
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

    // Insert after "## Open Enhancements" header
    const openHeader = '## Open Enhancements';
    const headerIndex = content.indexOf(openHeader);

    if (headerIndex === -1) {
      // Header not found - append to end (shouldn't happen with template)
      content = content.replace(/---\s*\n\s*\*Last updated:.*$/,
        `${issueEntry}\n---\n\n*Last updated: ${new Date().toISOString().split('T')[0]}*\n`);
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
