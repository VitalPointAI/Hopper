/**
 * Security check command handler
 *
 * Provides /security-check command with two-phase UX:
 * 1. Summary of scan results (threat intel, file count, severity breakdown)
 * 2. Category breakdown (OWASP) with fix options
 */

import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
// Import types only - these don't trigger ESLint plugin initialization
import type { SecurityIssue, DependencyIssue } from '../../security/types';
// Advisory functions don't use ESLint, safe to import directly
import {
  getLatestAdvisories,
  matchAdvisoriesToDependencies,
  readPackageJson,
} from '../../security/advisories';

// Lazy-load scanner and fix modules to defer ESLint/jscodeshift initialization
// These are loaded on-demand when /security-check is invoked
let scannerModule: typeof import('../../security/scanner') | null = null;
let fixesModule: typeof import('../../security/fixes') | null = null;

async function getScannerModule() {
  if (!scannerModule) {
    scannerModule = await import('../../security/scanner');
  }
  return scannerModule;
}

async function getFixesModule() {
  if (!fixesModule) {
    fixesModule = await import('../../security/fixes');
  }
  return fixesModule;
}

/**
 * Handle /security-check command
 *
 * Scans user's codebase for security vulnerabilities.
 * Two-phase UX: summary → category details → fix options
 */
export async function handleSecurityCheck(ctx: CommandContext): Promise<IHopperResult> {
  const { stream, extensionContext } = ctx;

  // Get workspace root
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('## No Workspace Open\n\n');
    stream.markdown('Open a folder to scan for security issues.\n');
    return { metadata: { lastCommand: 'security-check' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  stream.markdown('## Security Check\n\n');
  stream.markdown('Scanning your codebase for vulnerabilities...\n\n');

  // Phase 1: Update threat intelligence
  stream.progress('Updating threat intelligence...');
  const { advisories, fromCache, cacheAge } = await getLatestAdvisories(extensionContext);

  const cacheStatus = fromCache
    ? `(cached ${Math.round(cacheAge / 1000 / 60)} min ago)`
    : '(fresh)';
  stream.markdown(`**Threat intelligence:** ${advisories.length} advisories loaded ${cacheStatus}\n\n`);

  // Phase 2: Check dependencies
  stream.progress('Checking dependencies...');
  const dependencies = await readPackageJson(workspaceUri);
  const dependencyIssues: DependencyIssue[] = [];

  if (Object.keys(dependencies).length > 0) {
    const matched = matchAdvisoriesToDependencies(advisories, dependencies);
    dependencyIssues.push(...matched);
  }

  // Phase 3: Scan code
  // Dynamically import scanner to defer ESLint plugin initialization
  stream.progress('Scanning code for vulnerabilities...');
  const scanPatterns = [
    vscode.Uri.joinPath(workspaceUri, 'src/**/*.ts').fsPath,
    vscode.Uri.joinPath(workspaceUri, 'src/**/*.tsx').fsPath,
    vscode.Uri.joinPath(workspaceUri, 'src/**/*.js').fsPath,
    vscode.Uri.joinPath(workspaceUri, 'src/**/*.jsx').fsPath,
    vscode.Uri.joinPath(workspaceUri, 'lib/**/*.ts').fsPath,
    vscode.Uri.joinPath(workspaceUri, 'app/**/*.ts').fsPath,
    vscode.Uri.joinPath(workspaceUri, 'app/**/*.tsx').fsPath,
  ];

  // Lazy-load scanner to avoid ESLint plugin init at extension activation
  const scanner = await getScannerModule();
  const { issues: codeIssues, filesScanned, duration } = await scanner.scanFiles(scanPatterns, workspaceUri.fsPath);

  // Combine all issues
  const allIssues: SecurityIssue[] = [...codeIssues, ...dependencyIssues];

  // Show summary
  showScanSummary(stream, allIssues, filesScanned, duration, dependencyIssues.length);

  if (allIssues.length === 0) {
    stream.markdown('### No Issues Found\n\n');
    stream.markdown('Your code passed all security checks. Great job!\n\n');
    return {
      metadata: {
        lastCommand: 'security-check',
        issuesFound: 0
      } as IHopperResult['metadata'] & { issuesFound: number }
    };
  }

  // Store issues in globalState for fix commands
  await extensionContext.globalState.update('hopper.security.lastScanIssues', allIssues);

  // Show category breakdown and fix options
  showCategoryBreakdown(stream, allIssues);
  showFixOptions(stream, allIssues);

  return {
    metadata: {
      lastCommand: 'security-check',
      issuesFound: allIssues.length,
      critical: allIssues.filter(i => i.severity === 'critical').length,
      high: allIssues.filter(i => i.severity === 'high').length
    } as IHopperResult['metadata'] & { issuesFound: number; critical: number; high: number }
  };
}

/**
 * Show scan summary with metrics
 */
function showScanSummary(
  stream: vscode.ChatResponseStream,
  issues: SecurityIssue[],
  filesScanned: number,
  duration: number,
  depIssues: number
): void {
  const critical = issues.filter(i => i.severity === 'critical').length;
  const high = issues.filter(i => i.severity === 'high').length;
  const medium = issues.filter(i => i.severity === 'medium').length;
  const low = issues.filter(i => i.severity === 'low').length;

  stream.markdown('### Scan Summary\n\n');
  stream.markdown(`| Metric | Value |\n`);
  stream.markdown(`|--------|-------|\n`);
  stream.markdown(`| Files scanned | ${filesScanned} |\n`);
  stream.markdown(`| Duration | ${duration}ms |\n`);
  stream.markdown(`| Dependency issues | ${depIssues} |\n`);
  stream.markdown(`| Code issues | ${issues.length - depIssues} |\n\n`);

  if (issues.length > 0) {
    stream.markdown('### Issues by Severity\n\n');
    stream.markdown(`| Severity | Count |\n`);
    stream.markdown(`|----------|-------|\n`);
    if (critical > 0) stream.markdown(`| 🔴 Critical | ${critical} |\n`);
    if (high > 0) stream.markdown(`| 🟠 High | ${high} |\n`);
    if (medium > 0) stream.markdown(`| 🟡 Medium | ${medium} |\n`);
    if (low > 0) stream.markdown(`| 🟢 Low | ${low} |\n`);
    stream.markdown('\n');
  }
}

/**
 * Show category breakdown grouped by OWASP category
 */
function showCategoryBreakdown(
  stream: vscode.ChatResponseStream,
  issues: SecurityIssue[]
): void {
  // Group by OWASP category
  const byCategory = new Map<string, SecurityIssue[]>();

  for (const issue of issues) {
    const category = issue.owasp || 'Uncategorized';
    const existing = byCategory.get(category) || [];
    existing.push(issue);
    byCategory.set(category, existing);
  }

  stream.markdown('### Issues by OWASP Category\n\n');

  for (const [category, categoryIssues] of byCategory) {
    const severityIcon = getSeverityIcon(getMaxSeverity(categoryIssues));
    stream.markdown(`#### ${severityIcon} ${formatOWASPCategory(category)}\n\n`);

    for (const issue of categoryIssues.slice(0, 5)) {
      const icon = getSeverityIcon(issue.severity);
      let location = '';

      if (issue.file) {
        // Get relative path from workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
          const relativePath = vscode.workspace.asRelativePath(issue.file);
          location = `\`${relativePath}:${issue.line}\``;
        } else {
          location = `\`${issue.file}:${issue.line}\``;
        }
      } else if (issue.type === 'dependency') {
        location = `\`${(issue as DependencyIssue).package}\``;
      }

      stream.markdown(`- ${icon} **${issue.severity.toUpperCase()}**: ${issue.message}\n`);
      if (location) stream.markdown(`  - Location: ${location}\n`);
      if (issue.suggestedFix) stream.markdown(`  - Fix: ${issue.suggestedFix}\n`);
    }

    if (categoryIssues.length > 5) {
      stream.markdown(`  - *...and ${categoryIssues.length - 5} more*\n`);
    }
    stream.markdown('\n');
  }
}

/**
 * Get severity icon for display
 */
function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
}

