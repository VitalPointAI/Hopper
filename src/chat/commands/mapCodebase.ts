import * as vscode from 'vscode';
import { CommandContext, IHopperResult } from './types';

/**
 * Document types that map-codebase generates
 */
type CodebaseDocType =
  | 'ARCHITECTURE'
  | 'STACK'
  | 'CONVENTIONS'
  | 'STRUCTURE'
  | 'CONCERNS'
  | 'INTEGRATIONS'
  | 'TESTING';

interface DocGenConfig {
  type: CodebaseDocType;
  filename: string;
  description: string;
  prompt: string;
}

/**
 * Configuration for each document type
 */
const DOC_CONFIGS: DocGenConfig[] = [
  {
    type: 'ARCHITECTURE',
    filename: 'ARCHITECTURE.md',
    description: 'System design, module structure, data flow',
    prompt: `Analyze the codebase and generate ARCHITECTURE.md documentation.

Focus on:
- Overall system architecture (monolith, modular, microservices)
- Core modules and their responsibilities
- Data flow between components
- Entry points and main execution paths
- Key abstractions and interfaces

Output format:
# Architecture

## Overview
[2-3 sentences describing the architecture style]

## Core Modules
[List each major module with its purpose]

## Data Flow
[Describe how data moves through the system]

## Entry Points
[List main entry points: CLI, API, UI, etc.]

## Key Abstractions
[Important interfaces, base classes, patterns]

Keep it concise but comprehensive.`
  },
  {
    type: 'STACK',
    filename: 'STACK.md',
    description: 'Technologies, versions, dependencies',
    prompt: `Analyze the codebase and generate STACK.md documentation.

Focus on:
- Primary language(s) and version requirements
- Framework(s) used
- Key dependencies and their purposes
- Build tools and configuration
- Development vs production dependencies

Output format:
# Technology Stack

## Languages
[Language and version]

## Frameworks
[Primary frameworks]

## Key Dependencies
| Package | Purpose | Version |
|---------|---------|---------|
| ... | ... | ... |

## Build Tools
[Build/bundle tools and config]

## Development Tools
[Linters, formatters, test tools]

Be specific about versions and purposes.`
  },
  {
    type: 'CONVENTIONS',
    filename: 'CONVENTIONS.md',
    description: 'Coding patterns, naming, style',
    prompt: `Analyze the codebase and generate CONVENTIONS.md documentation.

Focus on:
- Naming conventions (files, functions, variables, types)
- Code organization patterns
- Common patterns used (factory, singleton, etc.)
- Error handling conventions
- Comment and documentation style
- Import/export patterns

Output format:
# Coding Conventions

## Naming
- Files: [pattern]
- Functions: [pattern]
- Variables: [pattern]
- Types/Interfaces: [pattern]

## Patterns Used
[List common patterns with examples]

## Error Handling
[How errors are handled]

## Documentation Style
[How code is documented]

## File Organization
[How files are structured]

Show real examples from the codebase.`
  },
  {
    type: 'STRUCTURE',
    filename: 'STRUCTURE.md',
    description: 'Directory organization, file purposes',
    prompt: `Analyze the codebase and generate STRUCTURE.md documentation.

Focus on:
- Directory tree with purpose of each directory
- Key files and their roles
- Where to find specific types of code
- Configuration files locations

Output format:
# Directory Structure

## Overview
\`\`\`
project/
├── src/           # Source code
│   ├── ...        # Description
├── tests/         # Test files
├── config/        # Configuration
└── ...
\`\`\`

## Key Files
| File | Purpose |
|------|---------|
| ... | ... |

## Where to Find Things
- Components: [path]
- Utils: [path]
- Tests: [path]
- Config: [path]

Be specific about the actual structure.`
  },
  {
    type: 'CONCERNS',
    filename: 'CONCERNS.md',
    description: 'Tech debt, known issues, improvement areas',
    prompt: `Analyze the codebase and generate CONCERNS.md documentation.

Focus on:
- Obvious tech debt (TODOs, FIXMEs, hacks)
- Inconsistencies in patterns
- Outdated dependencies
- Missing tests or documentation
- Performance concerns
- Security considerations

Output format:
# Technical Concerns

## Tech Debt
[List known debt items]

## Inconsistencies
[Pattern inconsistencies found]

## Dependencies
[Outdated or concerning dependencies]

## Testing Gaps
[Areas lacking test coverage]

## Security
[Security considerations]

## Recommendations
[Priority improvements]

Be honest but constructive.`
  },
  {
    type: 'INTEGRATIONS',
    filename: 'INTEGRATIONS.md',
    description: 'External services, APIs',
    prompt: `Analyze the codebase and generate INTEGRATIONS.md documentation.

Focus on:
- External APIs consumed
- Third-party services used
- Authentication methods for each
- Environment variables needed
- Webhook endpoints exposed

Output format:
# External Integrations

## APIs Consumed
| Service | Purpose | Auth Method |
|---------|---------|-------------|
| ... | ... | ... |

## Third-Party Services
[List services: databases, storage, etc.]

## Environment Variables
| Variable | Purpose | Required |
|----------|---------|----------|
| ... | ... | ... |

## Webhooks
[Endpoints exposed for external services]

## API Clients
[Where API client code lives]

Be specific about what's actually integrated.`
  },
  {
    type: 'TESTING',
    filename: 'TESTING.md',
    description: 'Test setup, coverage, patterns',
    prompt: `Analyze the codebase and generate TESTING.md documentation.

Focus on:
- Test framework(s) used
- Test organization (unit, integration, e2e)
- How to run tests
- Coverage expectations
- Mocking patterns
- Test data approaches

Output format:
# Testing

## Framework
[Test framework and version]

## Running Tests
\`\`\`bash
# Unit tests
npm test

# Integration tests
npm run test:integration
\`\`\`

## Organization
- Unit tests: [location and pattern]
- Integration tests: [location and pattern]
- E2E tests: [location and pattern]

## Patterns
[Common testing patterns used]

## Mocking
[How mocks are handled]

## Coverage
[Coverage requirements and how to check]

Be specific about actual test setup.`
  }
];

