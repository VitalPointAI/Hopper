# UAT Issues: Phase 9 Plan 02-FIX-FIX-FIX

**Tested:** 2026-01-19
**Source:** .planning/phases/09-useability-and-skills/09-02-FIX-FIX-FIX-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: Plan Fix cannot parse open issues from ISSUES.md

**Discovered:** 2026-01-19
**Phase/Plan:** 09-02-FIX-FIX-FIX
**Severity:** Blocker
**Feature:** Plan Fix issue detection
**Description:** Plan Fix button appears and runs correctly, but reports "No open issues" even when the ISSUES.md file contains issues in the "Open Issues" section. The issue parser fails to detect issues formatted as `### EXE-XX-YY-NN: Title`.
**Expected:** Plan Fix should find issue `EXE-02-01-01` in the Open Issues section and offer to create a fix plan
**Actual:** Reports "No open issues. The ISSUES.md file has no open issues to fix. All issues may have been moved to Resolved Issues section."
**Repro:**
1. Have an ISSUES.md file with an `### EXE-02-01-01:` formatted issue under `## Open Issues`
2. Run Plan Fix button or `/plan-fix {phase}-{plan}`
3. Observe "No open issues" message despite file having open issues

## Resolved Issues

[None yet]

---

*Phase: 09-useability-and-skills*
*Plan: 02-FIX-FIX-FIX*
*Tested: 2026-01-19*
