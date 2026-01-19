import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import {
  fetchDocumentation,
  getOfficialDocsUrl,
  getPackageDocUrls,
  summarizeDocContent,
  DocResult
} from '../../utils/webFetch';

/**
 * System prompt for phase research domain identification
 */
const RESEARCH_DOMAIN_PROMPT = `You are helping analyze a project phase to identify what research is needed.

Based on the phase description and project context, identify research domains and determine if research is necessary.

Output your response as JSON with this exact structure:
{
  "needsResearch": true/false,
  "reason": "Why research is/isn't needed",
  "domains": [
    {
      "name": "Domain name (e.g., 'Three.js 3D Rendering')",
      "category": "core-technology|ecosystem|architecture|pitfalls|dont-hand-roll",
      "questions": ["What library to use?", "What patterns are standard?"]
    }
  ],
  "suggestSkip": false,
  "skipReason": null
}

Guidelines:
- needsResearch: true for niche/complex domains (3D, game dev, audio, ML, specialized frameworks)
- needsResearch: false for commodity work (auth, CRUD, REST APIs, standard forms)
- domains: 2-5 specific areas to research
- suggestSkip: true if this is clearly commodity work that doesn't need research
- categories: core-technology (main tech), ecosystem (supporting libs), architecture (patterns), pitfalls (common mistakes), dont-hand-roll (use existing solutions)

Always return valid JSON.`;

/**
 * System prompt for generating comprehensive research content
 */
const RESEARCH_GENERATION_PROMPT = `You are a senior software architect conducting comprehensive research for a project phase.

Based on the phase description, project context, and identified domains, produce detailed research findings.

Output your response as JSON with this structure:
{
  "summary": "2-3 paragraph executive summary of findings",
  "primaryRecommendation": "One-liner actionable guidance",
  "confidence": "HIGH|MEDIUM|LOW",
  "standardStack": {
    "core": [
      {"name": "library-name", "version": "1.0.0", "purpose": "what it does", "whyStandard": "why experts use it"}
    ],
    "supporting": [
      {"name": "library-name", "version": "1.0.0", "purpose": "what it does", "whenToUse": "use case"}
    ],
    "alternatives": [
      {"insteadOf": "standard lib", "couldUse": "alternative", "tradeoff": "when alternative makes sense"}
    ],
    "installCommand": "npm install ..."
  },
  "architecturePatterns": {
    "projectStructure": "src/\\n├── folder/\\n...",
    "patterns": [
      {"name": "Pattern Name", "what": "description", "whenToUse": "conditions", "example": "code example"}
    ],
    "antiPatterns": [
      {"pattern": "Anti-pattern name", "why": "why it's bad", "instead": "what to do instead"}
    ]
  },
  "dontHandRoll": [
    {"problem": "Problem description", "dontBuild": "what you'd build", "useInstead": "library to use", "why": "edge cases, complexity"}
  ],
  "commonPitfalls": [
    {"name": "Pitfall Name", "whatGoesWrong": "description", "whyItHappens": "root cause", "howToAvoid": "prevention", "warningSigns": "how to detect"}
  ],
  "codeExamples": [
    {"title": "Example Title", "source": "where from", "code": "typescript code"}
  ],
  "stateOfTheArt": {
    "changes": [
      {"oldApproach": "old", "currentApproach": "new", "whenChanged": "date/version", "impact": "what it means"}
    ],
    "newTools": ["Tool: what it enables"],
    "deprecated": ["Thing: why outdated"]
  },
  "openQuestions": [
    {"question": "What's unclear", "whatWeKnow": "partial info", "recommendation": "how to handle"}
  ],
  "sources": {
    "primary": ["HIGH confidence sources"],
    "secondary": ["MEDIUM confidence - verified"],
    "tertiary": ["LOW confidence - needs validation"]
  }
}

Guidelines:
- Be specific with library versions
- Include actual code examples
- Document what NOT to build yourself
- Mark confidence levels honestly
- Focus on actionable ecosystem knowledge

Always return valid JSON.`;

/**
 * System prompt for merging new research with existing research
 */
