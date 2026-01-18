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
  /** True when buttons shown, awaiting click */
  waitingForResult?: boolean;
  /** True when awaiting severity for fail/partial */
  pendingSeverity?: boolean;
  /** Stores result status while awaiting severity */
  pendingStatus?: 'fail' | 'partial';
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
 * Uses a sanitized key to ensure it persists across restarts
 */
function getVerificationStateKey(planPath: string): string {
  // Create clean key from plan path - extract phase-plan identifier
  const match = planPath.match(/(\d+(?:\.\d+)?)-(\d+)-SUMMARY\.md$/);
  if (match) {
    return `hopper.verificationState.${match[1]}-${match[2]}`;
  }
  // Fallback: hash the path to create a short, valid key
  const hash = planPath.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0);
  return `hopper.verificationState.${Math.abs(hash)}`;
}

/**
 * Save verification state to extension globalState
 * Marks keys for sync to ensure persistence across VSCode restarts
 */
async function saveVerificationState(
  context: vscode.ExtensionContext,
  state: VerificationState
): Promise<void> {
  const key = getVerificationStateKey(state.planPath);
  await context.globalState.update(key, state);
  // Mark key for sync to survive restarts
  context.globalState.setKeysForSync([key]);
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
 * Display a single test with buttons for result selection
 * Uses stream.button() which allows user to type in chat between button clicks
 */
function displayTestWithButtons(
  stream: vscode.ChatResponseStream,
  testItem: string,
  testIndex: number,
  totalTests: number,
  planPath: string
): void {
  stream.markdown(`---\n\n`);
  stream.markdown(`### Test ${testIndex + 1} of ${totalTests}\n\n`);
  stream.markdown(`${testItem}\n\n`);
  stream.markdown('**What is the result?**\n\n');

  // Show buttons for each result option
  stream.button({
    command: 'hopper.verifyWorkTestResult',
    arguments: [planPath, testIndex, 'pass'],
    title: '✓ Pass'
  });
  stream.markdown(' ');
  stream.button({
    command: 'hopper.verifyWorkTestResult',
    arguments: [planPath, testIndex, 'fail'],
    title: '✗ Fail'
  });
  stream.markdown(' ');
  stream.button({
    command: 'hopper.verifyWorkTestResult',
    arguments: [planPath, testIndex, 'partial'],
    title: '⚠ Partial'
  });
  stream.markdown(' ');
  stream.button({
    command: 'hopper.verifyWorkTestResult',
    arguments: [planPath, testIndex, 'skip'],
    title: '⏭ Skip'
  });
  stream.markdown('\n\n');
  stream.markdown('*You can type questions in the chat before clicking a button.*\n\n');
}

/**
 * Display severity selection buttons for fail/partial results
 */
function displaySeverityButtons(
  stream: vscode.ChatResponseStream,
  planPath: string
): void {
  stream.markdown('**How severe is this issue?**\n\n');

  stream.button({
    command: 'hopper.verifyWorkSeverity',
    arguments: [planPath, 'blocker'],
    title: 'Blocker'
  });
  stream.markdown(' ');
  stream.button({
    command: 'hopper.verifyWorkSeverity',
    arguments: [planPath, 'major'],
    title: 'Major'
  });
  stream.markdown(' ');
  stream.button({
    command: 'hopper.verifyWorkSeverity',
    arguments: [planPath, 'minor'],
    title: 'Minor'
  });
  stream.markdown(' ');
  stream.button({
    command: 'hopper.verifyWorkSeverity',
    arguments: [planPath, 'cosmetic'],
    title: 'Cosmetic'
  });
  stream.markdown('\n\n');
}

/**
 * Get default description based on severity level
 */
function getDefaultDescription(severity: 'blocker' | 'major' | 'minor' | 'cosmetic'): string {
  const descriptions: Record<typeof severity, string> = {
    blocker: 'Feature completely unusable',
    major: 'Feature works but significant problem',
    minor: 'Small issue, feature still usable',
    cosmetic: 'Visual issue only'
  };
  return descriptions[severity];
}

/**
 * Display test results summary and handle completion
 */
async function displayTestSummary(
  stream: vscode.ChatResponseStream,
  results: TestResult[],
  planningUri: vscode.Uri,
  phaseDir: string,
  target: { phase: string; plan: string; uri: vscode.Uri }
): Promise<void> {
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
      planningUri,
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
  try {
    const planRef = `${target.phase}-${target.plan.padStart(2, '0')}`;
    await updateStateAfterVerification(
      planningUri,
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

/**
 * Handle /verify-work command
 *
 * Guides manual user acceptance testing of recently built features.
 * Uses button-based flow that allows typing in chat between tests.
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
  let testItems: string[];
  let verificationState: VerificationState;

  // If we have saved state that is waiting for a severity selection, display severity buttons
  if (savedState && savedState.pendingSeverity && savedState.pendingStatus) {
    stream.markdown(`## Select Severity\n\n`);
    stream.markdown(`**Plan:** Phase ${target.phase} Plan ${target.plan}\n`);
    stream.markdown(`**Test ${savedState.currentIndex + 1}:** marked as **${savedState.pendingStatus}**\n\n`);
    displaySeverityButtons(stream, planPath);
    return { metadata: { lastCommand: 'verify-work', waitingForSeverity: true } };
  }

  // If we have saved state and all tests are complete, show summary
  if (savedState && savedState.currentIndex >= savedState.testItems.length && !savedState.waitingForResult) {
    await clearVerificationState(extensionContext, planPath);
    await displayTestSummary(stream, savedState.results, projectContext.planningUri, phaseDir, target);
    return {
      metadata: {
        lastCommand: 'verify-work',
        phase: `${target.phase}-${target.plan}`,
        testResults: {
          passed: savedState.results.filter(r => r.status === 'pass').length,
          failed: savedState.results.filter(r => r.status === 'fail').length,
          partial: savedState.results.filter(r => r.status === 'partial').length,
          skipped: savedState.results.filter(r => r.status === 'skip').length
        }
      }
    };
  }

  // Check if we have existing state with completed tests
  if (savedState && savedState.currentIndex > 0 && savedState.currentIndex < savedState.testItems.length) {
    // Show progress and continue from where we left off
    testItems = savedState.testItems;
    verificationState = savedState;

    stream.markdown(`## Continuing Verification\n\n`);
    stream.markdown(`**Plan:** Phase ${target.phase} Plan ${target.plan}\n`);
    stream.markdown(`**Progress:** ${savedState.results.length} of ${savedState.testItems.length} tests completed\n\n`);

    // Show completed results
    if (savedState.results.length > 0) {
      stream.markdown('### Completed Tests\n\n');
      for (let i = 0; i < savedState.results.length; i++) {
        const r = savedState.results[i];
        const emoji = { pass: '✓', fail: '✗', partial: '⚠', skip: '⏭' }[r.status];
        stream.markdown(`${emoji} Test ${i + 1}: **${r.status}**${r.severity ? ` (${r.severity})` : ''}\n`);
      }
      stream.markdown('\n');
    }

    // Display current test with buttons
    displayTestWithButtons(
      stream,
      testItems[savedState.currentIndex],
      savedState.currentIndex,
      testItems.length,
      planPath
    );

    // Mark as waiting for result
    verificationState.waitingForResult = true;
    await saveVerificationState(extensionContext, verificationState);

    return { metadata: { lastCommand: 'verify-work', waitingForResult: true } };
  }

  // Start fresh - generate test checklist
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
    startedAt: new Date().toISOString(),
    waitingForResult: true
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

  stream.markdown(`**${testItems.length} tests generated.**\n\n`);
  stream.markdown('### Interactive Testing\n\n');
  stream.markdown('Click the buttons below to record your test results.\n');
  stream.markdown('**You can type questions in the chat anytime** - the buttons will still work.\n\n');

  // Display first test with buttons
  displayTestWithButtons(stream, testItems[0], 0, testItems.length, planPath);

  return { metadata: { lastCommand: 'verify-work', waitingForResult: true } };
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

/**
 * Handle test result button click from verify-work UI
 * Called when user clicks Pass/Fail/Partial/Skip buttons
 */
export async function handleTestResultButton(
  extensionContext: vscode.ExtensionContext,
  planPath: string,
  testIndex: number,
  result: 'pass' | 'fail' | 'partial' | 'skip'
): Promise<{ needsSeverity: boolean; completed: boolean; message: string }> {
  // Load current state
  const state = loadVerificationState(extensionContext, planPath);

  if (!state) {
    return { needsSeverity: false, completed: false, message: 'No verification state found. Run /verify-work to start.' };
  }

  // For pass or skip, record result immediately
  if (result === 'pass' || result === 'skip') {
    const testResult: TestResult = {
      feature: state.testItems[testIndex],
      status: result
    };
    state.results.push(testResult);
    state.currentIndex = testIndex + 1;
    state.waitingForResult = false;
    await saveVerificationState(extensionContext, state);

    if (state.currentIndex >= state.testItems.length) {
      return { needsSeverity: false, completed: true, message: `Test ${testIndex + 1} marked as ${result}. All tests complete!` };
    }
    return { needsSeverity: false, completed: false, message: `Test ${testIndex + 1} marked as ${result}. Continue with next test.` };
  }

  // For fail or partial, need to get severity first
  state.pendingStatus = result;
  state.pendingSeverity = true;
  state.waitingForResult = false;
  await saveVerificationState(extensionContext, state);

  return { needsSeverity: true, completed: false, message: `Test ${testIndex + 1} marked as ${result}. Select severity.` };
}

/**
 * Handle severity button click from verify-work UI
 * Called when user clicks Blocker/Major/Minor/Cosmetic buttons after fail/partial
 */
export async function handleSeverityButton(
  extensionContext: vscode.ExtensionContext,
  planPath: string,
  severity: 'blocker' | 'major' | 'minor' | 'cosmetic'
): Promise<{ completed: boolean; message: string }> {
  // Load current state
  const state = loadVerificationState(extensionContext, planPath);

  if (!state || !state.pendingStatus) {
    return { completed: false, message: 'No pending test result. Run /verify-work to continue.' };
  }

  // Record the result with severity and default description
  const testResult: TestResult = {
    feature: state.testItems[state.currentIndex],
    status: state.pendingStatus,
    severity,
    description: getDefaultDescription(severity)
  };
  state.results.push(testResult);
  state.currentIndex = state.currentIndex + 1;
  state.pendingStatus = undefined;
  state.pendingSeverity = false;
  state.waitingForResult = false;
  await saveVerificationState(extensionContext, state);

  if (state.currentIndex >= state.testItems.length) {
    return { completed: true, message: `Issue recorded as ${severity}. All tests complete!` };
  }
  return { completed: false, message: `Issue recorded as ${severity}. Continue with next test.` };
}