/**
 * Collect workspace information for LLM context
 */
async function collectWorkspaceInfo(
  workspaceUri: vscode.Uri,
  stream: vscode.ChatResponseStream
): Promise<string> {
  const contextParts: string[] = [];

  // Read package.json if exists
  try {
    stream.progress('Reading package.json...');
    const pkgUri = vscode.Uri.joinPath(workspaceUri, 'package.json');
    const pkgBytes = await vscode.workspace.fs.readFile(pkgUri);
    const pkgContent = Buffer.from(pkgBytes).toString('utf-8');
    contextParts.push('## package.json\n```json\n' + pkgContent + '\n```\n');
  } catch {
    // No package.json
  }

  // Read tsconfig.json if exists
  try {
    const tsconfigUri = vscode.Uri.joinPath(workspaceUri, 'tsconfig.json');
    const tsconfigBytes = await vscode.workspace.fs.readFile(tsconfigUri);
    const tsconfigContent = Buffer.from(tsconfigBytes).toString('utf-8');
    contextParts.push('## tsconfig.json\n```json\n' + tsconfigContent + '\n```\n');
  } catch {
    // No tsconfig.json
  }

  // Get directory structure
  stream.progress('Scanning directory structure...');
  const structure = await getDirectoryStructure(workspaceUri, '', 3);
  contextParts.push('## Directory Structure\n```\n' + structure + '\n```\n');

  // Sample source files
  stream.progress('Reading sample source files...');
  const sourceFiles = await findSourceFiles(workspaceUri);
  for (const file of sourceFiles.slice(0, 5)) {
    try {
      const bytes = await vscode.workspace.fs.readFile(file);
      const content = Buffer.from(bytes).toString('utf-8');
      const relativePath = vscode.workspace.asRelativePath(file);
      // Truncate long files
      const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n... (truncated)' : content;
      contextParts.push(`## ${relativePath}\n\`\`\`\n${truncated}\n\`\`\`\n`);
    } catch {
      // Skip unreadable files
    }
  }

  return contextParts.join('\n');
}

/**
 * Get directory structure as a tree string
 */
async function getDirectoryStructure(
  uri: vscode.Uri,
  prefix: string,
  maxDepth: number
): Promise<string> {
  if (maxDepth <= 0) {
    return '';
  }

  const lines: string[] = [];

  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const sorted = entries.sort((a, b) => {
      // Directories first
      if (a[1] === vscode.FileType.Directory && b[1] !== vscode.FileType.Directory) return -1;
      if (a[1] !== vscode.FileType.Directory && b[1] === vscode.FileType.Directory) return 1;
      return a[0].localeCompare(b[0]);
    });

    // Skip common ignore patterns
    const filtered = sorted.filter(([name]) =>
      !['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage', '.planning'].includes(name) &&
      !name.startsWith('.')
    );

    for (let i = 0; i < filtered.length; i++) {
      const [name, type] = filtered[i];
      const isLast = i === filtered.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');

      if (type === vscode.FileType.Directory) {
        lines.push(prefix + connector + name + '/');
        const childLines = await getDirectoryStructure(
          vscode.Uri.joinPath(uri, name),
          childPrefix,
          maxDepth - 1
        );
        if (childLines) {
          lines.push(childLines);
        }
      } else {
        lines.push(prefix + connector + name);
      }
    }
  } catch {
    // Can't read directory
  }

  return lines.join('\n');
}

/**
 * Find source files to sample
 */
async function findSourceFiles(workspaceUri: vscode.Uri): Promise<vscode.Uri[]> {
  const patterns = [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.py',
    '**/*.go',
    '**/*.rs'
  ];

  const files: vscode.Uri[] = [];

  for (const pattern of patterns) {
    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceUri, pattern),
      '**/node_modules/**',
      10
    );
    files.push(...found);
    if (files.length >= 10) break;
  }

  return files.slice(0, 10);
}

