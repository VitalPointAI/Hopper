# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-12)

**Core value:** Model-agnostic structured planning and execution accessible through VSCode's native agent chat interface — enabling any model (including NEAR AI) to reliably build complete projects through intelligent context engineering.
**Current focus:** Milestone 1 complete

## Current Position

Phase: 9 of 9 (Useability and Skills)
Plan: 2 of 3 complete (+ 09-02-FIX + 09-02-FIX-FIX + 09-02-FIX-FIX-FIX + 09-02-FIX-FIX-FIX-FIX + 09-02-FIX-FIX-FIX-FIX-FIX + 09-02-FIX-FIX-FIX-FIX-FIX-FIX)
Status: In progress
Last activity: 2026-01-19 — Completed 09-02-FIX-FIX-FIX-FIX-FIX-FIX-PLAN.md (tool diagnostics and prompt strengthening)

Progress: █████████████████████ 96% (8 phases + 2/3 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 54 (including FIX plans)
- Average duration: 6.4 min
- Total execution time: 346 min

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
| 05.1-gsd-parity | 5+FIX | 41 min | 6.8 min |
| 06-security-review | 4 | 19 min | 4.8 min |

**Recent Trend:**
- Last 5 plans: 09-02-FIX-FIX (1 min), 09-02-FIX-FIX-FIX (2 min), 09-02-FIX-FIX-FIX-FIX (1 min), 09-02-FIX-FIX-FIX-FIX-FIX (3 min), 09-02-FIX-FIX-FIX-FIX-FIX-FIX (3 min)
- Trend: FIX plans executing efficiently (~2.0 min avg)

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
| 05.1-04 | LLM generates milestone details from description | Natural language to milestone structure |
| 05.1-04 | Milestone archives in .planning/milestones/ | Separate from phase directories |
| 05.1-04 | MILESTONE-CONTEXT.md for vision capture | Matches discuss-phase pattern |
| 05.1-05 | Three depth levels for discovery | verify/standard/deep serve different use cases |
| 05.1-05 | Verify depth returns verbal only | No file output for quick checks |
| 05.1-05 | Web fetching for npm/GitHub/MDN | Parse HTML from known documentation sources |
| 05.1-05 | planPhase loads DISCOVERY.md | Discovery findings included in LLM context |
| 06-01 | semver for version range matching | Handles npm semver syntax correctly |
| 06-01 | 24hr cache TTL for advisories | Balances freshness with API efficiency |
| 06-01 | All dependency issues map to OWASP A03 | Supply Chain Failures category |
| 06-01 | Never throw on API errors | Scan continues with cached or empty data |
| 06-04 | Lazy module loading for ESLint | Defer ESLint init until /security-check invoked |
| 06-04 | GlobalState for scan results | Fix commands access issues without re-scan |
| 07-01 | createDefaultConfig() helper | Generates fresh timestamps for new configs |
| 07-01 | loadConfig() validates and merges | Resilience against corrupted config files |
| 07-01 | ISO string timestamps | Human-readable in JSON files |
| 07-02 | Star icon for recommended options | Visual indicator in QuickPick |
| 07-02 | ignoreFocusOut: true | Prevents accidental dismissal |
| 07-02 | Default to standard/guided on cancel | Non-blocking config selection |
| 07-03 | Standard depth for new projects | Config doesn't exist at extraction time |
| 07-03 | Prompt functions return full strings | Not fragments to merge |
| 07-04 | Yolo mode auto-approves checkpoints | No pausing in fully trusted execution |
| 07-04 | Yolo mode auto-selects first decision option | Reasonable default when user trusts plan |
| 07-04 | Manual mode modal confirmation | Blocking UX appropriate for careful execution |
| 08-01 | createQuickPick() for non-blocking UI | showQuickPick() dismisses on click-away |
| 08-01 | ignoreFocusOut=true for dialogs | Keeps verification dialogs open during testing |
| 08-01 | State saved after each test result | Granular resume capability for interruptions |
| 08-01 | Default to Major severity on dismiss | Prevents blocking flow if user clicks away |
| 08-01-FIX | Button-based flow over QuickPick | stream.button() allows typing in chat between tests |
| 08-01-FIX | Sanitized storage keys | Extract phase-plan identifier for reliable persistence |
| 08-01-FIX | Default descriptions by severity | Quick entry without mandatory typing |
| 08-02 | LLM prompt with good/bad examples | Concrete examples guide better output quality |
| 08-02 | Pause saves pausedAt timestamp | State persists without recording a test result |
| 08-02 | Resume shows truncated prior results | Compact display with 60-char limit per item |
| 08-02-FIX | Auth type determines expiresAt unit | Wallet uses nanoseconds, OAuth uses milliseconds |
| 08-02-FIX | Button-based discuss-phase flow | Non-blocking UX matching verify-work pattern |
| 08-02-FIX | Generate 3-5 questions upfront | All questions ready at start for button display |
| 09-01 | Singleton HopperLogger pattern | Consistent output channel access across codebase |
| 09-01 | Auto-show output channel on errors | User immediately sees failures without hunting |
| 09-01 | [HH:MM:SS] timestamp format | Readable log entries in output channel |
| 09-02 | Transient error patterns (regex) | Rate limit, timeout, network, 503, 429 detected via patterns |
| 09-02 | Max 3 attempts with exponential backoff | Retry 1s, 2s delays before failing permanently |
| 09-02 | Auto-issue only in yolo mode | User already aware interactively in guided/manual |
| 09-02 | EXE-{phase}-{task} issue ID format | Distinguishes execution failures from other issues |
| 09-02-FIX | Regex patterns for verify failure detection | Covers npm errors, test failures, TS errors, syntax errors, etc. |
| 09-02-FIX | Tool output capture for post-execution analysis | executeWithTools returns accumulated output |
| 09-02-FIX-FIX | Plan Fix button on failures | Primary action when tasks fail, more helpful than git changes |
| 09-02-FIX-FIX-FIX | rawPlan property for FIX suffix preservation | Store full frontmatter plan value to preserve FIX suffixes |
| 09-02-FIX-FIX-FIX | findIssuesFile handles FIX suffixes | Regex captures full plan name including FIX suffixes |
| 09-02-FIX-FIX-FIX-FIX | parseIssues handles UAT and EXE formats | Single regex matches UAT-XXX and EXE-XX-YY-NN |
| 09-02-FIX-FIX-FIX-FIX | Severity fallback from Impact/Type fields | EXE issues use Impact field for severity mapping |
| 09-02-FIX-FIX-FIX-FIX-FIX | LLM prompts with good/bad examples | Explicit examples guide better task generation |
| 09-02-FIX-FIX-FIX-FIX-FIX | Fallback generates numbered steps from issue fields | Uses expected/actual/feature for actionable content |
| 09-02-FIX-FIX-FIX-FIX-FIX | FIX plans load parent ISSUES.md for context | Remove one -FIX suffix to find parent's issues |
| 09-02-FIX-FIX-FIX-FIX-FIX | generateFallbackTests creates meaningful tests | Uses issue data for test instructions without LLM |
| 09-02-FIX-FIX-FIX-FIX-FIX-FIX | Tool availability logging before executeWithTools | Diagnose if tools are being passed correctly |
| 09-02-FIX-FIX-FIX-FIX-FIX-FIX | Explicit LanguageModelChatToolMode.Auto | Being explicit helps clarify intent for tool calling |
| 09-02-FIX-FIX-FIX-FIX-FIX-FIX | CRITICAL prompt sections for tool usage | Strongly instruct model to use tools immediately |

### Deferred Issues

- ISS-001: Unify NEAR AI API auth with wallet auth (see .planning/ISSUES.md)

### Blockers/Concerns

- **Cosmetic**: NEAR AI category header doesn't appear in dropdown (only in Manage Models). VSCode UI limitation, not blocking.
- **Resolved (UAT-006)**: Worker deployed, wallet connection works. Remaining: NEAR contract deployment (01.5.1-02).

### Roadmap Evolution

- Phase 1.5.1 inserted after Phase 1.5: Infrastructure Deploy (URGENT) — Discovered during 03-03 UAT that licensing was built but never deployed
- Phase 1.5.3 inserted after Phase 1.5.2: Rebrand SpecFlow to Hopper (URGENT) — User-facing name change from @specflow to @hopper
- Phase 6 added: Security Review — Security audit and hardening of extension and backend
- Phase 7 added: Planning Depth — User-selectable planning depth and execution control modes
- Phase 8 added: Fix Improperly Built Functions — Fix functions that were not built correctly
- Phase 9 added: Useability and Skills — Useability improvements and skills system

## Session Continuity

Last session: 2026-01-19
Stopped at: Completed 09-02-FIX-FIX-FIX-FIX-FIX-FIX-PLAN.md (tool diagnostics and prompt strengthening)
Resume file: None
Next: Test /execute-plan to verify tool usage fix, then execute 09-03-PLAN.md

## Post-Milestone Enhancements

### 2026-01-18: State Management & GSD Parity
See: `.planning/phases/post-m1-enhancements/SESSION-2026-01-18-SUMMARY.md`

**Summary:**
- Created centralized STATE.md update utility (`src/chat/state/`)
- Integrated state updates into `/execute-plan`, `/verify-work`, `/plan-phase`
- Added Session Continuity parsing to project context
- Enhanced `/progress` routing with agent detection and STATE.md suggestions
- Added agent ID tracking for interrupted execution detection
- Fixed VSCode callback URI (publisher case-sensitivity)
- Increased tool iteration limit from 10 to 50

**Key Decisions:**
- 08-01 | Centralized state manager | Single source of truth for STATE.md updates
- 08-02 | Agent ID tracking | Unique ID per execution enables interrupted detection
- 08-03 | Session Continuity parsing | Matches GSD pattern for workflow routing
- 08-04 | Route -1 priority for agents | Interrupted work highest priority (like GSD)