const RESEARCH_MERGE_PROMPT = `You are a senior software architect updating existing research with new findings.

The user wants to add to or refine existing research. Merge the new information with the existing research, preserving valuable existing content while incorporating new insights.

Output your response as JSON with the same structure as the original research:
{
  "summary": "Updated executive summary incorporating new findings",
  "primaryRecommendation": "Updated actionable guidance",
  "confidence": "HIGH|MEDIUM|LOW",
  "standardStack": { ... merged stack recommendations ... },
  "architecturePatterns": { ... merged patterns ... },
  "dontHandRoll": [ ... merged list ... ],
  "commonPitfalls": [ ... merged list ... ],
  "codeExamples": [ ... merged examples ... ],
  "stateOfTheArt": { ... merged state ... },
  "openQuestions": [ ... updated questions, remove resolved ones ... ],
  "sources": { ... merged sources ... }
}

Guidelines:
- PRESERVE existing research - don't discard valuable findings
- INTEGRATE new information naturally
- If new research contradicts old, prefer the new (more recent info)
- Remove duplicates but keep all unique items
- Update confidence levels based on combined evidence
- Remove open questions that are now answered
- The merged research should be cohesive, not disjointed

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
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Fetch live documentation for identified research domains
 *
 * Extracts library/framework names from domains and fetches current docs
 * to ground LLM research in up-to-date information.
 */
async function fetchDocsForDomains(
  domains: Array<{ name: string; category: string; questions: string[] }>,
  stream: vscode.ChatResponseStream
): Promise<{ fetchedDocs: DocResult[]; docContext: string }> {
  const fetchedDocs: DocResult[] = [];

  // Extract potential library names from domain names and questions
  const potentialLibs = new Set<string>();

  for (const domain of domains) {
    // Extract words that look like library names (lowercase, no spaces)
    const words = domain.name.toLowerCase().split(/[\s,/]+/);
    for (const word of words) {
      // Skip common non-library words
      if (word.length > 2 &&
          !['the', 'and', 'for', 'with', 'how', 'use', 'best', 'way', 'using', 'based', 'patterns', 'architecture', 'integration'].includes(word)) {
        potentialLibs.add(word);
      }
    }

    // Also check questions for library names
    for (const q of domain.questions) {
      const qWords = q.toLowerCase().split(/[\s,/?]+/);
      for (const word of qWords) {
        if (word.length > 2 &&
            !['what', 'which', 'how', 'should', 'best', 'the', 'for', 'use', 'with', 'are', 'is'].includes(word)) {
          potentialLibs.add(word);
        }
      }
    }
  }

  // Limit to most likely library names (first 5)
  const libsToFetch = Array.from(potentialLibs).slice(0, 5);

  if (libsToFetch.length === 0) {
    return { fetchedDocs: [], docContext: '' };
  }

  stream.progress(`Fetching current documentation for: ${libsToFetch.join(', ')}...`);

  for (const lib of libsToFetch) {
    // Try official docs first
    const officialUrl = getOfficialDocsUrl(lib);
    if (officialUrl) {
      try {
        const doc = await fetchDocumentation(officialUrl);
        if (doc.success) {
          fetchedDocs.push(doc);
          stream.progress(`Fetched ${lib} docs`);
        }
      } catch {
        // Skip failed fetches
      }
    }

    // Try npm for packages (limit total docs to avoid context bloat)
    if (fetchedDocs.length < 4) {
      const { npm: npmUrl } = getPackageDocUrls(lib);
      if (npmUrl) {
        try {
          const doc = await fetchDocumentation(npmUrl);
          if (doc.success && doc.content.length > 100) {
            fetchedDocs.push(doc);
          }
        } catch {
          // Skip failed fetches
        }
      }
    }
  }

  // Build context string from fetched docs
  if (fetchedDocs.length === 0) {
    return { fetchedDocs: [], docContext: '' };
  }

  const contextParts = ['', '## Live Documentation (fetched just now)', ''];
  for (const doc of fetchedDocs) {
    contextParts.push(summarizeDocContent(doc, 1500));
    contextParts.push('');
  }

  return {
    fetchedDocs,
    docContext: contextParts.join('\n')
  };
}

/**
 * Generate RESEARCH.md content from research findings
 */
function generateResearchMarkdown(
  phaseNum: number,
  phaseName: string,
  domain: string,
  research: {
    summary: string;
    primaryRecommendation: string;
    confidence: string;
    standardStack: {
      core: Array<{ name: string; version: string; purpose: string; whyStandard: string }>;
      supporting: Array<{ name: string; version: string; purpose: string; whenToUse: string }>;
      alternatives: Array<{ insteadOf: string; couldUse: string; tradeoff: string }>;
      installCommand: string;
    };
    architecturePatterns: {
      projectStructure: string;
      patterns: Array<{ name: string; what: string; whenToUse: string; example: string }>;
      antiPatterns: Array<{ pattern: string; why: string; instead: string }>;
    };
    dontHandRoll: Array<{ problem: string; dontBuild: string; useInstead: string; why: string }>;
    commonPitfalls: Array<{ name: string; whatGoesWrong: string; whyItHappens: string; howToAvoid: string; warningSigns: string }>;
    codeExamples: Array<{ title: string; source: string; code: string }>;
    stateOfTheArt: {
      changes: Array<{ oldApproach: string; currentApproach: string; whenChanged: string; impact: string }>;
      newTools: string[];
      deprecated: string[];
    };
    openQuestions: Array<{ question: string; whatWeKnow: string; recommendation: string }>;
    sources: {
      primary: string[];
      secondary: string[];
      tertiary: string[];
    };
  }
): string {
  const date = getCurrentDate();

  let content = `# Phase ${phaseNum}: ${phaseName} - Research

