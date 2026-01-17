# UAT Issues: Phase 04 Plan 01-FIX-FIX-FIX-FIX-FIX

**Tested:** 2026-01-17
**Source:** .planning/phases/04-execution-commands/04-01-FIX-FIX-FIX-FIX-FIX-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: Tool calls use relative paths instead of absolute paths

**Discovered:** 2026-01-17
**Phase/Plan:** 04-01-FIX-FIX-FIX-FIX-FIX
**Severity:** Blocker
**Feature:** Tool orchestration with copilot_createFile
**Description:** When the model calls copilot_createFile, it passes relative paths (e.g., "src/db/schema.sql") but the tool requires absolute paths.
**Expected:** Tool calls should use absolute paths based on workspace root
**Actual:** Error "Invalid input path: src/db/schema.sql. Be sure to use an absolute path."
**Repro:**
1. Run @hopper /execute-plan on a plan with file creation tasks
2. Observe tool call errors for path validation

### UAT-002: Runtime crash - c.content.map is not a function

**Discovered:** 2026-01-17
**Phase/Plan:** 04-01-FIX-FIX-FIX-FIX-FIX
**Severity:** Blocker
**Feature:** Tool result processing in executeWithTools
**Description:** After tool calls return, the execution crashes with "c.content.map is not a function"
**Expected:** Tool results should be processed and fed back to model for next iteration
**Actual:** Runtime error crashes the execution loop
**Repro:**
1. Run @hopper /execute-plan
2. Let tools execute and return results
3. Observe crash when processing tool results

## Resolved Issues

[None yet]

---

*Phase: 04-execution-commands*
*Plan: 01-FIX-FIX-FIX-FIX-FIX*
*Tested: 2026-01-17*
