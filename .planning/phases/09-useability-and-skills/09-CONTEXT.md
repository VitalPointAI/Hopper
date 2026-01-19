# Phase 9: Useability and Skills - Context

**Gathered:** 2026-01-19
**Status:** Ready for planning

<vision>
## How This Should Work

The extension should feel like a true autonomous agent when in yolo mode — not a tool that constantly asks permission. When the user chooses yolo execution mode, that means "just do it." Commands should run automatically, failures should be handled intelligently (retry, adjust approach, log issues), and the AI should never skip over problems silently.

When something does go wrong, it should be visible — logged to the output channel, recorded as an issue if significant. The AI should attempt recovery before giving up, trying alternative approaches when the first attempt fails.

Critically, when the user speaks to the chat, the AI should actually listen and act. If the user says "fix this" or "you missed that," the AI should acknowledge and do it — not redirect them to check `/progress` or `/status`. The user is the boss, and their direct input overrides any workflow assumptions.

Finally, every skill that Claude Code's GSD framework has should be available in Hopper. Audit what exists, identify gaps, and port what's missing so there's true feature parity.

</vision>

<essential>
## What Must Be Nailed

- **True autonomous execution** — In yolo mode, the AI executes everything without asking, handles errors automatically, and only surfaces to the user when genuinely stuck
- **Responsive to user input** — When the user gives direct instructions in chat, the AI acts on them immediately instead of redirecting to workflow commands
- **Feature parity with GSD** — Every skill Claude Code's GSD framework has, Hopper must have

</essential>

<boundaries>
## What's Out of Scope

- No specific exclusions — open to whatever changes are needed (backend, UI, etc.) to achieve the essential outcomes

</boundaries>

<specifics>
## Specific Ideas

- **Log failures visibly** — When something fails, show it in the output channel and auto-create an issue for tracking
- **Retry before giving up** — Try alternative approaches when first attempt fails before surfacing the problem to user
- **Acknowledge user input** — When user provides instruction, confirm receipt ("Got it, doing X...") and act on it immediately
- Silent failures and skipped steps are unacceptable — every action should either succeed or be logged as failed

</specifics>

<notes>
## Additional Context

The current experience breaks the promise of "yolo mode" — users chose autonomous execution but still get asked for permission, and worse, things fail silently without recovery attempts. This erodes trust in the tool.

The "user input ignored" problem is particularly frustrating — when someone interrupts to give direct guidance, they expect the AI to prioritize that over its planned workflow.

Priority: Audit GSD skills for gaps, then fix execution behavior (auto-run, error handling, user responsiveness).

</notes>

---

*Phase: 09-useability-and-skills*
*Context gathered: 2026-01-19*
