# UAT Issues: Phase 01 Plan 02

**Tested:** 2026-01-12
**Source:** .planning/phases/01-foundation/01-02-SUMMARY.md
**Tester:** User via /gsd:verify-work

## Open Issues

### UAT-001: Auth module uses wrong authentication method

**Discovered:** 2026-01-12
**Phase/Plan:** 01-02
**Severity:** Blocker
**Feature:** Auth module (src/auth/nearAuth.ts)
**Description:** The auth module reads from `~/.nearai/config.json` and JSON-stringifies an auth object. This is the OLD NEAR AI authentication. The current NEAR AI Cloud API uses standard Bearer token authentication with API keys generated from the dashboard.
**Expected:**
- Users get API key from https://cloud.near.ai/ dashboard (API Keys section)
- Requests use standard `Authorization: Bearer YOUR_API_KEY` header
- API key stored in VSCode SecretStorage or settings (not a nearai config file)
**Actual:** Reads `~/.nearai/config.json`, extracts auth object with account_id/public_key/signature, JSON.stringify's it as API key
**API Reference:** https://docs.near.ai/cloud/quickstart
**Correct auth flow:**
1. User generates API key at cloud.near.ai dashboard
2. Extension stores key in VSCode SecretStorage
3. OpenAI SDK configured with `apiKey: YOUR_API_KEY` (standard Bearer token)

### UAT-002: Models are hardcoded instead of fetched from API

**Discovered:** 2026-01-12
**Phase/Plan:** 01-02
**Severity:** Major
**Feature:** NEAR AI client module (NEAR_AI_MODELS constant)
**Description:** The available NEAR AI models are hardcoded in `src/client/nearAiClient.ts`. Models change over time and should be fetched dynamically from the NEAR AI API.
**Expected:** Models fetched from `https://cloud-api.near.ai/v1/model/list` which returns:
- modelId (e.g., "deepseek-ai/DeepSeek-V3.1")
- inputCostPerToken / outputCostPerToken (with amount, scale, currency)
- metadata.modelDisplayName
- metadata.contextLength
- metadata.modelDescription
- metadata.modelIcon
**Actual:** Hardcoded array with outdated model IDs (fireworks:: prefix) and manually specified token limits
**API Reference:** https://docs.near.ai/api, endpoint: https://cloud-api.near.ai/v1/model/list
**Repro:**
1. Open `src/client/nearAiClient.ts`
2. See `NEAR_AI_MODELS` constant with hardcoded values
3. Compare to current models at https://docs.near.ai/cloud/models/overview

### UAT-003: Wrong API base URL

**Discovered:** 2026-01-12
**Phase/Plan:** 01-02
**Severity:** Blocker
**Feature:** NEAR AI client module (createNearAiClient)
**Description:** The client is configured with wrong base URL.
**Expected:** `https://cloud-api.near.ai/v1` (per NEAR AI Cloud docs)
**Actual:** `https://api.near.ai/v1` (old/incorrect endpoint)
**API Reference:** https://docs.near.ai/cloud/quickstart

## Resolved Issues

[None yet]

---

*Phase: 01-foundation*
*Plan: 02*
*Tested: 2026-01-12*