**Researched:** ${date}
**Domain:** ${domain}
**Confidence:** ${research.confidence}

<research_summary>
## Summary

${research.summary}

**Primary recommendation:** ${research.primaryRecommendation}
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
`;

  for (const lib of research.standardStack.core) {
    content += `| ${lib.name} | ${lib.version} | ${lib.purpose} | ${lib.whyStandard} |\n`;
  }

  content += `
### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
`;

  for (const lib of research.standardStack.supporting) {
    content += `| ${lib.name} | ${lib.version} | ${lib.purpose} | ${lib.whenToUse} |\n`;
  }

  content += `
### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
`;

  for (const alt of research.standardStack.alternatives) {
    content += `| ${alt.insteadOf} | ${alt.couldUse} | ${alt.tradeoff} |\n`;
  }

  content += `
**Installation:**
\`\`\`bash
${research.standardStack.installCommand}
\`\`\`
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
\`\`\`
${research.architecturePatterns.projectStructure}
\`\`\`

`;

  for (let i = 0; i < research.architecturePatterns.patterns.length; i++) {
    const pattern = research.architecturePatterns.patterns[i];
    content += `### Pattern ${i + 1}: ${pattern.name}
**What:** ${pattern.what}
**When to use:** ${pattern.whenToUse}
**Example:**
\`\`\`typescript
${pattern.example}
\`\`\`

`;
  }

  content += `### Anti-Patterns to Avoid
`;
  for (const anti of research.architecturePatterns.antiPatterns) {
    content += `- **${anti.pattern}:** ${anti.why} → ${anti.instead}\n`;
  }

  content += `</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
`;

  for (const item of research.dontHandRoll) {
    content += `| ${item.problem} | ${item.dontBuild} | ${item.useInstead} | ${item.why} |\n`;
  }

  content += `</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

`;

  for (let i = 0; i < research.commonPitfalls.length; i++) {
    const pitfall = research.commonPitfalls[i];
    content += `### Pitfall ${i + 1}: ${pitfall.name}
**What goes wrong:** ${pitfall.whatGoesWrong}
**Why it happens:** ${pitfall.whyItHappens}
**How to avoid:** ${pitfall.howToAvoid}
**Warning signs:** ${pitfall.warningSigns}

`;
  }

  content += `</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official sources:

`;

  for (const example of research.codeExamples) {
    content += `### ${example.title}
\`\`\`typescript
// Source: ${example.source}
${example.code}
\`\`\`

`;
  }

  content += `</code_examples>

<sota_updates>
## State of the Art (2024-2025)

What's changed recently:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
`;

  for (const change of research.stateOfTheArt.changes) {
    content += `| ${change.oldApproach} | ${change.currentApproach} | ${change.whenChanged} | ${change.impact} |\n`;
  }

  content += `
**New tools/patterns to consider:**
`;
  for (const tool of research.stateOfTheArt.newTools) {
    content += `- ${tool}\n`;
  }

  content += `
**Deprecated/outdated:**
`;
  for (const dep of research.stateOfTheArt.deprecated) {
    content += `- ${dep}\n`;
  }

  content += `</sota_updates>

<open_questions>
## Open Questions

Things that couldn't be fully resolved:

`;

  for (let i = 0; i < research.openQuestions.length; i++) {
    const q = research.openQuestions[i];
    content += `${i + 1}. **${q.question}**
   - What we know: ${q.whatWeKnow}
   - Recommendation: ${q.recommendation}

`;
  }

  content += `</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
`;
  for (const src of research.sources.primary) {
    content += `- ${src}\n`;
  }

  content += `
### Secondary (MEDIUM confidence)
`;
  for (const src of research.sources.secondary) {
    content += `- ${src}\n`;
  }

  content += `
### Tertiary (LOW confidence - needs validation)
`;
  for (const src of research.sources.tertiary) {
    content += `- ${src}\n`;
  }

  content += `</sources>

---

*Phase: ${formatPhaseNumber(phaseNum)}-${toKebabCase(phaseName)}*
*Research completed: ${date}*
*Ready for planning: yes*
`;

  return content;
}

