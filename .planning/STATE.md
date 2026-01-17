# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-12)

**Core value:** Model-agnostic structured planning and execution accessible through VSCode's native agent chat interface — enabling any model (including NEAR AI) to reliably build complete projects through intelligent context engineering.
**Current focus:** Phase 5.1 — GSD Feature Parity (in progress)

## Current Position

Phase: 5.1 of 10 (GSD Feature Parity)
Plan: 3 of 5 complete
Status: In progress
Last activity: 2026-01-17 — Completed 05.1-03-PLAN.md (UAT workflow)

Progress: ███████████░░░░░░░░░ 61%

## Performance Metrics

**Velocity:**
- Total plans completed: 42 (including FIX plans)
- Average duration: 6.8 min
- Total execution time: 290 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-foundation | 4 | 15 min | 3.8 min |
| 01.5-licensing | 6+FIX | 82 min | 11.7 min |
| 01.5.1-infra-deploy | 2 | 57 min | 28.5 min |
| 01.5.2-dual-auth | 4+FIX2+FIX3+UAT | 35 min | 5.0 min |
| 02-chat-participant | 3+FIX+FIX2+FIX3+FIX4 | 23 min | 2.9 min |
| 03-planning-commands | 3+FIX+FIX2 | 29 min | 5.8 min |
| 04-execution-commands | 3+FIX+FIX-FIX+FIX-FIX-FIX+FIX-FIX-FIX-FIX+FIX5+FIX6+FIX7+FIX8+04-03-FIX | 66 min | 5.1 min |
| 05-session-management | 3 | 10 min | 3.3 min |
| 05.1-gsd-parity | 3+FIX | 23 min | 5.8 min |

