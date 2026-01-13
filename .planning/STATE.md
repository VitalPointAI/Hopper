# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-12)

**Core value:** Model-agnostic structured planning and execution accessible through VSCode's native agent chat interface — enabling any model (including NEAR AI) to reliably build complete projects through intelligent context engineering.
**Current focus:** Phase 1.5 — Licensing (In progress)

## Current Position

Phase: 1.5 of 5 (Licensing)
Plan: 4 of 5 in current phase
Status: In progress
Last activity: 2026-01-13 — Completed 01.5-04-PLAN.md

Progress: ████████░░░░░░░░░░░ 40%

## Performance Metrics

**Velocity:**
- Total plans completed: 8
- Average duration: 11.1 min
- Total execution time: 89 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 4 | 15 min | 3.8 min |
| 01.5-licensing | 4 | 80 min | 20.0 min |

**Recent Trend:**
- Last 5 plans: 01-03 (8 min), 01.5-01 (4 min), 01.5-02 (9 min), 01.5-03 (25 min), 01.5-04 (33 min)
- Trend: —

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

| Phase | Decision | Rationale |
|-------|----------|-----------|
| 01-01 | esbuild over webpack | Faster builds, VSCode recommended |
| 01-01 | engine ^1.104.0 | Required for Language Model Chat Provider API |
| 01-02 | OpenAI SDK for NEAR AI | NEAR AI is OpenAI-compatible |
| 01-02-FIX | API key auth (not config file) | NEAR AI Cloud uses Bearer token, not nearai CLI config |
| 01-02-FIX | Dynamic model fetching | Models from /v1/model/list, not hardcoded |
| 01-03 | Enable toolCalling for picker visibility | Required for models to appear in agent mode dropdown |
| 01-03 | Graceful API key prompting | Show friendly dialog instead of error when key missing |
| 01.5-01 | near_sdk::store::LookupMap | Modern SDK pattern over deprecated collections |
| 01.5-01 | Nanosecond timestamps | NEAR block_timestamp compatibility |
| 01.5-02 | Cloudflare Workers + Hono | Auditable serverless, globally distributed, edge-native |
| 01.5-02 | Direct NEAR JSON-RPC | near-api-js incompatible with Workers edge runtime |
| 01.5-02 | KV for idempotency/state | Fast lookups, TTL for automatic cleanup |
| 01.5-03 | ANY_INPUT swap for recurring payments | NEAR Intents SDK lacks subscription pre-auth |
| 01.5-03 | Date-indexed KV storage | Efficient cron queries without full scan |
| 01.5-04 | Wallet auth required for license | Prevents account impersonation via challenge/signature/JWT |
| 01.5-04 | CSP nonce with addEventListener | Inline onclick blocked by CSP, use JS event listeners |

### Deferred Issues

- ISS-001: Unify NEAR AI API auth with wallet auth (see .planning/ISSUES.md)

### Blockers/Concerns

- **Cosmetic**: NEAR AI category header doesn't appear in dropdown (only in Manage Models). VSCode UI limitation, not blocking.

## Session Continuity

Last session: 2026-01-13
Stopped at: Completed 01.5-04-PLAN.md
Resume file: None
