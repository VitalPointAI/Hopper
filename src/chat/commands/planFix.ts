import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import { stageFiles, commit, checkGitRepo } from '../executor';

/**
 * Parsed UAT issue from ISSUES.md
 */
interface UATIssue {
  id: string;
  title: string;
  severity: string;
  description: string;
  expected?: string;
  actual?: string;
  feature?: string;
  /** Full error output from ISSUES.md (for execution failures) */
  fullOutput?: string;
  /** Files involved in the failure */
  affectedFiles?: string[];
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
 * Parse issues from an ISSUES.md file.
 * Handles both UAT issues (UAT-XXX format from verify-work) and
 * execution issues (EXE-XX-YY-NN format from execute-plan failures).
 */
function parseIssues(content: string): UATIssue[] {
  const issues: UATIssue[] = [];

  // Find the Open Issues section
  const openSection = content.match(/## Open Issues\s*([\s\S]*?)(?=## Resolved Issues|$)/i);
  if (!openSection) {
    return issues;
  }

  const openContent = openSection[1];

  // Match individual issue blocks starting with ### UAT-XXX or ### EXE-XX-YY-NN
  // UAT format: UAT-001, UAT-002, etc.
  // EXE format: EXE-02-01-01, EXE-09-02-FIX-01, etc.
  const issuePattern = /### ((?:UAT|EXE)-[\d-]+(?:-FIX)*(?:-\d+)?):\s*([^\n]+)([\s\S]*?)(?=### (?:UAT|EXE)-[\d-]+(?:-FIX)*(?:-\d+)?:|$)/g;
  let match;

  while ((match = issuePattern.exec(openContent)) !== null) {
    const id = match[1];
    const title = match[2].trim();
    const body = match[3];

    // Parse fields from body - handle both UAT and EXE formats
    // UAT uses: Severity, Description, Expected, Actual, Feature
    // EXE uses: Type, Impact, Description, Affected Files, Full Error Output
    const severityMatch = body.match(/\*\*Severity:\*\*\s*([^\n]+)/);
    const typeMatch = body.match(/\*\*Type:\*\*\s*([^\n]+)/);
    const impactMatch = body.match(/\*\*Impact:\*\*\s*([^\n]+)/);
    const descMatch = body.match(/\*\*Description:\*\*\s*([^\n]+)/);
    const expectedMatch = body.match(/\*\*Expected:\*\*\s*([^\n]+)/);
    const actualMatch = body.match(/\*\*Actual:\*\*\s*([^\n]+)/);
    const featureMatch = body.match(/\*\*Feature:\*\*\s*([^\n]+)/);
    const affectedFilesMatch = body.match(/\*\*Affected Files:\*\*\s*([^\n]+)/);

    // Extract Full Error Output code block
    const fullOutputMatch = body.match(/\*\*Full Error Output:\*\*\s*```[\s\S]*?```/);
    let fullOutput: string | undefined;
    if (fullOutputMatch) {
      // Extract content between ``` markers
      const codeBlockMatch = fullOutputMatch[0].match(/```\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        fullOutput = codeBlockMatch[1].trim();
      }
    }

    // Parse affected files into array
    let affectedFiles: string[] | undefined;
    if (affectedFilesMatch) {
      affectedFiles = affectedFilesMatch[1].trim().split(',').map(f => f.trim()).filter(Boolean);
    }

    // Determine severity: prefer Severity field, fallback to Impact/Type mapping
    let severity = 'Unknown';
    if (severityMatch) {
      severity = severityMatch[1].trim();
    } else if (impactMatch) {
      // Map Impact field to severity
      const impact = impactMatch[1].trim().toLowerCase();
      if (impact.includes('blocking') || impact.includes('blocker')) {
        severity = 'Blocker';
      } else if (impact.includes('major')) {
        severity = 'Major';
      } else if (impact.includes('minor')) {
        severity = 'Minor';
      } else {
        severity = 'Major'; // Default for execution failures
      }
    } else if (typeMatch) {
      // Map Type field to severity (execution failures are typically Major)
      severity = 'Major';
    }

    issues.push({
      id,
      title,
      severity,
      description: descMatch ? descMatch[1].trim() : title,
      expected: expectedMatch ? expectedMatch[1].trim() : undefined,
      actual: actualMatch ? actualMatch[1].trim() : undefined,
      feature: featureMatch ? featureMatch[1].trim() : undefined,
      fullOutput,
      affectedFiles
    });
  }

  return issues;
}

/**
 * Find ISSUES.md file for a plan
 * Handles both regular plans (e.g., "04-02") and FIX plans (e.g., "09-02-FIX-FIX")
 */
async function findIssuesFile(
  planningUri: vscode.Uri,
  planArg: string
): Promise<{ uri: vscode.Uri; phase: string; plan: string; phaseDir: string } | null> {
  // Parse plan argument - capture phase and full plan name (including FIX suffixes)
  // Examples: "04-02", "05.1-03", "09-02-FIX", "09-02-FIX-FIX"
  const planMatch = planArg.match(/^(\d+(?:\.\d+)?)-(.+)$/);
  if (!planMatch) {
    return null;
  }

  const phase = planMatch[1];
  const plan = planMatch[2]; // Full plan name including FIX suffixes

  try {
    // Search for matching ISSUES.md in phases
    const phasesUri = vscode.Uri.joinPath(planningUri, 'phases');
    const phases = await vscode.workspace.fs.readDirectory(phasesUri);

    for (const [phaseName, type] of phases) {
      if (type !== vscode.FileType.Directory) continue;

      // Check if phase directory matches
      const phaseNum = phaseName.match(/^(\d+(?:\.\d+)?)/)?.[1];
      if (phaseNum !== phase && !phaseNum?.startsWith(phase + '.')) continue;

      const phaseDir = vscode.Uri.joinPath(phasesUri, phaseName);
      const files = await vscode.workspace.fs.readDirectory(phaseDir);

      // Build expected ISSUES.md filename
      // For "02-FIX-FIX" -> "09-02-FIX-FIX-ISSUES.md"
      // For "02" -> "09-02-ISSUES.md"
      const issuesFileName = `${phase}-${plan}-ISSUES.md`;

      for (const [fileName] of files) {
        // Direct match is preferred
        if (fileName === issuesFileName) {
          return {
            uri: vscode.Uri.joinPath(phaseDir, fileName),
            phase,
            plan,
            phaseDir: phaseName
          };
        }
      }

      // Also check for padded numeric plan (backwards compatibility for "02" -> "09-02-ISSUES.md")
      if (!plan.includes('-')) {
        const paddedIssuesFileName = `${phase}-${plan.padStart(2, '0')}-ISSUES.md`;
        for (const [fileName] of files) {
          if (fileName === paddedIssuesFileName) {
            return {
              uri: vscode.Uri.joinPath(phaseDir, fileName),
              phase,
              plan: plan.padStart(2, '0'),
              phaseDir: phaseName
            };
          }
        }
      }
    }
  } catch {
    // Phases directory doesn't exist
  }

  return null;
}

/**
 * Truncate error output for LLM prompt (keep it concise but useful)
 * Default 800 chars gives room for file paths while staying manageable
 */
function truncateForPrompt(output: string, maxLength: number = 800): string {
  if (output.length <= maxLength) {
    return output;
  }
  return output.slice(0, maxLength) + '\n...[truncated]';
}

/**
 * Generate fix tasks using LLM
 */
async function generateFixTasks(
  ctx: CommandContext,
  issues: UATIssue[],
  phase: string,
  plan: string
): Promise<string> {
  const { token } = ctx;

  // Get available LLM models
  const models = await vscode.lm.selectChatModels();
  if (models.length === 0) {
    // Fallback: generate basic tasks
    return generateBasicFixTasks(issues);
  }

  const model = models[0];

  const issuesText = issues.map(issue => {
    let text = `
### ${issue.id}: ${issue.title}
- Severity: ${issue.severity}
- Description: ${issue.description}`;

    if (issue.expected) {
      text += `\n- Expected: ${issue.expected}`;
    }
    if (issue.actual) {
      text += `\n- Actual: ${issue.actual}`;
    }
    if (issue.affectedFiles && issue.affectedFiles.length > 0) {
      text += `\n- Affected Files: ${issue.affectedFiles.join(', ')}`;
    }
    if (issue.fullOutput) {
      text += `\n- Error Output:\n\`\`\`\n${truncateForPrompt(issue.fullOutput)}\n\`\`\``;
    }

    return text;
  }).join('\n');

  const prompt = `Generate fix tasks for the following UAT issues.

## Issues to Fix
${issuesText}

## Instructions
Create XML task elements for each issue that needs fixing. Group related minor issues if appropriate.
Use this exact format for each task:

<task type="auto">
  <name>Fix UAT-XXX: [brief description]</name>
  <files>[affected files, if known]</files>
  <action>
[MUST contain specific, executable instructions - NOT just the error message]
  </action>
  <verify>[How to verify the fix works]</verify>
  <done>[Issue acceptance criteria met]</done>
</task>

## CRITICAL: Action Content Requirements

The <action> tag MUST contain SPECIFIC, EXECUTABLE INSTRUCTIONS. Analyze the issue details and generate actual implementation steps.

**BAD (just echoes the error):**
<action>Fix the issue: Task failed: Verify step failed</action>
<action>Fix the issue: Expected behavior not working</action>

**GOOD (actionable instructions):**
<action>
1. Open the source file mentioned in the error
2. Locate the failing function/component
3. Fix the root cause:
   - If Expected/Actual fields provided: implement the expected behavior
   - If error message provided: fix the underlying bug
4. Add/update tests to cover this case
5. Run verification to confirm the fix
</action>

<action>
1. Read the original PLAN.md to understand what was attempted
2. Investigate why the verify step failed (check output, errors, missing dependencies)
3. Identify the specific code that needs to change
4. Implement the fix in the affected files
5. Re-run the verify step to confirm success
</action>

Use the Issue's Expected/Actual/Description fields to determine WHAT specifically needs to change.

Prioritize: Blocker → Major → Minor → Cosmetic

Output ONLY the task XML elements, no other text.`;

  try {
    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response = await model.sendRequest(messages, {}, token);

    let responseText = '';
    for await (const chunk of response.text) {
      responseText += chunk;
    }

    // Extract task elements
    const taskMatches = responseText.match(/<task[\s\S]*?<\/task>/g);
    if (taskMatches && taskMatches.length > 0) {
      return taskMatches.join('\n\n');
    }
  } catch {
    // LLM call failed
  }

  // Fallback
  return generateBasicFixTasks(issues);
}

/**
 * Detect error type from output for targeted fix guidance
 */
function detectErrorType(output: string): 'test' | 'typescript' | 'build' | 'runtime' | 'unknown' {
  const lowerOutput = output.toLowerCase();
  if (lowerOutput.includes('test failed') || lowerOutput.includes('expect(') || lowerOutput.includes('assertion')) {
    return 'test';
  }
  if (lowerOutput.includes('error ts') || lowerOutput.includes('typescript')) {
    return 'typescript';
  }
  if (lowerOutput.includes('build failed') || lowerOutput.includes('compilation')) {
    return 'build';
  }
  if (lowerOutput.includes('typeerror') || lowerOutput.includes('referenceerror') || lowerOutput.includes('syntaxerror')) {
    return 'runtime';
  }
  return 'unknown';
}

/**
 * Generate basic fix tasks without LLM
 * Creates actionable guidance based on issue fields
 */
function generateBasicFixTasks(issues: UATIssue[]): string {
  // Sort by severity
  const severityOrder: Record<string, number> = {
    'Blocker': 0,
    'Major': 1,
    'Minor': 2,
    'Cosmetic': 3
  };

  const sorted = [...issues].sort((a, b) => {
    const aOrder = severityOrder[a.severity] ?? 4;
    const bOrder = severityOrder[b.severity] ?? 4;
    return aOrder - bOrder;
  });

  return sorted.map(issue => {
    // Build actionable steps based on available fields
    const steps: string[] = [];

    // Determine files to target
    const targetFiles = issue.affectedFiles && issue.affectedFiles.length > 0
      ? issue.affectedFiles.join(', ')
      : 'the affected source files';

    // Build error context section if we have fullOutput
    let errorContext = '';
    if (issue.fullOutput) {
      const errorType = detectErrorType(issue.fullOutput);
      const truncatedError = truncateForPrompt(issue.fullOutput, 500);

      errorContext = `
**Error output:**
\`\`\`
${truncatedError}
\`\`\`

`;

      // Add error-type specific guidance
      switch (errorType) {
        case 'test':
          steps.push('1. Review the test output above for the specific failing assertions');
          steps.push('2. Open the test file and the source file being tested');
          steps.push('3. Fix the implementation to match expected behavior, OR update test expectations if they were wrong');
          break;
        case 'typescript':
          steps.push('1. Review the TypeScript errors shown above');
          steps.push(`2. Open ${targetFiles} and fix the type errors`);
          steps.push('3. Run npm run compile to verify all errors are fixed');
          break;
        case 'build':
          steps.push('1. Review the build errors shown above');
          steps.push('2. Resolve compilation/build configuration issues');
          steps.push('3. Verify the build passes with npm run compile');
          break;
        case 'runtime':
          steps.push('1. Review the runtime error and stack trace above');
          steps.push(`2. Open ${targetFiles} and locate the error source`);
          steps.push('3. Add null checks, fix type mismatches, or correct logic errors');
          break;
        default:
          steps.push(`1. Review the error output above to identify the root cause`);
          steps.push(`2. Open ${targetFiles}`);
          steps.push('3. Fix the underlying issue based on the error message');
      }
    } else {
      // No error output - use generic guidance
      if (issue.feature) {
        steps.push(`1. Investigate the ${issue.feature} functionality`);
      } else {
        steps.push(`1. Read the related PLAN.md to understand what was attempted`);
      }

      if (issue.actual && issue.expected) {
        steps.push(`2. The issue: Currently "${issue.actual}" but should "${issue.expected}"`);
      } else if (issue.description) {
        steps.push(`2. Identify the root cause: ${issue.description}`);
      }

      if (issue.expected) {
        steps.push(`3. Implement the fix to achieve: ${issue.expected}`);
      } else {
        steps.push(`3. Fix the underlying code to resolve the issue`);
      }
    }

    // Step N: Verification
    steps.push(`${steps.length + 1}. Test your fix by verifying the expected behavior works`);

    // Build verify instruction based on available fields
    let verifyInstruction = 'Test that the issue is resolved';
    if (issue.expected) {
      verifyInstruction = `Verify that: ${issue.expected}`;
    } else if (issue.feature) {
      verifyInstruction = `Test the ${issue.feature} functionality works correctly`;
    } else if (issue.fullOutput) {
      verifyInstruction = 'Re-run the original command/test - it should now pass';
    }

    // Build files section if we have affected files
    const filesSection = issue.affectedFiles && issue.affectedFiles.length > 0
      ? `\n  <files>${issue.affectedFiles.join(', ')}</files>`
      : '';

    return `<task type="auto">
  <name>Fix ${issue.id}: ${issue.title}</name>${filesSection}
  <action>
${errorContext}${steps.join('\n')}

IMPORTANT: After fixing, stage ONLY the specific files you modified using 'git add <filename>' for each file.
Do NOT use 'git add .' or stage files you didn't change.
  </action>
  <verify>${verifyInstruction}</verify>
  <done>${issue.id} acceptance criteria met - ${issue.expected || 'issue resolved'}</done>
</task>`;
  }).join('\n\n');
}

/**
 * Handle /plan-fix command
 *
 * Creates a FIX.md plan from UAT issues found during verify-work.
 */
export async function handlePlanFix(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, projectContext } = ctx;

  // Check if project exists
  if (!projectContext.hasPlanning || !projectContext.planningUri) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('No `.planning` directory found. Use **/new-project** to initialize.\n\n');
    stream.button({
      command: 'hopper.chat-participant.new-project',
      title: 'New Project'
    });
    return { metadata: { lastCommand: 'plan-fix' } };
  }

