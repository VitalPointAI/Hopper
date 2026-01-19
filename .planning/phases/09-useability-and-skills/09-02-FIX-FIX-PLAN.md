---
phase: 09-useability-and-skills
plan: 02-FIX-FIX
type: fix
---

<objective>
Fix 1 UAT issue from plan 09-02-FIX.

Source: 09-02-FIX-ISSUES.md
Priority: 0 critical, 0 major, 1 minor

**Issue:** Add "Plan Fix" button after verify failure instead of generic git changes/check progress buttons.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-phase.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/09-useability-and-skills/09-02-FIX-ISSUES.md

**Original plan for reference:**
@.planning/phases/09-useability-and-skills/09-02-FIX-PLAN.md

**File to modify:**
@src/chat/commands/executePlan.ts
</context>

<tasks>
<task type="auto">
  <name>Fix UAT-001: Add "Plan Fix" button after verify/task failures</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
In the "Next Steps" section at the end of executeCommand (around line 1692):

1. Check if any tasks failed: `const hasFailures = failedCount > 0;`

2. If hasFailures is true, show failure-specific next steps:
   - Show "Plan Fix" button that invokes `hopper.chat-participant.plan-fix` with the current plan's phase-plan identifier (e.g., "09-02")
   - Keep "Check Progress" button but make it secondary
   - Remove the git changes button for failures (not relevant when tasks failed)

3. If no failures, keep existing behavior (git changes, verify, commit, check progress)

The "Plan Fix" button should:
- command: 'hopper.chat-participant.plan-fix'
- arguments: [planIdentifier] where planIdentifier is constructed from plan.phase and plan.planNumber (e.g., "09-02")
- title: 'Plan Fix'

Example output when failures occur:
```
### Next Steps

Some tasks failed during execution.

1. **Plan fixes** to address the failed tasks
[Plan Fix button]

2. **Check progress** to see overall status
[Check Progress button]
```
  </action>
  <verify>Build succeeds with `npm run compile`</verify>
  <done>When tasks fail, "Plan Fix" button is shown as primary next step action instead of git changes/check progress</done>
</task>
</tasks>

<verification>
Before declaring plan complete:
- [ ] Build succeeds without errors
- [ ] When tasks fail, "Plan Fix" button is primary next step
- [ ] When all tasks pass, existing behavior preserved
</verification>

<success_criteria>
- UAT-001 from 09-02-FIX-ISSUES.md addressed
- Build passes
- Ready for re-verification
</success_criteria>

<output>
After completion, create `.planning/phases/09-useability-and-skills/09-02-FIX-FIX-SUMMARY.md`
</output>
