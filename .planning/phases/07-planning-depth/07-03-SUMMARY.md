---
phase: 07-planning-depth
plan: 03
subsystem: generators
tags: [prompts, llm, depth-configuration, planning]

# Dependency graph
requires:
  - phase: 07-02
    provides: Config selection and persistence
provides:
  - Depth-aware PROJECT.md extraction prompts
  - Depth-aware ROADMAP.md phase prompts
  - Depth-aware PLAN.md generation prompts
affects: [newProject, createRoadmap, planPhase]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Depth-parameterized prompt generation
    - Prompt template factory functions

key-files:
  created:
    - src/config/prompts.ts
  modified:
    - src/config/index.ts
    - src/chat/commands/newProject.ts
    - src/chat/commands/createRoadmap.ts

key-decisions:
  - "Standard depth for new projects since config doesn't exist yet"
  - "Prompt functions return full prompt strings (not fragments)"

patterns-established:
  - "Depth-aware prompts: quick targets minimal, standard balanced, comprehensive thorough"

issues-created: []

# Metrics
duration: 10min
completed: 2026-01-18
---

# Phase 7 Plan 3: Depth-Aware Prompts Summary

**Prompt template functions that vary LLM instructions based on configured planning depth (quick/standard/comprehensive)**

## Performance

- **Duration:** 10 min
- **Started:** 2026-01-18T17:30:32Z
- **Completed:** 2026-01-18T17:40:27Z
- **Tasks:** 5
- **Files modified:** 4

## Accomplishments
- Created src/config/prompts.ts with three depth-aware prompt generators
- Updated /new-project to use standard depth (config doesn't exist yet)
- Updated /create-roadmap to load config and show depth indicator
- Exported all prompt functions from config module

## Task Commits

Each task was committed atomically:

1. **Task 1: Create depth-aware prompt templates** - `b024bd5` (feat)
2. **Task 2: Update /new-project with depth-aware prompt** - `a587ef5` (feat)
3. **Task 3: Update /create-roadmap with depth-aware prompt** - `7aa0e9e` (feat)
4. **Task 4: Update config module exports** - `64def5f` (feat)

**Plan metadata:** (this commit) (docs: complete plan)

## Files Created/Modified
- `src/config/prompts.ts` - Three prompt generator functions (project, phase, plan)
- `src/config/index.ts` - Re-exports prompt functions
- `src/chat/commands/newProject.ts` - Uses getProjectExtractionPrompt('standard')
- `src/chat/commands/createRoadmap.ts` - Loads config, shows depth indicator, uses depth-aware prompt

## Decisions Made
- Use 'standard' depth for new projects since config doesn't exist at extraction time
- Prompt functions return complete prompt strings (not fragments to merge)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness
- Depth-aware prompts complete
- Ready for 07-04: Gate implementation (confirmation flow based on execution mode)
- getPlanGenerationPrompt exported but not yet used by /plan-phase (07-04 or separate task)

---
*Phase: 07-planning-depth*
*Completed: 2026-01-18*
