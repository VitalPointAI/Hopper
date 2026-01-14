# UAT Issues: Phase 02 Plan 01

**Tested:** 2026-01-14
**Source:** .planning/phases/02-chat-participant/02-01-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-003: No follow-up suggestion chips appear

**Discovered:** 2026-01-14
**Phase/Plan:** 02-01
**Severity:** Minor (may be VSCode limitation)
**Feature:** Follow-up suggestions after chat response
**Description:** No follow-up suggestion chips appear below chat responses.
**Expected:** Follow-up chips like "Show commands" and "Check progress" should appear.
**Actual:** No chips visible below the response.
**Status:** Deferred - may be VSCode version or API limitation. Low priority.

## Resolved Issues

### UAT-004: License check gates entire chat instead of per-command

**Discovered:** 2026-01-14
**Resolved:** 2026-01-14 - Fixed in 02-01-FIX3.md
**Commits:** `000684d`, `e9e6e93`, `29bc077`

**Original issue:**
- Chat participant checked Phase 2 license on EVERY message
- Even basic chat like `@specflow hello` showed upgrade prompt
- License check should be per-command, not upfront

**Resolution:**
- Removed upfront checkPhaseAccess(2, ...) call
- Basic chat now works for all users without license check
- Per-command license gating deferred to 02-02 (slash commands)

### UAT-002: License check shows modal dialog instead of chat response

**Discovered:** 2026-01-14
**Resolved:** 2026-01-14 - Fixed in 02-01-FIX2.md
**Commits:** `9b1f796`, `cf54c40`

**Original issue:**
- Modal dialog popup appeared instead of in-stream upgrade message
- Chat panel remained empty after dismissing modal

**Resolution:**
- Added quiet mode to checkPhaseAccess
- Chat participant uses quiet mode to skip modal dialogs
- In-stream "SpecFlow Pro Required" message now displays properly

### UAT-001: Extension Development Host crashes on activation

### UAT-001: Extension Development Host crashes on activation

**Discovered:** 2026-01-14
**Resolved:** 2026-01-14 - Fixed in 02-01-FIX.md
**Commits:** `7805536`, `de35f79`, `edacbec`

**Original issue:**
- Extension crashed on activation due to Chat API registration issues
- Telemetry fetch failure visible but was caught properly

**Resolution:**
- Added try-catch around chat participant registration
- Added explicit onChatParticipant activation event
- Added defensive Chat API availability check
- Extension now activates successfully, @specflow visible in chat

---

*Phase: 02-chat-participant*
*Plan: 01*
*Tested: 2026-01-14*
