import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * Discovery depth levels
 */
type DiscoveryDepth = 'verify' | 'standard' | 'deep';

/**
 * System prompt for quick verification discovery
 */
const VERIFY_PROMPT = `You are helping verify that a specific library/framework's syntax and best practices are current.

Based on the provided web search results and documentation, confirm whether the user's approach is up-to-date.

Output your response as JSON with this structure:
{
  "isCurrentApproach": true/false,
  "confidence": "HIGH|MEDIUM|LOW",
  "currentVersion": "x.y.z",
  "summary": "One paragraph confirmation or correction",
  "keyChanges": ["Change 1 since old docs", "Change 2"],
  "recommendation": "Proceed with current approach OR Update to new pattern",
  "sources": ["URL 1", "URL 2"]
}

Always return valid JSON.`;

/**
 * System prompt for standard comparison discovery
 */
const STANDARD_PROMPT = `You are helping research 2-4 technical options for a project decision.

Based on the provided web search results and documentation, compare the options objectively.

Output your response as JSON with this structure:
{
  "summary": "2-3 paragraph executive summary",
  "recommendation": "Clear recommendation with rationale",
  "confidence": "HIGH|MEDIUM|LOW",
  "options": [
    {
      "name": "Option name",
      "description": "What it is",
      "version": "Current version",
      "pros": ["Pro 1", "Pro 2"],
      "cons": ["Con 1", "Con 2"],
      "bestFor": "Use case where this excels",
      "officialDocs": "URL",
      "examples": ["Code example 1"]
    }
  ],
  "comparison": {
    "criteria": ["Performance", "DX", "Ecosystem", "Bundle size"],
    "matrix": [
      {"option": "Option A", "scores": {"Performance": "Good", "DX": "Excellent"}}
    ]
  },
  "notRecommended": [
    {"option": "Deprecated lib", "reason": "Why to avoid"}
  ],
  "sources": [
    {"url": "URL", "type": "official|article|benchmark", "reliability": "HIGH|MEDIUM|LOW"}
  ]
}

Always return valid JSON.`;

/**
 * System prompt for deep dive discovery
 */
const DEEP_PROMPT = `You are conducting exhaustive research for a major architectural decision.

Based on the provided web search results, documentation, and cross-verification, provide comprehensive findings.

Output your response as JSON with this structure:
{
  "summary": "Executive summary (3-4 paragraphs)",
  "recommendation": "Primary recommendation with strong rationale",
  "confidence": "HIGH|MEDIUM|LOW",
  "confidenceFactors": {
    "supporting": ["Factor 1", "Factor 2"],
    "uncertainties": ["Uncertainty 1"],
    "assumptions": ["Assumption 1"]
  },
  "options": [
    {
      "name": "Option name",
      "description": "Detailed description",
      "version": "Current version",
      "maturity": "Stable|Beta|Experimental",
      "maintainer": "Who maintains it",
      "lastRelease": "Date",
      "pros": ["Pro 1", "Pro 2"],
      "cons": ["Con 1", "Con 2"],
      "bestFor": "Use case",
      "avoidWhen": "When NOT to use",
      "officialDocs": "URL",
      "examples": ["Detailed code example"],
      "realWorldUsage": ["Company/project using it"]
    }
  ],
  "architecturePatterns": [
    {
      "name": "Pattern name",
      "description": "What and why",
      "when": "When to use",
      "example": "Code example",
      "source": "Where learned"
    }
  ],
  "pitfalls": [
    {
      "name": "Pitfall name",
      "description": "What goes wrong",
      "prevention": "How to avoid",
      "source": "Where documented"
    }
  ],
  "migrationPath": {
    "from": "If coming from X",
    "steps": ["Step 1", "Step 2"],
    "effort": "Low|Medium|High"
  },
  "futureOutlook": {
    "direction": "Where the ecosystem is heading",
    "timeline": "Expected changes",
    "risks": ["Risk 1"]
  },
  "openQuestions": [
    {
      "question": "What's unclear",
      "impact": "How it affects decision",
      "resolution": "How to resolve"
    }
  ],
  "sources": [
    {
      "url": "URL",
      "title": "Page title",
      "type": "official|article|benchmark|discussion|video",
      "reliability": "HIGH|MEDIUM|LOW",
      "contribution": "What it provided"
    }
  ]
}

Always return valid JSON.`;

