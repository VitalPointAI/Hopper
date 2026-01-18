/**
 * Depth-aware prompt templates for LLM-based planning.
 *
 * These functions generate prompts that vary based on the configured
 * planning depth (quick/standard/comprehensive).
 */

import type { PlanningDepth } from './types';

/**
 * Generate project extraction prompt based on planning depth.
 *
 * - quick: Name, description, coreValue, 3-5 requirements
 * - standard: Full extraction with requirements, outOfScope, constraints
 * - comprehensive: Full extraction plus risks, assumptions, stakeholders, success metrics
 */
export function getProjectExtractionPrompt(depth: PlanningDepth): string {
  const baseInstructions = `You are helping extract project details from a user's description.
Extract the following fields from their input. If a field is not mentioned, provide a reasonable default or leave empty.`;

  const quickSchema = `{
  "name": "project name",
  "description": "2-3 sentence description of what this project does",
  "coreValue": "the ONE most important thing this project must do",
  "requirements": ["requirement 1", "requirement 2", "requirement 3"],
  "outOfScope": [],
  "context": "",
  "constraints": []
}`;

  const standardSchema = `{
  "name": "project name",
  "description": "2-3 sentence description of what this project does",
  "coreValue": "the ONE most important thing this project must do",
  "requirements": ["requirement 1", "requirement 2"],
  "outOfScope": ["thing not building 1"],
  "context": "background context",
  "constraints": ["constraint 1"]
}`;

  const comprehensiveSchema = `{
  "name": "project name",
  "description": "2-3 sentence description of what this project does",
  "coreValue": "the ONE most important thing this project must do",
  "requirements": ["requirement 1", "requirement 2"],
  "outOfScope": ["thing not building 1"],
  "context": "background context",
  "constraints": ["constraint 1"],
  "risks": ["potential risk 1"],
  "assumptions": ["assumption 1"],
  "stakeholders": ["stakeholder 1"],
  "successMetrics": ["metric 1"]
}`;

  switch (depth) {
    case 'quick':
      return `${baseInstructions}

Output your response as JSON with these exact fields:
${quickSchema}

Keep it brief - focus on:
- Clear project name
- Concise description (2-3 sentences max)
- The ONE core value
- 3-5 key requirements only

Skip outOfScope, constraints, and context unless explicitly mentioned.
If the user provides minimal input, fill in reasonable defaults.
Always return valid JSON.`;

    case 'standard':
      return `${baseInstructions}

Output your response as JSON with these exact fields:
${standardSchema}

If the user provides minimal input, make reasonable assumptions and note them.
Always return valid JSON.`;

    case 'comprehensive':
      return `${baseInstructions}

Output your response as JSON with these exact fields:
${comprehensiveSchema}

Be thorough:
- Extract ALL requirements mentioned or implied
- Identify what's explicitly out of scope
- Note any constraints (tech stack, timeline, budget)
- Identify potential risks
- Document assumptions being made
- List stakeholders if mentioned
- Define measurable success metrics

If the user provides minimal input, ask clarifying questions in the context field.
Always return valid JSON.`;

    default:
      // Default to standard
      return `${baseInstructions}

Output your response as JSON with these exact fields:
${standardSchema}

If the user provides minimal input, make reasonable assumptions and note them.
Always return valid JSON.`;
  }
}

/**
 * Generate phase extraction prompt based on planning depth.
 *
 * - quick: 2-4 phases, minimal dependencies, no research flags
 * - standard: 3-8 phases, dependencies, research flags where needed
 * - comprehensive: 5-12 phases, detailed dependencies, research topics, milestones
 */
