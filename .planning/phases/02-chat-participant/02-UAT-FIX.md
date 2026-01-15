---
phase: 02-chat-participant
plan: UAT-FIX
type: fix
---

<objective>
Fix 1 UAT issue from Phase 2 acceptance testing.

Source: 02-UAT-ISSUES.md
Priority: 0 critical, 1 major, 0 minor
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-phase.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/02-chat-participant/02-UAT-ISSUES.md

**Affected files:**
@src/chat/commands/index.ts
@src/extension.ts
</context>

<tasks>
<task type="auto">
  <name>Fix UAT-001: Register placeholder VSCode commands for button actions</name>
  <files>src/extension.ts</files>
  <action>
Register VSCode commands that the stream.button() calls reference. These commands should show a notification that the feature is coming in Phase 3.

Commands to register in extension activation:
- `specflow.chat-participant.new-project` - Shows info message "The /new-project command will be available in Phase 3"

Use `vscode.commands.registerCommand()` and add the disposable to context.subscriptions.

Pattern:
```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('specflow.chat-participant.new-project', () => {
    vscode.window.showInformationMessage('The /new-project command will be available in Phase 3. Use @specflow /new-project in the chat.');
  })
);
```

This provides user feedback when the button is clicked, rather than silent failure.
  </action>
  <verify>
1. Run `npm run compile` - no errors
2. Launch extension (F5)
3. Open agent chat, type `@specflow /status` in workspace without .planning
4. Click "New Project" button
5. See information message appear
  </verify>
  <done>Button click shows informational message instead of doing nothing</done>
</task>
</tasks>

<verification>
Before declaring plan complete:
- [ ] `npm run compile` succeeds without errors
- [ ] Button in /status triggers info message
- [ ] Button in /help triggers info message
- [ ] No regressions in existing functionality
</verification>

<success_criteria>
- UAT-001 resolved - buttons now provide user feedback
- Extension builds without errors
- Ready for re-verification
</success_criteria>

<output>
After completion, create `.planning/phases/02-chat-participant/02-UAT-FIX-SUMMARY.md`
</output>
