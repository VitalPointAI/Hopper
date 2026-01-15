import * as vscode from 'vscode';
import { CommandContext, ISpecflowResult } from './types';
import {
  PhaseConfig,
  RoadmapConfig,
  StateConfig,
  saveRoadmap,
  roadmapExists
} from '../generators';

/**
 * System prompt for extracting phases from PROJECT.md
 */
const PHASE_EXTRACTION_PROMPT = `You are helping create a project roadmap by analyzing PROJECT.md and suggesting phases.

Analyze the project requirements and break them into logical phases. Each phase should:
- Deliver something coherent and testable
- Build on previous phases when needed
- Be completable in reasonable scope (not too large)

Output your response as JSON with this exact structure:
{
  "overview": "One paragraph describing the journey from start to finish",
  "phases": [
    {
      "name": "kebab-case-name",
      "goal": "What this phase delivers (1-2 sentences)",
      "dependsOn": null,
      "researchLikely": false,
      "researchTopics": null
    },
    {
      "name": "next-phase",
      "goal": "What this phase delivers",
      "dependsOn": 1,
      "researchLikely": true,
      "researchTopics": "External API integration, new libraries"
    }
  ]
}

Guidelines:
- Target 3-8 phases based on project complexity
- Use kebab-case names (e.g., "foundation", "core-features", "user-auth")
- First phase dependsOn should be null
- Subsequent phases typically depend on the previous phase
- researchLikely = true for: external APIs, new libraries, architectural decisions
- researchLikely = false for: internal patterns, CRUD operations, established conventions
- Include researchTopics when researchLikely is true

Always return valid JSON.`;

/**
 * Parse JSON from LLM response, handling markdown code blocks
 */
function parsePhaseResponse(response: string): { overview: string; phases: Omit<PhaseConfig, 'number'>[] } | null {
  try {
    // Remove markdown code blocks if present
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);

    // Validate structure
    if (!parsed.overview || typeof parsed.overview !== 'string') {
      return null;
    }
    if (!Array.isArray(parsed.phases) || parsed.phases.length === 0) {
      return null;
    }

    // Validate each phase
    for (const phase of parsed.phases) {
      if (!phase.name || typeof phase.name !== 'string') {
        return null;
      }
      if (!phase.goal || typeof phase.goal !== 'string') {
        return null;
      }
    }

    return {
      overview: parsed.overview,
      phases: parsed.phases.map((p: {
        name: string;
        goal: string;
        dependsOn?: number | null;
        researchLikely?: boolean;
        researchTopics?: string | null;
      }) => ({
        name: p.name,
        goal: p.goal,
        dependsOn: p.dependsOn ?? undefined,
        researchLikely: p.researchLikely ?? false,
        researchTopics: p.researchTopics ?? undefined
      }))
    };
  } catch {
    return null;
  }
}

/**
 * Extract core value from PROJECT.md content
 */