  // Parse plan argument (required)
  const planArg = request.prompt.trim();
  if (!planArg) {
    stream.markdown('## Plan Number Required\n\n');
    stream.markdown('**Usage:** `/plan-fix 04-02`\n\n');
    stream.markdown('This creates a fix plan from `.planning/phases/XX-name/04-02-ISSUES.md`\n\n');
    stream.markdown('ISSUES.md files are created by **/verify-work** when UAT finds issues.\n');
    return { metadata: { lastCommand: 'plan-fix' } };
  }

  // Find the ISSUES.md file
  stream.progress('Finding issues file...');
  const issuesInfo = await findIssuesFile(projectContext.planningUri, planArg);

  if (!issuesInfo) {
    stream.markdown('## No Issues File Found\n\n');
    stream.markdown(`No ISSUES.md found for plan **${planArg}**.\n\n`);
    stream.markdown('ISSUES.md files are created by **/verify-work** when UAT finds issues.\n');
    stream.markdown('If no issues were found during testing, no fix plan is needed.\n\n');
    stream.button({
      command: 'hopper.chat-participant.verify-work',
      title: 'Run Verify Work'
    });
    return { metadata: { lastCommand: 'plan-fix' } };
  }

  // Read and parse issues
  stream.progress('Reading issues...');
  const issuesContent = await readFileContent(issuesInfo.uri);

