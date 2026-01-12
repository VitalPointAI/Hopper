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

- [ ] **Phase 1: Foundation** - Extension scaffolding, NEAR AI model registration in VSCode
- [ ] **Phase 1.5: Licensing** - INSERTED - NEAR license contract, Stripe subscription, x402 crypto payments
- [ ] **Phase 2: Chat Participant** - @specflow agent with command routing
- [ ] **Phase 3: Planning Commands** - PROJECT.md, ROADMAP.md, STATE.md generation
- [ ] **Phase 4: Execution Commands** - PLAN.md execution, verification, git integration
- [ ] **Phase 5: Session Management** - Progress tracking, resumption, issue logging

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
- [ ] 01-03: VSCode Language Model provider registration

### Phase 1.5: Licensing (INSERTED)
**Goal**: Freemium license system with on-chain storage and dual payment rails (Stripe + crypto)
**Depends on**: Phase 1 (extension must work before monetizing)
**Research**: Likely (NEAR contracts, x402 protocol, NEAR Intents)
**Research topics**: NEAR smart contract for license storage, Stripe subscription webhooks, x402 payment protocol, NEAR Intents for crypto-to-USDC conversion
**Plans**: TBD

Plans:
- [ ] 01.5-01: NEAR license contract (account_id → subscription_expiry)
- [ ] 01.5-02: Stripe subscription integration + webhook handler
- [ ] 01.5-03: x402 + NEAR Intents crypto payment flow
- [ ] 01.5-04: Extension license validation (check before Phase 2+ execution)

### Phase 2: Chat Participant
**Goal**: @specflow chat participant responding to mentions with slash command routing
**Depends on**: Phase 1.5 (license check integrated)
**Research**: Likely (VSCode Chat API)
**Research topics**: Chat Participants API registration, slash command definition, ChatResponseStream handling, context variables
**Plans**: TBD

Plans:
- [ ] 02-01: Chat participant registration and basic response
- [ ] 02-02: Slash command routing infrastructure
- [ ] 02-03: Context variable injection

### Phase 3: Planning Commands
**Goal**: Full planning document generation (/new-project, /create-roadmap, /plan-phase)
**Depends on**: Phase 2
**Research**: Unlikely (internal patterns from GSD framework)
**Plans**: TBD

Plans:
- [ ] 03-01: /new-project command (PROJECT.md generation)
- [ ] 03-02: /create-roadmap command (ROADMAP.md, STATE.md)
- [ ] 03-03: /plan-phase command (PLAN.md generation)

### Phase 4: Execution Commands
**Goal**: Plan execution with verification and git integration
**Depends on**: Phase 3
**Research**: Unlikely (standard VSCode workspace APIs)
**Plans**: TBD

Plans:
- [ ] 04-01: /execute-plan command implementation
- [ ] 04-02: Verification criteria checking
- [ ] 04-03: Git commit integration

### Phase 5: Session Management
**Goal**: Progress tracking, session resumption, and deferred issue management
**Depends on**: Phase 4
**Research**: Unlikely (internal state management)
**Plans**: TBD

Plans:
- [ ] 05-01: Progress tracking (/progress command)
- [ ] 05-02: Session resumption (/resume-work, /pause-work)
- [ ] 05-03: Issue logging (/consider-issues)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 1.5 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/3 | In progress | - |
| 1.5 Licensing | 0/4 | Not started | - |
| 2. Chat Participant | 0/3 | Not started | - |
| 3. Planning Commands | 0/3 | Not started | - |
| 4. Execution Commands | 0/3 | Not started | - |
| 5. Session Management | 0/3 | Not started | - |
