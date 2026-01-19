---
phase: 08-fix-improperly-built-functions
plan: 02-FIX-FIX
type: fix
---

<objective>
Fix 3 UAT issues from plan 08-02-FIX.

Source: 08-02-FIX-ISSUES.md
Priority: 1 blocker, 1 major, 1 minor
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-phase.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/08-fix-improperly-built-functions/08-02-FIX-ISSUES.md

**Original plan for reference:**
@.planning/phases/08-fix-improperly-built-functions/08-02-FIX-PLAN.md

**Key files to investigate:**
@src/licensing/phaseGate.ts
@src/licensing/validator.ts
@src/chat/commands/discussPhase.ts
@src/extension.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix UAT-001 - Wallet auth license check blocker</name>
  <files>src/licensing/validator.ts, src/licensing/phaseGate.ts</files>
  <action>
Debug and fix the wallet auth license check that returns false negatives for valid licenses.

Investigation steps:
1. Add debug logging to trace the exact values at each step
2. Check if `viewIsLicensed` and `viewGetExpiry` are returning correct values from the NEAR contract
3. Verify the cache is not returning stale data
4. Check if the session is properly established before license check

The issue is likely:
- Cache returning stale "unlicensed" data from before the user purchased
- Contract RPC call timing/failure
- Session not fully initialized when license check runs

Fix approach:
1. Add more debug logging to trace values: isAuthenticated, session, isLicensed, expiresAt
2. Check if cache should be bypassed on first check after auth
3. Ensure license check waits for session to be fully loaded

Debug output should use console.log with clear prefixes like [Hopper:license].
  </action>
  <verify>
1. Connect with NEAR wallet that has valid license
2. Run a phase-gated command like /plan-phase
3. Command should execute without showing "Upgrade to Pro" button
  </verify>
  <done>Wallet-authenticated users with valid licenses can access phase-gated commands without false "Upgrade to Pro" prompts</done>
</task>

<task type="auto">
  <name>Task 2: Fix UAT-002 - Create Hopper output channel</name>
  <files>src/extension.ts, src/logging.ts</files>
  <action>
Create a dedicated "Hopper" output channel for debug logs.

Implementation:
1. Create `src/logging.ts` with a singleton output channel
2. Export a `log(category: string, message: string, ...args: unknown[])` function
3. Create the output channel in extension activation with name "Hopper"
4. Replace console.log calls in licensing files with the new log function
5. Channel should appear in Output panel dropdown when extension activates

Pattern:
```typescript
// src/logging.ts
import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initLogging(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Hopper');
  }
  return outputChannel;
}

export function log(category: string, message: string, ...args: unknown[]): void {
  const channel = initLogging();
  const timestamp = new Date().toISOString();
  const formattedArgs = args.map(a => JSON.stringify(a)).join(' ');
  channel.appendLine(`[${timestamp}] [${category}] ${message} ${formattedArgs}`);
  // Also log to console for dev tools
  console.log(`[Hopper:${category}] ${message}`, ...args);
}
```
  </action>
  <verify>
1. Open VSCode Output panel (View > Output)
2. Check dropdown for "Hopper" channel
3. Run a license-gated command
4. Verify log messages appear in Hopper channel
  </verify>
  <done>"Hopper" output channel exists in VSCode Output panel and shows debug logs</done>
</task>

<task type="auto">
  <name>Task 3: Fix UAT-003 - Discuss-phase button text truncation</name>
  <files>src/chat/commands/discussPhase.ts</files>
  <action>
Fix button text truncation so options are readable.

The current approach truncates at 45 characters but VSCode chat buttons have even more limited space. Options:

1. **Shorten button text aggressively** - Truncate at 25-30 characters max
2. **Use numbered buttons** - Show "Option 1", "Option 2" etc., with full text in markdown above
3. **Simplify prompts** - Tell LLM to generate shorter option text (20 chars max)

Implementation (option 2 - clearest UX):
1. In `displayQuestionWithButtons()`, modify to show full option text as a numbered list in markdown BEFORE buttons
2. Change buttons to just show "1", "2", "3" etc. or short labels like "Option A", "Option B"
3. User reads options in markdown, clicks corresponding button

Example output:
```
**Options:**
1. Focus on simplicity and minimal features
2. Build something feature-rich and comprehensive
3. Find a balance between the two

[1] [2] [3] [Other...] [Pause]
```
  </action>
  <verify>
1. Run /discuss-phase for any phase
2. Observe that full option text is visible in markdown
3. Buttons are short and fit without truncation
4. Clicking a button correctly records the full option text
  </verify>
  <done>Discuss-phase questions show full option text in markdown with short numbered buttons that don't truncate</done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] All critical issues fixed
- [ ] All major issues fixed
- [ ] Minor issues fixed or documented as deferred
- [ ] Original acceptance criteria from issues met
</verification>

<success_criteria>
- UAT-001: Wallet auth license check returns true for valid licenses
- UAT-002: Hopper output channel visible in VSCode Output panel
- UAT-003: Discuss-phase button options are fully readable
- All 3 UAT issues addressed
- Ready for re-verification with /gsd:verify-work 08-02-FIX-FIX
</success_criteria>

<output>
After completion, create `.planning/phases/08-fix-improperly-built-functions/08-02-FIX-FIX-SUMMARY.md`
</output>
