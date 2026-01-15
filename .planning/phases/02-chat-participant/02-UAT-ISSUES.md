# UAT Issues: Phase 02 (Full Phase)

**Tested:** 2026-01-14
**Source:** All Phase 2 SUMMARY.md files (02-01, 02-02, 02-03)
**Tester:** User via /gsd:verify-work

## Open Issues

[None]

## Resolved Issues

### UAT-001: stream.button() commands not registered

**Discovered:** 2026-01-14
**Phase/Plan:** 02-02, 02-03
**Severity:** Major
**Feature:** Action buttons in /help and /status
**Description:** The "Initialize Project" and "New Project" buttons rendered via `stream.button()` don't do anything when clicked. The buttons use command IDs like `specflow.chat-participant.new-project` but no VSCode commands are registered for these IDs.
**Expected:** Clicking button triggers the corresponding slash command (e.g., /new-project)
**Actual:** Nothing happens when button is clicked

**Resolved:** 2026-01-14 - Fixed in 02-UAT-FIX.md
**Fix:** Registered placeholder VSCode command `specflow.chat-participant.new-project` in extension.ts that shows an info message explaining the feature is coming in Phase 3.

---

*Phase: 02-chat-participant*
*Tested: 2026-01-14*
