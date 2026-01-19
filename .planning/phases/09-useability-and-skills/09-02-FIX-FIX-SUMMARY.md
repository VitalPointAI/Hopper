---
phase: 09-useability-and-skills
plan: 02-FIX-FIX
subsystem: execution
tags: [chat-participant, execute-plan, button, ux]

# Dependency graph
requires:
  - phase: 09-02-FIX
    provides: Verify failure detection and auto-issue logging
provides:
  - Plan Fix button shown after task failures
  - Failure-specific next steps UX
affects: [execute-plan, verify-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Conditional next steps based on execution outcome

key-files:
  created: []
  modified:
    - src/chat/commands/executePlan.ts

key-decisions:
  - "Show Plan Fix as primary action when failures occur"
  - "Remove git changes button for failures (not relevant)"

patterns-established:
  - "Failure-specific next steps flow"

issues-created: []

# Metrics
duration: 1min
completed: 2026-01-19
---

# Phase 9 Plan 02-FIX-FIX: Plan Fix Button Summary

**Added "Plan Fix" button as primary next step action when task failures occur during plan execution**

## Performance

- **Duration:** 1 min
- **Started:** 2026-01-19T14:33:20Z
- **Completed:** 2026-01-19T14:34:08Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added `hasFailures` check before rendering Next Steps section
- When failures exist: Show "Plan Fix" button (primary) + "Check Progress" (secondary)
- When no failures: Keep existing git changes/verify/commit flow
- Plan Fix button invokes `hopper.chat-participant.plan-fix` with plan identifier

## Task Commits

1. **Task 1: Fix UAT-001 - Add Plan Fix button** - `082f78c` (fix)

**Plan metadata:** This commit (docs: complete plan)

## Files Created/Modified

- `src/chat/commands/executePlan.ts` - Added failure-specific next steps branch

## Decisions Made

- Plan Fix button uses plan identifier format `{phase}-{plan}` (e.g., "09-02")
- Remove git changes button for failures since reviewing changes isn't the priority when tasks failed
- Keep Check Progress as secondary action for failure flow

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- UAT-001 from 09-02-FIX-ISSUES.md addressed
- Ready for re-verification or next plan execution

---
*Phase: 09-useability-and-skills*
*Completed: 2026-01-19*
