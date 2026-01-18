import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';
import {
  PhaseConfig,
  RoadmapConfig,
  StateConfig,
  saveRoadmap,
  roadmapExists
} from '../generators';
import { ConfigManager, getPhaseExtractionPrompt } from '../../config';

/**
 * Extract JSON from response, handling various markdown formats
 */
function extractJsonFromResponse(response: string): string {
  // Try to find JSON block in markdown
  const jsonBlockMatch = response.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }

  // Try generic code block
  const codeBlockMatch = response.match(/```\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find JSON object directly (starts with { ends with })
  const jsonObjectMatch = response.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    return jsonObjectMatch[0];
  }

  // Return trimmed response as fallback
  return response.trim();
}

/**
 * Fallback parser for non-JSON responses
 * Attempts to extract phases from structured text
 */
function fallbackParsePhases(response: string): { overview: string; phases: Omit<PhaseConfig, 'number'>[] } | null {
  try {
    // Look for numbered list patterns like "1. Phase Name - Description"
    const phasePattern = /(\d+)\.\s*\*?\*?([^*\-:]+)\*?\*?\s*[-:]\s*(.+)/g;
    const phases: Omit<PhaseConfig, 'number'>[] = [];
    let match;

    while ((match = phasePattern.exec(response)) !== null) {
      const name = match[2].trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const goal = match[3].trim();

      if (name && goal) {
        phases.push({
          name,
          goal,
          dependsOn: phases.length > 0 ? phases.length : undefined,
          researchLikely: false
        });
      }
    }

    if (phases.length >= 2) {
      // Extract overview from first paragraph or generate one
      const overviewMatch = response.match(/^([^0-9\n][^\n]+)/);
      const overview = overviewMatch
        ? overviewMatch[1].trim()
        : `A structured approach to building the project in ${phases.length} phases.`;

      return { overview, phases };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse JSON from LLM response, handling markdown code blocks
 * Falls back to text parsing if JSON fails
 */
function parsePhaseResponse(response: string): { overview: string; phases: Omit<PhaseConfig, 'number'>[] } | null {
  // First, try to extract and parse JSON
  try {
    const jsonStr = extractJsonFromResponse(response);
    const parsed = JSON.parse(jsonStr);

    // Validate structure
    if (!parsed.overview || typeof parsed.overview !== 'string') {
      throw new Error('Missing overview');
    }
    if (!Array.isArray(parsed.phases) || parsed.phases.length === 0) {
      throw new Error('Missing or empty phases');
    }

    // Validate each phase
    for (const phase of parsed.phases) {
      if (!phase.name || typeof phase.name !== 'string') {
        throw new Error('Phase missing name');
      }
      if (!phase.goal || typeof phase.goal !== 'string') {
        throw new Error('Phase missing goal');
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
    // JSON parsing failed, try fallback parser
    return fallbackParsePhases(response);
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
export async function handleCreateRoadmap(ctx: CommandContext): Promise<IHopperResult> {
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
      command: 'hopper.chat-participant.new-project',
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
      stream.markdown('\n');

      // Button to view existing roadmap
      stream.button({
        command: 'vscode.open',
        arguments: [roadmapUri],
        title: 'View ROADMAP.md'
      });
    }

    stream.markdown('\n**Options:**\n');
    stream.markdown('- View your project status with `/status`\n');
    stream.markdown('- Start planning phases with `/plan-phase 1`\n');
    stream.markdown('- Delete `.planning/ROADMAP.md` manually to recreate\n\n');

    stream.button({
      command: 'hopper.chat-participant.status',
      title: 'View Status'
    });

    stream.button({
      command: 'hopper.chat-participant.plan-phase',
      arguments: [1],
      title: 'Plan Phase 1'
    });

    return { metadata: { lastCommand: 'create-roadmap' } };
  }

  // Process PROJECT.md with LLM to suggest phases
  stream.progress('Reading project details...');

  const projectMd = projectContext.projectMd;
  const projectName = extractProjectName(projectMd);
  const coreValue = extractCoreValue(projectMd);

  // Load config for planning depth (will return defaults if missing)
  const configManager = new ConfigManager(workspaceUri);
  const config = await configManager.loadConfig();
  const planningDepth = config.planningDepth;

  stream.progress('Analyzing requirements and planning phases...');

  // Show planning depth indicator
  stream.markdown(`**Planning depth:** ${planningDepth}\n\n`);

  try {
    // Build messages for LLM using depth-aware prompt
    const phasePrompt = getPhaseExtractionPrompt(planningDepth);
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(phasePrompt),
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
      stream.markdown('## Unable to Parse Phases\n\n');
      stream.markdown('Could not extract phase information from the model response.\n\n');
      stream.markdown('**Model output (preview):**\n```\n' + fullResponse.slice(0, 500) + '\n```\n\n');
      stream.markdown('**Suggestions:**\n');
      stream.markdown('- Try running the command again\n');
      stream.markdown('- Add more specific requirements to PROJECT.md\n');
      stream.markdown('- Ensure PROJECT.md describes clear deliverables\n\n');

      stream.button({
        command: 'hopper.chat-participant.create-roadmap',
        title: 'Try Again'
      });

      if (projectContext.planningUri) {
        const projectUri = vscode.Uri.joinPath(projectContext.planningUri, 'PROJECT.md');
        stream.button({
          command: 'vscode.open',
          arguments: [projectUri],
          title: 'Edit PROJECT.md'
        });
      }

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
      command: 'hopper.chat-participant.plan-phase',
      arguments: [1],
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
