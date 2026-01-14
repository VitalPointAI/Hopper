# UAT Issues: Phase 02 Plan 01

**Tested:** 2026-01-14
**Source:** .planning/phases/02-chat-participant/02-01-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-002: License check shows modal dialog instead of chat response

**Discovered:** 2026-01-14
**Phase/Plan:** 02-01
**Severity:** Major
**Feature:** License-gated chat participant response
**Description:** When user sends message to @specflow without a connected wallet, a modal dialog popup appears asking to connect wallet. The chat panel itself shows nothing - no "SpecFlow Pro Required" message, no upgrade prompt, no follow-ups.
**Expected:** Chat stream should show the "SpecFlow Pro Required" markdown message with bullet points about Pro features, followed by "Upgrade to Pro" button. The modal should only appear if user clicks that button.
**Actual:** Modal dialog appears immediately, blocking. After dismissing the modal, chat panel remains empty with no response.
**Repro:**
1. Launch Extension Development Host (F5)
2. Open Chat panel
3. Type `@specflow hello` and send
4. Modal popup appears asking to connect wallet
5. Dismiss modal (click X or Cancel)
6. Chat panel is empty - no response from @specflow

**Root cause analysis:** The `checkPhaseAccess` function in `src/licensing/phaseGate.ts` likely calls `showUpgradeModal` which shows a blocking VSCode modal dialog, rather than returning false to let the chat handler show the in-chat upgrade prompt.

## Resolved Issues

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