export function getPhaseExtractionPrompt(depth: PlanningDepth): string {
  const baseInstructions = `You are helping create a project roadmap by analyzing PROJECT.md and suggesting phases.

Analyze the project requirements and break them into logical phases. Each phase should:
- Deliver something coherent and testable
- Build on previous phases when needed
- Be completable in reasonable scope (not too large)`;

  const quickSchema = `{
  "overview": "Brief overview of the project journey (1-2 sentences)",
  "phases": [
    {
      "name": "kebab-case-name",
      "goal": "What this phase delivers (1 sentence)",
      "dependsOn": null,
      "researchLikely": false,
      "researchTopics": null
    }
  ]
}`;

  const standardSchema = `{
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
}`;

  const comprehensiveSchema = `{
  "overview": "Detailed paragraph describing the journey from start to finish, including key milestones",
  "phases": [
    {
      "name": "kebab-case-name",
      "goal": "What this phase delivers (2-3 sentences with acceptance criteria)",
      "dependsOn": null,
      "researchLikely": false,
      "researchTopics": null,
      "estimatedComplexity": "low|medium|high",
      "keyDeliverables": ["deliverable 1", "deliverable 2"]
    }
  ],
  "milestones": [
    {
      "name": "milestone-name",
      "afterPhase": 3,
      "description": "What's achieved at this milestone"
    }
  ]
}`;

  switch (depth) {
    case 'quick':
      return `${baseInstructions}

Output your response as JSON with this exact structure:
${quickSchema}

Guidelines:
- Target **2-4 phases** only - keep it minimal
- Use kebab-case names (e.g., "foundation", "core-features")
- First phase dependsOn should be null
- Keep goals to 1 sentence
- Set researchLikely to false for all phases (skip research step)
- Skip researchTopics

Focus on the fastest path to a working product.
Always return valid JSON.`;

    case 'standard':
      return `${baseInstructions}

Output your response as JSON with this exact structure:
${standardSchema}

Guidelines:
- Target **3-8 phases** based on project complexity
- Use kebab-case names (e.g., "foundation", "core-features", "user-auth")
- First phase dependsOn should be null
- Subsequent phases typically depend on the previous phase
- researchLikely = true for: external APIs, new libraries, architectural decisions
- researchLikely = false for: internal patterns, CRUD operations, established conventions
- Include researchTopics when researchLikely is true

Always return valid JSON.`;

    case 'comprehensive':
      return `${baseInstructions}

Output your response as JSON with this exact structure:
${comprehensiveSchema}

Guidelines:
- Target **5-12 phases** for thorough coverage
- Use kebab-case names (e.g., "foundation", "core-features", "user-auth")
- First phase dependsOn should be null
- Define explicit dependencies between phases
- Set researchLikely = true generously - research prevents rework
- Include detailed researchTopics for any unfamiliar areas
- Estimate complexity (low/medium/high) for each phase
- List key deliverables for each phase
- Define milestones at logical checkpoints (every 2-4 phases)

Be thorough - this roadmap guides a complex project.
Always return valid JSON.`;

    default:
      // Default to standard
      return `${baseInstructions}

Output your response as JSON with this exact structure:
${standardSchema}

Guidelines:
- Target 3-8 phases based on project complexity
- Use kebab-case names (e.g., "foundation", "core-features", "user-auth")
- First phase dependsOn should be null
- Subsequent phases typically depend on the previous phase
- researchLikely = true for: external APIs, new libraries, architectural decisions
- researchLikely = false for: internal patterns, CRUD operations, established conventions
- Include researchTopics when researchLikely is true

Always return valid JSON.`;
  }
}

/**
 * Generate plan generation prompt based on planning depth.
 *
 * - quick: 2-3 tasks per plan, minimal verification, no checkpoints
 * - standard: 3-5 tasks per plan, verification criteria, checkpoints for significant tasks
 * - comprehensive: 4-7 tasks per plan, detailed verification, checkpoints after each major task, TDD guidance
 */
