# UAT Issues: Phase 3 Plan 02

**Tested:** 2026-01-15
**Source:** .planning/phases/03-planning-commands/03-02-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: All stream.button() calls non-functional

**Discovered:** 2026-01-15
**Phase/Plan:** 03-02
**Severity:** Major
**Feature:** Action buttons throughout extension
**Description:** All buttons rendered via stream.button() don't respond to clicks. This affects View, Status, Plan Phase, Create Roadmap, New Project buttons, and any other stream.button() usage.
**Expected:** Clicking a button should execute its associated command or action
**Actual:** Buttons appear but clicking does nothing
**Workaround:** Slash commands work correctly (/new-project, /create-roadmap, /plan-phase, etc.)
**Repro:**
1. Run /create-roadmap in a workspace with existing ROADMAP.md
2. Click any of the shown buttons (View, Status, Plan Phase)
3. Nothing happens

**Scope:** This appears to be an extension-wide issue, not specific to 03-02. Likely affects all commands using stream.button().

## Resolved Issues

[None yet]

---

*Phase: 03-planning-commands*
*Plan: 02*
*Tested: 2026-01-15*