  if (!issuesContent) {
    stream.markdown('## Error Reading Issues\n\n');
    stream.markdown(`Could not read: ${issuesInfo.uri.fsPath}\n\n`);
    return { metadata: { lastCommand: 'plan-fix' } };
  }

  const issues = parseIssues(issuesContent);

  if (issues.length === 0) {
    stream.markdown('## No Open Issues\n\n');
    stream.markdown('The ISSUES.md file has no open issues to fix.\n\n');
    stream.markdown('All issues may have been moved to "Resolved Issues" section.\n\n');
    stream.reference(issuesInfo.uri);
    return { metadata: { lastCommand: 'plan-fix' } };
  }

  // Count by severity
  const counts: Record<string, number> = { Blocker: 0, Major: 0, Minor: 0, Cosmetic: 0 };
  for (const issue of issues) {
    if (counts[issue.severity] !== undefined) {
      counts[issue.severity]++;
    }
  }

  stream.markdown(`## Creating Fix Plan\n\n`);
  stream.markdown(`**Plan:** ${planArg}\n`);
  stream.markdown(`**Issues:** ${issues.length}\n\n`);

  stream.markdown('| Severity | Count |\n');
  stream.markdown('|----------|-------|\n');
  stream.markdown(`| Blocker | ${counts.Blocker} |\n`);
  stream.markdown(`| Major | ${counts.Major} |\n`);
  stream.markdown(`| Minor | ${counts.Minor} |\n`);
  stream.markdown(`| Cosmetic | ${counts.Cosmetic} |\n\n`);