**Recent Trend:**
- Last 5 plans: 05.1-01 (6 min), 05.1-02 (8 min), 05.1-03 (5 min), 05.1-03-FIX (4 min)
- Trend: Regular plans executing efficiently (~5 min avg)

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
| 01.5.2-01 | bcryptjs for Workers password hashing | Workers-compatible, native bcrypt not supported |
| 01.5.2-01 | OAuth state in PROCESSED_EVENTS KV | 5-min TTL for CSRF protection |
| 01.5.2-01 | Rate limiting: 5 attempts -> 15-min lockout | Prevent brute force on email login |
| 01.5.2-02 | AuthSession userId supports both OAuth and wallet | oauth:{provider}:{id} OR NEAR account ID |
| 01.5.2-02 | Dual license checking backends | Contract for wallet, Worker API for OAuth |
| 01.5.2-03 | JWT verification reuses admin pattern | HMAC-SHA256 with ADMIN_SECRET for consistency |
| 01.5.2-03 | Stripe metadata has auth_type + user_id | Enables webhook routing to correct license store |
| 01.5.2-03 | Crypto payments require wallet | OAuth users must use card payments |
| 01.5.2-03 | Pending payment in globalState | Resumes after auth callback completes |
| 01.5.2-03-FIX2 | Session-based crypto init | Allows subscription before wallet is known |
| 01.5.2-03-FIX2 | Link wallet before payment | Associate wallet before money moves for safety |
| 01.5.2-03-FIX2 | VSCode redirect on success | Completes auth loop after payment |
| 01.5.2-04 | Multi-chain wallet auth page | NEAR, EVM, Solana all use same flow |
| 01.5.2-04 | Auth check before license check | Prevents access when disconnected |
| 01.5.2-04 | Auto-open /status after auth | In-chat feedback instead of toast |
| 01.5.2-04 | FastNEAR RPC endpoints | Better performance than official RPC |
| 04-01 | Regex-based plan parsing | Simple regex sufficient for PLAN.md format |
| 04-01 | Auto-detect from STATE.md | Parse current phase, find unexecuted plans |
| 04-01 | License check after parse | Extract phase number from plan's phase field |
| 04-01 | Stream without auto-apply | Show LLM suggestions, user applies manually |
| 04-01-FIX | findFiles for plan resolution | Glob pattern search simpler than directory traversal |
| 04-01-FIX | supportsToolCalling check | Graceful degradation when tools unavailable |
| 04-01-FIX | Empty tools array for built-ins | Enables VSCode tools without custom definitions |
| 04-01-FIX-FIX | supportsTools check before loop | Consistent mode indicator throughout execution |
| 04-01-FIX-FIX-FIX | Remove supportsToolCalling check | Property doesn't exist in VSCode API, always enable tools |
| 04-01-FIX-FIX-FIX-FIX | sendChatParticipantRequest for tool orchestration | Library handles tool calling loop, invokes vscode.lm.tools |
| 04-01-FIX5 | Manual tool orchestration | Remove buggy alpha library, implement executeWithTools helper |
| 04-01-FIX6 | Workspace root in prompt | Model needs absolute paths for copilot tools |
| 04-01-FIX6 | Extract result.content | LanguageModelToolResultPart expects content array, not full result |
| 04-01-FIX7 | Pass toolInvocationToken | Required for file operations in chat context |
| 04-02 | GlobalState for checkpoint state | Persists execution state across VSCode restarts |
| 04-02 | Type guards for task discrimination | Cleaner than casting for discriminated unions |
| 04-02 | Stream buttons for checkpoint actions | Better UX than text prompts |
| 04-03 | child_process.exec for git CLI | No external library, works with any git installation |
| 04-03 | Auto-detect commit type from task name | Analyze keywords (fix/refactor/docs), default feat |
| 04-03 | Stage all changes per task | git add -A after each task since task files define scope |
| 04-03-FIX | Direct exec for one-time git init | gitService expects existing repo, direct exec simpler for initialization |
| 05-01 | Integrated routing in handler | Simpler than separate module, no cross-file dependencies |
| 05-01 | File system scanning for counts | More accurate than parsing STATE.md |
| 05-02 | Frontmatter + XML for handoff files | Matches GSD template structure |
| 05-02 | First handoff takes priority | Single active session assumption |
| 05-02 | Route 0 in progress for handoffs | Paused work checked before other routing |
| 05-03 | LLM categorization for issues | resolved/urgent/natural-fit/can-wait categories |
| 05-03 | GlobalState for issue analyses | Store between command and close button action |
| 05-03 | Separate helper command for close | hopper.closeResolvedIssues for button action |
| 05.1-01 | LLM generates phase name and goal | Natural language to structured content |
| 05.1-01 | Decimal numbering for insertions | Avoids renumbering existing phases |
| 05.1-01 | Insert only after complete phases | Ensures logical dependency chain |
| 05.1-01 | Cannot remove completed phases | Preserves completed work history |
| 05.1-02 | LLM domain identification for research | Analyze phase to determine research areas |
| 05.1-02 | Skip research for commodity work | Auth, CRUD, REST don't need research |
| 05.1-02 | Command args for discuss-phase context | VSCode Chat doesn't support multi-turn questioning |
| 05.1-02 | list-phase-assumptions is informational | No files created, just surfaces assumptions |
| 05.1-03 | LLM generates test checklist from SUMMARY.md | More useful UAT guidance than raw accomplishments |
| 05.1-03 | Phase-scoped ISSUES.md with UAT-XXX prefix | Distinguish from global ISS-XXX issues |
| 05.1-03 | Fix plans use type: fix | Standard plan structure for consistent execution |
| 05.1-03 | Resume-task guides to re-execution | Agent context may have expired |
| 05.1-03-FIX | vscode.window dialogs for interactive flow | Chat API doesn't support multi-turn |
| 05.1-03-FIX | Auto-log issues from test results | Reduce manual steps for user |

### Deferred Issues

- ISS-001: Unify NEAR AI API auth with wallet auth (see .planning/ISSUES.md)

### Blockers/Concerns

- **Cosmetic**: NEAR AI category header doesn't appear in dropdown (only in Manage Models). VSCode UI limitation, not blocking.
- **Resolved (UAT-006)**: Worker deployed, wallet connection works. Remaining: NEAR contract deployment (01.5.1-02).

### Roadmap Evolution

- Phase 1.5.1 inserted after Phase 1.5: Infrastructure Deploy (URGENT) — Discovered during 03-03 UAT that licensing was built but never deployed
- Phase 1.5.3 inserted after Phase 1.5.2: Rebrand SpecFlow to Hopper (URGENT) — User-facing name change from @specflow to @hopper

## Session Continuity

Last session: 2026-01-17
Stopped at: Completed 05.1-03-FIX.md (UAT workflow fixes)
Resume file: None
Next: Re-verify 05.1-03 or execute 05.1-04-PLAN.md
