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
 * Parse issues from a UAT ISSUES.md file
 */
function parseUATIssues(content: string): UATIssue[] {
  const issues: UATIssue[] = [];

  // Find the Open Issues section
  const openSection = content.match(/## Open Issues\s*([\s\S]*?)(?=## Resolved Issues|$)/i);
  if (!openSection) {
    return issues;
  }

  const openContent = openSection[1];

  // Match individual issue blocks starting with ### UAT-XXX
  const issuePattern = /### (UAT-\d+):\s*([^\n]+)([\s\S]*?)(?=### UAT-\d+:|$)/g;
  let match;

  while ((match = issuePattern.exec(openContent)) !== null) {
    const id = match[1];
    const title = match[2].trim();
    const body = match[3];

    // Parse fields from body
    const severityMatch = body.match(/\*\*Severity:\*\*\s*([^\n]+)/);
    const descMatch = body.match(/\*\*Description:\*\*\s*([^\n]+)/);
    const expectedMatch = body.match(/\*\*Expected:\*\*\s*([^\n]+)/);
    const actualMatch = body.match(/\*\*Actual:\*\*\s*([^\n]+)/);
    const featureMatch = body.match(/\*\*Feature:\*\*\s*([^\n]+)/);

    issues.push({
      id,
      title,
      severity: severityMatch ? severityMatch[1].trim() : 'Unknown',
      description: descMatch ? descMatch[1].trim() : title,
      expected: expectedMatch ? expectedMatch[1].trim() : undefined,
      actual: actualMatch ? actualMatch[1].trim() : undefined,
      feature: featureMatch ? featureMatch[1].trim() : undefined
    });
  }

  return issues;
}

/**
 * Find ISSUES.md file for a plan
 */
async function findIssuesFile(
  planningUri: vscode.Uri,
  planArg: string
): Promise<{ uri: vscode.Uri; phase: string; plan: string; phaseDir: string } | null> {
  // Parse plan argument (e.g., "04-02" or "05.1-03")
  const planMatch = planArg.match(/^(\d+(?:\.\d+)?)-(\d+)/);
  if (!planMatch) {
    return null;
  }

  const phase = planMatch[1];
  const plan = planMatch[2];

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

      // Look for matching ISSUES.md
      const issuesFileName = `${phase}-${plan.padStart(2, '0')}-ISSUES.md`;
      for (const [fileName] of files) {
        if (fileName === issuesFileName || fileName.endsWith('-ISSUES.md')) {
          // Verify it matches the plan
          const fileMatch = fileName.match(/^(\d+(?:\.\d+)?)-(\d+)-ISSUES\.md$/);
          if (fileMatch) {
            const [, filePhase, filePlan] = fileMatch;
            if (filePhase === phase && filePlan === plan) {
              return {
                uri: vscode.Uri.joinPath(phaseDir, fileName),
                phase,
                plan,
                phaseDir: phaseName
              };
            }
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

  const issuesText = issues.map(issue => `
### ${issue.id}: ${issue.title}
- Severity: ${issue.severity}
- Description: ${issue.description}
${issue.expected ? `- Expected: ${issue.expected}` : ''}
${issue.actual ? `- Actual: ${issue.actual}` : ''}
`).join('\n');

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
[What needs to be fixed and how]
  </action>
  <verify>[How to verify the fix works]</verify>
  <done>[Issue acceptance criteria met]</done>
</task>

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
 * Generate basic fix tasks without LLM
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

  return sorted.map(issue => `<task type="auto">
  <name>Fix ${issue.id}: ${issue.title}</name>
  <files>[Identify affected files]</files>
  <action>
Fix the issue: ${issue.description}
${issue.expected ? `Expected behavior: ${issue.expected}` : ''}
${issue.actual ? `Actual behavior: ${issue.actual}` : ''}
  </action>
  <verify>Test that the issue is resolved</verify>
  <done>${issue.id} acceptance criteria met</done>
</task>`).join('\n\n');
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

  const issues = parseUATIssues(issuesContent);

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

<execution_context>
~/.claude/get-shit-done/workflows/execute-phase.md
~/.claude/get-shit-done/templates/summary.md
</execution_context>

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
