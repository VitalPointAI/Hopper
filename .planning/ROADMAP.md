# Roadmap: SpecFlow

## Overview

Build a VSCode extension that brings model-agnostic structured planning to agent chat. Start with NEAR AI model registration and extension scaffolding, then implement the chat participant for command routing, followed by planning document generation, execution capabilities, and finally session management for continuity.

## Domain Expertise

None

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Extension scaffolding, NEAR AI model registration in VSCode
- [x] **Phase 1.5: Licensing** - INSERTED - NEAR license contract, Stripe subscription, x402 crypto payments
- [x] **Phase 1.5.1: Infrastructure Deploy** - INSERTED - Deploy NEAR contract and Cloudflare Worker to production
- [x] **Phase 1.5.2: Dual Auth** - INSERTED - OAuth + wallet authentication with unified license management
- [x] **Phase 1.5.3: Rebrand to Hopper** - INSERTED - Rename extension from SpecFlow to Hopper in all user-facing items
- [x] **Phase 2: Chat Participant** - @hopper agent with command routing
- [x] **Phase 3: Planning Commands** - PROJECT.md, ROADMAP.md, STATE.md generation
- [x] **Phase 4: Execution Commands** - PLAN.md execution, verification, git integration
- [ ] **Phase 5: Session Management** - Progress tracking, resumption, issue logging
- [ ] **Phase 5.1: GSD Feature Parity** - INSERTED - Complete all GSD framework commands

## Phase Details

### Phase 1: Foundation
**Goal**: Working VSCode extension with NEAR AI models appearing in native model picker
**Depends on**: Nothing (first phase)
**Research**: Likely (new VSCode APIs, external API)
**Research topics**: VSCode Language Model API for custom model registration, NEAR AI hosted API authentication and endpoint structure, local inference setup
**Plans**: TBD

Plans:
- [x] 01-01: Extension scaffolding and build setup
- [x] 01-02: NEAR AI API client implementation
- [x] 01-03: VSCode Language Model provider registration

### Phase 1.5: Licensing (INSERTED)
**Goal**: Freemium license system with on-chain storage, recurring subscriptions (Stripe + crypto), and admin dashboard
**Depends on**: Phase 1 (extension must work before monetizing)
**Research**: Likely (NEAR contracts, x402 protocol, NEAR Intents)
**Research topics**: NEAR smart contract for license storage, Stripe subscription webhooks, x402 payment protocol, NEAR Intents for crypto-to-USDC conversion
**Plans**: TBD

Plans:
- [x] 01.5-01: NEAR license contract (account_id → subscription_expiry)
- [x] 01.5-02: Stripe recurring subscription integration + webhook handler
- [x] 01.5-03: NEAR Intents recurring crypto subscriptions
- [x] 01.5-04: Extension license validation (check before Phase 2+ execution)
- [x] 01.5-05: Admin wallet authentication and API endpoints
- [x] 01.5-06: Admin dashboard UI and management actions

### Phase 1.5.1: Infrastructure Deploy (INSERTED)
**Goal**: Deploy licensing infrastructure to production (NEAR contract, Cloudflare Worker, KV namespaces)
**Depends on**: Phase 1.5 (code must exist before deploying)
**Research**: Unlikely (deployment of existing code)
**Plans**: TBD

Plans:
- [x] 01.5.1-01: Deploy Cloudflare Worker with KV namespaces and secrets
- [x] 01.5.1-02: Configure extension and verify end-to-end flow

### Phase 1.5.2: Dual Auth (INSERTED)
**Goal**: Support OAuth (Google/GitHub/Email) alongside NEAR wallet auth with unified license management
**Depends on**: Phase 1.5.1 (infrastructure must be deployed)
**Research**: Unlikely (standard OAuth patterns)
**Research topics**: OAuth 2.0 flows, Cloudflare Workers OAuth handling
**Plans**: TBD

Plans:
- [x] 01.5.2-01: OAuth infrastructure in Worker (Google, GitHub, email+password)
- [x] 01.5.2-02: Extension auth flow updates (unified connect command)
- [x] 01.5.2-03: Stripe flow updates (OAuth user as customer ID)
- [x] 01.5.2-04: Testing and validation

