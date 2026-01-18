# Phase 8: Fix Improperly Built Functions - Context

**Gathered:** 2026-01-18
**Status:** Ready for planning

<vision>
## How This Should Work

The `/verify-work` command has significant UX issues that make it frustrating to use:

1. **Test instructions are insufficient** - When a test says "Verify: Set up Node.js/Express backend with security middleware", the user has no idea what specific steps to take or what to check.

2. **Verification stops abruptly** - If the user clicks away or presses Escape (even accidentally), verification just stops. There's no graceful handling.

3. **No way to ask clarifying questions** - During verification, if a user needs help understanding what to test, they can't ask questions without losing the entire verification flow.

4. **Results not persisted** - When verification completes (or is interrupted), the state isn't properly recorded.

The fix should make verification feel collaborative, not like a timed test. Users should be able to pause, ask questions, get clarification, and resume without losing their progress.

</vision>

<essential>
## What Must Be Nailed

- **Non-blocking verification** - User can interact with chat (ask questions, get help) without losing verification state
- **Clear test instructions** - Each verification step tells user exactly what to do, what to look for, and how to confirm it works
- **State persistence** - Verification progress saved so it can resume if interrupted (click away, close VSCode, etc.)

All three are equally important - the current implementation fails on all of them.

</essential>

<boundaries>
## What's Out of Scope

Nothing explicitly excluded - fix whatever is broken in the verify-work flow. This is a bug fix phase, so:
- If other functions are found to have similar issues, they can be fixed
- The goal is working functionality, not new features

</boundaries>

<specifics>
## Specific Ideas

- Keep verification dialog/state active even when user interacts with chat
- Show detailed test instructions with specific commands to run, endpoints to hit, or UI elements to check
- Persist verification state to file or globalState so it survives interruptions
- Allow "pause" and "resume" within verification flow
- Record final verification results in STATE.md or a verification log

</specifics>

<notes>
## Additional Context

The user discovered this issue while trying to verify work on a test project. The current flow is:
1. User runs `/verify-work`
2. Tests are generated and shown
3. User clicks away to try something → **verification stops**
4. No state saved, no way to resume, frustrating UX

This is a quality-of-life fix that makes the GSD workflow actually usable for real verification.

</notes>

---

*Phase: 08-fix-improperly-built-functions*
*Context gathered: 2026-01-18*