  // Generate fix tasks
  stream.progress('Generating fix tasks...');
  const fixTasks = await generateFixTasks(ctx, issues, issuesInfo.phase, issuesInfo.plan);

  // Build FIX.md content
  const today = new Date().toISOString().split('T')[0];
  const fixPlanContent = `---
phase: ${issuesInfo.phaseDir}
plan: ${issuesInfo.plan}-FIX
type: fix
---

<objective>
Fix ${issues.length} UAT issue(s) from plan ${planArg}.

Source: ${issuesInfo.phase}-${issuesInfo.plan.padStart(2, '0')}-ISSUES.md
Priority: ${counts.Blocker} blocker, ${counts.Major} major, ${counts.Minor} minor
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/${issuesInfo.phaseDir}/${issuesInfo.phase}-${issuesInfo.plan.padStart(2, '0')}-ISSUES.md

**Original plan for reference:**
@.planning/phases/${issuesInfo.phaseDir}/${issuesInfo.phase}-${issuesInfo.plan.padStart(2, '0')}-PLAN.md
</context>

<tasks>

${fixTasks}

</tasks>

<verification>
Before declaring plan complete:
- [ ] All blocker issues fixed
- [ ] All major issues fixed
- [ ] Minor issues fixed or documented as deferred
- [ ] Original acceptance criteria from issues met
</verification>

<success_criteria>
- All UAT issues from ${planArg}-ISSUES.md addressed
- Tests pass
- Ready for re-verification
</success_criteria>

<output>
After completion, create \`.planning/phases/${issuesInfo.phaseDir}/${issuesInfo.phase}-${issuesInfo.plan.padStart(2, '0')}-FIX-SUMMARY.md\`
</output>
`;

