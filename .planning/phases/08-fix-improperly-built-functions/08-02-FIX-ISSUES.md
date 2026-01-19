# UAT Issues: Phase 08 Plan 02-FIX

**Tested:** 2026-01-18
**Source:** .planning/phases/08-fix-improperly-built-functions/08-02-FIX-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: Wallet auth license check returns false negative

**Discovered:** 2026-01-18
**Phase/Plan:** 08-02-FIX
**Severity:** Blocker
**Feature:** License validation for wallet auth
**Description:** User is connected with wallet auth and has a valid (non-expired) license, but phase-gated commands show "Upgrade to Pro" button instead of allowing access.
**Expected:** License check should pass and command should execute
**Actual:** Shows "Upgrade to Pro" button even with valid wallet license
**Repro:**
1. Connect with NEAR wallet
2. Have an active license on the contract
3. Run a phase-gated command like /plan-phase
4. Observe "Upgrade to Pro" button instead of command execution

### UAT-002: No Hopper output channel for debug logs

**Discovered:** 2026-01-18
**Phase/Plan:** 08-02-FIX
**Severity:** Minor
**Feature:** Debug logging
**Description:** Debug logs were added to license check flow, but no "Hopper" output channel exists in VSCode Output panel.
**Expected:** "Hopper" channel should appear in Output panel dropdown
**Actual:** No Hopper channel visible
**Repro:**
1. Open VSCode Output panel (View > Output)
2. Check dropdown for "Hopper" channel
3. Channel does not exist

### UAT-003: Discuss-phase button text truncation

**Discovered:** 2026-01-18
**Phase/Plan:** 08-02-FIX
**Severity:** Major
**Feature:** Button-based discuss-phase flow
**Description:** Button text for discuss-phase questions gets cut off on the right side, making it hard to understand what each option means.
**Expected:** Full button text visible or truncated with ellipsis in readable way
**Actual:** Text cut off significantly, options hard to distinguish
**Repro:**
1. Run /discuss-phase for any phase
2. Observe buttons that appear for answering questions
3. Text is truncated on right side

## Resolved Issues

[None yet]

---

*Phase: 08-fix-improperly-built-functions*
*Plan: 02-FIX*
*Tested: 2026-01-18*
