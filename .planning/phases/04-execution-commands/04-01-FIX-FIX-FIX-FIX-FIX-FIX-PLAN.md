---
phase: 04-execution-commands
plan: 01-FIX-FIX-FIX-FIX-FIX-FIX
type: fix
---

<objective>
Fix 2 UAT blocker issues from plan 04-01-FIX-FIX-FIX-FIX-FIX.

Source: 04-01-FIX-FIX-FIX-FIX-FIX-ISSUES.md
Priority: 2 blockers, 0 major, 0 minor
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-phase.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/04-execution-commands/04-01-FIX-FIX-FIX-FIX-FIX-ISSUES.md

**Original implementation:**
@src/chat/commands/executePlan.ts
</context>

<tasks>
<task type="auto">
  <name>Task 1: Fix UAT-001 - Add workspace root to system prompt</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
The model passes relative paths (e.g., "src/db/schema.sql") to copilot_createFile, but VSCode tools require absolute paths.

**Root cause:** The buildTaskPrompt function doesn't tell the model what the workspace root path is, so it cannot construct absolute paths.

**Fix:** Update buildTaskPrompt to:
1. Accept workspaceRoot as a parameter
2. Add clear instruction to the prompt that ALL file paths must be absolute
3. Provide the workspace root path so the model can prefix relative paths

**Implementation:**
1. Add `workspaceRoot: string` parameter to buildTaskPrompt
2. Add this to the prompt:

```
**CRITICAL: File Path Requirements**
All file paths MUST be absolute paths. The workspace root is: ${workspaceRoot}
When creating or modifying files, always use the full absolute path.
Example: Instead of "src/types/user.ts", use "${workspaceRoot}/src/types/user.ts"
```

3. Update the call site to pass workspaceUri.fsPath
  </action>
  <verify>Build succeeds with npm run compile</verify>
  <done>buildTaskPrompt includes workspace root and absolute path instructions</done>
</task>

<task type="auto">
  <name>Task 2: Fix UAT-002 - Correct tool result handling</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
Error "c.content.map is not a function" occurs when processing tool results.

**Root cause analysis:**
Looking at line 58, when we create LanguageModelToolResultPart:
```typescript
new vscode.LanguageModelToolResultPart(part.callId, result)
```

The `result` from `vscode.lm.invokeTool` returns a `vscode.LanguageModelToolResult` which contains content parts. But we're passing the whole result object as the second argument when it expects the content array.

According to VSCode API:
- `invokeTool` returns `LanguageModelToolResult` with a `content` property
- `LanguageModelToolResultPart` constructor expects: `(callId: string, content: (LanguageModelTextPart | LanguageModelPromptTsxPart)[])`

**Fix:** Extract the content from the result:
```typescript
// Line 56-59: Change from
toolResults.push(
  new vscode.LanguageModelToolResultPart(part.callId, result)
);

// To
toolResults.push(
  new vscode.LanguageModelToolResultPart(part.callId, result.content)
);
```

Note: result.content is already an array of LanguageModelTextPart or similar, which is what the constructor expects.

**Also fix the error case at line 66-70:**
```typescript
// Change from
toolResults.push(
  new vscode.LanguageModelToolResultPart(
    part.callId,
    [new vscode.LanguageModelTextPart(`Error: ${errorMsg}`)]
  )
);
// This part is already correct - it passes an array
```
  </action>
  <verify>Build succeeds with npm run compile</verify>
  <done>Tool results correctly extracted from invokeTool response and passed to LanguageModelToolResultPart</done>
</task>
</tasks>

<verification>
Before declaring plan complete:
- [ ] npm run compile succeeds without errors
- [ ] Both issues addressed in code
- [ ] Ready for UAT re-verification
</verification>

<success_criteria>
- UAT-001: Prompt includes workspace root and absolute path requirement
- UAT-002: Tool result content correctly extracted from invokeTool response
- Extension compiles without errors
- Ready for re-verification via /gsd:verify-work
</success_criteria>

<output>
After completion, create `.planning/phases/04-execution-commands/04-01-FIX-FIX-FIX-FIX-FIX-FIX-SUMMARY.md`
</output>