  // Write the FIX plan
  const fixFileName = `${issuesInfo.phase}-${issuesInfo.plan.padStart(2, '0')}-FIX-PLAN.md`;
  const phaseDirUri = vscode.Uri.joinPath(projectContext.planningUri, 'phases', issuesInfo.phaseDir);
  const fixPlanUri = vscode.Uri.joinPath(phaseDirUri, fixFileName);

  try {
    await vscode.workspace.fs.writeFile(fixPlanUri, Buffer.from(fixPlanContent, 'utf-8'));

    stream.markdown('---\n\n');
    stream.markdown('## Fix Plan Created\n\n');
    stream.markdown(`**File:** \`${fixFileName}\`\n\n`);
    stream.reference(fixPlanUri);
    stream.markdown('\n\n');

    // Commit the fix plan if git is available
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      const workspaceUri = workspaceFolders[0].uri;
      const isGitRepo = await checkGitRepo(workspaceUri);

      if (isGitRepo) {
        try {
          const relPath = fixPlanUri.fsPath.replace(workspaceUri.fsPath + '/', '');
          await stageFiles(workspaceUri, [relPath]);
          const commitMessage = `docs(${issuesInfo.phase}-${issuesInfo.plan}-FIX): plan fixes for UAT issues`;
          const commitResult = await commit(workspaceUri, commitMessage);

          if (commitResult.success && commitResult.hash) {
            stream.markdown(`**Committed:** \`${commitResult.hash}\` - ${commitMessage}\n\n`);
          }
        } catch (gitError) {
          const gitErrorMsg = gitError instanceof Error ? gitError.message : String(gitError);
          stream.markdown(`*Git commit skipped: ${gitErrorMsg}*\n\n`);
        }
      }
    }

    // Offer next actions
    stream.markdown('---\n\n');
    stream.markdown('### Next Steps\n\n');

    stream.button({
      command: 'hopper.chat-participant.execute-plan',
      arguments: [fixPlanUri.fsPath],
      title: 'Execute Fix Plan'
    });

    stream.markdown(' ');

    stream.button({
      command: 'vscode.open',
      arguments: [fixPlanUri],
      title: 'Review Plan First'
    });

    stream.markdown('\n\n');

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    stream.markdown(`**Error:** Failed to write fix plan: ${errorMsg}\n\n`);
    return { metadata: { lastCommand: 'plan-fix' } };
  }

  return {
    metadata: {
      lastCommand: 'plan-fix',
      planPath: fixPlanUri.fsPath,
      phase: `${issuesInfo.phase}-${issuesInfo.plan}-FIX`
    }
  };
}