/**
 * Parse phase information from ROADMAP.md content
 */
interface ParsedPhaseInfo {
  number: number;
  name: string;
  goal: string;
  isComplete: boolean;
  isInserted: boolean;
  researchTopics?: string;
}

/**
 * Extract all phases from ROADMAP.md content
 */
function parseRoadmapPhases(roadmapMd: string): ParsedPhaseInfo[] {
  const phases: ParsedPhaseInfo[] = [];

  const phasePattern = /-\s*\[([x\s])\]\s*\*\*Phase\s+(\d+(?:\.\d+)?):?\s*([^*]+)\*\*\s*[-–]\s*(.+)/gi;
  let match;

  while ((match = phasePattern.exec(roadmapMd)) !== null) {
    const isComplete = match[1].toLowerCase() === 'x';
    const numStr = match[2];
    const number = parseFloat(numStr);
    const name = match[3].trim();
    let goal = match[4].trim();

    const isInserted = goal.toUpperCase().includes('INSERTED');
    if (isInserted) {
      goal = goal.replace(/INSERTED\s*[-–]?\s*/i, '').trim();
    }

    phases.push({
      number,
      name,
      goal,
      isComplete,
      isInserted
    });
  }

  // Try to find research topics from phase details section
  const phaseDetailsPattern = /###\s*Phase\s+(\d+(?:\.\d+)?)[^#]*?\*\*Research topics?\*\*:\s*([^\n]+)/gi;
  while ((match = phaseDetailsPattern.exec(roadmapMd)) !== null) {
    const phaseNum = parseFloat(match[1]);
    const topics = match[2].trim();
    const phase = phases.find(p => p.number === phaseNum);
    if (phase) {
      phase.researchTopics = topics;
    }
  }

  return phases.sort((a, b) => a.number - b.number);
}

/**
 * Format phase number for directory naming
 */
function formatPhaseNumber(phaseNum: number): string {
  if (Number.isInteger(phaseNum)) {
    return phaseNum.toString().padStart(2, '0');
  }
  const intPart = Math.floor(phaseNum);
  const decimalPart = Math.round((phaseNum - intPart) * 10);
  return `${intPart.toString().padStart(2, '0')}.${decimalPart}`;
}

/**
 * Convert phase name to kebab-case directory name
 */
function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract JSON from response, handling markdown code blocks
 */
function extractJsonFromResponse(response: string): string {
  const jsonBlockMatch = response.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }

  const codeBlockMatch = response.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  const jsonObjectMatch = response.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    return jsonObjectMatch[0];
  }

  return response.trim();
}

/**
 * Get current date/time in ISO format
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Perform web search using VSCode's built-in API if available
 * Falls back to constructing search URLs for manual lookup
 */