/**
 * Get the maximum severity from a list of issues
 */
function getMaxSeverity(issues: SecurityIssue[]): string {
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  for (const severity of order) {
    if (issues.some(i => i.severity === severity)) {
      return severity;
    }
  }
  return 'info';
}

/**
 * Format OWASP category for display
 * A05:2025-Injection → A05: Injection
 */
function formatOWASPCategory(category: string): string {
  const match = category.match(/^(A\d+):(\d+)-(.+)$/);
  if (match) {
    return `${match[1]}: ${match[3].replace(/-/g, ' ')}`;
  }
  return category;
}

/**
 * Show fix options with action buttons
 */
function showFixOptions(
  stream: vscode.ChatResponseStream,
  issues: SecurityIssue[]
): void {
  const fixable = issues.filter(i => i.fixable);
  const autoFixable = fixable.filter(i => i.fixConfidence === 'high');
  const needsReview = fixable.filter(i => i.fixConfidence !== 'high');

  stream.markdown('---\n\n');
  stream.markdown('### Remediation Options\n\n');

  if (autoFixable.length > 0) {
    stream.markdown(`**Auto-fixable:** ${autoFixable.length} issue(s) can be safely fixed automatically.\n\n`);
    stream.button({
      command: 'hopper.securityAutoFix',
      title: `Auto-fix ${autoFixable.length} Safe Issues`
    });
    stream.markdown('\n\n');
  }

  if (needsReview.length > 0) {
    stream.markdown(`**Needs review:** ${needsReview.length} issue(s) require human judgment.\n\n`);
    stream.button({
      command: 'hopper.securityInteractiveFix',
      title: `Review ${needsReview.length} Issues`
    });
    stream.markdown('\n\n');
  }

  const unfixable = issues.filter(i => !i.fixable);
  if (unfixable.length > 0) {
    stream.markdown(`**Manual fixes needed:** ${unfixable.length} issue(s) require manual remediation.\n`);
    stream.markdown('These issues are flagged but cannot be auto-fixed (e.g., architectural changes needed).\n\n');
  }

  // Dependency updates
  const depIssues = issues.filter(i => i.type === 'dependency') as DependencyIssue[];
  const updatable = depIssues.filter(i => i.patchedVersions);

  if (updatable.length > 0) {
    stream.markdown(`**Dependency updates:** ${updatable.length} vulnerable package(s) have patches available.\n\n`);

    const updateCommands = updatable.map(i =>
      `npm install ${i.package}@${i.patchedVersions}`
    ).join(' && ');

    stream.markdown('```bash\n' + updateCommands + '\n```\n\n');
  }
}

