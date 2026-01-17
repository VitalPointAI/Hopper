# UAT Issues: Phase 04 Plan 01-FIX-FIX-FIX-FIX-FIX-FIX

**Tested:** 2026-01-17
**Source:** .planning/phases/04-execution-commands/04-01-FIX-FIX-FIX-FIX-FIX-FIX-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

[None - all issues resolved]

## Resolved Issues

### UAT-001: copilot_createFile fails with "Invalid stream" error
**Resolved:** 2026-01-17 - Fixed in 04-01-FIX8 (custom hopper_createFile tool)
**Commit:** a2c8534
**Severity:** Blocker
**Root Cause:** Bug in GitHub Copilot Chat extension 0.36.1 - copilot_createFile tool throws "Invalid stream" when invoked via vscode.lm.invokeTool
**Solution:** Created custom hopper_createFile and hopper_createDirectory tools that use VSCode's native workspace.fs API
**Verification:** Files are now created successfully during plan execution, confirmed by tester

### UAT-001 (from FIX5): Tool calls use relative paths instead of absolute paths
**Resolved:** 2026-01-17 - Fixed in 04-01-FIX-FIX-FIX-FIX-FIX-FIX
**Commit:** 6b1a2ef
**Verification:** Directory creation now uses absolute paths, confirmed by tester

### UAT-002 (from FIX5): Runtime crash - c.content.map is not a function
**Resolved:** 2026-01-17 - Fixed in 04-01-FIX-FIX-FIX-FIX-FIX-FIX
**Commit:** 6b1a2ef
**Verification:** Model receives tool results and continues appropriately, confirmed by tester

---

*Phase: 04-execution-commands*
*Plan: 01-FIX-FIX-FIX-FIX-FIX-FIX*
*Tested: 2026-01-17*
