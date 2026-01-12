---
phase: 01-foundation
plan: 03
subsystem: provider
tags: [vscode-api, language-model-provider, streaming, openai-sdk]

requires:
  - phase: 01-02
    provides: NEAR AI client and auth module
provides:
  - LanguageModelChatProvider implementation
  - Model picker integration
  - Streaming chat responses
  - API key management UI
affects: [02-chat-participant, user-facing-features]

tech-stack:
  added: []
  patterns: [provider-pattern, streaming-response, graceful-degradation]

key-files:
  created: [src/provider/nearAiProvider.ts, src/provider/messageConverter.ts]
  modified: [src/extension.ts]

key-decisions:
  - "Enable toolCalling for models to appear in agent mode dropdown"
  - "Show friendly prompt instead of error when API key missing"
  - "Detect tool support from model description keywords"

patterns-established:
  - "Check auth before API call, prompt user gracefully"
  - "Dynamic model fetching with caching"

issues-created: []

duration: 8min
completed: 2026-01-12
---

# Phase 01: Foundation - Plan 03 Summary

**NEAR AI models registered in VSCode's native model picker with streaming responses and friendly API key setup flow.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-12T22:46:00Z
- **Completed:** 2026-01-12T22:54:00Z
- **Tasks:** 3 (2 auto + 1 checkpoint)
- **Files modified:** 3

## Accomplishments

- Implemented full LanguageModelChatProvider with all 3 required methods
- NEAR AI models appear in VSCode's model picker dropdown
- Streaming responses work correctly via progress.report()
- Friendly API key setup flow when user tries to use unconfigured model
- Dynamic model fetching from NEAR AI Cloud with tool calling detection

## Task Commits

1. **Task 1: Implement LanguageModelChatProvider** - `0868295` (feat)
2. **Task 2: Register provider in extension activation** - `9aa18ed` (feat)
3. **Fix: Enable tool calling for picker visibility** - `0b64f37` (fix)
4. **Fix: Friendly API key prompt** - `211db53` (fix)

**Plan metadata:** (pending)

## Files Created/Modified

- `src/provider/nearAiProvider.ts` - Full provider implementation with 3 methods
- `src/provider/messageConverter.ts` - VSCode-to-OpenAI message format conversion
- `src/extension.ts` - Provider registration and management command

## Decisions Made

- **Enable toolCalling capability** - Required for models to appear in agent mode dropdown (discovered during verification)
- **Graceful API key handling** - Show dialog + helpful chat message instead of throwing error
- **Detect tool support heuristically** - Check model description for "tool", "agent", etc.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Models not appearing in main dropdown**
- **Found during:** Task 3 (human verification)
- **Issue:** Models appeared in "Manage Models" but not main picker - toolCalling was false
- **Fix:** Enable toolCalling:true for models that support it, detect from description
- **Files modified:** src/provider/nearAiProvider.ts
- **Verification:** Models now appear in main dropdown
- **Committed in:** 0b64f37

**2. [Rule 1 - Bug] Cryptic error when API key not configured**
- **Found during:** Task 3 (human verification)
- **Issue:** Using model without API key threw ugly stack trace error
- **Fix:** Check auth first, show friendly dialog + in-chat setup instructions
- **Files modified:** src/provider/nearAiProvider.ts
- **Verification:** User sees helpful prompt instead of error
- **Committed in:** 211db53

**3. [Deviation from plan] Auth approach changed**
- **Found during:** Task 1 (implementation)
- **Issue:** Plan referenced old getAuthFromConfigFile/isAuthConfigured APIs that no longer exist after 01-02-FIX
- **Fix:** Adapted to use SecretStorage-based API key approach from 01-02-FIX
- **Files modified:** src/provider/nearAiProvider.ts
- **Verification:** Works with current auth module
- **Committed in:** 0868295

---

**Total deviations:** 3 (2 bugs fixed during verification, 1 plan adaptation)
**Impact on plan:** All fixes necessary for correct operation. No scope creep.

## Issues Encountered

- **Category header in dropdown**: NEAR AI models appear grouped under "NEAR AI" in Manage Models view, but no category header in main dropdown picker. This is a VSCode UI limitation - the dropdown renderer doesn't show vendor headers like the full models editor does. Cosmetic only, functionality works.

## Next Phase Readiness

**Phase 1: Foundation is COMPLETE!**

All 3 plans executed successfully:
- 01-01: Extension scaffolding ✓
- 01-02: NEAR AI client ✓
- 01-03: Language Model provider ✓

Ready for Phase 1.5 (Licensing) or Phase 2 (Chat Participant).

---
*Phase: 01-foundation*
*Completed: 2026-01-12*
