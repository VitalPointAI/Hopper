# Project Issues Log

Enhancements discovered during execution. Not critical - address in future phases.

## Open Enhancements

### ISS-001: Unify NEAR AI API auth with wallet authentication

- **Discovered:** Phase 01.5 Task 04 (2026-01-13)
- **Type:** UX / Refactoring
- **Description:** NEAR AI Cloud supports wallet-based sign-in (no API key needed). Currently we have two separate auth flows: 1) API key for NEAR AI model access, 2) Wallet auth for license validation. Could potentially unify these - user connects wallet once and gets both NEAR AI access AND license validation. Would eliminate "Manage NEAR AI Connection" command and simplify onboarding significantly.
- **Impact:** Low (both auth methods work, this would simplify UX)
- **Effort:** Medium (need to research NEAR AI wallet auth API, update provider)
- **Suggested phase:** Future (after Phase 2 chat participant)
- **References:**
  - [NEAR AI Cloud Introduction](https://near.ai/blog/introducing-near-ai-cloud-private-chat)
  - [NEAR AI Cloud Portal](https://cloud.near.ai/)

### ISS-002: Add revoke_license method to NEAR contract

- **Discovered:** Phase 01.5 Task 06 (2026-01-13)
- **Type:** Feature
- **Description:** The NEAR license contract only has grant_license which extends expiry from max(current, now) + duration. There's no way to immediately revoke a license. For admin operations, we need a revoke_license method that sets expiry to block_timestamp (immediate revocation) or allows setting a specific expiry date.
- **Impact:** Low (licenses expire naturally, revocation rarely needed)
- **Effort:** Low (simple contract change, requires redeploy)
- **Suggested phase:** Future (when contract upgrade needed for other reasons)
- **References:**
  - contracts/license/src/lib.rs - grant_license implementation
  - workers/license-api/src/handlers/admin/actions.ts - handleAdminRevokeLicense

## Closed Enhancements

[None yet]

---

*Last updated: 2026-01-13*
