# UAT Issues: Phase 9 Plan 02-FIX-FIX

**Tested:** 2026-01-19
**Source:** .planning/phases/09-useability-and-skills/09-02-FIX-FIX-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: Plan Fix button looks at global ISSUES.md instead of phase-scoped file

**Discovered:** 2026-01-19
**Phase/Plan:** 09-02-FIX-FIX
**Severity:** Major
**Feature:** Plan Fix button
**Description:** When clicking the Plan Fix button after execution failures, it looks at the global `.planning/ISSUES.md` file instead of the phase-scoped `{phase}-{plan}-ISSUES.md` file. Message shown: "No Open Issues - The ISSUES.md file has no open issues to fix. All issues may have been moved to 'Resolved Issues' section."
**Expected:** Plan Fix should find and read the phase-scoped issues file (e.g., `.planning/phases/09-useability-and-skills/09-02-FIX-FIX-ISSUES.md`)
**Actual:** Looks at global ISSUES.md which has no issues, reports no issues to fix
**Repro:**
1. Execute a plan that has failures
2. Click "Plan Fix" button
3. Observe it checks wrong file location

## Resolved Issues

[None yet]

---

*Phase: 09-useability-and-skills*
*Plan: 02-FIX-FIX*
*Tested: 2026-01-19*
