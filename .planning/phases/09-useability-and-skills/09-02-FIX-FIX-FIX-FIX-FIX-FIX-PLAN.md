---
phase: 09-useability-and-skills
plan: 02-FIX-FIX-FIX-FIX-FIX-FIX
type: fix
---

<objective>
Fix /execute-plan regression where model shows text suggestions instead of executing tools.

Source: 09-02-FIX-FIX-FIX-FIX-FIX-ISSUES.md
Priority: 1 blocker

The model is outputting "Next steps: Run npm test && npm run build" text instead of actually invoking the tools to execute commands. This is a regression from working behavior.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-phase.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/09-useability-and-skills/09-02-FIX-FIX-FIX-FIX-FIX-ISSUES.md

**Current implementation:**
@src/chat/commands/executePlan.ts

**Analysis:**
The execute-plan code looks correct structurally:
1. Gets tools from vscode.lm.tools with filter for workspace/vscode tags
2. Selects gpt-4o model from Copilot
3. Calls executeWithTools which handles tool calling loop
4. Model can return LanguageModelToolCallPart to invoke tools

Likely causes:
1. Model doesn't "see" tools as available (tools array might be empty after filter)
2. Model prompt doesn't strongly encourage tool usage
3. Need to use LanguageModelChatToolMode.Required to force tool use
4. Need better diagnostic logging to understand what's happening
</context>

<tasks>
<task type="auto">
  <name>Fix UAT-001: Add tool availability logging and force tool mode</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
1. Add diagnostic logging before executeWithTools call to show:
   - Number of tools available from vscode.lm.tools
   - Number of tools after filtering (with workspace/vscode tags)
   - List of tool names being passed to the model

2. Update the model.sendRequest call in executeWithTools to use LanguageModelChatToolMode:
   - Import LanguageModelChatToolMode from vscode if not already imported
   - Change the sendRequest options from `{ tools }` to `{ tools, toolMode: vscode.LanguageModelChatToolMode.Auto }`
   - This explicitly sets the mode (Auto is default but being explicit helps)

3. Improve the task prompt to more strongly instruct tool usage:
   - Add to buildTaskPrompt: "You MUST use tools to complete this task. Do NOT just describe what to do - USE the tools to actually make changes."
   - Add: "Start by using tools immediately. Do not output planning text before using tools."

4. Add fallback logging when no tool calls are detected:
   - In the executeWithTools loop, if hasToolCalls is false on first iteration, log a warning
   - Include the number of tools passed and first few tool names in the log
  </action>
  <verify>npm run compile succeeds without errors</verify>
  <done>Code compiles, logging added, tool mode explicit, prompt strengthened</done>
</task>
</tasks>

<verification>
Before declaring plan complete:
- [ ] Code compiles without errors
- [ ] Logging shows tool count in output channel
- [ ] Tool mode is explicitly set
- [ ] Prompt includes stronger tool usage instructions
</verification>

<success_criteria>
- Execute-plan command logs tool availability information
- Model is encouraged to use tools via explicit mode and prompt
- Can diagnose if tools are being passed correctly
- Ready for user testing to verify fix
</success_criteria>

<output>
After completion, create `.planning/phases/09-useability-and-skills/09-02-FIX-FIX-FIX-FIX-FIX-FIX-SUMMARY.md`
</output>
