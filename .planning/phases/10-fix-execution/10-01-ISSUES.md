# UAT Issues: Phase 10 Plan 01

**Tested:** 2026-01-19
**Source:** .planning/phases/10-fix-execution/10-01-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: FIX plans lack sufficient context to actually fix issues

**Discovered:** 2026-01-19
**Phase/Plan:** 10-01
**Severity:** Blocker
**Feature:** Automatic FIX plan generation after task failures
**Description:** When execution fails and auto-creates FIX plans, those plans don't contain enough information to actually fix the problem. The ISSUES.md file gets populated with generic entries like "Task failure in X-PLAN.md" and "Suggested fix: Review error, adjust plan or retry manually" - but the generated FIX plan lacks:
- The full error output (actual error message, stack trace)
- Specific actionable fix instructions based on the error type
- Relevant code context showing what failed and suggesting changes

This results in infinite loops where FIX plans keep failing because they don't have enough context to address the root cause.

**Expected:** When a task fails:
1. Capture and include the full error output in the ISSUES.md
2. Generate specific fix instructions based on the error type (test failure vs compile error vs runtime error)
3. Include relevant code context - the files involved and what changes might fix the issue
4. The FIX plan should be actionable enough for execution to succeed

**Actual:** ISSUES.md contains generic "Task failure" entries with "Review error, adjust plan or retry manually" which provides no actionable guidance. The FIX plans generated from this are equally vague and fail in the same way.

**Repro:**
1. Run `/execute-plan` on a plan where a task will fail (e.g., tests fail)
2. Observe the auto-created ISSUES.md - it lacks error details
3. Run `/plan-fix` or let it auto-create a FIX plan
4. The FIX plan is too generic to fix the actual issue
5. Execute the FIX plan - it fails similarly
6. Loop continues indefinitely

## Resolved Issues

[None yet]

---

*Phase: 10-fix-execution*
*Plan: 01*
*Tested: 2026-01-19*