function extractCoreValue(projectMd: string): string {
  // Look for Core Value section
  const coreValueMatch = projectMd.match(/##\s*Core Value\s*\n+([^\n#]+)/i);
  if (coreValueMatch) {
    return coreValueMatch[1].trim();
  }
  return 'Deliver value to users';
}

/**
 * Extract project name from PROJECT.md content
 */
function extractProjectName(projectMd: string): string {
  // Look for first heading
  const match = projectMd.match(/^#\s+(.+)$/m);
  if (match) {
    return match[1].trim();
  }
  return 'Project';
}

/**
 * Handle /create-roadmap command
 *
 * Creates ROADMAP.md and STATE.md by:
 * 1. Checking if PROJECT.md exists
 * 2. Using LLM to suggest phases based on requirements
 * 3. Generating files following GSD templates
 */
export async function handleCreateRoadmap(ctx: CommandContext): Promise<ISpecflowResult> {
  const { request, stream, token, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/create-roadmap` again.\n');
    return { metadata: { lastCommand: 'create-roadmap' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if PROJECT.md exists
  if (!projectContext.hasPlanning || !projectContext.projectMd) {
    stream.markdown('## No Project Found\n\n');
    stream.markdown('Cannot create roadmap without PROJECT.md.\n\n');
    stream.markdown('Use **/new-project** to initialize your project first.\n\n');
    stream.button({
      command: 'specflow.chat-participant.new-project',
      title: 'Create Project'
    });
    return { metadata: { lastCommand: 'create-roadmap' } };
  }

  // Check if ROADMAP.md already exists
  if (await roadmapExists(workspaceUri)) {
    stream.markdown('## Roadmap Already Exists\n\n');
    stream.markdown('This project already has a ROADMAP.md file.\n\n');

    if (projectContext.planningUri) {
      const roadmapUri = vscode.Uri.joinPath(projectContext.planningUri, 'ROADMAP.md');
      stream.markdown('**Existing roadmap:**\n');
      stream.reference(roadmapUri);
    }

    stream.markdown('\n**Options:**\n');
    stream.markdown('- View your roadmap with `/status`\n');
    stream.markdown('- Start planning phases with `/plan-phase 1`\n');
    stream.markdown('- Delete `.planning/ROADMAP.md` manually to recreate\n');

    stream.button({
      command: 'specflow.chat-participant.status',
      title: 'View Status'
    });

    return { metadata: { lastCommand: 'create-roadmap' } };
  }

  // Process PROJECT.md with LLM to suggest phases
  stream.progress('Reading project details...');

  const projectMd = projectContext.projectMd;
  const projectName = extractProjectName(projectMd);
  const coreValue = extractCoreValue(projectMd);

  stream.progress('Analyzing requirements and planning phases...');

  try {
    // Build messages for LLM
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(PHASE_EXTRACTION_PROMPT),
      vscode.LanguageModelChatMessage.User(`PROJECT.md content:\n\n${projectMd}`)
    ];

    // Send to model
    const response = await request.model.sendRequest(messages, {}, token);

    // Collect full response
    let fullResponse = '';
    for await (const fragment of response.text) {
      if (token.isCancellationRequested) {
        stream.markdown('**Cancelled**\n');
        return { metadata: { lastCommand: 'create-roadmap' } };
      }
      fullResponse += fragment;
    }

    // Parse the response
    const parsed = parsePhaseResponse(fullResponse);

    if (!parsed) {
      stream.markdown('**Error:** Could not parse phase suggestions.\n\n');
      stream.markdown('The model returned:\n```\n' + fullResponse.slice(0, 500) + '\n```\n\n');
      stream.markdown('Please try again or provide more details in PROJECT.md.\n');
      return { metadata: { lastCommand: 'create-roadmap' } };
    }

    // Add phase numbers
    const phases: PhaseConfig[] = parsed.phases.map((p, index) => ({
      ...p,
      number: index + 1
    }));

    // Show suggested phases
    stream.markdown('## Suggested Phases\n\n');
    stream.markdown(`Based on your PROJECT.md, here's the recommended roadmap:\n\n`);

    for (const phase of phases) {
      const research = phase.researchLikely ? ' (research likely)' : '';
      stream.markdown(`${phase.number}. **${phase.name}** - ${phase.goal}${research}\n`);
    }
    stream.markdown('\n');

    // Generate files
    stream.progress('Creating roadmap files...');

    const roadmapConfig: RoadmapConfig = {
      projectName,
      overview: parsed.overview,
      phases
    };

    const stateConfig: StateConfig = {
      projectName,
      coreValue,
      currentPhase: 1,
      totalPhases: phases.length
    };

    const result = await saveRoadmap(workspaceUri, roadmapConfig, stateConfig);

    if (!result.success) {
      stream.markdown(`**Error:** ${result.error}\n`);
      return { metadata: { lastCommand: 'create-roadmap' } };
    }

    // Success!
    stream.markdown('## Roadmap Created\n\n');
    stream.markdown(`Created roadmap with **${phases.length} phases** for ${projectName}.\n\n`);

    // Show created files
    stream.markdown('### Created Files\n\n');

    if (projectContext.planningUri) {
      const roadmapUri = vscode.Uri.joinPath(projectContext.planningUri, 'ROADMAP.md');
      const stateUri = vscode.Uri.joinPath(projectContext.planningUri, 'STATE.md');

      stream.reference(roadmapUri);
      stream.reference(stateUri);
      stream.markdown('\n');

      // Button to open roadmap
      stream.button({
        command: 'vscode.open',
        arguments: [roadmapUri],
        title: 'Open ROADMAP.md'
      });
    }

    // Show phase directories
    stream.markdown('\n### Phase Directories\n\n');
    stream.markdown('Created directories under `.planning/phases/`:\n');
    for (const phase of phases) {
      const dirName = `${phase.number.toString().padStart(2, '0')}-${phase.name}`;
      stream.markdown(`- ${dirName}/\n`);
    }
    stream.markdown('\n');

    // Next steps
    stream.markdown('### Next Steps\n\n');
    stream.markdown('Use **/plan-phase 1** to create the detailed execution plan for Phase 1.\n\n');

    stream.button({
      command: 'specflow.chat-participant.plan-phase',
      title: 'Plan Phase 1'
    });

    return { metadata: { lastCommand: 'create-roadmap', phaseNumber: 1 } };

  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      stream.markdown(`**Model Error:** ${err.message}\n\n`);
      stream.markdown('Please check your model connection and try again.\n');
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err);
      stream.markdown(`**Error:** ${errorMessage}\n`);
    }
    return { metadata: { lastCommand: 'create-roadmap' } };
  }
}
