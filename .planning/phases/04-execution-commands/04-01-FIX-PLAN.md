---
phase: 04-execution-commands
plan: 01-FIX
type: execute
---

<objective>
Fix UAT issues from 04-01 /execute-plan command testing.

Purpose: Address the two major issues discovered during user acceptance testing:
1. UAT-001: Short plan paths don't resolve (must use full relative path)
2. UAT-002: Execution streams suggestions instead of running as agent

Output: Updated /execute-plan command that:
- Accepts short plan identifiers (e.g., `04-01-PLAN`, `04-01`) and resolves them
- Executes tasks in agent mode where the LLM can actually create/modify files
</objective>

<execution_context>
Execute tasks sequentially, committing after each task completion.
Follow the plan's verification and success criteria.
Create SUMMARY.md after all tasks complete.
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

# UAT Issues to fix:
@.planning/phases/04-execution-commands/04-01-ISSUES.md

# Source file to modify:
@src/chat/commands/executePlan.ts

**Tech stack available:**
- vscode.workspace.fs for file operations
- Glob patterns via vscode.workspace.findFiles
- vscode.LanguageModelChatMessage for LLM requests
- VSCode chat tool_choice for agent-like behavior
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add short path resolution for plan identifiers</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
Fix UAT-001 by adding short path resolution logic.

When user provides a path argument like `04-01-PLAN` or `04-01`:

1. Check if it's already a full path (contains `/` or starts with `.planning/`)
   - If yes: use as-is (existing behavior)

2. If it's a short identifier:
   a. Normalize: strip `.md` if present, add `-PLAN` suffix if not present
      - `04-01` → `04-01-PLAN`
      - `04-01-PLAN` → `04-01-PLAN`
      - `04-01-PLAN.md` → `04-01-PLAN`

   b. Search for matching file in `.planning/phases/*/`:
      ```typescript
      const pattern = new vscode.RelativePattern(
        workspaceUri,
        `.planning/phases/*/${normalizedName}.md`
      );
      const files = await vscode.workspace.findFiles(pattern, null, 1);
      ```

   c. If found: use that file's URI
   d. If not found: show helpful error with available plans

Add a helper function `resolvePlanPath(workspaceUri, promptText)` that handles this logic.

Location: Insert after line ~130 (before handleExecutePlan), modify lines 176-184.
  </action>
  <verify>
- npm run compile succeeds
- Test: `/execute-plan 04-02-PLAN` finds the correct plan
- Test: `/execute-plan 04-02` also works (adds -PLAN suffix)
- Test: Full paths still work
  </verify>
  <done>
- Short plan identifiers resolve to full paths
- Both with and without `-PLAN` suffix work
- Both with and without `.md` extension work
- Error message shows available plans when not found
  </done>
</task>

<task type="auto">
  <name>Task 2: Enable agent mode for task execution</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
Fix UAT-002 by making task execution use agent mode.

The current implementation just streams LLM suggestions. To run as an agent where the LLM can actually modify files, we need to use VSCode's tool-calling capabilities.

**Approach: Use lm.sendRequest with toolMode**

When VSCode Language Model API supports tools, the LLM can use built-in tools to:
- Read files
- Edit files
- Run terminal commands

Update the task execution loop (lines 364-410):

1. Update the prompt to instruct agent behavior:
```typescript
const prompt = `You are an AI assistant executing a task from a Hopper plan.

Task: ${task.name}
${filesLine}
**Action to perform:**
${task.action}

**Done when:**
${task.done}

**Verification:**
${task.verify}

Execute this task by making the necessary file changes. Create or modify files as needed. Do not just describe what to do - actually implement it.`;
```

2. Check if model supports tool calling:
```typescript
// If model supports tools, enable them
const requestOptions: vscode.LanguageModelChatRequestOptions = {};
if (request.model.supportsToolCalling) {
  // Let the LLM use VSCode's built-in tools
  requestOptions.tools = []; // Empty array enables built-in tools
}
```

3. If tool calling not supported, keep existing behavior but make the instruction clearer that user needs to apply changes.

Note: VSCode's Language Model API tool support may be limited. If tools aren't available, the fallback should still work but with clearer messaging.
  </action>
  <verify>
- npm run compile succeeds
- Test: LLM attempts to use tools/create files when executing
- Test: Falls back gracefully if tools not supported
  </verify>
  <done>
- Task execution requests agent/tool mode from LLM
- Prompt instructs LLM to implement, not describe
- Graceful fallback when tools unavailable
  </done>
</task>

<task type="auto">
  <name>Task 3: Update completion messaging</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
Update the completion section to reflect agent behavior:

1. Change "Next Steps" section:
   - Remove step about "Apply the changes" (LLM did it)
   - Change to "Review the changes made"
   - Add git diff button to see changes

2. Add summary of files modified:
   - After execution, show which files were created/modified
   - This helps user understand what the agent did

3. Show clearer status per task:
   - Show files touched per task
   - Show success/partial/failed status

Update lines 413-452.
  </action>
  <verify>
- npm run compile succeeds
- Completion message reflects agent behavior
- Shows useful next steps for reviewing changes
  </verify>
  <done>
- Completion message updated for agent mode
- Next steps focus on review, not apply
- File modification summary shown
  </done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] npm run compile succeeds without errors
- [ ] Short plan paths resolve correctly (e.g., `04-02-PLAN`, `04-02`)
- [ ] Full paths still work
- [ ] Task execution uses agent/tool mode when available
- [ ] Completion messaging reflects agent behavior
- [ ] Both UAT issues addressed
</verification>

<success_criteria>
- UAT-001 fixed: Short plan identifiers work
- UAT-002 fixed: Execution runs in agent mode
- All verification checks pass
- No TypeScript errors
</success_criteria>

<output>
After completion, create `.planning/phases/04-execution-commands/04-01-FIX-SUMMARY.md` following the summary template.

Also update 04-01-ISSUES.md to move fixed issues to "Resolved Issues" section.
</output>
