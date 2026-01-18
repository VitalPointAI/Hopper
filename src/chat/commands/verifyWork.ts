import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import { truncateContent } from '../context/projectContext';
import { updateStateAfterVerification } from '../state';

/**
 * Test result from user
 */
interface TestResult {
  feature: string;
  status: 'pass' | 'fail' | 'partial' | 'skip';
  description?: string;
  severity?: 'blocker' | 'major' | 'minor' | 'cosmetic';
}

/**
 * Verification state for persistence and resume capability
 */
interface VerificationState {
  planPath: string;
  phase: string;
  plan: string;
  testItems: string[];
  results: TestResult[];
  currentIndex: number;
  startedAt: string;
  pausedAt?: string;
}

/**
 * UAT Issue logged from testing
 */
interface UATIssue {
  id: string;
  feature: string;
  severity: 'Blocker' | 'Major' | 'Minor' | 'Cosmetic';
  description: string;
  expected?: string;
  actual?: string;
}

/**
 * Get the storage key for verification state
 */
function getVerificationStateKey(planPath: string): string {
  return `hopper.verificationState.${planPath}`;
}

/**
 * Save verification state to extension globalState
 */
async function saveVerificationState(
  context: vscode.ExtensionContext,
  state: VerificationState
): Promise<void> {
  const key = getVerificationStateKey(state.planPath);
  await context.globalState.update(key, state);
}

/**
 * Load verification state from extension globalState
 */
function loadVerificationState(
  context: vscode.ExtensionContext,
  planPath: string
): VerificationState | undefined {
  const key = getVerificationStateKey(planPath);
  return context.globalState.get<VerificationState>(key);
}

/**
 * Clear verification state from extension globalState
 */
async function clearVerificationState(
  context: vscode.ExtensionContext,
  planPath: string
): Promise<void> {
  const key = getVerificationStateKey(planPath);
  await context.globalState.update(key, undefined);
}

/**
 * Parse a SUMMARY.md file to extract testable deliverables
 */
