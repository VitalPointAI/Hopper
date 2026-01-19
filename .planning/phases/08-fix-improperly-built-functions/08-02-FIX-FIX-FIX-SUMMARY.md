---
phase: 08-fix-improperly-built-functions
plan: 02-FIX-FIX-FIX
subsystem: licensing
tags: [near, contract, config]

# Dependency graph
requires:
  - phase: 08-02-FIX-FIX
    provides: Output channel logging revealed contract name mismatch
provides:
  - Correct license contract name (license.specflow.near)
  - Working wallet license validation
affects: [licensing, auth]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/licensing/types.ts

key-decisions:
  - "Use original contract name (license.specflow.near) rather than redeploying contract"

patterns-established: []

issues-created: []

# Metrics
duration: 2min
completed: 2026-01-19
---

# Phase 8 Plan 02-FIX-FIX-FIX: Fix License Contract Name Summary

**Corrected license contract name from license.hopper.near to license.specflow.near to restore wallet license validation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-19T12:25:00Z
- **Completed:** 2026-01-19T12:27:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Fixed blocker UAT-001: License checks now query the correct contract
- Wallet users can have licenses validated without RPC errors

## Task Commits

1. **Task 1: Correct license contract name** - `6921ba9` (fix)

**Plan metadata:** TBD (this commit)

## Files Created/Modified

- `src/licensing/types.ts` - Changed DEFAULT_LICENSE_CONFIG.contractId from 'license.hopper.near' to 'license.specflow.near'

## Decisions Made

- Used original deployed contract name (license.specflow.near) rather than redeploying contract with new name
- UAT-002 (cosmetic - vertical buttons) documented as VSCode API limitation, not fixable without custom webview

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- UAT-001 blocker resolved
- Ready for re-verification with /gsd:verify-work 08-02-FIX-FIX-FIX
- Milestone 1 complete pending successful re-verification

---

*Phase: 08-fix-improperly-built-functions*
*Completed: 2026-01-19*
