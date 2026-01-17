---
phase: 04-execution-commands
plan: 01-FIX-FIX
type: fix
---

<objective>
Fix 1 UAT issue from plan 04-01-FIX.

Source: 04-01-FIX-ISSUES.md
Priority: 0 critical, 1 minor, 0 major
</objective>

<execution_context>
Execute tasks sequentially, committing after each task completion.
Follow the plan's verification and success criteria.
Create SUMMARY.md after all tasks complete.
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/04-execution-commands/04-01-FIX-ISSUES.md

**Original plan for reference:**
@.planning/phases/04-execution-commands/04-01-FIX-PLAN.md

**Source file to modify:**
@src/chat/commands/executePlan.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix UAT-001 - Move supportsTools check outside task loop</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
Fix the mode indicator inconsistency by checking `supportsTools` once before the task loop, not per-task inside the loop.

**Current problem:**
- `supportsTools` is checked at line 462 inside the task execution loop
- This means each task could potentially evaluate differently
- `usedAgentMode` is set based on `supportsTools` per-task
- The completion Mode indicator shows based on `usedAgentMode`
- This can cause "Implementation (apply manually)" during execution but "Mode: Agent" at completion

**Fix:**
1. Move the `supportsTools` check to BEFORE the task loop (around line 440, after plan parsing)
2. Set it once and use consistently for all tasks
3. This ensures the header text ("Agent executing..." vs "Implementation...") always matches the completion Mode indicator

Find where the task loop starts (around line 450 with `for (const task of plan.tasks)`) and move the supportsTools check before it.

Change from:
```typescript
// Inside task loop
const supportsTools = Boolean(request.model.supportsToolCalling);
```

To:
```typescript
// Before task loop, after plan parsing
// @ts-ignore - supportsToolCalling may not be in all VSCode versions
const supportsTools = Boolean(request.model.supportsToolCalling);

// Then use supportsTools throughout the loop consistently
```

Also simplify the `usedAgentMode` tracking - just set it once based on `supportsTools` before the loop instead of tracking per-task.
  </action>
  <verify>
- npm run compile succeeds
- supportsTools is checked exactly once before the task loop
- All tasks use the same supportsTools value
- Mode indicator matches execution text
  </verify>
  <done>
- supportsTools check moved outside task loop
- Consistent mode indicator throughout execution
- No TypeScript errors
  </done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] npm run compile succeeds without errors
- [ ] supportsTools checked once before loop
- [ ] Mode indicator consistent with execution text
- [ ] UAT-001 addressed
</verification>

<success_criteria>
- UAT-001 fixed: Mode indicator matches execution messaging
- All verification checks pass
- No TypeScript errors
</success_criteria>

<output>
After completion, create `.planning/phases/04-execution-commands/04-01-FIX-FIX-SUMMARY.md` following the summary template.

Also update 04-01-FIX-ISSUES.md to move fixed issues to "Resolved Issues" section.
</output>
