---
phase: 11-log-paste-context
plan: 01-FIX-FIX-FIX-FIX
type: fix
---

<objective>
Fix 1 UAT issue from plan 11-01-FIX-FIX-FIX.

Source: 11-01-FIX-FIX-FIX-ISSUES.md
Priority: 0 critical, 0 major, 1 minor

**Root cause analysis:**
The guidance message cannot be written to ChatResponseStream after cancellation because VSCode closes the stream atomically when the CancellationToken is triggered. Writing to `stream.markdown()` after cancellation is silently ignored.

Previous attempts:
- 11-01-FIX-FIX: Added check after executeWithTools returns → stream already closed
- 11-01-FIX-FIX-FIX: Moved check inside executeWithTools after while loop → still too late

**Solution:**
Use VSCode's information message API (`vscode.window.showInformationMessage`) instead of the chat stream. This creates a notification that appears regardless of stream state.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-phase.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/11-log-paste-context/11-01-FIX-FIX-FIX-ISSUES.md

**Original code for reference:**
@src/chat/commands/executePlan.ts
</context>

<tasks>
<task type="auto">
  <name>Fix UAT-001: Show guidance via VSCode information message instead of stream</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
The issue is that ChatResponseStream becomes unusable after CancellationToken triggers. The stream.markdown() calls are silently dropped.

**Solution:** Use `vscode.window.showInformationMessage()` with action buttons to provide guidance. This notification appears regardless of stream state.

1. In the `executeWithTools` function, after the while loop exits (around line 410), replace the stream.markdown guidance with:

```typescript
// Check if we exited due to cancellation - show guidance via notification (stream may be closed)
if (token.isCancellationRequested) {
  // Show guidance as information message since stream may already be closed
  vscode.window.showInformationMessage(
    'Execution paused. Paste context and send to resume, or start a new command.',
    'OK'
  );
}
```

2. Remove any stream.markdown calls for guidance in the cancellation check inside executeWithTools (since they don't work).

3. Also update the cancellation check after executeWithTools returns (around line 1594) to NOT try writing to stream for guidance:

```typescript
if (token.isCancellationRequested) {
  // Save cancelled execution state for potential resume with context
  await saveCancelledExecution(ctx.extensionContext, planPath, i);

  // Clear active execution state
  await clearActiveExecution(ctx.extensionContext);

  // NOTE: Don't try to write to stream here - it's closed after cancellation
  // Guidance is shown via vscode.window.showInformationMessage in executeWithTools

  return { metadata: { lastCommand: 'execute-plan' } };
}
```

4. Similarly update the cancellation check at the start of the task loop (around line 1405) to use information message instead of stream.markdown:

```typescript
if (token.isCancellationRequested) {
  await saveCancelledExecution(ctx.extensionContext, planPath, i);
  await clearActiveExecution(ctx.extensionContext);

  // Show guidance via notification (stream is closed)
  vscode.window.showInformationMessage(
    `Execution paused at task ${i + 1}. Paste context and send to resume.`,
    'OK'
  );

  return { metadata: { lastCommand: 'execute-plan' } };
}
```

**Why this works:**
- `vscode.window.showInformationMessage()` is independent of the chat stream
- It creates a notification/toast that appears in VSCode's notification area
- User sees the guidance regardless of when the stream closed
  </action>
  <verify>Compile succeeds with `npm run compile`</verify>
  <done>Guidance message shown via VSCode information message notification instead of chat stream. User sees guidance regardless of stream state.</done>
</task>
</tasks>

<verification>
Before declaring plan complete:
- [ ] `npm run compile` succeeds without errors
- [ ] When Stop is clicked during execution, an information message appears with guidance
</verification>

<success_criteria>
- UAT-001 addressed: Guidance shown via notification when execution is stopped
- Compile passes
- Ready for re-verification
</success_criteria>

<output>
After completion, create `.planning/phases/11-log-paste-context/11-01-FIX-FIX-FIX-FIX-SUMMARY.md`
</output>