/**
 * Generate a single codebase document using LLM
 */
async function generateDocument(
  config: DocGenConfig,
  workspaceContext: string,
  request: vscode.ChatRequest,
  token: vscode.CancellationToken
): Promise<string> {
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(config.prompt),
    vscode.LanguageModelChatMessage.User('Here is the codebase information:\n\n' + workspaceContext)
  ];

  const response = await request.model.sendRequest(messages, {}, token);

  let content = '';
  for await (const fragment of response.text) {
    if (token.isCancellationRequested) {
      throw new Error('Cancelled');
    }
    content += fragment;
  }

  return content;
}

/**
 * Handle /map-codebase command
 *
 * Analyzes the codebase and generates structured documentation in .planning/codebase/
 */
export async function handleMapCodebase(ctx: CommandContext): Promise<IHopperResult> {
  const { request, stream, token } = ctx;

  // Check for workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    stream.markdown('**Error:** No workspace folder open.\n\n');
    stream.markdown('Please open a folder first, then run `/map-codebase` again.\n');
    return { metadata: { lastCommand: 'map-codebase' } };
  }

  const workspaceUri = workspaceFolders[0].uri;

  // Check for --force flag
  const forceRegenerate = request.prompt.includes('--force');

  // Check if mapping already exists
  const codebaseDir = vscode.Uri.joinPath(workspaceUri, '.planning', 'codebase');
  let existingFiles: [string, vscode.FileType][] = [];
  try {
    existingFiles = await vscode.workspace.fs.readDirectory(codebaseDir);
  } catch {
    // Directory doesn't exist
  }

  if (existingFiles.length > 0 && !forceRegenerate) {
    stream.markdown('## Codebase Mapping Exists\n\n');
    stream.markdown('Found existing codebase documentation:\n');
    for (const [name] of existingFiles) {
      if (name.endsWith('.md')) {
        stream.markdown(`- ${name}\n`);
      }
    }
    stream.markdown('\n');
    stream.markdown('To regenerate, run: `/map-codebase --force`\n\n');
    stream.button({
      command: 'hopper.chat-participant.map-codebase',
      arguments: ['--force'],
      title: 'Regenerate Mapping'
    });
    return { metadata: { lastCommand: 'map-codebase' } };
  }

  stream.markdown('## Mapping Codebase\n\n');
  stream.markdown('Analyzing workspace and generating documentation...\n\n');

  // Collect workspace information
  stream.progress('Collecting workspace information...');
  const workspaceContext = await collectWorkspaceInfo(workspaceUri, stream);

  // Ensure .planning/codebase directory exists
  try {
    await vscode.workspace.fs.createDirectory(codebaseDir);
  } catch {
    // Directory may already exist
  }

  // Generate each document
  const generatedFiles: string[] = [];
  const errors: string[] = [];

  for (const config of DOC_CONFIGS) {
    if (token.isCancellationRequested) {
      stream.markdown('\n**Cancelled**\n');
      return { metadata: { lastCommand: 'map-codebase' } };
    }

    stream.progress(`Generating ${config.filename}...`);
    stream.markdown(`- Generating **${config.filename}** (${config.description})...\n`);

    try {
      const content = await generateDocument(config, workspaceContext, request, token);

      // Write the file
      const fileUri = vscode.Uri.joinPath(codebaseDir, config.filename);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));

      generatedFiles.push(config.filename);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${config.filename}: ${errorMsg}`);
    }
  }

  // Summary
  stream.markdown('\n### Mapping Complete\n\n');

  if (generatedFiles.length > 0) {
    stream.markdown(`**Generated ${generatedFiles.length} documents:**\n`);
    for (const filename of generatedFiles) {
      const fileUri = vscode.Uri.joinPath(codebaseDir, filename);
      stream.reference(fileUri);
    }
    stream.markdown('\n');
  }

  if (errors.length > 0) {
    stream.markdown('**Errors:**\n');
    for (const error of errors) {
      stream.markdown(`- ${error}\n`);
    }
    stream.markdown('\n');
  }

  stream.markdown('### Usage\n\n');
  stream.markdown('The codebase mapping will be automatically included when planning phases.\n\n');
  stream.markdown('- UI phases will reference: CONVENTIONS.md, STRUCTURE.md\n');
  stream.markdown('- API phases will reference: ARCHITECTURE.md, CONVENTIONS.md\n');
  stream.markdown('- Database phases will reference: ARCHITECTURE.md, STACK.md\n');
  stream.markdown('- Testing phases will reference: TESTING.md, CONVENTIONS.md\n\n');

  stream.button({
    command: 'hopper.chat-participant.plan-phase',
    title: 'Plan Next Phase'
  });

  return {
    metadata: {
      lastCommand: 'map-codebase'
    }
  };
}
