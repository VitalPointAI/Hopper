---
phase: 10-fix-execution
plan: 01-FIX-FIX
type: fix
---

<objective>
Fix 1 UAT issue from plan 10-01-FIX.

Source: 10-01-FIX-ISSUES.md
Priority: 0 critical, 0 major, 1 minor
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-phase.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/10-fix-execution/10-01-FIX-ISSUES.md

**Original plan for reference:**
@.planning/phases/10-fix-execution/10-01-FIX-PLAN.md

**File to modify:**
@src/chat/commands/planFix.ts
</context>

<tasks>
<task type="auto">
  <name>Fix UAT-001: Smart truncation that preserves file paths</name>
  <files>src/chat/commands/planFix.ts</files>
  <action>
Update the `truncateForPrompt` function in planFix.ts to implement smart truncation that:

1. **Extract file paths first:** Before truncating, use a regex to find all file paths in the error output (patterns like `/home/...`, `./...`, `src/...`, paths ending in `.ts`, `.js`, `.tsx`, `.md`, etc.)

2. **Preserve key paths:** Keep the most relevant file paths (first 2-3 unique paths found) at the beginning of the truncated output

3. **Truncate the middle:** If the output is too long, truncate from the middle or end of non-path content, keeping:
   - First line (often contains the error type)
   - File paths
   - Last meaningful error line if possible

4. **Alternative simpler approach:** If extracting paths is complex, increase the limit from 300 to 500 characters for task action error context, and from 500 to 800 for LLM prompts. This gives more room for paths while staying manageable.

Choose the simpler approach (increasing limits) unless the smart extraction is straightforward to implement. The goal is pragmatic improvement, not perfect truncation.

Update both call sites:
- Line 245: `truncateForPrompt(issue.fullOutput)` - for LLM prompt (currently 500, increase to 800)
- Line 377: `truncateForPrompt(issue.fullOutput, 300)` - for task action (increase to 500)
  </action>
  <verify>
1. Build passes: `npm run compile`
2. Read the updated function and verify the limits are increased
3. Verify no TypeScript errors
  </verify>
  <done>
- Truncation limits increased to give more room for file paths
- Both call sites updated with new limits
- Build passes
  </done>
</task>
</tasks>

<verification>
Before declaring plan complete:
- [ ] All tasks completed
- [ ] Build passes without errors
- [ ] Truncation limits increased appropriately
</verification>

<success_criteria>
- UAT-001 from 10-01-FIX-ISSUES.md addressed
- Longer truncation limits provide more context for file paths
- Build passes
- Ready for re-verification
</success_criteria>

<output>
After completion, create `.planning/phases/10-fix-execution/10-01-FIX-FIX-SUMMARY.md`
</output>
