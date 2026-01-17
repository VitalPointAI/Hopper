---
phase: 04-execution-commands
plan: 01-FIX-FIX-FIX-FIX-FIX
type: fix
---

<objective>
Fix UAT-001: Tool result streaming error with sendChatParticipantRequest.

Source: 04-01-FIX-FIX-FIX-FIX-ISSUES.md
Priority: 1 Blocker

**Root Cause Analysis:**
The `@vscode/chat-extension-utils@0.0.0-alpha.5` library's `sendChatParticipantRequest` crashes with "Invalid stream (at tsx element ToolUserPrompt > ToolCalls > Chunk > ToolResultElement)" when processing tool results. This is a bug in the alpha library's internal TSX streaming components.

**Fix Strategy:**
Replace the library with manual tool orchestration using the standard VSCode Language Model API:
1. Use `model.sendRequest()` with `tools` parameter
2. Handle `LanguageModelToolCallPart` responses manually
3. Invoke tools via `vscode.lm.invokeTool()`
4. Loop until model stops requesting tools

This is the same approach the library uses internally, but we control the implementation.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-phase.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/04-execution-commands/04-01-FIX-FIX-FIX-FIX-ISSUES.md

**Current implementation:**
@src/chat/commands/executePlan.ts

**VSCode API Reference:**
- vscode.lm.tools: Array of available tools
- vscode.lm.invokeTool(name, options, token): Invoke a tool
- LanguageModelChatResponse.stream: AsyncIterable of LanguageModelChatResponsePart
- LanguageModelToolCallPart: { name, callId, input }
- LanguageModelToolResultPart: { callId, content }
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove @vscode/chat-extension-utils dependency</name>
  <files>package.json</files>
  <action>
Remove the `@vscode/chat-extension-utils` dependency from package.json since the alpha library has bugs.

Run `npm install` after updating to clean up node_modules.
  </action>
  <verify>npm ls @vscode/chat-extension-utils returns "empty" or error (not found)</verify>
  <done>@vscode/chat-extension-utils is removed from dependencies</done>
</task>

<task type="auto">
  <name>Task 2: Implement manual tool orchestration in executePlan</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
Replace `sendChatParticipantRequest` with manual tool orchestration.

1. Remove the import:
   ```typescript
   // DELETE: import * as chatUtils from '@vscode/chat-extension-utils';
   ```

2. Create a helper function for tool orchestration:
   ```typescript
   /**
    * Execute a chat request with tool calling loop.
    * Handles invoking tools when the model requests them.
    */
   async function executeWithTools(
     model: vscode.LanguageModelChat,
     messages: vscode.LanguageModelChatMessage[],
     tools: vscode.LanguageModelChatTool[],
     stream: vscode.ChatResponseStream,
     token: vscode.CancellationToken
   ): Promise<void> {
     const MAX_ITERATIONS = 10;
     let iteration = 0;

     while (iteration < MAX_ITERATIONS && !token.isCancellationRequested) {
       iteration++;

       const response = await model.sendRequest(
         messages,
         { tools },
         token
       );

       let hasToolCalls = false;
       const toolResults: vscode.LanguageModelToolResultPart[] = [];

       for await (const part of response.stream) {
         if (part instanceof vscode.LanguageModelTextPart) {
           stream.markdown(part.value);
         } else if (part instanceof vscode.LanguageModelToolCallPart) {
           hasToolCalls = true;

           // Show tool invocation in stream
           stream.markdown(`\n\n*Executing tool: ${part.name}...*\n\n`);

           try {
             // Invoke the tool
             const result = await vscode.lm.invokeTool(
               part.name,
               { input: part.input },
               token
             );

             // Collect tool result for next iteration
             toolResults.push(
               new vscode.LanguageModelToolResultPart(
                 part.callId,
                 result
               )
             );

             stream.markdown(`*Tool ${part.name} completed.*\n\n`);
           } catch (err) {
             const errorMsg = err instanceof Error ? err.message : String(err);
             stream.markdown(`*Tool ${part.name} failed: ${errorMsg}*\n\n`);

             toolResults.push(
               new vscode.LanguageModelToolResultPart(
                 part.callId,
                 [new vscode.LanguageModelTextPart(`Error: ${errorMsg}`)]
               )
             );
           }
         }
       }

       // If no tool calls, we're done
       if (!hasToolCalls) {
         break;
       }

       // Add assistant message with tool calls to history
       // Add tool results as user message for next iteration
       messages.push(
         vscode.LanguageModelChatMessage.Assistant(''),  // Placeholder for tool calls
         vscode.LanguageModelChatMessage.User(toolResults)
       );
     }
   }
   ```

3. Update the task execution in the main loop to use this helper:
   ```typescript
   // Get available tools
   const tools = vscode.lm.tools.filter(tool =>
     tool.tags.includes('workspace') ||
     tool.tags.includes('vscode') ||
     !tool.tags.length
   );

   // Select a model (use first available that supports tools)
   const models = await vscode.lm.selectChatModels({
     family: 'gpt-4'  // Or other appropriate selector
   });

   if (models.length === 0) {
     throw new Error('No language model available');
   }
   const model = models[0];

   // Build messages
   const messages = [
     vscode.LanguageModelChatMessage.User(prompt)
   ];

   // Execute with tool loop
   await executeWithTools(model, messages, tools, stream, token);
   ```

4. Handle the case where tools are empty (model doesn't support tools):
   - Fall back to simple sendRequest without tools
   - Still works but won't make file changes

Key implementation notes:
- Use vscode.LanguageModelToolCallPart to detect tool requests
- Use vscode.lm.invokeTool() to execute tools
- Loop until model returns only text (no tool calls)
- Cap iterations to prevent infinite loops
  </action>
  <verify>npm run compile succeeds without TypeScript errors</verify>
  <done>executePlan implements manual tool orchestration without external library</done>
</task>

<task type="auto">
  <name>Task 3: Clean up unused imports and context parameter</name>
  <files>src/chat/commands/executePlan.ts, src/chat/commands/types.ts</files>
  <action>
Clean up code that was only needed for the library:

1. In executePlan.ts:
   - Remove `ctx.context` usage (was for sendChatParticipantRequest)
   - Remove any unused imports

2. In types.ts:
   - Check if `context: vscode.ChatContext` in CommandContext is still needed
   - If not used elsewhere, can remove or keep for future use

Ensure code compiles cleanly.
  </action>
  <verify>npm run compile succeeds without TypeScript errors or warnings about unused variables</verify>
  <done>Code is clean, no unused imports or dead code from library removal</done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] npm run compile succeeds without errors
- [ ] Extension loads in Extension Development Host
- [ ] /execute-plan with a real PLAN.md invokes tools successfully
- [ ] Files are actually created/modified (not just printed)
- [ ] Tool results don't crash the stream
</verification>

<success_criteria>
- All UAT issues from 04-01-FIX-FIX-FIX-FIX-ISSUES.md addressed
- LLM can use VSCode tools to create/edit files during /execute-plan
- No dependency on buggy alpha library
- Ready for re-verification
</success_criteria>

<output>
After completion, create `.planning/phases/04-execution-commands/04-01-FIX-FIX-FIX-FIX-FIX-SUMMARY.md`
</output>
