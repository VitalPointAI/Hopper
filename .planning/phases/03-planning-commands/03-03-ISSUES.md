# UAT Issues: Phase 3 Plan 03

**Tested:** 2026-01-15
**Source:** .planning/phases/03-planning-commands/03-03-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-004: License check runs before argument validation

**Discovered:** 2026-01-15
**Phase/Plan:** 03-03
**Severity:** Major
**Feature:** /plan-phase command
**Description:** When running `/plan-phase` with no arguments, the command shows "connect wallet" message instead of usage help. The license check happens before argument validation.
**Expected:** Show usage help explaining how to use the command when no arguments provided
**Actual:** Shows license/wallet connection message blocking access to usage help
**Repro:**
1. Open VSCode chat
2. Type `@specflow /plan-phase` (no arguments)
3. Observe wallet connection message instead of usage help

### UAT-005: Phase 1 planning requires license

**Discovered:** 2026-01-15
**Phase/Plan:** 03-03
**Severity:** Major
**Feature:** /plan-phase command
**Description:** Per the freemium model, Phase 1 planning should be free without requiring a license. Currently all /plan-phase usage is gated behind license check.
**Expected:** Phase 1 planning should work without license; only Phase 2+ should require Pro license
**Actual:** All phases require license, including Phase 1
**Repro:**
1. Open VSCode chat without connecting wallet/license
2. Type `@specflow /plan-phase 1`
3. Observe license required message

## Resolved Issues

### UAT-006: Licensing infrastructure not deployed (RESOLVED)

**Discovered:** 2026-01-15
**Phase/Plan:** 03-03 (blocks testing)
**Severity:** Blocker
**Feature:** Wallet connection / license validation
**Description:** Cannot test /plan-phase with license because the wallet/license infrastructure (NEAR contract, Cloudflare Worker, KV namespaces) has not been deployed to production.
**Expected:** Wallet page loads, user can connect and obtain license
**Actual:** "That page is not deployed/useable"
**Resolved:** 2026-01-15 - Phase 01.5.1 deployed Worker, contract, and implemented user auth endpoints
**Worker:** https://specflow-license-api.vitalpointai.workers.dev
**Contract:** license.specflow.near

### UAT-001: License gating not enforced for /plan-phase

**Discovered:** 2026-01-15
**Phase/Plan:** 03-03
**Severity:** Major
**Feature:** /plan-phase command
**Description:** Command executes even when user has no license. Planning commands (Phase 3+) should require Pro license.
**Expected:** Command should check license status and show "Pro license required" message when not licensed
**Actual:** Command runs and generates plan without license check
**Resolved:** 2026-01-15 - Fixed in 03-03-FIX.md
**Commit:** 3ac261e

### UAT-002: XML template references GSD/Claude paths

**Discovered:** 2026-01-15
**Phase/Plan:** 03-03
**Severity:** Major
**Feature:** Plan generation output
**Description:** Generated plan XML contains references to `~/.claude/get-shit-done` paths and GSD workflows instead of SpecFlow-specific content
**Expected:** Template content should reference SpecFlow conventions and paths
**Actual:** Template execution_context and other fields reference Claude Code / GSD framework
**Resolved:** 2026-01-15 - Fixed in 03-03-FIX.md
**Commit:** a76c8e3

### UAT-003: Missing argument defaults to Phase 1 instead of showing usage

**Discovered:** 2026-01-15
**Phase/Plan:** 03-03
**Severity:** Minor
**Feature:** Argument parsing
**Description:** When no phase number provided, command defaults to planning Phase 1 instead of showing usage help
**Expected:** Show usage message like "Usage: /plan-phase <phase-number>"
**Actual:** Says "no plan identified" and proceeds to create Phase 1 plan
**Resolved:** 2026-01-15 - Fixed in 03-03-FIX.md
**Commit:** 3ac261e

---

*Phase: 03-planning-commands*
*Plan: 03*
*Tested: 2026-01-15*