function parseDeliverables(summaryContent: string): { accomplishments: string[]; files: string[] } {
  const accomplishments: string[] = [];
  const files: string[] = [];

  // Extract accomplishments section
  const accomplishMatch = summaryContent.match(/## Accomplishments\s*([\s\S]*?)(?=##|$)/i);
  if (accomplishMatch) {
    const lines = accomplishMatch[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        accomplishments.push(trimmed.replace(/^[-*]\s*/, ''));
      }
    }
  }

  // Extract files created/modified
  const filesMatch = summaryContent.match(/## Files Created\/Modified\s*([\s\S]*?)(?=##|$)/i);
  if (filesMatch) {
    const lines = filesMatch[1].split('\n');
    for (const line of lines) {
      const fileMatch = line.match(/`([^`]+)`/);
      if (fileMatch) {
        files.push(fileMatch[1]);
      }
    }
  }

  return { accomplishments, files };
}

/**
 * Read file content from workspace
 */
async function readFileContent(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString('utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Find SUMMARY.md files based on argument (phase or plan number)
 */
async function findSummaryFiles(
  planningUri: vscode.Uri,
  arg?: string
): Promise<{ uri: vscode.Uri; phase: string; plan: string }[]> {
  const results: { uri: vscode.Uri; phase: string; plan: string }[] = [];

  try {
    // List all phase directories
    const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');
    const phases = await vscode.workspace.fs.readDirectory(phasesUri);

    for (const [phaseName, type] of phases) {
      if (type !== vscode.FileType.Directory) continue;

      // If arg provided, filter by phase number
      if (arg) {
        const phaseNum = phaseName.match(/^(\d+(?:\.\d+)?)/)?.[1];
        if (arg.includes('-')) {
          // Plan identifier like "04-02"
          const [argPhase, argPlan] = arg.split('-');
          if (phaseNum !== argPhase && !phaseNum?.startsWith(argPhase)) continue;
        } else {
          // Just phase number like "4" or "4.5"
          if (phaseNum !== arg && !phaseNum?.startsWith(arg)) continue;
        }
      }

      const phaseDir = vscode.Uri.joinPath(phasesUri, phaseName);
      const files = await vscode.workspace.fs.readDirectory(phaseDir);

      for (const [fileName] of files) {
        if (!fileName.endsWith('-SUMMARY.md')) continue;

        // If specific plan requested, check match
        if (arg?.includes('-')) {
          const planMatch = fileName.match(/^(\d+(?:\.\d+)?)-(\d+)-SUMMARY\.md$/);
          if (planMatch) {
            const [, filePhase, filePlan] = planMatch;
            const [argPhase, argPlan] = arg.split('-');
            if (filePhase !== argPhase && !filePhase?.startsWith(argPhase + '.')) continue;
            if (filePlan !== argPlan) continue;
          }
        }

        const summaryUri = vscode.Uri.joinPath(phaseDir, fileName);
        const planMatch = fileName.match(/^(\d+(?:\.\d+)?)-(\d+)/);
        if (planMatch) {
          results.push({
            uri: summaryUri,
            phase: planMatch[1],
            plan: planMatch[2]
          });
        }
      }
    }
  } catch {
    // Phases directory doesn't exist
  }

  // Sort by phase and plan number, most recent first
  results.sort((a, b) => {
    const phaseA = parseFloat(a.phase);
    const phaseB = parseFloat(b.phase);
    if (phaseA !== phaseB) return phaseB - phaseA;
    return parseInt(b.plan) - parseInt(a.plan);
  });

  return results;
}

/**
 * Generate test checklist from deliverables using LLM
 */
async function generateTestChecklist(
  ctx: CommandContext,
  deliverables: { accomplishments: string[]; files: string[] },
  planName: string
): Promise<string[]> {
  const { token } = ctx;

  // Get available LLM models
  const models = await vscode.lm.selectChatModels();
  if (models.length === 0) {
    // Fallback: convert accomplishments directly to test items
    return deliverables.accomplishments.map(a => `Verify: ${a}`);
  }

  const model = models[0];

  const prompt = `Generate detailed manual user acceptance test instructions for the following deliverables.

## Deliverables
**Plan:** ${planName}
**Accomplishments:**
${deliverables.accomplishments.map(a => `- ${a}`).join('\n')}

**Files changed:**
${deliverables.files.slice(0, 10).map(f => `- ${f}`).join('\n')}

## Instructions
Create 3-8 detailed test instructions that a USER can follow step-by-step. Each test MUST include:
1. **What to do** - Specific actions (click X, type Y, navigate to Z)
2. **How to do it** - Exact steps to reproduce
3. **What to expect** - The expected result when the feature works correctly

The test description should be detailed enough that someone unfamiliar with the code can follow along.

Respond with a JSON array of test descriptions. Each should be a complete, actionable test instruction.

Example format:
[
  "Open the application in browser, navigate to Settings page via the gear icon in the top-right, then click 'Dark Mode' toggle. Expected: The entire UI should switch to dark theme with dark backgrounds and light text.",
  "In the login form, leave the email field empty and click Submit. Expected: A red error message 'Email is required' should appear below the email field and the form should not submit.",
  "Navigate to /dashboard after logging in. Expected: You should see a welcome message with your username and a list of recent activity items."
]

Only output the JSON array, no other text.`;

  try {
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {}, token);

    let responseText = '';
    for await (const chunk of response.text) {
      responseText += chunk;
    }

    // Parse JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const tests = JSON.parse(jsonMatch[0]);
        if (Array.isArray(tests)) {
          return tests;
        }
      } catch {
        // JSON parse failed
      }
    }
  } catch {
    // LLM call failed
  }

  // Fallback
  return deliverables.accomplishments.map(a => `Verify: ${a}`);
}

/**
 * Write issues to phase-scoped ISSUES.md file
 */
async function writeIssuesFile(
  planningUri: vscode.Uri,
  phaseDir: string,
  phase: string,
  plan: string,
  issues: UATIssue[]
): Promise<vscode.Uri | undefined> {
  if (issues.length === 0) return undefined;

  const today = new Date().toISOString().split('T')[0];
  const issuesFileName = `${phase}-${plan.padStart(2, '0')}-ISSUES.md`;

  // Find the phase directory
  const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');

  try {
    const phases = await vscode.workspace.fs.readDirectory(phasesUri);
    let targetDir: vscode.Uri | undefined;

    for (const [name, type] of phases) {
      if (type === vscode.FileType.Directory && name.startsWith(phase)) {
        targetDir = vscode.Uri.joinPath(phasesUri, name);
        break;
      }
    }

    if (!targetDir) {
      // Try phaseDir as fallback
      targetDir = vscode.Uri.joinPath(phasesUri, phaseDir);
    }

    const issuesUri = vscode.Uri.joinPath(targetDir, issuesFileName);

    // Build file content
    let content = `# UAT Issues: Phase ${phase} Plan ${plan}\n\n`;
    content += `**Tested:** ${today}\n`;
    content += `**Source:** .planning/phases/${phaseDir}/${phase}-${plan.padStart(2, '0')}-SUMMARY.md\n`;
    content += `**Tester:** User via /verify-work\n\n`;
    content += `## Open Issues\n\n`;

    for (const issue of issues) {
      content += `### ${issue.id}: ${issue.feature}\n\n`;
      content += `**Discovered:** ${today}\n`;
      content += `**Phase/Plan:** ${phase}-${plan.padStart(2, '0')}\n`;
      content += `**Severity:** ${issue.severity}\n`;
      content += `**Feature:** ${issue.feature}\n`;
      content += `**Description:** ${issue.description}\n`;
      if (issue.expected) {
        content += `**Expected:** ${issue.expected}\n`;
      }
      if (issue.actual) {
        content += `**Actual:** ${issue.actual}\n`;
      }
      content += `\n`;
    }

    content += `## Resolved Issues\n\n`;
    content += `[None yet]\n\n`;
    content += `---\n\n`;
    content += `*Phase: ${phase}*\n`;
    content += `*Plan: ${plan}*\n`;
    content += `*Tested: ${today}*\n`;

    await vscode.workspace.fs.writeFile(issuesUri, Buffer.from(content, 'utf-8'));
    return issuesUri;

  } catch (err) {
    console.error('[Hopper] Failed to write issues file:', err);
    return undefined;
  }
}

/**
 * Show a non-blocking QuickPick that persists when clicking away
 * Returns the selected value or null if cancelled/dismissed
 */
async function showNonBlockingQuickPick<T extends { label: string; value: unknown }>(
  items: T[],
  options: { title: string; placeHolder: string }
): Promise<T | null> {
  return new Promise((resolve) => {
    const picker = vscode.window.createQuickPick<T>();
    picker.items = items;
    picker.title = options.title;
    picker.placeholder = options.placeHolder;
    picker.ignoreFocusOut = true; // Keep open when clicking elsewhere

    let resolved = false;

    picker.onDidAccept(() => {
      if (picker.selectedItems.length > 0 && !resolved) {
        resolved = true;
        const selected = picker.selectedItems[0];
        picker.dispose();
        resolve(selected);
      }
    });

    picker.onDidHide(() => {
      if (!resolved) {
        resolved = true;
        picker.dispose();
        resolve(null);
      }
    });

    picker.show();
  });
}

/**
 * Show a non-blocking input box that persists when clicking away
 * Returns the entered text or empty string if cancelled
 */
async function showNonBlockingInputBox(
  options: { title: string; prompt: string; placeHolder: string }
): Promise<string> {
  return new Promise((resolve) => {
    const inputBox = vscode.window.createInputBox();
    inputBox.title = options.title;
    inputBox.prompt = options.prompt;
    inputBox.placeholder = options.placeHolder;
    inputBox.ignoreFocusOut = true; // Keep open when clicking elsewhere

    let resolved = false;

    inputBox.onDidAccept(() => {
      if (!resolved) {
        resolved = true;
        const value = inputBox.value;
        inputBox.dispose();
        resolve(value);
      }
    });

    inputBox.onDidHide(() => {
      if (!resolved) {
        resolved = true;
        inputBox.dispose();
        resolve(''); // Return empty string on dismiss
      }
    });

    inputBox.show();
  });
}

/**
 * Run interactive test flow using non-blocking VSCode dialogs
 * Guides user through tests one-by-one with per-test reporting
 * Saves state after each test for resume capability
 */
async function runInteractiveTests(
  testItems: string[],
  planName: string,
  stream: vscode.ChatResponseStream,
  extensionContext: vscode.ExtensionContext,
  state: VerificationState,
  startIndex: number = 0
): Promise<{ results: TestResult[]; paused: boolean }> {
  // Start with any existing results from resumed state
  const results: TestResult[] = [...state.results];

  if (startIndex === 0) {
    stream.markdown('### Interactive Testing\n\n');
    stream.markdown('Follow the instructions below for each test, then select the result from the dialog.\n\n');
    stream.markdown('**Note:** The dialog stays open when you click away. You can resume testing with **/verify-work** if you need to pause.\n\n');
  } else {
    stream.markdown(`### Resuming Testing (from test ${startIndex + 1})\n\n`);
    stream.markdown(`**${startIndex} of ${testItems.length}** tests already completed.\n\n`);
  }

  for (let i = startIndex; i < testItems.length; i++) {
    const testItem = testItems[i];

    // Display test with clear formatting
    stream.markdown(`---\n\n`);
    stream.markdown(`### Test ${i + 1} of ${testItems.length}\n\n`);
    stream.markdown(`${testItem}\n\n`);

    // Show non-blocking QuickPick for test result
    const statusResult = await showNonBlockingQuickPick(
      [
        { label: '$(pass) Pass', description: 'Feature works as described', value: 'pass' as const },
        { label: '$(error) Fail', description: 'Feature does not work', value: 'fail' as const },
        { label: '$(warning) Partial', description: 'Works but has issues', value: 'partial' as const },
        { label: '$(debug-step-over) Skip', description: 'Cannot test right now', value: 'skip' as const }
      ],
      {
        title: `Test ${i + 1}/${testItems.length}: What is the result?`,
        placeHolder: 'Read the test instructions in the chat panel, then select result'
      }
    );

    if (!statusResult) {
      // User dismissed the picker (pressed Escape or clicked close)
      stream.markdown(`  - *Testing paused*\n\n`);
      stream.markdown('---\n\n');
      stream.markdown('**Testing paused.** You dismissed the dialog.\n\n');
      stream.markdown(`Progress: **${results.length}/${testItems.length}** tests completed.\n\n`);

      // Save state for resume
      state.currentIndex = i;
      state.results = results;
      state.pausedAt = new Date().toISOString();
      await saveVerificationState(extensionContext, state);

      stream.markdown('Run **/verify-work** to resume from where you left off.\n\n');
      return { results, paused: true };
    }

    const result: TestResult = {
      feature: testItem,
      status: statusResult.value
    };

    // If fail or partial, get more details
    if (statusResult.value === 'fail' || statusResult.value === 'partial') {
      // Get severity (with non-blocking picker)
      const severityResult = await showNonBlockingQuickPick(
        [
          { label: 'Blocker', description: 'Cannot use feature at all', value: 'blocker' as const },
          { label: 'Major', description: 'Feature works but significant problem', value: 'major' as const },
          { label: 'Minor', description: 'Small issue, feature still usable', value: 'minor' as const },
          { label: 'Cosmetic', description: 'Visual only, no functional impact', value: 'cosmetic' as const }
        ],
        {
          title: 'Issue Severity',
          placeHolder: 'How severe is this issue?'
        }
      );

      // Default to Major if cancelled
      result.severity = severityResult?.value || 'major';

      // Get description (with non-blocking input box)
      const description = await showNonBlockingInputBox({
        title: 'Issue Description',
        prompt: 'What went wrong?',
        placeHolder: 'Describe what happened vs what you expected'
      });

      if (description) {
        result.description = description;
      }
    }

    results.push(result);

    // Save state after each test result for resume capability
    state.currentIndex = i + 1;
    state.results = results;
    await saveVerificationState(extensionContext, state);

    // Show result in chat
    const statusEmoji = {
      pass: '✓',
      fail: '✗',
      partial: '⚠',
      skip: '⏭'
    }[result.status];

    stream.markdown(`  - ${statusEmoji} **${statusResult.label}**`);
    if (result.severity) {
      stream.markdown(` (${result.severity})`);
    }
    if (result.description) {
      stream.markdown(`: ${result.description}`);
    }
    stream.markdown('\n\n');
  }

  return { results, paused: false };
}

/**
 * Handle /verify-work command
 *
 * Guides manual user acceptance testing of recently built features.
 * Extracts deliverables from SUMMARY.md, generates test checklist,
 * guides user through each test interactively, logs issues to phase-scoped file.
 */
export async function handleVerifyWork(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, projectContext, extensionContext } = ctx;

  // Check if project exists
  if (!projectContext.hasPlanning || !projectContext.planningUri) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('No `.planning` directory found. Use **/new-project** to initialize.\n\n');
    stream.button({
      command: 'hopper.chat-participant.new-project',
      title: 'New Project'
    });
    return { metadata: { lastCommand: 'verify-work' } };
  }

  // Parse argument (optional phase or plan number)
  const arg = request.prompt.trim() || undefined;

  // Find SUMMARY.md files to test
  stream.progress('Finding summaries to test...');
  const summaries = await findSummaryFiles(projectContext.planningUri, arg);

  if (summaries.length === 0) {
    stream.markdown('## No Summaries Found\n\n');
    if (arg) {
      stream.markdown(`No SUMMARY.md files found matching: **${arg}**\n\n`);
    } else {
      stream.markdown('No SUMMARY.md files found in `.planning/phases/`.\n\n');
    }
    stream.markdown('Complete a plan with **/execute-plan** first, then run verification.\n\n');
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });
    return { metadata: { lastCommand: 'verify-work' } };
  }

  // Use the most recent summary
  const target = summaries[0];
  const summaryContent = await readFileContent(target.uri);

  if (!summaryContent) {
    stream.markdown('## Error Reading Summary\n\n');
    stream.markdown(`Could not read: ${target.uri.fsPath}\n\n`);
    return { metadata: { lastCommand: 'verify-work' } };
  }

  // Extract deliverables
  stream.progress('Extracting deliverables...');
  const deliverables = parseDeliverables(summaryContent);

  if (deliverables.accomplishments.length === 0) {
    stream.markdown('## No Testable Deliverables\n\n');
    stream.markdown('The SUMMARY.md does not have any accomplishments to test.\n\n');
    stream.reference(target.uri);
    return { metadata: { lastCommand: 'verify-work' } };
  }

  // Get phase directory name
  const pathParts = target.uri.fsPath.split('/');
  const phaseDir = pathParts[pathParts.length - 2];
  const planPath = target.uri.fsPath;

  // Check for existing verification state (for resume capability)
  const savedState = loadVerificationState(extensionContext, planPath);
  let startIndex = 0;
  let testItems: string[];
  let verificationState: VerificationState;

  if (savedState && savedState.currentIndex < savedState.testItems.length) {
    // Offer to resume
    const resumeChoice = await vscode.window.showQuickPick(
      [
        { label: '$(debug-continue) Resume', description: `Continue from test ${savedState.currentIndex + 1}`, value: 'resume' as const },
        { label: '$(refresh) Start Over', description: 'Clear progress and start fresh', value: 'restart' as const }
      ],
      {
        title: `Resume Verification? (${savedState.results.length}/${savedState.testItems.length} tests completed)`,
        placeHolder: 'Choose how to proceed'
      }
    );

    if (resumeChoice?.value === 'resume') {
      // Resume from saved state
      testItems = savedState.testItems;
      startIndex = savedState.currentIndex;
      verificationState = savedState;

      stream.markdown(`## Resuming Verification\n\n`);
      stream.markdown(`**Plan:** Phase ${target.phase} Plan ${target.plan}\n`);
      stream.markdown(`**Progress:** ${savedState.results.length} of ${savedState.testItems.length} tests completed\n\n`);
    } else {
      // Start fresh - clear state and regenerate
      await clearVerificationState(extensionContext, planPath);

      stream.progress('Generating test checklist...');
      const planName = `Phase ${target.phase} Plan ${target.plan}`;
      testItems = await generateTestChecklist(ctx, deliverables, planName);

      verificationState = {
        planPath,
        phase: target.phase,
        plan: target.plan,
        testItems,
        results: [],
        currentIndex: 0,
        startedAt: new Date().toISOString()
      };
      await saveVerificationState(extensionContext, verificationState);

      // Present the UAT overview
      stream.markdown(`## User Acceptance Testing\n\n`);
      stream.markdown(`**Plan:** ${planName}\n`);
      stream.markdown(`**Summary:** ${target.uri.fsPath.replace(projectContext.planningUri.fsPath, '.')}\n\n`);

      stream.markdown('### Deliverables to Test\n\n');
      for (const accomplishment of deliverables.accomplishments) {
        stream.markdown(`- ${accomplishment}\n`);
      }
      stream.markdown('\n');

      stream.markdown(`**${testItems.length} tests generated.** Starting interactive testing...\n\n`);
    }
  } else {
    // No saved state - start fresh
    stream.progress('Generating test checklist...');
    const planName = `Phase ${target.phase} Plan ${target.plan}`;
    testItems = await generateTestChecklist(ctx, deliverables, planName);

    verificationState = {
      planPath,
      phase: target.phase,
      plan: target.plan,
      testItems,
      results: [],
      currentIndex: 0,
      startedAt: new Date().toISOString()
    };
    await saveVerificationState(extensionContext, verificationState);

    // Present the UAT overview
    stream.markdown(`## User Acceptance Testing\n\n`);
    stream.markdown(`**Plan:** ${planName}\n`);
    stream.markdown(`**Summary:** ${target.uri.fsPath.replace(projectContext.planningUri.fsPath, '.')}\n\n`);

    stream.markdown('### Deliverables to Test\n\n');
    for (const accomplishment of deliverables.accomplishments) {
      stream.markdown(`- ${accomplishment}\n`);
    }
    stream.markdown('\n');

    stream.markdown(`**${testItems.length} tests generated.** Starting interactive testing...\n\n`);
  }

  const planName = `Phase ${target.phase} Plan ${target.plan}`;

  // Run interactive test flow with state persistence
  const { results, paused } = await runInteractiveTests(
    testItems,
    planName,
    stream,
    extensionContext,
    verificationState,
    startIndex
  );

  // If paused, return early (state already saved)
  if (paused) {
    return { metadata: { lastCommand: 'verify-work', paused: true } };
  }

  // Clear verification state since all tests completed
  await clearVerificationState(extensionContext, planPath);

  // Calculate summary
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const partial = results.filter(r => r.status === 'partial').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  // Display summary
  stream.markdown('---\n\n');
  stream.markdown('## Test Results Summary\n\n');
  stream.markdown(`| Status | Count |\n`);
  stream.markdown(`|--------|-------|\n`);
  stream.markdown(`| ✓ Passed | ${passed} |\n`);
  stream.markdown(`| ✗ Failed | ${failed} |\n`);
  stream.markdown(`| ⚠ Partial | ${partial} |\n`);
  stream.markdown(`| ⏭ Skipped | ${skipped} |\n\n`);

  // Collect issues (failed and partial)
  const issueResults = results.filter(r => r.status === 'fail' || r.status === 'partial');

  if (issueResults.length > 0) {
    // Convert to UATIssue format
    const issues: UATIssue[] = issueResults.map((r, idx) => ({
      id: `UAT-${String(idx + 1).padStart(3, '0')}`,
      feature: r.feature,
      severity: (r.severity ? r.severity.charAt(0).toUpperCase() + r.severity.slice(1) : 'Major') as UATIssue['severity'],
      description: r.description || `Test ${r.status}: ${r.feature}`
    }));

    // Write issues file
    const issuesUri = await writeIssuesFile(
      projectContext.planningUri,
      phaseDir,
      target.phase,
      target.plan,
      issues
    );

    if (issuesUri) {
      stream.markdown(`### Issues Logged\n\n`);
      stream.markdown(`**${issues.length} issue(s)** saved to: \`${target.phase}-${target.plan.padStart(2, '0')}-ISSUES.md\`\n\n`);

      for (const issue of issues) {
        stream.markdown(`- **${issue.id}** (${issue.severity}): ${issue.feature}\n`);
      }
      stream.markdown('\n');

      stream.reference(issuesUri);
    }

    // Determine verdict
    const blockers = issues.filter(i => i.severity === 'Blocker').length;
    const majors = issues.filter(i => i.severity === 'Major').length;

    stream.markdown('### Verdict\n\n');
    if (blockers > 0) {
      stream.markdown(`**BLOCKERS FOUND** — ${blockers} blocking issue(s) must be fixed before continuing.\n\n`);
    } else if (majors > 0) {
      stream.markdown(`**MAJOR ISSUES** — ${majors} significant issue(s) found. Review before proceeding.\n\n`);
    } else {
      stream.markdown(`**MINOR ISSUES** — Feature works with minor issues logged.\n\n`);
    }

    // Offer next steps
    stream.markdown('### Next Steps\n\n');
    stream.markdown('Use **/plan-fix** to create a fix plan for logged issues:\n\n');
    stream.button({
      command: 'hopper.chat-participant.plan-fix',
      arguments: [`${target.phase}-${target.plan.padStart(2, '0')}`],
      title: `Plan Fixes for ${target.phase}-${target.plan}`
    });
  } else if (passed === results.length) {
    stream.markdown('### Verdict\n\n');
    stream.markdown('**ALL TESTS PASSED** — Feature validated!\n\n');

    stream.markdown('### Next Steps\n\n');
    stream.markdown('Ready to continue to the next phase:\n\n');
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });
  } else {
    stream.markdown('### Verdict\n\n');
    stream.markdown(`**TESTING INCOMPLETE** — ${skipped} test(s) were skipped.\n\n`);

    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });
  }

  stream.markdown('\n');
  stream.reference(target.uri);

  // Update STATE.md with verification results
  if (projectContext.planningUri) {
    try {
      const planRef = `${target.phase}-${target.plan.padStart(2, '0')}`;
      await updateStateAfterVerification(
        projectContext.planningUri,
        planRef,
        passed,
        failed,
        partial,
        skipped
      );
    } catch (stateErr) {
      console.error('[Hopper] Failed to update STATE.md after verification:', stateErr);
      // Don't fail the verification, just log the error
    }
  }

  return {
    metadata: {
      lastCommand: 'verify-work',
      phase: `${target.phase}-${target.plan}`,
      testResults: { passed, failed, partial, skipped }
    }
  };
}

/**
 * Handle result reporting from verify-work
 * Called via button command hopper.verifyWorkResult
 */
export async function handleVerifyWorkResult(
  extensionContext: vscode.ExtensionContext,
  planningUri: vscode.Uri,
  phase: string,
  plan: string,
  phaseDir: string,
  result: 'all-pass' | 'has-issues',
  issues?: UATIssue[]
): Promise<{ success: boolean; issuesFile?: vscode.Uri; message: string }> {
  if (result === 'all-pass') {
    return {
      success: true,
      message: `All tests passed for Phase ${phase} Plan ${plan}. Feature validated.`
    };
  }

  // Write issues to file
  if (issues && issues.length > 0) {
    const issuesUri = await writeIssuesFile(planningUri, phaseDir, phase, plan, issues);

    if (issuesUri) {
      return {
        success: true,
        issuesFile: issuesUri,
        message: `${issues.length} issue(s) logged to ${phase}-${plan.padStart(2, '0')}-ISSUES.md`
      };
    }
  }

  return {
    success: false,
    message: 'Failed to record test results'
  };
}
