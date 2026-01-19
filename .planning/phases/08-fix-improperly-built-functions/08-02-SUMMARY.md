---
phase: 08-fix-improperly-built-functions
plan: 02
subsystem: ui
tags: [vscode, chat, testing, uat, prompts]

# Dependency graph
requires:
  - phase: 08-01-FIX
    provides: Button-based verify-work flow with state persistence
provides:
  - Detailed test instruction prompts with ACTION/STEPS/EXPECTED/CONFIRM format
  - Explicit Pause button for saving verification progress
  - Progress indicator showing test count and resume context
affects: [testing, uat, verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - LLM prompt with good/bad examples for instruction quality
    - Pause state with pausedAt timestamp
    - Resume context with prior results display

key-files:
  created: []
  modified:
    - src/chat/commands/verifyWork.ts

key-decisions:
  - "Improved prompt includes concrete good/bad examples"
  - "Pause button saves state without recording a result"
  - "Resume shows truncated prior results with status emoji"

patterns-established:
  - "LLM prompt quality: include bad/good examples for desired output format"
  - "Pause handling: save timestamp, return paused flag, show completion counts"

issues-created: []

# Metrics
duration: 3min
completed: 2026-01-19
---

# Phase 08 Plan 02: Enhanced Test Instructions Summary

**Detailed test instruction prompts with explicit pause/resume UX for collaborative verification**

## Performance

- **Duration:** 3 min
- **Started:** 2026-01-19T00:38:57Z
- **Completed:** 2026-01-19T00:42:18Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Enhanced LLM prompt to require ACTION, STEPS, EXPECTED, CONFIRM in each test instruction
- Added concrete good/bad examples to guide LLM output quality
- Added explicit Pause button to test picker with friendly resume message
- Enhanced resume flow to show "Previously completed" and "Continuing from" context
- Prior results display with truncated descriptions and status emoji

## Task Commits

Each task was committed atomically:

1. **Task 1: Improve LLM prompt for detailed test instructions** - `1e4aa13` (feat)
2. **Task 2: Add explicit Pause button to test picker** - `617619d` (feat)
3. **Task 3: Show progress indicator and help during testing** - `c6f078b` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/chat/commands/verifyWork.ts` - Enhanced LLM prompt, added Pause button, improved progress display

## Decisions Made

- Use concrete good/bad examples in LLM prompt rather than abstract instructions
- Pause button saves state with pausedAt timestamp but doesn't record a test result
- Resume context shows truncated descriptions (60 chars) to keep display compact

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- /verify-work now generates detailed, actionable test instructions
- Users have explicit Pause control with clear resume context
- Phase 8 complete - all /verify-work UX issues resolved
- Ready for verification testing or next milestone

---
*Phase: 08-fix-improperly-built-functions*
*Completed: 2026-01-19*
