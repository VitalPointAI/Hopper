# UAT Issues: Phase 11 Plan 01

**Tested:** 2026-01-19
**Source:** .planning/phases/11-log-paste-context/11-01-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: Cannot send messages during active execution due to VSCode Chat API limitation

**Discovered:** 2026-01-19
**Phase/Plan:** 11-01
**Severity:** Blocker
**Feature:** Mid-execution context injection
**Description:** User can type in the chat input during execution, but cannot send the message without first clicking the Stop button to terminate execution. The VSCode Chat API blocks sending new messages while a response is actively streaming.
**Expected:** User can paste context and send it while execution continues, with the context being stored and incorporated into subsequent tasks.
**Actual:** VSCode Chat UI requires stopping the active response before a new message can be sent. This defeats the purpose of "non-interrupting" context injection.
**Root Cause:** VSCode Chat Participant API design - only one active response stream per participant at a time.

**Solution Approach:**
Accept the stop-and-resume flow but make it seamless:
1. When user stops execution and sends a message, detect this is context injection (not a new command)
2. Store the provided context
3. Auto-resume execution from the current checkpoint, incorporating the context into the next task
4. User experience: Stop → Paste info → Send → Execution resumes with context

## Resolved Issues

[None yet]

---

*Phase: 11-log-paste-context*
*Plan: 01*
*Tested: 2026-01-19*
