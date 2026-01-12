# UAT Issues: Phase 01 Plan 02

**Tested:** 2026-01-12
**Source:** .planning/phases/01-foundation/01-02-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

## Resolved Issues

### UAT-004: fetchNearAiModels requires apiKey but endpoint is public

**Discovered:** 2026-01-12
**Resolved:** 2026-01-12 (quick fix)
**Phase/Plan:** 01-02-FIX
**Severity:** Minor
**Feature:** NEAR AI client module (fetchNearAiModels function)
**Description:** The `fetchNearAiModels(apiKey: string)` function requires an API key parameter and sends a Bearer token header, but the `/v1/model/list` endpoint is actually public and returns data without authentication.
**Resolution:** Removed apiKey parameter and Authorization header from fetchNearAiModels()
**Commit:** ef8b44d

### UAT-001: Auth module uses wrong authentication method

**Discovered:** 2026-01-12
**Resolved:** 2026-01-12 (01-02-FIX)
**Phase/Plan:** 01-02
**Severity:** Blocker
**Feature:** Auth module (src/auth/nearAuth.ts)
**Description:** The auth module reads from `~/.nearai/config.json` and JSON-stringifies an auth object. This is the OLD NEAR AI authentication. The current NEAR AI Cloud API uses standard Bearer token authentication with API keys generated from the dashboard.
**Resolution:** Rewrote auth module to provide API key utilities. Removed config.json logic. Extension will use VSCode SecretStorage for key storage.
**Commit:** fcb0a48

### UAT-002: Models are hardcoded instead of fetched from API

**Discovered:** 2026-01-12
**Resolved:** 2026-01-12 (01-02-FIX)
**Phase/Plan:** 01-02
**Severity:** Major
**Feature:** NEAR AI client module (NEAR_AI_MODELS constant)
**Description:** The available NEAR AI models are hardcoded in `src/client/nearAiClient.ts`. Models change over time and should be fetched dynamically from the NEAR AI API.
**Resolution:** Removed hardcoded models. Added `fetchNearAiModels()` function that calls `/v1/model/list` endpoint.
**Commit:** d9396e0

### UAT-003: Wrong API base URL

**Discovered:** 2026-01-12
**Resolved:** 2026-01-12 (01-02-FIX)
**Phase/Plan:** 01-02
**Severity:** Blocker
**Feature:** NEAR AI client module (createNearAiClient)
**Description:** The client is configured with wrong base URL.
**Resolution:** Updated base URL from `api.near.ai` to `cloud-api.near.ai/v1`.
**Commit:** ee8d970

---

*Phase: 01-foundation*
*Plan: 02*
*Tested: 2026-01-12*
*Fixed: 2026-01-12*
