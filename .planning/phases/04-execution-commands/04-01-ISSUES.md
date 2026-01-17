# UAT Issues: Phase 4 Plan 01

**Tested:** 2026-01-17
**Source:** .planning/phases/04-execution-commands/04-01-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

[None]

## Resolved Issues

### UAT-001: Short plan paths don't resolve

**Discovered:** 2026-01-17
**Resolved:** 2026-01-17
**Phase/Plan:** 04-01
**Severity:** Major
**Feature:** /execute-plan path argument handling
**Description:** When providing a short plan path like `01-01-PLAN` or `01-01-PLAN.md`, the command fails with "Plan Not Found". Full relative paths like `.planning/phases/01-foundation/01-01-PLAN.md` work correctly.
**Resolution:** Added `resolvePlanPath()` helper that normalizes short identifiers (04-01, 04-01-PLAN, 04-01-PLAN.md) and searches `.planning/phases/*/` for matching files. Shows available plans in error message when not found.
**Commit:** 8b37819

### UAT-002: Execution streams suggestions instead of running as agent

**Discovered:** 2026-01-17
**Resolved:** 2026-01-17
**Phase/Plan:** 04-01
**Severity:** Major
**Feature:** /execute-plan task execution
**Description:** When executing tasks, the command streams LLM suggestions to the chat instead of actually creating/modifying files. Users expect agent-like behavior where the LLM can write code.
**Resolution:** Added tool calling support by checking `model.supportsToolCalling` and passing empty tools array to enable VSCode built-in tools. Updated prompts to instruct implementation vs description based on tool support. Added mode indicator and adjusted completion messaging.
**Commit:** e40c9f9, d403ef1

---

*Phase: 04-execution-commands*
*Plan: 01*
*Tested: 2026-01-17*
