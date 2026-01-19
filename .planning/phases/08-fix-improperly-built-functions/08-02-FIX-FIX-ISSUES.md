# UAT Issues: Phase 8 Plan 02-FIX-FIX

**Tested:** 2026-01-19
**Source:** .planning/phases/08-fix-improperly-built-functions/08-02-FIX-FIX-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: Wrong contract name in license config

**Discovered:** 2026-01-19
**Phase/Plan:** 08-02-FIX-FIX
**Severity:** Blocker
**Feature:** Wallet auth license check
**Description:** The license config defaults to `license.hopper.near` but the actual deployed contract is `license.specflow.near`. This causes NEAR RPC "Server error" when checking licenses.
**Expected:** License check should query the correct contract and return license status
**Actual:** RPC error because contract `license.hopper.near` doesn't exist
**Repro:**
1. Authenticate with NEAR wallet
2. Run any license-gated command
3. See "Server error" in Hopper output channel

### UAT-002: Discuss-phase buttons display vertically

**Discovered:** 2026-01-19
**Phase/Plan:** 08-02-FIX-FIX
**Severity:** Cosmetic
**Feature:** Discuss-phase numbered buttons
**Description:** Buttons display vertically stacked. User preference is horizontal layout.
**Expected:** Buttons displayed horizontally (side by side)
**Actual:** Buttons displayed vertically (stacked)
**Repro:** Run `/discuss-phase 1` and observe button layout

## Resolved Issues

[None yet]

---

*Phase: 08-fix-improperly-built-functions*
*Plan: 02-FIX-FIX*
*Tested: 2026-01-19*
