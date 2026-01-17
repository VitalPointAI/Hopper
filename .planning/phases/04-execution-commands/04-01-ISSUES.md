# UAT Issues: Phase 4 Plan 01

**Tested:** 2026-01-17
**Source:** .planning/phases/04-execution-commands/04-01-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: Short plan paths don't resolve

**Discovered:** 2026-01-17
**Phase/Plan:** 04-01
**Severity:** Major
**Feature:** /execute-plan path argument handling
**Description:** When providing a short plan path like `01-01-PLAN` or `01-01-PLAN.md`, the command fails with "Plan Not Found". Full relative paths like `.planning/phases/01-foundation/01-01-PLAN.md` work correctly.
**Expected:** Short plan identifiers should resolve to full paths (matching GSD behavior where you can just say `04-01-PLAN`)
**Actual:** Only full relative paths from workspace root are accepted
**Repro:**
1. Type `@hopper /execute-plan 01-01-PLAN.md`
2. See "Plan Not Found" error
3. Type `@hopper /execute-plan .planning/phases/01-foundation/01-01-PLAN.md`
4. Works correctly

### UAT-002: Execution streams suggestions instead of running as agent

**Discovered:** 2026-01-17
**Phase/Plan:** 04-01
**Severity:** Major
**Feature:** /execute-plan task execution
**Description:** When executing tasks, the command streams LLM suggestions to the chat instead of actually creating/modifying files. Users expect agent-like behavior where the LLM can write code.
**Expected:** Execute in agent mode where LLM can create and modify files directly
**Actual:** Streams code suggestions that user must manually apply via Copilot Edit or copy/paste
**Repro:**
1. Run `/execute-plan` on any plan
2. Watch task execution
3. See code streamed as suggestions, not applied to files

## Resolved Issues

[None yet]

---

*Phase: 04-execution-commands*
*Plan: 01*
*Tested: 2026-01-17*
