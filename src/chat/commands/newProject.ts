import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CommandContext, IHopperResult } from './types';
import { ProjectConfig, saveProject, planningExists } from '../generators';
import {
  ConfigManager,
  selectPlanningDepth,
  selectExecutionMode,
  showConfigurationSummary,
  createDefaultConfig,
  getProjectExtractionPrompt
} from '../../config';

const execAsync = promisify(exec);

/**
 * Parse JSON from LLM response, handling markdown code blocks
 */
function parseJsonResponse(response: string): ProjectConfig | null {
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

    // Validate required fields
    if (!parsed.name || typeof parsed.name !== 'string') {
      return null;
    }

    // Provide defaults for missing fields
    return {
      name: parsed.name,
      description: parsed.description || 'A new project initialized with Hopper',
      coreValue: parsed.coreValue || 'Deliver value to users',
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
      outOfScope: Array.isArray(parsed.outOfScope) ? parsed.outOfScope : [],
      context: parsed.context || '',
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : []
    };
  } catch {
    return null;
  }
}

/**
 * Handle /new-project command
 *
 * Creates a new PROJECT.md file by:
 * 1. Checking if .planning already exists
 * 2. Using LLM to extract project details from user's description
 * 3. Generating PROJECT.md following GSD template
 */
export async function handleNewProject(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token, projectContext } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/new-project` again.\n');
    return { metadata: { lastCommand: 'new-project' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check if .planning already exists
  if (projectContext.hasPlanning || await planningExists(workspaceUri)) {
    stream.markdown('## Existing Project Found\n\n');
    stream.markdown('This workspace already has a `.planning` directory.\n\n');

    // Show reference to existing PROJECT.md
    if (projectContext.planningUri) {
      const projectUri = vscode.Uri.joinPath(projectContext.planningUri, 'PROJECT.md');
      stream.markdown('**Existing project:**\n');
      stream.reference(projectUri);
    }

    stream.markdown('\n**Options:**\n');
    stream.markdown('- View your current project with `/status`\n');
    stream.markdown('- Continue planning with `/create-roadmap`\n');
    stream.markdown('- Delete `.planning/` manually to start fresh\n');

    stream.button({
      command: 'hopper.chat-participant.status',
      title: 'View Status'
    });

    return { metadata: { lastCommand: 'new-project' } };
  }

  // Check if user provided input
  const userInput = request.prompt.trim();

  if (!userInput) {
    // No input provided - explain what's needed
    stream.markdown('## Initialize New Project\n\n');
    stream.markdown('Tell me about your project! Include:\n\n');
    stream.markdown('- **Project name** - What should we call it?\n');
    stream.markdown('- **Description** - What does it do? Who is it for?\n');
    stream.markdown('- **Core value** - What\'s the ONE thing that matters most?\n');
    stream.markdown('- **Requirements** - What features are you building?\n');
    stream.markdown('- **Constraints** - Any tech stack, timeline, or other limitations?\n\n');
    stream.markdown('**Example:**\n');
    stream.markdown('```\n/new-project TaskFlow is a task management app for small teams. Core value: simple team collaboration. Requirements: create tasks, assign to members, track progress. Built with React and Node.js.\n```\n');
    return { metadata: { lastCommand: 'new-project' } };
  }

  // Process user input with LLM
  stream.progress('Analyzing your project description...');

  try {
    // Build messages for LLM
    // Use 'standard' depth for new projects since config doesn't exist yet
    // User selects final depth after PROJECT.md creation
    const extractionPrompt = getProjectExtractionPrompt('standard');
    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(extractionPrompt),
      vscode.LanguageModelChatMessage.User(`User's project description:\n\n${userInput}`)
    ];

    // Send to model
    const response = await request.model.sendRequest(messages, {}, token);

    // Collect full response
    let fullResponse = '';
    for await (const fragment of response.text) {
      if (token.isCancellationRequested) {
        stream.markdown('**Cancelled**\n');
        return { metadata: { lastCommand: 'new-project' } };
      }
      fullResponse += fragment;
    }

    // Parse the response
    const config = parseJsonResponse(fullResponse);

    if (!config) {
      stream.markdown('**Error:** Could not parse project details.\n\n');
      stream.markdown('**Debug - Model response:**\n');
      stream.markdown('```\n' + fullResponse.slice(0, 500) + '\n```\n\n');
      stream.markdown('Please try again with a clearer description including:\n');
      stream.markdown('- Project name\n');
      stream.markdown('- What it does\n');
      stream.markdown('- Key requirements\n');
      return { metadata: { lastCommand: 'new-project' } };
    }

    // Generate and save PROJECT.md
    stream.progress('Generating PROJECT.md...');

    const result = await saveProject(workspaceUri, config);

    if (!result.success) {
      stream.markdown(`**Error:** ${result.error}\n`);
      return { metadata: { lastCommand: 'new-project' } };
    }

    // Success!
    stream.markdown('## Project Initialized\n\n');
    stream.markdown(`**${config.name}** has been created!\n\n`);

    // Show what was created
    stream.markdown('### Project Details\n\n');
    stream.markdown(`**Description:** ${config.description}\n\n`);
    stream.markdown(`**Core Value:** ${config.coreValue}\n\n`);

    if (config.requirements.length > 0) {
      stream.markdown('**Requirements:**\n');
      for (const req of config.requirements) {
        stream.markdown(`- ${req}\n`);
      }
      stream.markdown('\n');
    }

    if (config.constraints.length > 0) {
      stream.markdown('**Constraints:**\n');
      for (const c of config.constraints) {
        stream.markdown(`- ${c}\n`);
      }
      stream.markdown('\n');
    }

    // Show assumptions note if defaults were applied
    const hasDefaults =
      config.requirements.length === 0 ||
      config.outOfScope.length === 0 ||
      config.constraints.length === 0;

    if (hasDefaults) {
      stream.markdown('*Note: Some fields used defaults. Edit PROJECT.md to add more details.*\n\n');
    }

    // Reference to created file
    stream.markdown('### Created Files\n\n');
    if (result.filePath) {
      stream.reference(result.filePath);
      stream.markdown('\n');

      // Button to open the file
      stream.button({
        command: 'vscode.open',
        arguments: [result.filePath],
        title: 'Open PROJECT.md'
      });
    }

    // Initialize git repository for new projects
    const workspacePath = workspaceFolders[0].uri.fsPath;
    try {
      // Check if git repo already exists
      await execAsync('git rev-parse --git-dir', { cwd: workspacePath });
      // Git already initialized - skip
    } catch {
      // No git repo exists - initialize one
      stream.progress('Initializing git repository...');
      try {
        await execAsync('git init', { cwd: workspacePath });
        await execAsync('git add .planning/', { cwd: workspacePath });
        await execAsync('git commit -m "chore: initialize project with Hopper"', { cwd: workspacePath });
        stream.markdown('\n✓ Git repository initialized with initial commit\n\n');
      } catch (gitError) {
        // Git not available or error - warn but continue
        const errorMsg = gitError instanceof Error ? gitError.message : String(gitError);
        stream.markdown(`\n⚠️ Could not initialize git: ${errorMsg}\n\n`);
        stream.markdown('*Git commit integration will be unavailable. Install git and run `git init` manually.*\n\n');
      }
    }

    // Configure project settings
    stream.progress('Configuring project settings...');

    // Prompt for planning depth - use default if cancelled
    const selectedDepth = await selectPlanningDepth();
    const depth = selectedDepth ?? 'standard';

    // Prompt for execution mode - use default if cancelled
    const selectedMode = await selectExecutionMode();
    const mode = selectedMode ?? 'guided';

    // Save configuration
    const configManager = new ConfigManager(workspaceUri);
    const hopperConfig = createDefaultConfig();
    hopperConfig.planningDepth = depth;
    hopperConfig.executionMode = mode;
    await configManager.saveConfig(hopperConfig);

    // Show configuration summary
    showConfigurationSummary(hopperConfig, stream);

    // Next steps
    stream.markdown('\n### Next Steps\n\n');
    stream.markdown('Use **/create-roadmap** to plan your project phases.\n\n');

    stream.button({
      command: 'hopper.chat-participant.create-roadmap',
      title: 'Create Roadmap'
    });

    return { metadata: { lastCommand: 'new-project' } };

  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      stream.markdown(`**Model Error:** ${err.message}\n\n`);
      stream.markdown('Please check your model connection and try again.\n');
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err);
      stream.markdown(`**Error:** ${errorMessage}\n`);
    }
    return { metadata: { lastCommand: 'new-project' } };
  }
}