### Phase 1.5.3: Rebrand to Hopper (INSERTED)
**Goal**: Rename extension from SpecFlow to Hopper in all user-facing items (@specflow → @hopper, display names, etc.)
**Depends on**: Phase 1.5.2 (complete auth before rebranding)
**Research**: Unlikely (find-and-replace with verification)
**Plans**: 2

Plans:
- [x] 01.5.3-01: Update all user-facing references from SpecFlow to Hopper
- [x] 01.5.3-02: Update Worker and infrastructure references to Hopper

### Phase 2: Chat Participant
**Goal**: @hopper chat participant responding to mentions with slash command routing
**Depends on**: Phase 1.5 (license check integrated)
**Research**: Likely (VSCode Chat API)
**Research topics**: Chat Participants API registration, slash command definition, ChatResponseStream handling, context variables
**Plans**: TBD

Plans:
- [x] 02-01: Chat participant registration and basic response
- [x] 02-02: Slash command routing infrastructure
- [x] 02-03: Context variable injection

### Phase 3: Planning Commands
**Goal**: Full planning document generation (/new-project, /create-roadmap, /plan-phase)
**Depends on**: Phase 2
**Research**: Unlikely (internal patterns from GSD framework)
**Plans**: TBD

Plans:
- [x] 03-01: /new-project command (PROJECT.md generation)
- [x] 03-02: /create-roadmap command (ROADMAP.md, STATE.md)
- [x] 03-03: /plan-phase command (PLAN.md generation)

### Phase 4: Execution Commands
**Goal**: Plan execution with verification and git integration
**Depends on**: Phase 3
**Research**: Unlikely (standard VSCode workspace APIs)
**Plans**: TBD

Plans:
- [x] 04-01: /execute-plan command implementation
- [x] 04-02: Verification criteria checking
- [x] 04-03: Git commit integration

### Phase 5: Session Management
**Goal**: Progress tracking, session resumption, and deferred issue management
**Depends on**: Phase 4
**Research**: Unlikely (internal state management)
**Plans**: TBD

Plans:
- [x] 05-01: Progress tracking (/progress command)
- [ ] 05-02: Session resumption (/resume-work, /pause-work)
- [ ] 05-03: Issue logging (/consider-issues)

### Phase 5.1: GSD Feature Parity (INSERTED)
**Goal**: Implement all remaining GSD framework commands for 100% feature parity
**Depends on**: Phase 5 (session management provides foundation)
**Research**: Unlikely (implementing known GSD patterns)
**Plans**: 5

Plans:
- [ ] 05.1-01: Phase management (/add-phase, /insert-phase, /remove-phase)
- [ ] 05.1-02: Pre-planning commands (/research-phase, /discuss-phase, /list-phase-assumptions)
- [ ] 05.1-03: UAT workflow (/verify-work, /plan-fix, /resume-task)
- [ ] 05.1-04: Milestone management (/new-milestone, /complete-milestone, /discuss-milestone)
- [ ] 05.1-05: Codebase mapping (/map-codebase) and parity verification

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 1.5 → 1.5.1 → 1.5.2 → 1.5.3 → 2 → 3 → 4 → 5 → 5.1

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete | 2026-01-12 |
| 1.5 Licensing | 6/6 | Complete | 2026-01-14 |
| 1.5.1 Infrastructure Deploy | 2/2 | Complete | 2026-01-15 |
| 1.5.2 Dual Auth | 4/4 | Complete | 2026-01-16 |
| 1.5.3 Rebrand to Hopper | 2/2 | Complete | 2026-01-16 |
| 2. Chat Participant | 3/3 | Complete | 2026-01-15 |
| 3. Planning Commands | 3/3 | Complete | 2026-01-15 |
| 4. Execution Commands | 3/3 | Complete | 2026-01-17 |
| 5. Session Management | 1/3 | In progress | - |
| 5.1 GSD Feature Parity | 0/5 | Not started | - |
