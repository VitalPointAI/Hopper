# UAT Issues: Phase 02 Plan 02

**Tested:** 2026-01-14
**Source:** .planning/phases/02-chat-participant/02-02-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: No clickable buttons in /help output

**Discovered:** 2026-01-14
**Phase/Plan:** 02-02
**Severity:** Major
**Feature:** /help command
**Description:** The /help command shows all 6 commands as text, but no clickable action buttons appear. The plan specified using `stream.button()` for Quick Actions.
**Expected:** Clickable buttons in a "Quick Actions" section that trigger commands
**Actual:** Text-only output with command descriptions, no interactive buttons
**Repro:**
1. Open VSCode Agent Chat
2. Type `@specflow /help`
3. Look for clickable buttons - none present

### UAT-002: No follow-up suggestions appear

**Discovered:** 2026-01-14
**Phase/Plan:** 02-02
**Severity:** Major
**Feature:** Contextual follow-ups
**Description:** After running any command, no follow-up suggestion buttons appear below the response. The followupProvider should show contextual next actions.
**Expected:** Follow-up suggestions like "Start new project" after /help
**Actual:** No follow-up suggestions appear at all
**Repro:**
1. Open VSCode Agent Chat
2. Type `@specflow /help`
3. Look below response for follow-up suggestions - none present

### UAT-003: General chat lacks SpecFlow context

**Discovered:** 2026-01-14
**Phase/Plan:** 02-02
**Severity:** Minor
**Feature:** General chat (no command)
**Description:** When using @specflow without a slash command, the model responds but doesn't seem to know about SpecFlow or GSD framework. It gives generic AI responses.
**Expected:** Response that understands SpecFlow purpose and suggests appropriate commands
**Actual:** Generic AI response without SpecFlow context
**Repro:**
1. Open VSCode Agent Chat
2. Type `@specflow what is this extension for?`
3. Response is generic, not SpecFlow-aware

## Resolved Issues

[None yet]

---

*Phase: 02-chat-participant*
*Plan: 02*
*Tested: 2026-01-14*