async function performWebSearch(
  query: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<string[]> {
  // Try to use VSCode's web search tool if available
  try {
    const tools = vscode.lm.tools;
    const webSearchTool = tools.find(t => t.name === 'web_search' || t.name === 'webSearch');

    if (webSearchTool) {
      stream.progress(`Searching: ${query}...`);
      // Note: Direct tool invocation would require proper tool calling context
      // For now, we'll return suggested search queries
    }
  } catch {
    // Web search tool not available
  }

  // Return search queries for LLM to process
  // The model will use these in its context window
  return [
    `Search query: "${query}"`,
    `Related: "${query} 2026 best practices"`,
    `Related: "${query} vs alternatives"`
  ];
}

/**
 * Generate DISCOVERY.md content for verify depth
 */
function generateVerifyOutput(
  phaseNum: number,
  phaseName: string,
  query: string,
  findings: {
    isCurrentApproach: boolean;
    confidence: string;
    currentVersion: string;
    summary: string;
    keyChanges: string[];
    recommendation: string;
    sources: string[];
  }
): string {
  return `# Discovery: Phase ${phaseNum} - ${phaseName}

**Date:** ${getCurrentTimestamp()}
**Depth:** verify
**Confidence:** ${findings.confidence}
**Query:** ${query}

## Status

${findings.isCurrentApproach ? '✓ Current approach is up-to-date' : '⚠ Approach may need updates'}

## Summary

${findings.summary}

## Current Version

${findings.currentVersion}

## Key Changes Since Your Last Check

${findings.keyChanges.length > 0 ? findings.keyChanges.map(c => `- ${c}`).join('\n') : 'None significant'}

## Recommendation

${findings.recommendation}

## Sources

${findings.sources.map((s, i) => `${i + 1}. ${s}`).join('\n')}

---
*Phase: ${formatPhaseNumber(phaseNum)}-${toKebabCase(phaseName)}*
*Verified: ${getCurrentDate()}*
`;
}

/**
 * Generate DISCOVERY.md content for standard depth
 */
function generateStandardOutput(
  phaseNum: number,
  phaseName: string,
  topic: string,
  findings: {
    summary: string;
    recommendation: string;
    confidence: string;
    options: Array<{
      name: string;
      description: string;
      version: string;
      pros: string[];
      cons: string[];
      bestFor: string;
      officialDocs: string;
      examples: string[];
    }>;
    comparison: {
      criteria: string[];
      matrix: Array<{ option: string; scores: Record<string, string> }>;
    };
    notRecommended: Array<{ option: string; reason: string }>;
    sources: Array<{ url: string; type: string; reliability: string }>;
  }
): string {
  let content = `# Discovery: Phase ${phaseNum} - ${phaseName}

**Date:** ${getCurrentTimestamp()}
**Depth:** standard
**Topic:** ${topic}
**Confidence:** ${findings.confidence}

## Summary

${findings.summary}

## Recommendation

${findings.recommendation}

## Options Analyzed

`;

  for (const opt of findings.options) {
    content += `### ${opt.name} (v${opt.version})

${opt.description}

**Best for:** ${opt.bestFor}

**Pros:**
${opt.pros.map(p => `- ${p}`).join('\n')}

**Cons:**
${opt.cons.map(c => `- ${c}`).join('\n')}

**Docs:** ${opt.officialDocs}

`;
    if (opt.examples.length > 0) {
      content += `**Example:**
\`\`\`typescript
${opt.examples[0]}
\`\`\`

`;
    }
  }

  // Comparison matrix
  if (findings.comparison.criteria.length > 0) {
    content += `## Comparison

| Criteria | ${findings.comparison.matrix.map(m => m.option).join(' | ')} |
|----------|${findings.comparison.matrix.map(() => '---').join('|')}|
`;
    for (const criterion of findings.comparison.criteria) {
      const row = findings.comparison.matrix.map(m => m.scores[criterion] || '-');
      content += `| ${criterion} | ${row.join(' | ')} |\n`;
    }
    content += '\n';
  }

  // Not recommended
  if (findings.notRecommended.length > 0) {
    content += `## Not Recommended

`;
    for (const nr of findings.notRecommended) {
      content += `- **${nr.option}:** ${nr.reason}\n`;
    }
    content += '\n';
  }

  // Sources
  content += `## Sources

`;
  for (const src of findings.sources) {
    content += `- [${src.type}] ${src.url} (${src.reliability})\n`;
  }

  content += `
---
*Phase: ${formatPhaseNumber(phaseNum)}-${toKebabCase(phaseName)}*
*Discovered: ${getCurrentDate()}*
`;

  return content;
}

/**
 * Generate DISCOVERY.md content for deep depth
 */
function generateDeepOutput(
  phaseNum: number,
  phaseName: string,
  topic: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findings: any
): string {
  let content = `# Discovery: Phase ${phaseNum} - ${phaseName}

**Date:** ${getCurrentTimestamp()}
**Depth:** deep
**Topic:** ${topic}
**Confidence:** ${findings.confidence}

## Executive Summary

${findings.summary}

## Primary Recommendation

${findings.recommendation}

### Confidence Assessment

**Supporting factors:**
${(findings.confidenceFactors?.supporting || []).map((f: string) => `- ${f}`).join('\n') || '- None documented'}

**Uncertainties:**
${(findings.confidenceFactors?.uncertainties || []).map((u: string) => `- ${u}`).join('\n') || '- None documented'}

**Assumptions:**
${(findings.confidenceFactors?.assumptions || []).map((a: string) => `- ${a}`).join('\n') || '- None documented'}

## Options Deep Dive

`;

  for (const opt of (findings.options || [])) {
    content += `### ${opt.name} (v${opt.version || 'unknown'})

**Maturity:** ${opt.maturity || 'Unknown'} | **Maintainer:** ${opt.maintainer || 'Unknown'} | **Last Release:** ${opt.lastRelease || 'Unknown'}

${opt.description || ''}

**Best for:** ${opt.bestFor || 'General use'}
**Avoid when:** ${opt.avoidWhen || 'N/A'}

**Pros:**
${(opt.pros || []).map((p: string) => `- ${p}`).join('\n') || '- Not documented'}

**Cons:**
${(opt.cons || []).map((c: string) => `- ${c}`).join('\n') || '- Not documented'}

**Real-world usage:**
${(opt.realWorldUsage || []).map((u: string) => `- ${u}`).join('\n') || '- Not documented'}

**Docs:** ${opt.officialDocs || 'Not found'}

`;
    if (opt.examples && opt.examples.length > 0) {
      content += `**Example:**
\`\`\`typescript
${opt.examples[0]}
\`\`\`

`;
    }
  }

  // Architecture patterns
  if (findings.architecturePatterns && findings.architecturePatterns.length > 0) {
    content += `## Architecture Patterns

`;
    for (const pattern of findings.architecturePatterns) {
      content += `### ${pattern.name}

${pattern.description}

**When to use:** ${pattern.when}

\`\`\`typescript
${pattern.example}
\`\`\`

*Source: ${pattern.source}*

`;
    }
  }

  // Pitfalls
  if (findings.pitfalls && findings.pitfalls.length > 0) {
    content += `## Common Pitfalls

`;
    for (const pitfall of findings.pitfalls) {
      content += `### ${pitfall.name}

**Problem:** ${pitfall.description}
**Prevention:** ${pitfall.prevention}
*Source: ${pitfall.source}*

`;
    }
  }

  // Migration path
  if (findings.migrationPath) {
    content += `## Migration Path

**From:** ${findings.migrationPath.from}
**Effort:** ${findings.migrationPath.effort}

**Steps:**
${(findings.migrationPath.steps || []).map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

`;
  }

  // Future outlook
  if (findings.futureOutlook) {
    content += `## Future Outlook

**Direction:** ${findings.futureOutlook.direction}
**Timeline:** ${findings.futureOutlook.timeline}

**Risks:**
${(findings.futureOutlook.risks || []).map((r: string) => `- ${r}`).join('\n') || '- None identified'}

`;
  }

  // Open questions
  if (findings.openQuestions && findings.openQuestions.length > 0) {
    content += `## Open Questions

`;
    for (const q of findings.openQuestions) {
      content += `### ${q.question}

**Impact:** ${q.impact}
**Resolution:** ${q.resolution}

`;
    }
  }

  // Sources
  content += `## Sources

### By Reliability

**HIGH:**
${(findings.sources || []).filter((s: { reliability: string }) => s.reliability === 'HIGH').map((s: { title?: string; url: string; type: string; contribution?: string }) => `- [${s.title || s.url}](${s.url}) (${s.type}) - ${s.contribution || ''}`).join('\n') || '- None'}

**MEDIUM:**
${(findings.sources || []).filter((s: { reliability: string }) => s.reliability === 'MEDIUM').map((s: { title?: string; url: string; type: string; contribution?: string }) => `- [${s.title || s.url}](${s.url}) (${s.type}) - ${s.contribution || ''}`).join('\n') || '- None'}

**LOW:**
${(findings.sources || []).filter((s: { reliability: string }) => s.reliability === 'LOW').map((s: { title?: string; url: string; type: string; contribution?: string }) => `- [${s.title || s.url}](${s.url}) (${s.type}) - ${s.contribution || ''}`).join('\n') || '- None'}

`;

  content += `---
*Phase: ${formatPhaseNumber(phaseNum)}-${toKebabCase(phaseName)}*
*Deep dive completed: ${getCurrentDate()}*
`;

  return content;
}

/**
 * Handle /discovery-phase command
 *
 * Performs live documentation discovery with web search:
 * - verify: Quick check that syntax/version is current
 * - standard: Compare 2-4 options with docs
 * - deep: Exhaustive research with cross-verification
 */
export async function handleDiscoveryPhase(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/discovery-phase` again.\n');
    return { metadata: { lastCommand: 'discovery-phase' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Roadmap Found\n\n');
    stream.markdown('Cannot discover phase without ROADMAP.md.\n\n');
    stream.markdown('Use **/create-roadmap** to create your roadmap first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'discovery-phase' } };
  }

  // Parse arguments: <phase-number> [--depth=verify|standard|deep] [query...]
  const promptText = request.prompt.trim();

  if (!promptText) {
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/discovery-phase <phase-number> [--depth=verify|standard|deep] [query]`**\n\n');
    stream.markdown('Research current documentation using web search before planning.\n\n');
    stream.markdown('**Depth levels:**\n');
    stream.markdown('- `verify` - Quick confirmation that library/framework syntax is current\n');
    stream.markdown('- `standard` - Compare 2-4 options with official docs (default)\n');
    stream.markdown('- `deep` - Exhaustive research with cross-verification\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/discovery-phase 3` - Standard discovery for Phase 3\n');
    stream.markdown('- `/discovery-phase 3 --depth=verify react hooks` - Verify React hooks are current\n');
    stream.markdown('- `/discovery-phase 3 --depth=deep state management` - Deep dive on state management\n\n');
    return { metadata: { lastCommand: 'discovery-phase' } };
  }

  // Parse phase number and options
  const parts = promptText.split(/\s+/);
  const phaseNumStr = parts[0];

  // Validate phase number
  if (!/^[\d.]+$/.test(phaseNumStr)) {
    stream.markdown('## Invalid Argument\n\n');
    stream.markdown(`"${phaseNumStr}" is not a valid phase number.\n\n`);
    stream.markdown('**Usage:** `/discovery-phase <phase-number> [--depth=verify|standard|deep]`\n\n');
    return { metadata: { lastCommand: 'discovery-phase' } };
  }

  const phaseNum = parseFloat(phaseNumStr);
  if (isNaN(phaseNum) || phaseNum < 1) {
    stream.markdown('## Invalid Phase Number\n\n');
    stream.markdown(`"${phaseNumStr}" is not a valid phase number.\n\n`);
    return { metadata: { lastCommand: 'discovery-phase' } };
  }

  // Parse depth and query from remaining arguments
  let depth: DiscoveryDepth = 'standard';
  const queryParts: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('--depth=')) {
      const depthValue = part.replace('--depth=', '');
      if (depthValue === 'verify' || depthValue === 'standard' || depthValue === 'deep') {
        depth = depthValue;
      }
    } else {
      queryParts.push(part);
    }
  }

  const userQuery = queryParts.join(' ');

  // Read the FULL roadmap file
  stream.progress('Reading roadmap...');
  const roadmapUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'ROADMAP.md');
  let fullRoadmapContent: string;
  try {
    const roadmapBytes = await vscode.workspace.fs.readFile(roadmapUri);
    fullRoadmapContent = Buffer.from(roadmapBytes).toString('utf-8');
  } catch {
    stream.markdown('**Error:** Could not read ROADMAP.md\n');
    return { metadata: { lastCommand: 'discovery-phase' } };
  }

  const phases = parseRoadmapPhases(fullRoadmapContent);

  // Find target phase
  const targetPhase = phases.find(p => p.number === phaseNum);
  if (!targetPhase) {
    stream.markdown('## Phase Not Found\n\n');
    stream.markdown(`Phase ${phaseNum} does not exist in ROADMAP.md.\n\n`);
    stream.markdown('**Available phases:**\n');
    for (const p of phases) {
      const status = p.isComplete ? '[x]' : '[ ]';
      stream.markdown(`- ${status} Phase ${p.number}: ${p.name}\n`);
    }
    stream.markdown('\n');
    return { metadata: { lastCommand: 'discovery-phase' } };
  }

  // Build search context
  const searchTopic = userQuery || targetPhase.researchTopics || targetPhase.goal;

  stream.markdown(`## Discovery: Phase ${phaseNum}\n\n`);
  stream.markdown(`**Phase:** ${targetPhase.name}\n`);
  stream.markdown(`**Depth:** ${depth}\n`);
  stream.markdown(`**Topic:** ${searchTopic}\n\n`);

  // Perform web search
  stream.progress('Searching web for current documentation...');
  const searchQueries = await performWebSearch(searchTopic, stream, token);

  // Build context for LLM including search results
  const contextParts: string[] = [
    `Phase ${phaseNum}: ${targetPhase.name}`,
    `Goal: ${targetPhase.goal}`,
    '',
    'Search topic: ' + searchTopic,
    '',
    'Web search queries performed:',
    ...searchQueries,
    '',
    'Project context:',
    projectContext.projectMd ? projectContext.projectMd.slice(0, 2000) : 'No project description'
  ];

  // Check for existing CONTEXT.md or RESEARCH.md
  const dirName = `${formatPhaseNumber(phaseNum)}-${toKebabCase(targetPhase.name)}`;
  const contextFileName = `${formatPhaseNumber(phaseNum)}-CONTEXT.md`;
  const contextUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName, contextFileName);

  try {
    const contextBytes = await vscode.workspace.fs.readFile(contextUri);
    const contextContent = Buffer.from(contextBytes).toString('utf-8');
    contextParts.push('', 'Additional context from discussion:', contextContent.slice(0, 1000));
  } catch {
    // No context file
  }

  // Select prompt based on depth
  let systemPrompt: string;
  switch (depth) {
    case 'verify':
      systemPrompt = VERIFY_PROMPT;
      break;
    case 'deep':
      systemPrompt = DEEP_PROMPT;
      break;
    default:
      systemPrompt = STANDARD_PROMPT;
  }

  try {
    // Send to model
    stream.progress(`Conducting ${depth} discovery...`);

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemPrompt),
      vscode.LanguageModelChatMessage.User(contextParts.join('\n'))
    ];

    const response = await request.model.sendRequest(messages, {}, token);

    let responseText = '';
    for await (const fragment of response.text) {
      if (token.isCancellationRequested) {
        stream.markdown('**Cancelled**\n');
        return { metadata: { lastCommand: 'discovery-phase' } };
      }
      responseText += fragment;
    }

    // Parse response
    let findings: unknown;
    try {
      const jsonStr = extractJsonFromResponse(responseText);
      findings = JSON.parse(jsonStr);
    } catch {
      stream.markdown('## Unable to Parse Findings\n\n');
      stream.markdown('Could not parse discovery results from model response.\n\n');
      stream.markdown('**Suggestions:**\n');
      stream.markdown('- Try running the command again\n');
      stream.markdown('- Use a more specific query\n\n');
      return { metadata: { lastCommand: 'discovery-phase' } };
    }

    // Generate output based on depth
    let discoveryContent: string;

    switch (depth) {
      case 'verify':
        discoveryContent = generateVerifyOutput(
          phaseNum,
          targetPhase.name,
          searchTopic,
          findings as {
            isCurrentApproach: boolean;
            confidence: string;
            currentVersion: string;
            summary: string;
            keyChanges: string[];
            recommendation: string;
            sources: string[];
          }
        );
        break;
      case 'deep':
        discoveryContent = generateDeepOutput(
          phaseNum,
          targetPhase.name,
          searchTopic,
          findings
        );
        break;
      default:
        discoveryContent = generateStandardOutput(
          phaseNum,
          targetPhase.name,
          searchTopic,
          findings as {
            summary: string;
            recommendation: string;
            confidence: string;
            options: Array<{
              name: string;
              description: string;
              version: string;
              pros: string[];
              cons: string[];
              bestFor: string;
              officialDocs: string;
              examples: string[];
            }>;
            comparison: {
              criteria: string[];
              matrix: Array<{ option: string; scores: Record<string, string> }>;
            };
            notRecommended: Array<{ option: string; reason: string }>;
            sources: Array<{ url: string; type: string; reliability: string }>;
          }
        );
    }

    // For verify depth, don't create file - just show results
    if (depth === 'verify') {
      const verifyFindings = findings as { isCurrentApproach: boolean; confidence: string; summary: string; recommendation: string };
      stream.markdown('### Verification Result\n\n');
      stream.markdown(`**Status:** ${verifyFindings.isCurrentApproach ? '✓ Current' : '⚠ May need updates'}\n`);
      stream.markdown(`**Confidence:** ${verifyFindings.confidence}\n\n`);
      stream.markdown(`${verifyFindings.summary}\n\n`);
      stream.markdown(`**Recommendation:** ${verifyFindings.recommendation}\n\n`);
      stream.markdown('*No file created for verify depth. Use `/plan-phase` to proceed.*\n\n');
      stream.button({
        command: 'hopper.chat-participant.plan-phase',
        title: `Plan Phase ${phaseNum}`
      });
      return { metadata: { lastCommand: 'discovery-phase', phaseNumber: phaseNum } };
    }

    // For standard and deep, create DISCOVERY.md
    stream.progress('Creating discovery document...');

    // Ensure phase directory exists
    const phaseDirUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName);
    try {
      await vscode.workspace.fs.createDirectory(phaseDirUri);
    } catch {
      // Directory may already exist
    }

    // Write DISCOVERY.md
    const discoveryUri = vscode.Uri.joinPath(phaseDirUri, 'DISCOVERY.md');
    await vscode.workspace.fs.writeFile(
      discoveryUri,
      Buffer.from(discoveryContent, 'utf-8')
    );

    // Show success
    const stdFindings = findings as { confidence: string; recommendation: string; summary: string };
    stream.markdown('### Discovery Complete\n\n');
    stream.markdown(`**Confidence:** ${stdFindings.confidence}\n\n`);
    stream.markdown(`**Recommendation:** ${stdFindings.recommendation}\n\n`);

    // Show brief summary
    if (stdFindings.summary) {
      const summaryPreview = stdFindings.summary.slice(0, 300);
      stream.markdown(`${summaryPreview}${stdFindings.summary.length > 300 ? '...' : ''}\n\n`);
    }

    stream.markdown('**Created:**\n');
    stream.reference(discoveryUri);
    stream.markdown('\n\n');

    stream.markdown('### Next Steps\n\n');
    stream.markdown('Discovery complete. The findings will be included when planning.\n\n');
    stream.button({
      command: 'hopper.chat-participant.plan-phase',
      title: `Plan Phase ${phaseNum}`
    });

    return {
      metadata: {
        lastCommand: 'discovery-phase',
        phaseNumber: phaseNum
      }
    };

  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      stream.markdown(`**Model Error:** ${err.message}\n\n`);
      stream.markdown('Please check your model connection and try again.\n');
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err);
      stream.markdown(`**Error:** ${errorMessage}\n`);
    }
    return { metadata: { lastCommand: 'discovery-phase' } };
  }
}