export function getPlanGenerationPrompt(depth: PlanningDepth): string {
  const baseInstructions = `You are creating an execution plan for a project phase.
Generate a detailed plan with tasks that can be executed by an AI coding assistant.`;

  const quickTaskExample = `<task type="auto" id="1">
  <name>Set up project structure</name>
  <files>src/index.ts, package.json</files>
  <action>Create the basic project files and folder structure</action>
  <verify>Files exist and project compiles</verify>
  <done>Basic structure in place</done>
</task>`;

  const standardTaskExample = `<task type="auto" id="1">
  <name>Set up project structure</name>
  <files>src/index.ts, package.json, tsconfig.json</files>
  <action>
Create the basic project structure:
1. Initialize package.json with project metadata
2. Create tsconfig.json for TypeScript
3. Set up src/ directory with index.ts entry point
  </action>
  <verify>npm run compile succeeds</verify>
  <done>Project compiles and runs basic hello world</done>
</task>

<task type="checkpoint:human-verify" id="2">
  <what-built>Basic project structure with TypeScript compilation</what-built>
  <how-to-verify>
    1. Run npm run compile
    2. Check output in dist/
    3. Verify no type errors
  </how-to-verify>
  <resume-signal>Type "approved" to continue</resume-signal>
</task>`;

  const comprehensiveTaskExample = `<task type="auto" id="1" tdd="true">
  <name>Implement user validation</name>
  <files>src/validation/user.ts, src/validation/user.test.ts</files>
  <action>
Implement TDD cycle for user validation:

RED: Write failing tests for:
- Valid email format acceptance
- Invalid email rejection
- Empty input handling
- Password strength requirements

GREEN: Implement validation functions to pass tests

REFACTOR: Clean up code, extract constants
  </action>
  <verify>npm test -- --grep "user validation" passes all tests</verify>
  <done>User validation with 100% test coverage</done>
</task>

<task type="checkpoint:human-verify" id="2">
  <what-built>User validation with full TDD coverage</what-built>
  <how-to-verify>
    1. Run npm test to verify all tests pass
    2. Review test coverage report
    3. Check edge cases are covered
    4. Verify error messages are user-friendly
  </how-to-verify>
  <resume-signal>Type "approved" if validation is correct</resume-signal>
</task>`;

  switch (depth) {
    case 'quick':
      return `${baseInstructions}

Generate **2-3 tasks** maximum. Keep it simple and fast.

Task format:
${quickTaskExample}

Guidelines:
- **2-3 tasks only** - combine related work
- Brief action descriptions (1-3 lines)
- Simple verification (file exists, compiles)
- **NO checkpoints** - fully autonomous execution
- Skip detailed done criteria

Focus on getting to working code fast.
Output tasks in XML format within a <tasks> block.`;

    case 'standard':
      return `${baseInstructions}

Generate **3-5 tasks** with appropriate verification.

Task formats:
${standardTaskExample}

Guidelines:
- **3-5 tasks** per plan
- Clear action steps (numbered when complex)
- Specific verification commands
- Add checkpoint:human-verify after significant work
- Done criteria should be testable

Balance thoroughness with efficiency.
Output tasks in XML format within a <tasks> block.`;

    case 'comprehensive':
      return `${baseInstructions}

Generate **4-7 tasks** with detailed verification and TDD guidance where appropriate.

Task formats:
${comprehensiveTaskExample}

Guidelines:
- **4-7 tasks** per plan
- Detailed action steps with TDD cycles where appropriate
- Add tdd="true" attribute for logic-heavy tasks
- Comprehensive verification (tests, type checks, linting)
- Add checkpoint:human-verify after each major deliverable
- Include checkpoint:decision for architectural choices
- Detailed done criteria with acceptance tests

Types of checkpoints:
- checkpoint:human-verify - User confirms work is correct
- checkpoint:decision - User makes architectural/design choice
- checkpoint:human-action - Rare, only for truly manual steps

Be thorough - this plan guides complex implementation.
Output tasks in XML format within a <tasks> block.`;

    default:
      // Default to standard
      return `${baseInstructions}

Generate **3-5 tasks** with appropriate verification.

Task formats:
${standardTaskExample}

Guidelines:
- 3-5 tasks per plan
- Clear action steps (numbered when complex)
- Specific verification commands
- Add checkpoint:human-verify after significant work
- Done criteria should be testable

Balance thoroughness with efficiency.
Output tasks in XML format within a <tasks> block.`;
  }
}
