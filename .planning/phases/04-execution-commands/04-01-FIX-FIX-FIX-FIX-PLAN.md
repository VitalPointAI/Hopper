---
phase: 04-execution-commands
plan: 01-FIX-FIX-FIX-FIX
type: fix
---

<objective>
Fix UAT-001: LLM prints file changes instead of applying them.

Source: 04-01-FIX-FIX-FIX-ISSUES.md
Priority: 1 Blocker

**Root Cause Analysis:**
The current implementation passes `tools: []` to `sendRequest`, which does nothing. VSCode's Language Model API requires:
1. Accessing available tools via `vscode.lm.tools`
2. Passing those tools to the request
3. Handling tool call responses and invoking tools when requested by the LLM

The simplest fix is to use `@vscode/chat-extension-utils` library's `sendChatParticipantRequest` which handles tool orchestration automatically.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-phase.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/04-execution-commands/04-01-FIX-FIX-FIX-ISSUES.md

**Current implementation:**
@src/chat/commands/executePlan.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add @vscode/chat-extension-utils dependency</name>
  <files>package.json</files>
  <action>
Add `@vscode/chat-extension-utils` to dependencies in package.json.

This library provides `sendChatParticipantRequest` which handles tool orchestration automatically, including:
- Passing available tools from `vscode.lm.tools` to the LLM
- Processing tool call requests from the LLM response
- Invoking tools with the `toolInvocationToken` from the chat request
- Streaming results back through the chat response stream

Run `npm install` after updating package.json.
  </action>
  <verify>npm ls @vscode/chat-extension-utils shows the package installed</verify>
  <done>@vscode/chat-extension-utils is in dependencies and installed</done>
</task>

<task type="auto">
  <name>Task 2: Refactor executePlan to use sendChatParticipantRequest</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
Refactor the task execution loop in `handleExecutePlan` to use `sendChatParticipantRequest` from `@vscode/chat-extension-utils`:

1. Import the library:
   ```typescript
   import * as chatUtils from '@vscode/chat-extension-utils';
   ```

2. Replace the manual sendRequest logic in the task execution loop with:
   ```typescript
   // Get available tools - filter to workspace-relevant tools
   const tools = vscode.lm.tools.filter(tool =>
     tool.tags.includes('workspace') ||
     tool.tags.includes('vscode') ||
     !tool.tags.length // Include tools without tags
   );

   // Use sendChatParticipantRequest for automatic tool orchestration
   const result = chatUtils.sendChatParticipantRequest(
     request,
     context,  // Chat context from the handler
     {
       prompt: buildTaskPrompt(task, planContext, true),
       responseStreamOptions: {
         stream,
         references: true,
         responseText: true
       },
       tools
     },
     token
   );

   await result.result;
   ```

3. The `CommandContext` needs to be updated to include the chat context. Check how it's passed from the participant handler.

4. Remove the old manual `sendRequest` code and the `// @ts-ignore` comment for tools.

Key changes:
- Use `vscode.lm.tools` to get real available tools instead of empty array
- Use `sendChatParticipantRequest` which handles tool invocation automatically
- Pass the chat request and context so tools can be invoked with proper tokens
  </action>
  <verify>npm run compile succeeds without TypeScript errors</verify>
  <done>executePlan uses sendChatParticipantRequest with real tools from vscode.lm.tools</done>
</task>

<task type="auto">
  <name>Task 3: Update CommandContext type to include chat context</name>
  <files>src/chat/commands/types.ts, src/chat/hopperParticipant.ts</files>
  <action>
The `sendChatParticipantRequest` function requires the chat context (ChatContext) from the chat handler.

1. Update `CommandContext` interface in types.ts to include:
   ```typescript
   chatContext: vscode.ChatContext;
   ```

2. Update hopperParticipant.ts to pass the chat context when calling command handlers.

3. Ensure all command handlers that might need tool access have access to the chat context.
  </action>
  <verify>npm run compile succeeds without TypeScript errors</verify>
  <done>CommandContext includes chatContext and it's passed from hopperParticipant</done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] npm run compile succeeds without errors
- [ ] Extension loads in Extension Development Host
- [ ] /execute-plan with a real PLAN.md invokes tools (files are created/modified, not just printed)
</verification>

<success_criteria>
- All UAT issues from 04-01-FIX-FIX-FIX-ISSUES.md addressed
- LLM can use VSCode tools to create/edit files during /execute-plan
- Ready for re-verification
</success_criteria>

<output>
After completion, create `.planning/phases/04-execution-commands/04-01-FIX-FIX-FIX-FIX-SUMMARY.md`
</output>
