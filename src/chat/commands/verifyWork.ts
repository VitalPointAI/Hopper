import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import { truncateContent } from '../context/projectContext';

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

  const prompt = `Generate a manual user acceptance test checklist for the following deliverables.

## Deliverables
**Plan:** ${planName}
**Accomplishments:**
${deliverables.accomplishments.map(a => `- ${a}`).join('\n')}

**Files changed:**
${deliverables.files.slice(0, 10).map(f => `- ${f}`).join('\n')}

## Instructions
Create 3-8 testable items that a USER can manually verify. Focus on:
1. User-observable behaviors (what they can see/click/interact with)
2. Expected outcomes (what should happen)
3. Edge cases relevant to the features

Respond with a JSON array of test descriptions. Each should be a single, actionable test.

Example format:
["Check that login button appears on home page", "Verify form validation shows error for empty email"]

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
 * Handle /verify-work command
 *
 * Guides manual user acceptance testing of recently built features.
 * Extracts deliverables from SUMMARY.md, generates test checklist,
 * guides user through each test, logs issues to phase-scoped file.
 */
export async function handleVerifyWork(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, projectContext } = ctx;

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

  // Generate test checklist
  stream.progress('Generating test checklist...');
  const planName = `Phase ${target.phase} Plan ${target.plan}`;
  const testItems = await generateTestChecklist(ctx, deliverables, planName);

  // Present the UAT overview
  stream.markdown(`## User Acceptance Testing\n\n`);
  stream.markdown(`**Plan:** ${planName}\n`);
  stream.markdown(`**Summary:** ${target.uri.fsPath.replace(projectContext.planningUri.fsPath, '.')}\n\n`);

  stream.markdown('### Deliverables to Test\n\n');
  for (const accomplishment of deliverables.accomplishments) {
    stream.markdown(`- ${accomplishment}\n`);
  }
  stream.markdown('\n');

  stream.markdown('### Test Checklist\n\n');
  stream.markdown('Please manually verify each item and report results:\n\n');

  for (let i = 0; i < testItems.length; i++) {
    stream.markdown(`${i + 1}. ${testItems[i]}\n`);
  }
  stream.markdown('\n');

  // Create buttons for test results
  stream.markdown('---\n\n');
  stream.markdown('### Report Results\n\n');
  stream.markdown('After testing each item:\n\n');

  stream.button({
    command: 'hopper.verifyWorkResult',
    arguments: [target.phase, target.plan, phaseDir, 'all-pass'],
    title: 'All Tests Pass'
  });

  stream.markdown(' ');

  stream.button({
    command: 'hopper.verifyWorkResult',
    arguments: [target.phase, target.plan, phaseDir, 'has-issues'],
    title: 'Report Issues'
  });

  stream.markdown('\n\n');

  stream.markdown('**Tips:**\n');
  stream.markdown('- Test in a fresh environment if possible\n');
  stream.markdown('- Try edge cases (empty inputs, long text, etc.)\n');
  stream.markdown('- Check both happy path and error handling\n\n');

  stream.reference(target.uri);

  return {
    metadata: {
      lastCommand: 'verify-work',
      phase: `${target.phase}-${target.plan}`
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
