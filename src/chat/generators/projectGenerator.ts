import * as vscode from 'vscode';
import { ProjectConfig, GeneratorResult } from './types';

/**
 * Generate PROJECT.md content following GSD template
 *
 * @param config - Project configuration
 * @returns Formatted PROJECT.md content
 */
export function createProjectMd(config: ProjectConfig): string {
  const today = new Date().toISOString().split('T')[0];

  // Build requirements section
  const requirementsList = config.requirements.length > 0
    ? config.requirements.map(req => `- [ ] ${req}`).join('\n')
    : '- [ ] (Add requirements)';

  // Build out of scope section
  const outOfScopeList = config.outOfScope.length > 0
    ? config.outOfScope.map(item => `- ${item}`).join('\n')
    : '- (None specified yet)';

  // Build constraints section
  const constraintsList = config.constraints.length > 0
    ? config.constraints.map(c => `- **Constraint**: ${c}`).join('\n')
    : '- (None specified yet)';

  return `# ${config.name}

## What This Is

${config.description}

## Core Value

${config.coreValue}

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

${requirementsList}

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

${outOfScopeList}

## Context

${config.context || '(Background context to be added)'}

## Constraints

${constraintsList}

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| (None yet) | — | — |

---
*Last updated: ${today} after initial project creation*
`;
}

/**
 * Save PROJECT.md to workspace, creating .planning directory if needed
 *
 * @param workspaceUri - Workspace root URI
 * @param config - Project configuration
 * @returns GeneratorResult with success status and file path
 */
export async function saveProject(
  workspaceUri: vscode.Uri,
  config: ProjectConfig
): Promise<GeneratorResult> {
  try {
    // Create .planning directory
    const planningUri = vscode.Uri.joinPath(workspaceUri, '.planning');

    try {
      await vscode.workspace.fs.createDirectory(planningUri);
    } catch {
      // Directory may already exist, continue
    }

    // Create phases directory structure
    const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');
    try {
      await vscode.workspace.fs.createDirectory(phasesUri);
    } catch {
      // Directory may already exist, continue
    }

    // Generate PROJECT.md content
    const content = createProjectMd(config);

    // Write PROJECT.md
    const projectMdUri = vscode.Uri.joinPath(planningUri, 'PROJECT.md');
    await vscode.workspace.fs.writeFile(
      projectMdUri,
      Buffer.from(content, 'utf-8')
    );

    return {
      success: true,
      filePath: projectMdUri
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to create PROJECT.md: ${errorMessage}`
    };
  }
}

/**
 * Check if .planning directory already exists in workspace
 *
 * @param workspaceUri - Workspace root URI
 * @returns true if .planning exists
 */
export async function planningExists(workspaceUri: vscode.Uri): Promise<boolean> {
  try {
    const planningUri = vscode.Uri.joinPath(workspaceUri, '.planning');
    const stat = await vscode.workspace.fs.stat(planningUri);
    return stat.type === vscode.FileType.Directory;
  } catch {
    return false;
  }
}
