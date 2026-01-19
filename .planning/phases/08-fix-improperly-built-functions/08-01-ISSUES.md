# UAT Issues: Phase 8 Plan 1

**Tested:** 2026-01-18
**Source:** .planning/phases/08-fix-improperly-built-functions/08-01-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: Verification state lost after VSCode reload

**Discovered:** 2026-01-18
**Phase/Plan:** 08-01
**Severity:** Major
**Feature:** State persistence across sessions
**Description:** Verification state is lost when VSCode window is reloaded. After completing some tests and canceling mid-way, reloading VSCode (Developer: Reload Window) causes the saved state to be lost - no Resume prompt appears.
**Expected:** State should persist in globalState and survive VSCode restarts, offering Resume prompt when running verify-work again
**Actual:** State lost after reload, verification starts fresh with no Resume option
**Repro:**
1. Run `/verify-work` on any plan
2. Complete 1-2 tests
3. Dismiss/cancel mid-way
4. Run `Developer: Reload Window`
5. Run `/verify-work` on same plan
6. Observe: No Resume prompt, starts fresh

### UAT-002: Cannot interact with chat during verification without losing context

**Discovered:** 2026-01-18
**Phase/Plan:** 08-01
**Severity:** Blocker
**Feature:** Non-blocking verification UI
**Description:** During verify-work testing, user cannot type in the chat to ask clarifying questions about a test without first hitting the Stop button. After stopping, the verification context is lost and the assistant has no awareness of what was being tested.
**Expected:** User should be able to ask questions mid-verification (e.g., "what does this test mean?") without interrupting the flow, OR after stopping should be able to resume with context intact
**Actual:** Must hit Stop to type in chat, which loses all verification context
**Repro:**
1. Run `/verify-work` on any plan
2. When a test picker appears, try to type a question in the chat
3. Observe: Cannot type without hitting Stop
4. Hit Stop, then ask a question
5. Observe: Assistant has no context about the verification

## Resolved Issues

[None yet]

---

*Phase: 08-fix-improperly-built-functions*
*Plan: 01*
*Tested: 2026-01-18*