/**
 * Auto-fix command handler - fixes high-confidence issues
 */
export async function autoFixSecurityIssues(
  context: vscode.ExtensionContext
): Promise<{ fixed: number; total: number }> {
  const issues = context.globalState.get<SecurityIssue[]>('hopper.security.lastScanIssues');

  if (!issues) {
    return { fixed: 0, total: 0 };
  }

  // Lazy-load fix functions to avoid jscodeshift init at extension activation
  const fixes = await getFixesModule();

  const autoFixable = issues.filter(i => i.fixable && i.fixConfidence === 'high');
  let fixed = 0;

  for (const issue of autoFixable) {
    if (issue.file && issue.ruleId) {
      const fileUri = vscode.Uri.file(issue.file);
      const fixInfo = fixes.getFixForIssue(issue);

      if (fixInfo) {
        const result = await fixes.applyTransform(fileUri, fixInfo.transform, fixInfo.description);
        if (result.applied) {
          fixed++;
        }
      }
    }
  }

  return { fixed, total: autoFixable.length };
}

/**
 * Interactive fix command handler - reviews issues one by one
 */
export async function interactiveFixSecurityIssues(
  context: vscode.ExtensionContext
): Promise<{ fixed: number; skipped: number; stopped: boolean }> {
  const issues = context.globalState.get<SecurityIssue[]>('hopper.security.lastScanIssues');

  if (!issues) {
    return { fixed: 0, skipped: 0, stopped: false };
  }

  // Lazy-load fix functions to avoid jscodeshift init at extension activation
  const fixes = await getFixesModule();

  const needsReview = issues.filter(i => i.fixable && i.fixConfidence !== 'high');
  let fixed = 0;
  let skipped = 0;

  for (const issue of needsReview) {
    // Get relative path for display
    const displayPath = issue.file
      ? vscode.workspace.asRelativePath(issue.file)
      : issue.message;

    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(check) Apply Fix', value: 'fix' },
        { label: '$(arrow-right) Skip', value: 'skip' },
        { label: '$(stop) Stop Reviewing', value: 'stop' }
      ],
      {
        title: `${issue.severity.toUpperCase()}: ${issue.message}`,
        placeHolder: issue.file ? `${displayPath}:${issue.line}` : issue.message
      }
    );

    if (!choice || choice.value === 'stop') {
      return { fixed, skipped, stopped: true };
    }

    if (choice.value === 'skip') {
      skipped++;
      continue;
    }

    // Apply fix
    if (issue.file && issue.ruleId) {
      const fileUri = vscode.Uri.file(issue.file);
      const fixInfo = fixes.getFixForIssue(issue);

      if (fixInfo) {
        const result = await fixes.applyTransform(fileUri, fixInfo.transform, fixInfo.description);
        if (result.applied) {
          fixed++;
          vscode.window.showInformationMessage(`Fixed: ${fixInfo.description}`);
        } else {
          vscode.window.showWarningMessage(`Could not apply fix: ${result.error || 'Unknown error'}`);
        }
      }
    }
  }

  return { fixed, skipped, stopped: false };
}
