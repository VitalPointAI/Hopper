---
phase: 09-useability-and-skills
plan: 02-FIX-FIX-FIX-FIX-FIX
type: fix
---

<objective>
Fix 2 UAT issue(s) from plan 09-02-FIX-FIX-FIX-FIX.

Source: 09-02-FIX-FIX-FIX-FIX-ISSUES.md
Priority: 1 blocker, 1 major

**Root cause:** Both issues stem from inadequate prompting and fallback logic that echoes issue descriptions instead of generating actionable content.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/09-useability-and-skills/09-02-FIX-FIX-FIX-FIX-ISSUES.md

**Source files:**
@src/chat/commands/planFix.ts
@src/chat/commands/verifyWork.ts
</context>

<tasks>

<task type="auto">
  <name>Fix UAT-002: Improve plan-fix task generation with actionable content</name>
  <files>src/chat/commands/planFix.ts</files>
  <action>
The problem is that both `generateFixTasks` LLM prompt and `generateBasicFixTasks` fallback produce non-actionable tasks. Fix both:

1. **Improve LLM prompt** (around line 203-224):
   - Add explicit instruction that the `<action>` tag MUST contain specific, executable instructions
   - Include examples of GOOD vs BAD action content
   - Require the LLM to analyze the issue details and generate implementation steps

2. **Improve fallback function** `generateBasicFixTasks` (lines 251-277):
   - Instead of echoing `Fix the issue: ${issue.description}`, generate actionable guidance
   - Use the issue fields (expected, actual, feature) to construct meaningful steps
   - Structure the action as: "1. Investigate [feature/file], 2. Fix [description based on expected vs actual], 3. Verify [expected behavior]"

Example transformation:
BAD: `<action>Fix the issue: Task failed: Verify step failed</action>`
GOOD: `<action>
1. Read the original PLAN.md to understand what was attempted
2. Investigate why the verify step failed (check output, errors)
3. Fix the root cause in the affected files
4. Re-run the verify step to confirm the fix
</action>`
  </action>
  <verify>Run /plan-fix on an existing ISSUES.md and inspect the generated FIX-PLAN.md - the `<action>` tags should contain numbered steps or specific implementation guidance, not just echoed error messages</verify>
  <done>Generated fix tasks have actionable content that can be executed meaningfully</done>
</task>

<task type="auto">
  <name>Fix UAT-001: Improve verify-work test instructions for FIX plans</name>
  <files>src/chat/commands/verifyWork.ts</files>
  <action>
The problem is that verify-work's test generation doesn't handle FIX plan summaries well - it just wraps accomplishments as "Verify: Fix EXE-XX-YY" without context.

1. **Detect FIX plans** in `handleVerifyWork`:
   - Check if the plan name contains "-FIX" suffix
   - If so, read the corresponding ISSUES.md to get original issue context

2. **Enhance `generateTestChecklist` for FIX plans** (around line 221):
   - Pass an optional `isFix` flag and original issue data
   - For FIX plans, the prompt should generate tests that:
     a. Describe what the original issue was
     b. Explain how to reproduce the original problem (which should now be fixed)
     c. Verify the fix by checking the expected behavior works

3. **Improve the fallback** (line 298):
   - For FIX plans: "Test fix for [issue ID]: Original issue was '[description]'. Verify that [expected] now works correctly by [specific test steps based on feature/actual fields]"
   - For regular plans: Keep existing "Verify: [accomplishment]" format

4. **Read issue context when needed**:
   - Add helper function to load issues from corresponding ISSUES.md
   - Use issue details (description, expected, actual, feature) to generate meaningful test steps
  </action>
  <verify>Run /verify-work on a FIX plan's SUMMARY.md and check that the test instructions include context about the original issue and specific verification steps, not just "Verify: Fix [issue ID]"</verify>
  <done>verify-work generates actionable test instructions for FIX plans that explain what to test and how to confirm the fix works</done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] All blocker issues fixed
- [ ] All major issues fixed
- [ ] Generated fix plans have actionable tasks
- [ ] verify-work on FIX plans shows helpful test instructions
</verification>

<success_criteria>
- Both UAT issues from 09-02-FIX-FIX-FIX-FIX-ISSUES.md addressed
- /plan-fix generates tasks with specific implementation steps
- /verify-work on FIX plans shows meaningful test guidance
- Ready for re-verification
</success_criteria>

<output>
After completion, create `.planning/phases/09-useability-and-skills/09-02-FIX-FIX-FIX-FIX-FIX-SUMMARY.md`
</output>
