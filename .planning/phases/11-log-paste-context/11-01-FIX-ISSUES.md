# UAT Issues: Phase 11 Plan 01-FIX

**Tested:** 2026-01-19
**Source:** .planning/phases/11-log-paste-context/11-01-FIX-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: Missing guidance message when execution is stopped

**Discovered:** 2026-01-19
**Phase/Plan:** 11-01-FIX
**Severity:** Minor
**Feature:** Stop-and-resume flow
**Description:** When user stops execution, there is no guidance message explaining that they can paste context and send to resume.
**Expected:** After stopping, user sees a message like "Execution paused. Paste any additional context and send to resume, or use a command to do something else."
**Actual:** Execution stops silently without guidance about the resume capability.
**Repro:**
1. Start `/execute-plan` on any plan
2. Click Stop or press Escape
3. Observe no guidance message appears

## Resolved Issues

[None yet]

---

*Phase: 11-log-paste-context*
*Plan: 01-FIX*
*Tested: 2026-01-19*
