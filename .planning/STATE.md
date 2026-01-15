# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-12)

**Core value:** Model-agnostic structured planning and execution accessible through VSCode's native agent chat interface — enabling any model (including NEAR AI) to reliably build complete projects through intelligent context engineering.
**Current focus:** Phase 1.5.1 — Infrastructure Deploy (urgent insertion)

## Current Position

Phase: 1.5.1 (Infrastructure Deploy - INSERTED)
Plan: 1 of 2 in current phase
Status: In progress
Last activity: 2026-01-15 — Completed 01.5.1-01-PLAN.md (Worker deployment)

Progress: █████████████████░░ 85%

## Performance Metrics

**Velocity:**
- Total plans completed: 23 (including FIX plans)
- Average duration: 8.9 min
- Total execution time: 204 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 4 | 15 min | 3.8 min |
| 01.5-licensing | 6+FIX | 82 min | 11.7 min |
| 01.5.1-infra-deploy | 1 | 57 min | 57 min |
| 02-chat-participant | 3+FIX+FIX2+FIX3+FIX4 | 23 min | 2.9 min |
| 03-planning-commands | 3+FIX+FIX2 | 29 min | 5.8 min |

**Recent Trend:**
- Last 5 plans: 03-03 (4 min), 03-03-FIX (2 min), 01.5.1-01 (57 min)
- Trend: Infrastructure deployment took longer due to auth gates and verification

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
| 01.5-05 | ADMIN_WALLET env var for admin auth | Contract admin account configured at deployment |
| 01.5-04 | CSP nonce with addEventListener | Inline onclick blocked by CSP, use JS event listeners |
| 01.5-06-FIX | VSCode config for API URLs | process.env doesn't work in bundled extensions |
| 02-01-FIX3 | Per-command license gating | Basic chat free, gate Phase 2+ commands in 02-02 |
| 02-02 | kebab-case command names | Matches VSCode conventions |
| 02-02 | stream.button() for actions | Clickable buttons work better than markdown links |
| 02-02 | Contextual follow-ups | Follow-up suggestions change based on lastCommand |
| 02-03 | Direct file reading via vscode.workspace.fs | Chat Variables API still unstable/proposed |
| 02-03 | Content truncation at 2000 chars | Avoid token limit issues in LLM prompts |
| 03-01 | LLM extraction for project details | Natural language input to structured ProjectConfig |
| 03-01 | Generator module pattern | types.ts + implementation + index.ts for reuse |
| 03-02 | Fallback text parsing for LLM | Handle non-JSON LLM responses gracefully |
| 03-02 | Actionable buttons on errors | Every error state has a retry/fix action |
| 03-02-FIX | workbench.action.chat.open with query | Register commands to invoke chat participant via buttons |
| 03-03 | LLM JSON extraction for tasks | Use JSON schema prompts for structured task generation |
| 03-03 | XML task structure | Follow GSD template with task elements containing name, files, action, verify, done |
| 03-03 | Non-blocking dependencies | Warn when planning ahead but allow it for exploration |
| 03-03-FIX | Per-command license gating | /plan-phase requires Pro license before execution |
| 03-03-FIX | Inline execution context | Self-contained plans without external GSD references |
| 03-03-FIX | Explicit usage help | Show help when no argument instead of silent default |
| 01.5.1-01 | Mainnet contract: license.specflow.near | Subaccount of specflow.near for licensing |
| 01.5.1-01 | workers.dev subdomain: vitalpointai | Cloudflare Workers deployment target |

### Deferred Issues

- ISS-001: Unify NEAR AI API auth with wallet auth (see .planning/ISSUES.md)

### Blockers/Concerns

- **Cosmetic**: NEAR AI category header doesn't appear in dropdown (only in Manage Models). VSCode UI limitation, not blocking.
- **Resolved (UAT-006)**: Worker deployed, wallet connection works. Remaining: NEAR contract deployment (01.5.1-02).

### Roadmap Evolution

- Phase 1.5.1 inserted after Phase 1.5: Infrastructure Deploy (URGENT) — Discovered during 03-03 UAT that licensing was built but never deployed

## Session Continuity

Last session: 2026-01-15
Stopped at: Completed 01.5.1-01-PLAN.md (Worker deployed)
Resume file: None
