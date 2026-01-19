---
phase: 10-fix-execution
plan: 01-FIX
type: fix
---

<objective>
Fix 1 blocker UAT issue: FIX plans lack sufficient context to fix execution failures.

Source: 10-01-ISSUES.md
Priority: 1 blocker, 0 major, 0 minor

The root cause is that when tasks fail:
1. `autoLog.ts` only captures brief error summaries, not full error output
2. `planFix.ts` generates generic fix tasks without the error context needed to actually fix issues
3. This creates infinite loops where FIX plans fail the same way as the original

The fix requires:
1. Expanding TaskFailure interface to include full error output
2. Updating autoLog.ts to store the complete error details in ISSUES.md
3. Updating planFix.ts to include error output in generated FIX tasks
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/10-fix-execution/10-01-ISSUES.md

**Current implementations:**
@src/chat/issues/autoLog.ts
@src/chat/commands/planFix.ts
@src/chat/commands/executePlan.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Expand TaskFailure to include full error output</name>
  <files>src/chat/issues/autoLog.ts</files>
  <action>
1. Add new fields to TaskFailure interface:
   - `fullOutput: string` - The complete tool output captured during execution
   - `verifyOutput?: string` - The specific verify step output if available
   - `files?: string[]` - Files that were being modified when failure occurred

2. Update formatIssueEntry() to include the full error details:
   - Add a "Full Error Output" section that includes `fullOutput` (truncated to ~2000 chars if needed)
   - Add an "Affected Files" section if files are provided
   - Change "Suggested fix" from generic text to "See full error output above for root cause"

3. The ISSUES.md entry should look like:
```markdown
### EXE-09-02-01: Task failure in 09-02-PLAN.md

- **Discovered:** ...
- **Type:** Execution Failure
- **Task:** "Create user validation"
- **Description:** Task failed: Verify step failed: test suite failed
- **Impact:** Blocking
- **Affected Files:** src/utils/validate.ts, src/utils/validate.test.ts

**Full Error Output:**
```
[The actual error message, stack trace, test output, etc.]
```

- **Suggested fix:** See error output above for root cause. Check test output for specific failing assertions.
```
  </action>
  <verify>Build succeeds: npm run compile</verify>
  <done>TaskFailure interface has fullOutput field, formatIssueEntry includes full error output section</done>
</task>

<task type="auto">
  <name>Task 2: Pass full error output when logging task failures</name>
  <files>src/chat/commands/executePlan.ts</files>
  <action>
1. Find the two places where logTaskFailure is called (around lines 1407 and 1493)

2. At the first location (verify step failure around line 1407):
   - Add `fullOutput: executionResult.toolOutput` to the TaskFailure object
   - Add `verifyOutput: verifyCheck.reason` for the specific verify failure
   - Extract file paths from the current task: `files: task.files ? task.files.split(',').map(f => f.trim()) : []`

3. At the second location (general task failure around line 1493):
   - Same changes: add fullOutput from executionResult.toolOutput
   - Include task files if available

4. The failure objects should look like:
```typescript
const failure: TaskFailure = {
  planPath,
  taskId: task.id,
  taskName: task.name,
  error: `Verify step failed: ${verifyCheck.reason}`,
  fullOutput: executionResult.toolOutput,  // ADD THIS
  verifyOutput: verifyCheck.reason,         // ADD THIS
  files: task.files?.split(',').map(f => f.trim()).filter(Boolean), // ADD THIS
  phase: plan.phase,
  planNumber: String(plan.planNumber).padStart(2, '0'),
  timestamp: new Date()
};
```
  </action>
  <verify>Build succeeds: npm run compile</verify>
  <done>Both logTaskFailure calls include fullOutput, verifyOutput, and files fields</done>
</task>

<task type="auto">
  <name>Task 3: Update planFix to use error context in generated tasks</name>
  <files>src/chat/commands/planFix.ts</files>
  <action>
1. Update UATIssue interface to include the new fields:
   - `fullOutput?: string` - Full error output from ISSUES.md
   - `affectedFiles?: string[]` - Files involved in the failure

2. Update parseIssues() to extract the new fields:
   - Parse "Full Error Output" code block content
   - Parse "Affected Files" list

3. Update generateFixTasks() LLM prompt to include error context:
   - Add the full error output to the prompt so the LLM can generate specific fix instructions
   - Include affected files so the LLM knows which files to target

4. Update generateBasicFixTasks() fallback to be more actionable:
   - Include truncated error output in the action steps
   - Reference specific files that need to be fixed
   - Generate more specific fix guidance based on error patterns:
     * Test failures: "Review test output, fix failing assertions or update test expectations"
     * TypeScript errors: "Fix type errors shown in output"
     * Build errors: "Resolve compilation errors"
     * Runtime errors: "Debug runtime error, check stack trace for root cause"

5. The generated tasks should reference the actual error:
```xml
<task type="auto">
  <name>Fix EXE-09-02-01: Test validation failure</name>
  <files>src/utils/validate.ts, src/utils/validate.test.ts</files>
  <action>
The task failed with this error:
```
TypeError: Cannot read property 'email' of undefined
  at validateUser (src/utils/validate.ts:23:15)
  at Object.<anonymous> (src/utils/validate.test.ts:45:5)
```

Fix steps:
1. Open src/utils/validate.ts line 23
2. Add null check before accessing .email property
3. Run tests: npm test src/utils/validate.test.ts
  </action>
  <verify>npm test src/utils/validate.test.ts passes</verify>
  <done>validateUser handles null input, tests pass</done>
</task>
```
  </action>
  <verify>Build succeeds: npm run compile</verify>
  <done>FIX plans include actual error output and specific fix instructions</done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] npm run compile succeeds
- [ ] TaskFailure interface includes fullOutput, verifyOutput, files fields
- [ ] ISSUES.md entries include full error output section
- [ ] Generated FIX plans include actual error details
- [ ] Generated FIX tasks reference specific files to fix
</verification>

<success_criteria>
- UAT-001 resolved: FIX plans now contain sufficient context
- Error output captured in ISSUES.md
- FIX plan tasks include specific actionable instructions based on error
- Ready for re-verification
</success_criteria>

<output>
After completion, create `.planning/phases/10-fix-execution/10-01-FIX-SUMMARY.md`
</output>
