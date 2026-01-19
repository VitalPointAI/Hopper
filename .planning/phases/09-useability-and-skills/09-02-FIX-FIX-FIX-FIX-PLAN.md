---
phase: 09-useability-and-skills
plan: 02-FIX-FIX-FIX-FIX
type: fix
---

<objective>
Fix 1 UAT issue from plan 09-02-FIX-FIX-FIX.

Source: 09-02-FIX-FIX-FIX-ISSUES.md
Priority: 1 blocker

The Plan Fix command cannot parse issues with `EXE-` prefix format. The parseUATIssues function only recognizes `UAT-XXX` format, but execution failures create issues with `EXE-XX-YY-NN` format.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-phase.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/09-useability-and-skills/09-02-FIX-FIX-FIX-ISSUES.md

**Original plan for reference:**
@.planning/phases/09-useability-and-skills/09-02-FIX-FIX-FIX-PLAN.md

**Files to modify:**
@src/chat/commands/planFix.ts
@src/chat/issues/autoLog.ts
</context>

<tasks>
<task type="auto">
  <name>Fix UAT-001: Update parseUATIssues to handle both UAT- and EXE- prefix formats</name>
  <files>src/chat/commands/planFix.ts</files>
  <action>
Update the parseUATIssues function to handle both issue formats:

1. **Change the issue pattern regex** (line 45):
   - Current: `/### (UAT-\d+):\s*([^\n]+)([\s\S]*?)(?=### UAT-\d+:|$)/g`
   - New: `/### ((?:UAT|EXE)-[\d-]+):\s*([^\n]+)([\s\S]*?)(?=### (?:UAT|EXE)-[\d-]+:|$)/g`

   This matches:
   - `UAT-001`, `UAT-002`, etc. (from verify-work)
   - `EXE-02-01-01`, `EXE-09-02-FIX-01`, etc. (from execute-plan failures)

2. **Update field parsing to handle both formats** (lines 54-58):
   - Execution issues use `**Type:**` instead of `**Severity:**`
   - Add fallback: check for `**Type:**` if `**Severity:**` not found
   - Execution issues use `**Impact:**` instead of separate Expected/Actual
   - Add fallback for Impact field

3. **Rename function** for clarity:
   - Change `parseUATIssues` to `parseIssues` since it now handles both formats
   - Update the JSDoc comment to reflect both formats
   - Update all call sites (should just be one in handlePlanFix)

The field mapping for EXE issues:
- id: `EXE-XX-YY-NN` (captured from header)
- title: Text after colon (e.g., "Task failure in 09-02-PLAN.md")
- severity: Map from `**Type:**` (Execution Failure -> Major) or use `**Impact:**` (Blocking -> Blocker, else Major)
- description: From `**Description:**` (same field name)
- expected/actual: Not present in EXE format, leave undefined
- feature: Not present in EXE format, leave undefined
  </action>
  <verify>Build passes: npm run compile</verify>
  <done>
    - parseIssues function handles both UAT-XXX and EXE-XX-YY-NN formats
    - Plan Fix correctly finds and displays EXE- prefixed issues
    - Plan Fix still works for UAT- prefixed issues (no regression)
  </done>
</task>
</tasks>

<verification>
Before declaring plan complete:
- [ ] `npm run compile` succeeds without errors
- [ ] Regex correctly matches both `### UAT-001:` and `### EXE-02-01-01:` formats
- [ ] Severity mapping works for both formats
- [ ] No TypeScript errors
</verification>

<success_criteria>
- UAT-001 from 09-02-FIX-FIX-FIX-ISSUES.md addressed
- Plan Fix command can parse issues with EXE- prefix
- Tests pass
- Ready for re-verification
</success_criteria>

<output>
After completion, create `.planning/phases/09-useability-and-skills/09-02-FIX-FIX-FIX-FIX-SUMMARY.md`
</output>
