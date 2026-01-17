import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import { truncateContent } from '../context/projectContext';

/**
 * Parsed issue from ISSUES.md
 */
interface ParsedIssue {
  id: string;           // ISS-001
  description: string;  // Brief description
  discovered: string;   // Phase X Task Y (YYYY-MM-DD)
  type: string;         // Performance / Refactoring / UX / Testing / Documentation / Accessibility
  fullDescription: string;
  effort: string;       // Quick / Medium / Substantial
  suggestedPhase: string;
  rawBlock: string;     // Original markdown block for moving to closed
}

/**
 * Issue analysis result from LLM
 */
interface IssueAnalysis {
  issue: ParsedIssue;
  category: 'resolved' | 'urgent' | 'natural-fit' | 'can-wait';
  reason: string;
  evidence?: string;
  suggestedAction?: string;
}

/**
 * Parse issues from ISSUES.md content
 *
 * @param content - Full ISSUES.md content
 * @returns Array of parsed issues
 */
function parseIssues(content: string): ParsedIssue[] {
  const issues: ParsedIssue[] = [];

  // Find the Open Enhancements section
  const openSection = content.match(/## Open Enhancements\s*([\s\S]*?)(?=## Closed Enhancements|$)/);
  if (!openSection) {
    return issues;
  }

  const openContent = openSection[1];

  // Match individual issue blocks starting with ### ISS-XXX
  const issuePattern = /### (ISS-\d+):\s*([^\n]+)([\s\S]*?)(?=### ISS-\d+:|$)/g;
  let match;

  while ((match = issuePattern.exec(openContent)) !== null) {
    const id = match[1];
    const description = match[2].trim();
    const body = match[3];

    // Parse fields from body
    const discoveredMatch = body.match(/\*\*Discovered:\*\*\s*([^\n]+)/);
    const typeMatch = body.match(/\*\*Type:\*\*\s*([^\n]+)/);
    const descMatch = body.match(/\*\*Description:\*\*\s*([^\n]+)/);
    const effortMatch = body.match(/\*\*Effort:\*\*\s*([^\n]+)/);
    const phaseMatch = body.match(/\*\*Suggested phase:\*\*\s*([^\n]+)/);

    issues.push({
      id,
      description,
      discovered: discoveredMatch ? discoveredMatch[1].trim() : 'Unknown',
      type: typeMatch ? typeMatch[1].trim() : 'Unknown',
      fullDescription: descMatch ? descMatch[1].trim() : description,
      effort: effortMatch ? effortMatch[1].trim() : 'Unknown',
      suggestedPhase: phaseMatch ? phaseMatch[1].trim() : 'Future',
      rawBlock: match[0].trim()
    });
  }

  return issues;
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
 * Analyze issues using LLM
 *
 * @param ctx - Command context with stream and model access
 * @param issues - Parsed issues to analyze
 * @param roadmapContent - ROADMAP.md content for phase context
 * @returns Analysis results for each issue
 */
async function analyzeIssuesWithLLM(
  ctx: CommandContext,
  issues: ParsedIssue[],
  roadmapContent: string | undefined
): Promise<IssueAnalysis[]> {
  const { stream, token } = ctx;
  const results: IssueAnalysis[] = [];

  // Get available LLM models
  const models = await vscode.lm.selectChatModels();
  if (models.length === 0) {
    // Fallback: categorize all as "can-wait" without LLM
    return issues.map(issue => ({
      issue,
      category: 'can-wait' as const,
      reason: 'No LLM available for analysis'
    }));
  }

  const model = models[0];

  // Build context about upcoming phases
  let upcomingPhases = 'Unknown';
  if (roadmapContent) {
    // Extract phases marked as "Not started" or "In progress"
    const phaseMatches = roadmapContent.matchAll(/\*\*Phase (\d+(?:\.\d+)?)[^*]*\*\*[^|]*\|\s*(?:Not started|In progress)/gi);
    const phases = Array.from(phaseMatches).map(m => `Phase ${m[1]}`);
    if (phases.length > 0) {
      upcomingPhases = phases.join(', ');
    }
  }

  for (const issue of issues) {
    if (token.isCancellationRequested) {
      break;
    }

    const prompt = `Analyze this deferred issue and categorize it:

## Issue
- ID: ${issue.id}
- Description: ${issue.description}
- Full details: ${issue.fullDescription}
- Type: ${issue.type}
- Discovered: ${issue.discovered}
- Effort: ${issue.effort}

## Context
- Upcoming phases: ${upcomingPhases}
- Current roadmap context: ${truncateContent(roadmapContent || 'Not available', 500)}

## Instructions
Categorize this issue into ONE of these categories:
1. "resolved" - Code has changed, issue is no longer applicable
2. "urgent" - This is blocking upcoming work or causing active problems
3. "natural-fit" - This aligns well with an upcoming phase's work
4. "can-wait" - Still valid but not urgent, can remain deferred

Respond in this exact JSON format:
{
  "category": "resolved" | "urgent" | "natural-fit" | "can-wait",
  "reason": "Brief explanation of why this category",
  "evidence": "What indicates this (optional)",
  "suggestedAction": "What to do next (optional)"
}`;

    try {
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const response = await model.sendRequest(messages, {}, token);

      let responseText = '';
      for await (const chunk of response.text) {
        responseText += chunk;
      }

      // Parse JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const analysis = JSON.parse(jsonMatch[0]);
          results.push({
            issue,
            category: analysis.category || 'can-wait',
            reason: analysis.reason || 'Analysis complete',
            evidence: analysis.evidence,
            suggestedAction: analysis.suggestedAction
          });
        } catch {
          // JSON parse failed, use default
          results.push({
            issue,
            category: 'can-wait',
            reason: 'Could not parse LLM response'
          });
        }
      } else {
        results.push({
          issue,
          category: 'can-wait',
          reason: responseText.slice(0, 200)
        });
      }
    } catch (err) {
      // LLM call failed, categorize as can-wait
      results.push({
        issue,
        category: 'can-wait',
        reason: `Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      });
    }
  }

  return results;
}

/**
 * Close resolved issues by moving them to Closed Enhancements section
 *
 * @param planningUri - URI to .planning directory
 * @param issueIds - Array of issue IDs to close
 * @param analyses - Full analysis results for close reasons
 * @returns Number of issues closed
 */
export async function closeResolvedIssues(
  planningUri: vscode.Uri,
  issueIds: string[],
  analyses: IssueAnalysis[]
): Promise<{ closed: number; error?: string }> {
  const issuesUri = vscode.Uri.joinPath(planningUri, 'ISSUES.md');

  try {
    const content = await readFileContent(issuesUri);
    if (!content) {
      return { closed: 0, error: 'Could not read ISSUES.md' };
    }

    let updatedContent = content;
    const today = new Date().toISOString().split('T')[0];
    let closedCount = 0;

    // Build closure blocks
    const closureBlocks: string[] = [];

    for (const issueId of issueIds) {
      const analysis = analyses.find(a => a.issue.id === issueId);
      if (!analysis) continue;

      // Find and remove from Open Enhancements
      const issuePattern = new RegExp(
        `### ${issueId}:[^]*?(?=### ISS-\\d+:|## Closed Enhancements|$)`,
        'g'
      );

      const match = updatedContent.match(issuePattern);
      if (match) {
        // Remove from open section
        updatedContent = updatedContent.replace(issuePattern, '');

        // Create closure block
        closureBlocks.push(
          `### ${issueId}: ${analysis.issue.description}\n` +
          `**Resolved:** ${today} - ${analysis.reason}\n` +
          (analysis.evidence ? `**Evidence:** ${analysis.evidence}\n` : '')
        );

        closedCount++;
      }
    }

    if (closedCount === 0) {
      return { closed: 0, error: 'No matching issues found to close' };
    }

    // Add to Closed Enhancements section
    if (updatedContent.includes('## Closed Enhancements')) {
      // Insert after the header
      updatedContent = updatedContent.replace(
        /## Closed Enhancements\s*\n/,
        `## Closed Enhancements\n\n${closureBlocks.join('\n')}\n`
      );
    } else {
      // Add section at end
      updatedContent += `\n## Closed Enhancements\n\n${closureBlocks.join('\n')}\n`;
    }

    // Clean up extra blank lines in Open Enhancements section
    updatedContent = updatedContent.replace(/## Open Enhancements\n{3,}/g, '## Open Enhancements\n\n');

    // Write updated content
    await vscode.workspace.fs.writeFile(issuesUri, Buffer.from(updatedContent, 'utf-8'));

    return { closed: closedCount };
  } catch (err) {
    return { closed: 0, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Handle /consider-issues command
 *
 * Reviews deferred issues from ISSUES.md with codebase awareness,
 * identifying resolved, urgent, and natural-fit issues.
 */
export async function handleConsiderIssues(ctx: CommandContext): Promise<IHopperResult> {
  const { projectContext, stream, extensionContext } = ctx;

  // Step 1: Verify project exists
  if (!projectContext.hasPlanning || !projectContext.planningUri) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('No `.planning` directory found. Use **/new-project** to initialize.\n\n');
    stream.button({
      command: 'hopper.chat-participant.new-project',
      title: 'New Project'
    });
    return { metadata: { lastCommand: 'consider-issues' } };
  }

  // Step 2: Check if ISSUES.md exists
  const issuesUri = vscode.Uri.joinPath(projectContext.planningUri, 'ISSUES.md');
  const issuesContent = await readFileContent(issuesUri);

  if (!issuesContent) {
    stream.markdown('## No Issues File Found\n\n');
    stream.markdown('No `.planning/ISSUES.md` file exists.\n\n');
    stream.markdown('This means no enhancements have been deferred yet (Rule 5 hasn\'t triggered during execution).\n\n');
    stream.markdown('**Nothing to review.** Continue with your current work.\n\n');
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });
    return { metadata: { lastCommand: 'consider-issues' } };
  }

  // Step 3: Parse issues from Open Enhancements section
  const issues = parseIssues(issuesContent);

  if (issues.length === 0) {
    stream.markdown('## No Open Issues\n\n');
    stream.markdown('All issues in ISSUES.md are either closed or the file is empty.\n\n');
    stream.markdown('**All clear** - continue with current work.\n\n');
    stream.button({
      command: 'hopper.chat-participant.progress',
      title: 'Check Progress'
    });
    return { metadata: { lastCommand: 'consider-issues' } };
  }

  // Step 4: Analyze issues with LLM
  stream.markdown('## Analyzing Issues\n\n');
  stream.markdown(`Found **${issues.length}** open issue(s). Analyzing with codebase context...\n\n`);

  // Read ROADMAP for context
  const roadmapUri = vscode.Uri.joinPath(projectContext.planningUri, 'ROADMAP.md');
  const roadmapContent = await readFileContent(roadmapUri);

  const analyses = await analyzeIssuesWithLLM(ctx, issues, roadmapContent);

  // Store analyses in globalState for close action
  await extensionContext.globalState.update('hopper.issueAnalyses', analyses);

  // Step 5: Group by category
  const resolved = analyses.filter(a => a.category === 'resolved');
  const urgent = analyses.filter(a => a.category === 'urgent');
  const naturalFit = analyses.filter(a => a.category === 'natural-fit');
  const canWait = analyses.filter(a => a.category === 'can-wait');

  // Step 6: Present categorized report
  stream.markdown('---\n\n');
  stream.markdown('# Issue Review\n\n');
  stream.markdown(`**Analyzed:** ${issues.length} open issues\n`);
  stream.markdown(`**Date:** ${new Date().toISOString().split('T')[0]}\n\n`);

  // Resolved issues
  stream.markdown('## Resolved (can close)\n\n');
  if (resolved.length === 0) {
    stream.markdown('*None* - all issues still relevant\n\n');
  } else {
    for (const analysis of resolved) {
      stream.markdown(`### ${analysis.issue.id}: ${analysis.issue.description}\n`);
      stream.markdown(`**Reason:** ${analysis.reason}\n`);
      if (analysis.evidence) {
        stream.markdown(`**Evidence:** ${analysis.evidence}\n`);
      }
      stream.markdown('\n');
    }
  }

  stream.markdown('---\n\n');

  // Urgent issues
  stream.markdown('## Urgent (should address now)\n\n');
  if (urgent.length === 0) {
    stream.markdown('*None* - no blocking issues\n\n');
  } else {
    for (const analysis of urgent) {
      stream.markdown(`### ${analysis.issue.id}: ${analysis.issue.description}\n`);
      stream.markdown(`**Why urgent:** ${analysis.reason}\n`);
      stream.markdown(`**Effort:** ${analysis.issue.effort}\n`);
      if (analysis.suggestedAction) {
        stream.markdown(`**Recommendation:** ${analysis.suggestedAction}\n`);
      }
      stream.markdown('\n');
    }
  }

  stream.markdown('---\n\n');

  // Natural fit
  stream.markdown('## Natural Fit for Upcoming Work\n\n');
  if (naturalFit.length === 0) {
    stream.markdown('*None* - no issues align with upcoming phases\n\n');
  } else {
    for (const analysis of naturalFit) {
      stream.markdown(`### ${analysis.issue.id}: ${analysis.issue.description}\n`);
      stream.markdown(`**Fits with:** ${analysis.issue.suggestedPhase}\n`);
      stream.markdown(`**Reason:** ${analysis.reason}\n`);
      stream.markdown('\n');
    }
  }

  stream.markdown('---\n\n');

  // Can wait
  stream.markdown('## Can Wait (no change)\n\n');
  if (canWait.length === 0) {
    stream.markdown('*None* - all issues categorized above\n\n');
  } else {
    for (const analysis of canWait) {
      stream.markdown(`- **${analysis.issue.id}:** ${analysis.issue.description} - ${analysis.reason}\n`);
    }
    stream.markdown('\n');
  }

  // Step 7: Offer actions
  stream.markdown('---\n\n');
  stream.markdown('## Actions\n\n');

  if (resolved.length > 0) {
    stream.markdown(`**${resolved.length} resolved issue(s)** can be closed:\n\n`);
    stream.button({
      command: 'hopper.closeResolvedIssues',
      title: `Close ${resolved.length} Resolved Issue(s)`
    });
    stream.markdown('\n\n');
  }

  if (urgent.length > 0) {
    stream.markdown(`**${urgent.length} urgent issue(s)** may need immediate attention.\n`);
    stream.markdown('Consider using `/insert-phase` to address before continuing (coming in Phase 5.1).\n\n');
  }

  if (naturalFit.length > 0) {
    stream.markdown(`**${naturalFit.length} issue(s)** fit naturally with upcoming phases.\n`);
    stream.markdown('These will be considered during `/plan-phase`.\n\n');
  }

  stream.button({
    command: 'hopper.chat-participant.progress',
    title: 'Done - Check Progress'
  });

  return {
    metadata: {
      lastCommand: 'consider-issues',
      issue: resolved.length > 0 ? resolved.map(r => r.issue.id).join(',') : undefined
    }
  };
}
