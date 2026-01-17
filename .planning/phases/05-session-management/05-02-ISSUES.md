# UAT Issues: Phase 5 Plan 2

**Tested:** 2026-01-17
**Source:** .planning/phases/05-session-management/05-02-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-003: .continue-here.md not deleted after resume

**Discovered:** 2026-01-17
**Phase/Plan:** 05-02
**Severity:** Minor
**Feature:** Handoff file lifecycle
**Description:** After clicking "Continue from Here" or "Start Fresh" in /resume-work, the `.continue-here.md` file is not deleted. The code has a `clearHandoffAfterCompletion()` helper exported from resumeWork.ts, but it's not called by execute-plan after completion.
**Expected:** Handoff file deleted after plan completes (per SUMMARY.md: "Handoff file will be deleted after the plan completes")
**Actual:** File persists indefinitely
**Note:** This is by-design - the helper exists but execute-plan integration is planned for later. Documenting for completeness.
**Fix:** Call `clearHandoffAfterCompletion()` from execute-plan's completion path.

### UAT-004: "Start Fresh" and "Continue from Here" appear identical

**Discovered:** 2026-01-17
**Phase/Plan:** 05-02
**Severity:** Cosmetic
**Feature:** /resume-work navigation options
**Description:** Both buttons often route to `/progress`, making them seem identical. "Continue from Here" only differs when there's a specific plan path in the handoff.
**Expected:** Clear distinction between resuming paused work vs starting fresh
**Actual:** Both appear to do the same thing when no plan path in handoff
**Note:** The behavior is correct but UX could be confusing. Consider different routing or clearer button labels.

## Resolved Issues

### UAT-001: pause-work and resume-work commands not visible in slash menu
**Resolved:** 2026-01-17 - Fixed during UAT session
**Fix:** Added commands to package.json chatParticipants commands array

### UAT-002: stream.button() buttons don't work for execute-plan, pause-work, resume-work
**Resolved:** 2026-01-17 - Fixed during UAT session
**Fix:** Added command wrappers to extension.ts chatParticipantCommands array

---

*Phase: 05-session-management*
*Plan: 02*
*Tested: 2026-01-17*
