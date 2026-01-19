---
phase: 09-useability-and-skills
plan: 02-FIX-FIX-FIX-FIX-FIX
subsystem: commands
tags: [plan-fix, verify-work, test-generation, uat]

# Dependency graph
requires:
  - phase: 09-02-FIX-FIX-FIX-FIX
    provides: issue parsing for UAT and EXE formats
provides:
  - Actionable fix task generation in /plan-fix
  - Context-aware test instructions for FIX plans in /verify-work
affects: [plan-fix, verify-work, execution-flow]

# Tech tracking
tech-stack:
  added: []
  patterns: [fix-context-loading, fallback-test-generation]

key-files:
  created: []
  modified:
    - src/chat/commands/planFix.ts
    - src/chat/commands/verifyWork.ts

key-decisions:
  - "LLM prompts with good/bad examples for actionable content"
  - "Fallback generates numbered steps from issue fields"
  - "FIX plans load parent ISSUES.md for context"
  - "generateFallbackTests creates meaningful tests from issue data"

patterns-established:
  - "FIX plan detection via fullPlanName.includes('-FIX')"
  - "Issue context loading for parent plan's ISSUES.md"

issues-created: []

# Metrics
duration: 3min
completed: 2026-01-19
---

# Phase 09 Plan 02-FIX-FIX-FIX-FIX-FIX Summary

**Actionable fix task generation with LLM good/bad examples, and context-aware test instructions for FIX plans that describe what was broken and how to verify the fix**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-19T15:20:26Z
- **Completed:** 2026-01-19T15:23:32Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Fixed /plan-fix to generate actionable tasks with specific implementation steps instead of echoing error messages
- Improved LLM prompt with explicit good/bad examples for action tag content
- Enhanced fallback task generation to use issue fields (expected/actual/feature) for numbered steps
- Fixed /verify-work to detect FIX plans and load original issue context
- Added FIX-specific LLM prompt that generates tests explaining what was broken and how to verify
- Created fallback test generation that provides meaningful instructions from issue data

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix UAT-002 - Improve plan-fix task generation** - `616dd06` (fix)
2. **Task 2: Fix UAT-001 - Improve verify-work test instructions for FIX plans** - `ba85ef3` (fix)

**Plan metadata:** [pending]

## Files Created/Modified

- `src/chat/commands/planFix.ts` - Enhanced LLM prompt with good/bad examples, improved generateBasicFixTasks to produce numbered actionable steps
- `src/chat/commands/verifyWork.ts` - Added FIX plan detection, loadIssuesForFixPlan helper, FIX-specific LLM prompt, generateFallbackTests function

## Decisions Made

- Used explicit good/bad examples in LLM prompts to guide better output quality
- Fallback task generation builds numbered steps from issue's expected/actual/feature fields
- FIX plans read parent's ISSUES.md by removing one -FIX suffix from plan name
- Test generation for FIX plans explains what was broken, how to reproduce, and how to verify

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- Both UAT issues from 09-02-FIX-FIX-FIX-FIX-ISSUES.md addressed
- /plan-fix now generates actionable fix tasks
- /verify-work on FIX plans shows meaningful test guidance
- Ready for re-verification to confirm fixes work correctly

---
*Phase: 09-useability-and-skills*
*Completed: 2026-01-19*