/**
 * Handle /research-phase command
 *
 * Conducts comprehensive research on a phase before planning:
 * 1. Validates phase number argument
 * 2. Checks if phase exists in roadmap
 * 3. Checks if RESEARCH.md already exists
 * 4. Identifies research domains from phase description
 * 5. Uses LLM to research each domain
 * 6. Creates {phase}-RESEARCH.md in phase directory
 */
export async function handleResearchPhase(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/research-phase` again.\n');
    return { metadata: { lastCommand: 'research-phase' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if ROADMAP.md exists
  if (!projectContext.hasPlanning || !projectContext.roadmapMd) {
    stream.markdown('## No Roadmap Found\n\n');
    stream.markdown('Cannot research phase without ROADMAP.md.\n\n');
    stream.markdown('Use **/create-roadmap** to create your roadmap first.\n\n');
    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });
    return { metadata: { lastCommand: 'research-phase' } };
  }

  // Parse phase number from prompt (may include keywords like "additional" or a focus topic)
  const promptText = request.prompt.trim();
  const promptParts = promptText.split(/\s+/);
  const phaseArg = promptParts[0];
  const additionalArgs = promptParts.slice(1).join(' ');

  if (!phaseArg) {
    stream.markdown('## Usage\n\n');
    stream.markdown('**`/research-phase <phase-number> [topic]`**\n\n');
    stream.markdown('Research how to implement a phase before planning.\n\n');
    stream.markdown('**Examples:**\n');
    stream.markdown('- `/research-phase 3` - Research Phase 3\n');
    stream.markdown('- `/research-phase 2.1` - Research inserted Phase 2.1\n');
    stream.markdown('- `/research-phase 3 authentication patterns` - Add research on specific topic\n\n');
    stream.markdown('**When to use:**\n');
    stream.markdown('- 3D graphics, game development, audio/music\n');
    stream.markdown('- ML/AI integration, real-time systems\n');
    stream.markdown('- Specialized frameworks with active ecosystems\n\n');
    stream.markdown('**When to skip:**\n');
    stream.markdown('- Standard web dev (auth, CRUD, REST APIs)\n');
    stream.markdown('- Well-known patterns (forms, validation)\n');
    stream.markdown('- Simple integrations with clear docs\n\n');
    return { metadata: { lastCommand: 'research-phase' } };
  }

  // Validate phase number
  if (!/^[\d.]+$/.test(phaseArg)) {
    stream.markdown('## Invalid Argument\n\n');
    stream.markdown(`"${phaseArg}" is not a valid phase number.\n\n`);
    stream.markdown('**Usage:** `/research-phase <phase-number> [topic]`\n\n');
    return { metadata: { lastCommand: 'research-phase' } };
  }

  const phaseNum = parseFloat(phaseArg);
  if (isNaN(phaseNum) || phaseNum < 1) {
    stream.markdown('## Invalid Phase Number\n\n');
    stream.markdown(`"${promptText}" is not a valid phase number.\n\n`);
    stream.markdown('Phase number must be a positive number (e.g., 3, 2.1).\n\n');
    return { metadata: { lastCommand: 'research-phase' } };
  }

  // Read the FULL roadmap file
  stream.progress('Reading roadmap...');
  const roadmapUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'ROADMAP.md');
  let fullRoadmapContent: string;
  try {
    const roadmapBytes = await vscode.workspace.fs.readFile(roadmapUri);
    fullRoadmapContent = Buffer.from(roadmapBytes).toString('utf-8');
  } catch {
    stream.markdown('**Error:** Could not read ROADMAP.md\n');
    return { metadata: { lastCommand: 'research-phase' } };
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
    return { metadata: { lastCommand: 'research-phase' } };
  }

  // Check if RESEARCH.md already exists
  const dirName = `${formatPhaseNumber(phaseNum)}-${toKebabCase(targetPhase.name)}`;
  const researchFileName = `${formatPhaseNumber(phaseNum)}-RESEARCH.md`;
  const researchUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName, researchFileName);

  let existingResearchContent: string | undefined;
  try {
    const existingBytes = await vscode.workspace.fs.readFile(researchUri);
    existingResearchContent = Buffer.from(existingBytes).toString('utf-8');
  } catch {
    // File doesn't exist, which is expected
  }

  // Check if user wants to add to existing research
  const wantsToAdd = additionalArgs.length > 0;

  if (existingResearchContent && !wantsToAdd) {
    stream.markdown('## Research Already Exists\n\n');
    stream.markdown(`Phase ${phaseNum} (${targetPhase.name}) already has research.\n\n`);
    stream.markdown('**Existing research:**\n');
    stream.reference(researchUri);
    stream.markdown('\n\n');
    stream.markdown('**Options:**\n');
    stream.markdown(`- Add to research: \`/research-phase ${phaseNum} [topic to research]\`\n`);
    stream.markdown(`- Delete the file and run \`/research-phase ${phaseNum}\` to regenerate from scratch\n\n`);
    stream.markdown('**Or proceed to planning:**\n\n');
    stream.button({
      command: 'hopper.chat-participant.plan-phase',
      arguments: [phaseNum],
      title: `Plan Phase ${phaseNum}`
    });
    return { metadata: { lastCommand: 'research-phase' } };
  }

  // Check for existing CONTEXT.md (bonus context)
  let contextContent: string | undefined;
  const contextFileName = `${formatPhaseNumber(phaseNum)}-CONTEXT.md`;
  const contextUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName, contextFileName);
  try {
    const contextBytes = await vscode.workspace.fs.readFile(contextUri);
    contextContent = Buffer.from(contextBytes).toString('utf-8');
  } catch {
    // No context file, that's fine
  }

  // Determine if we're merging with existing research
  const isMerging = !!existingResearchContent && wantsToAdd;

  if (isMerging) {
    stream.markdown('## Adding to Existing Research\n\n');
    stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n\n`);
    stream.markdown(`**Additional topic:** ${additionalArgs}\n\n`);
    stream.progress('Researching additional topic...');
  } else {
    stream.progress('Analyzing phase for research domains...');
  }

  try {
    // Step 1: Identify research domains (or use provided topic for merging)
    let domainAnalysis: {
      needsResearch: boolean;
      reason: string;
      domains: Array<{ name: string; category: string; questions: string[] }>;
      suggestSkip: boolean;
      skipReason: string | null;
    };

    if (isMerging) {
      // When merging, use the user-provided topic as the domain
      domainAnalysis = {
        needsResearch: true,
        reason: `User requested additional research on: ${additionalArgs}`,
        domains: [{ name: additionalArgs, category: 'core-technology', questions: [`What are the best practices for ${additionalArgs}?`] }],
        suggestSkip: false,
        skipReason: null
      };
    } else {
      // Normal flow: identify domains from phase description
      const domainContextParts = [
        `Phase ${phaseNum}: ${targetPhase.name}`,
        `Goal: ${targetPhase.goal}`,
        '',
        'Project context:',
        projectContext.projectMd ? projectContext.projectMd.slice(0, 2000) : 'No project description available'
      ];

      if (contextContent) {
        domainContextParts.push('', 'Additional context from discussion:', contextContent.slice(0, 1000));
      }

      const domainMessages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(RESEARCH_DOMAIN_PROMPT),
        vscode.LanguageModelChatMessage.User(domainContextParts.join('\n'))
      ];

      const domainResponse = await request.model.sendRequest(domainMessages, {}, token);

      let domainResponseText = '';
      for await (const fragment of domainResponse.text) {
        if (token.isCancellationRequested) {
          stream.markdown('**Cancelled**\n');
          return { metadata: { lastCommand: 'research-phase' } };
        }
        domainResponseText += fragment;
      }

      try {
        const jsonStr = extractJsonFromResponse(domainResponseText);
        domainAnalysis = JSON.parse(jsonStr);
      } catch {
        // Default to needing research
        domainAnalysis = {
          needsResearch: true,
          reason: 'Unable to analyze, proceeding with research',
          domains: [{ name: targetPhase.name, category: 'core-technology', questions: ['What is the best approach?'] }],
          suggestSkip: false,
          skipReason: null
        };
      }

      // If research not needed, suggest skipping (only for new research, not merging)
      if (domainAnalysis.suggestSkip || !domainAnalysis.needsResearch) {
        stream.markdown('## Research May Not Be Needed\n\n');
        stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n\n`);
        stream.markdown(`${domainAnalysis.reason || domainAnalysis.skipReason || 'This appears to be commodity work that Claude handles well.'}\n\n`);
        stream.markdown('**Recommendation:** Skip research and proceed directly to planning.\n\n');
        stream.button({
          command: 'hopper.chat-participant.plan-phase',
          arguments: [phaseNum],
          title: `Plan Phase ${phaseNum}`
        });
        stream.markdown('\n\nIf you still want to research, re-run with `/research-phase ${phaseNum}` and specify what to research in a follow-up message.\n');
        return { metadata: { lastCommand: 'research-phase', phaseNumber: phaseNum } };
      }
    }

    // Show what we're researching
    stream.markdown('## Researching Phase\n\n');
    stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n\n`);
    stream.markdown(`**Goal:** ${targetPhase.goal}\n\n`);
    stream.markdown('**Research domains:**\n');
    for (const domain of domainAnalysis.domains) {
      stream.markdown(`- **${domain.name}** (${domain.category})\n`);
      for (const q of domain.questions.slice(0, 2)) {
        stream.markdown(`  - ${q}\n`);
      }
    }
    stream.markdown('\n');

    // Step 2: Fetch live documentation for identified domains
    const { fetchedDocs, docContext } = await fetchDocsForDomains(domainAnalysis.domains, stream);

    if (fetchedDocs.length > 0) {
      stream.markdown(`**Fetched ${fetchedDocs.length} live documentation source(s):**\n`);
      for (const doc of fetchedDocs) {
        stream.markdown(`- ${doc.title} (${doc.source})\n`);
      }
      stream.markdown('\n');
    }

    // Step 3: Conduct comprehensive research (or merge with existing)
    stream.progress(isMerging ? 'Researching and merging...' : 'Conducting comprehensive research...');

    const researchContextParts = [
      `Phase ${phaseNum}: ${targetPhase.name}`,
      `Goal: ${targetPhase.goal}`,
      '',
      'Research domains identified:',
      ...domainAnalysis.domains.map(d => `- ${d.name} (${d.category}): ${d.questions.join(', ')}`),
      '',
      'Project context:',
      projectContext.projectMd ? projectContext.projectMd.slice(0, 3000) : 'No project description'
    ];

    if (contextContent) {
      researchContextParts.push('', 'User vision/context:', contextContent.slice(0, 1500));
    }

    // Include live documentation if fetched
    if (docContext) {
      researchContextParts.push(docContext);
    }

    // Choose prompt based on whether we're merging
    let researchPrompt: string;
    let researchInput: string;

    if (isMerging && existingResearchContent) {
      researchPrompt = RESEARCH_MERGE_PROMPT;
      researchInput = [
        ...researchContextParts,
        '',
        '--- EXISTING RESEARCH ---',
        existingResearchContent.slice(0, 4000),
        '',
        '--- NEW TOPIC TO RESEARCH AND MERGE ---',
        additionalArgs
      ].join('\n');
    } else {
      researchPrompt = RESEARCH_GENERATION_PROMPT;
      researchInput = researchContextParts.join('\n');
    }

    const researchMessages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(researchPrompt),
      vscode.LanguageModelChatMessage.User(researchInput)
    ];

    const researchResponse = await request.model.sendRequest(researchMessages, {}, token);

    let researchResponseText = '';
    for await (const fragment of researchResponse.text) {
      if (token.isCancellationRequested) {
        stream.markdown('**Cancelled**\n');
        return { metadata: { lastCommand: 'research-phase' } };
      }
      researchResponseText += fragment;
    }

    // Parse research findings
    let research: ReturnType<typeof generateResearchMarkdown> extends string ? Parameters<typeof generateResearchMarkdown>[3] : never;

    try {
      const jsonStr = extractJsonFromResponse(researchResponseText);
      research = JSON.parse(jsonStr);

      // Validate required fields with defaults
      research.summary = research.summary || 'Research findings for this phase.';
      research.primaryRecommendation = research.primaryRecommendation || 'Follow standard practices.';
      research.confidence = research.confidence || 'MEDIUM';
      research.standardStack = research.standardStack || { core: [], supporting: [], alternatives: [], installCommand: '# No packages identified' };
      research.architecturePatterns = research.architecturePatterns || { projectStructure: 'src/', patterns: [], antiPatterns: [] };
      research.dontHandRoll = research.dontHandRoll || [];
      research.commonPitfalls = research.commonPitfalls || [];
      research.codeExamples = research.codeExamples || [];
      research.stateOfTheArt = research.stateOfTheArt || { changes: [], newTools: [], deprecated: [] };
      research.openQuestions = research.openQuestions || [];
      research.sources = research.sources || { primary: [], secondary: [], tertiary: [] };
    } catch {
      stream.markdown('## Unable to Generate Research\n\n');
      stream.markdown('Could not parse research findings from the model response.\n\n');
      stream.markdown('**Suggestions:**\n');
      stream.markdown('- Try running the command again\n');
      stream.markdown('- Use `/discuss-phase` to provide more context first\n\n');
      stream.button({
        command: 'hopper.chat-participant.research-phase',
        arguments: [phaseNum],
        title: 'Try Again'
      });
      return { metadata: { lastCommand: 'research-phase' } };
    }

    // Generate RESEARCH.md content
    stream.progress(isMerging ? 'Updating research document...' : 'Creating research document...');
    const primaryDomain = domainAnalysis.domains[0]?.name || targetPhase.name;
    const researchContent = generateResearchMarkdown(phaseNum, targetPhase.name, primaryDomain, research);

    // Ensure phase directory exists
    const phaseDirUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'phases', dirName);
    try {
      await vscode.workspace.fs.createDirectory(phaseDirUri);
    } catch {
      // Directory may already exist
    }

    // Write RESEARCH.md
    await vscode.workspace.fs.writeFile(
      researchUri,
      Buffer.from(researchContent, 'utf-8')
    );

    // Success!
    stream.markdown(isMerging ? '## Research Updated\n\n' : '## Research Complete\n\n');
    stream.markdown(`**Phase ${phaseNum}: ${targetPhase.name}**\n\n`);
    stream.markdown(`**Confidence:** ${research.confidence}\n\n`);
    stream.markdown(`**Primary recommendation:** ${research.primaryRecommendation}\n\n`);

    stream.markdown('### Key Findings\n\n');

    if (research.standardStack.core.length > 0) {
      stream.markdown('**Standard stack:**\n');
      for (const lib of research.standardStack.core.slice(0, 3)) {
        stream.markdown(`- ${lib.name} (${lib.version}) - ${lib.purpose}\n`);
      }
      stream.markdown('\n');
    }

    if (research.dontHandRoll.length > 0) {
      stream.markdown('**Don\'t hand-roll:**\n');
      for (const item of research.dontHandRoll.slice(0, 3)) {
        stream.markdown(`- ${item.problem} → Use ${item.useInstead}\n`);
      }
      stream.markdown('\n');
    }

    if (research.commonPitfalls.length > 0) {
      stream.markdown('**Watch out for:**\n');
      for (const pitfall of research.commonPitfalls.slice(0, 3)) {
        stream.markdown(`- ${pitfall.name}: ${pitfall.howToAvoid}\n`);
      }
      stream.markdown('\n');
    }

    stream.markdown(isMerging ? '**Updated:**\n' : '**Created:**\n');
    stream.reference(researchUri);
    stream.markdown('\n\n');

    if (isMerging) {
      stream.markdown('### Want to Add More?\n\n');
      stream.markdown(`Run \`/research-phase ${phaseNum} [another topic]\` to add more research.\n\n`);
    }

    stream.markdown('### Next Steps\n\n');
    stream.markdown(`Research ${isMerging ? 'updated' : 'complete'}. Use **/plan-phase ${phaseNum}** to create the execution plan.\n\n`);
    stream.button({
      command: 'hopper.chat-participant.plan-phase',
      arguments: [phaseNum],
      title: `Plan Phase ${phaseNum}`
    });

    return {
      metadata: {
        lastCommand: 'research-phase',
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
    return { metadata: { lastCommand: 'research-phase' } };
  }
}
