# Phase 2: Chat Participant - Context

**Gathered:** 2026-01-13
**Status:** Ready for research

<vision>
## How This Should Work

@specflow is a custom Chat Participant (agent) in VSCode's chat panel. When users mention @specflow, they enter a conversation with a planning-aware assistant that mirrors the Claude Code + GSD workflow experience.

The interaction is hybrid: natural language for exploration ("help me plan the next feature") combined with structured slash commands for specific actions (/plan-phase, /progress, /discuss-phase). The agent maintains conversation context across messages, so follow-ups like "now execute that plan" work naturally.

It should feel like Claude Code parity — the same GSD workflow experience — but enhanced by VSCode-native features where they improve the experience. The user never leaves the editor; planning, context, and execution all happen in the chat panel.

</vision>

<essential>
## What Must Be Nailed

- **Command routing reliability** — Every slash command routes correctly, no confusion between /plan-phase and /execute-plan
- **Context awareness** — @specflow knows about .planning/, current phase, project state without needing re-explanation
- **Response quality** — Output matches GSD formatting: actionable, structured, follows templates

All three are non-negotiable for this phase.

</essential>

<boundaries>
## What's Out of Scope

- Actual planning command implementations (/new-project, /plan-phase logic) — that's Phase 3
- Execution capabilities (file writes, git commits, code changes) — that's Phase 4
- Multi-model orchestration — just works with NEAR AI for now

Phase 2 = infrastructure (participant registration, command routing, context injection)
Phase 3+ = actual command implementations

</boundaries>

<specifics>
## Specific Ideas

- **GSD prompt patterns** — Use the same prompting style and templates from get-shit-done workflows
- **Clickable file links** — When referencing .planning/ files, make them clickable to open in editor
- **Progress indicators** — Show clear progress when commands are running (like GSD's status updates)
- **Actionable commands in chat** — Suggested commands should be clickable/runnable directly, not copy-paste
- **Slash commands within agent** — /plan-phase, /progress, etc. work within @specflow conversation

</specifics>

<notes>
## Additional Context

User wants the full GSD workflow system accessible through VSCode agent chat. The key value is never leaving the editor while maintaining the structured planning approach.

Priority is Claude Code parity first, then VSCode-native enhancements where they genuinely help (clickable links, in-chat actions, integrated file views).

</notes>

---

*Phase: 02-chat-participant*
*Context gathered: 2026-01-13*
