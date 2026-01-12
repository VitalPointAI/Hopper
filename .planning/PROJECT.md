# SpecFlow

## What This Is

A VSCode extension that brings the "Get Shit Done" planning and execution framework to VSCode's agent chat, working with any model including NEAR AI. It registers NEAR AI models in VSCode's native model picker alongside Copilot models, and provides the full GSD command set as chat participants.

## Core Value

Model-agnostic structured planning and execution accessible through VSCode's native agent chat interface — enabling any model (including NEAR AI) to reliably build complete projects through intelligent context engineering.

## Business Model

**Freemium licensing** with on-chain license storage:

- **Free tier**: Phase 1 of any project is fully functional
- **Pro tier**: Required for Phase 2+ execution
- **License storage**: NEAR smart contract (account_id → subscription_expiry)

**Payment options:**
- **Fiat (Stripe)**: Monthly/yearly subscription, webhook → NEAR contract
- **Crypto (20% discount)**: x402 protocol + NEAR Intents for any-crypto-to-USDC
- **Revenue destination**: vitalpointai.near

**Architecture:**
- Crypto payments: Fully decentralized (x402 → NEAR Intents → USDC → contract)
- Fiat payments: Hybrid (Stripe webhook → auditable serverless function → NEAR contract)

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Register NEAR AI models in VSCode's native model picker dropdown
- [ ] Support both NEAR AI hosted API and local inference
- [ ] Implement full GSD command set as agent chat slash commands
- [ ] NEAR AI API key configuration via VSCode settings
- [ ] Chat participant that responds to @specflow mentions
- [ ] Planning document generation (PROJECT.md, ROADMAP.md, STATE.md, PLAN.md)
- [ ] Codebase mapping functionality (ARCHITECTURE.md, STACK.md, etc.)
- [ ] Phase-based roadmap creation and management
- [ ] Task execution with verification criteria
- [ ] Git integration for atomic commits
- [ ] Progress tracking and session resumption
- [ ] Issue logging and deferred work management
- [ ] Freemium license gating (Phase 1 free, Phase 2+ requires license)
- [ ] NEAR smart contract for license storage
- [ ] Stripe subscription integration (monthly/yearly)
- [ ] x402 + NEAR Intents crypto payment flow
- [ ] License validation before phase execution

### Out of Scope

- Non-TypeScript implementation — constraint: pure TypeScript only
- Custom UI outside agent chat — using VSCode's native chat interface
- Replacing VSCode's built-in Copilot — augmenting with additional models

## Context

**Origin**: Cloning functionality from [glittercowboy/get-shit-done](https://github.com/glittercowboy/get-shit-done), a Claude Code meta-prompting framework that transforms vague ideas into structured, executable work.

**Key GSD Concepts**:
- Context engineering: PROJECT.md (vision), ROADMAP.md (phases), STATE.md (current position), PLAN.md (executable prompts)
- Subagent architecture: Fresh context windows per task to prevent token degradation
- Atomic commits: Git history as context source for future sessions
- Verification-driven: Each task has explicit success criteria

**VSCode Integration Points**:
- Language Model API for model registration
- Chat Participants API for @specflow agent
- Chat Variables for context injection
- Workspace API for file operations

**NEAR AI Integration**:
- Hosted inference API endpoint
- Local runtime support
- API key authentication via extension settings

## Constraints

- **Language**: TypeScript only — no other languages in the codebase
- **License**: MIT license compliance required — original repo is MIT (Copyright 2025 Lex Christopherson), must include attribution and license text
- **Platform**: VSCode extension — must use VSCode extension APIs
- **Auth**: NEAR AI credentials via VSCode settings UI

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use VSCode's native model picker | Seamless UX, models appear alongside Copilot | — Pending |
| Full GSD command parity | User wants complete functionality | — Pending |
| TypeScript only | User constraint | — Pending |
| NEAR AI auth via settings | User preference over env vars | — Pending |
| Support both hosted + local NEAR AI | Maximum flexibility for users | — Pending |
| Freemium with Phase 1 free | Lower barrier to entry, validate before paying | — Pending |
| On-chain license storage (NEAR) | Fully decentralized license validation | — Pending |
| Stripe subscription model | Recurring revenue, standard fiat UX | — Pending |
| x402 + NEAR Intents for crypto | Any-crypto-to-USDC, decentralized payments | — Pending |
| 20% crypto discount | Incentivize decentralized payment adoption | — Pending |
| Hybrid fiat architecture | Stripe webhook via auditable serverless, not fully decentralized | — Pending |

---
*Last updated: 2026-01-12 after monetization requirements added*
