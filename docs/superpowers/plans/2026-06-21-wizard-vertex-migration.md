# Wizard AI backend: Anthropic API → Vertex AI (Claude) migration plan

**Decision (boss + team):** Route the wizard's Claude calls through **Google Cloud Vertex AI**
(uses GCP spend, not a separate Anthropic bill), pin **Claude Sonnet 4.5** (drop Opus), stay
inside a **$25k GCP credit pool**.

**Architecture (key point):** This is a **platform-proxy change only**. The wizard always talks to
the Honch proxy (`/api/wizard/llm`) with a minted wizard token; the provider key/creds live in the
proxy. So we change the proxy's *upstream* from the Anthropic API to Vertex. The wizard, metering,
budget, and token-minting are unchanged. (Option C — wizard → Vertex direct — is rejected: it would
ship GCP service-account creds onto customer machines.)

Repos:
- **platform** (`~/Development/honch-io/platform`) — all the real work, in `backend/src/modules/wizard/`.
- **honcho-wizard** — no functional change needed (optional cosmetic model-string update).

---

## Phase 0 — GCP prerequisites (boss/user; needs console + gcloud; project euphoric-fusion-498103-g7)

These gate everything; do them first.

1. Enable Vertex AI API: `gcloud services enable aiplatform.googleapis.com --project=euphoric-fusion-498103-g7`
2. Enable **Claude Sonnet 4.5** in **Vertex Model Garden** (Anthropic models require per-model click-through
   "Enable" / order). Confirm the exact model id + a serving region (likely `claude-sonnet-4-5@20250929`,
   region e.g. `us-east5` — verify current availability in console).
3. Grant the honch-api Cloud Run **service account** `roles/aiplatform.user`.
   (Find SA: `gcloud run services describe honch-api --region=us-central1 --format='value(spec.template.spec.serviceAccountName)'`)
4. Check Vertex online-prediction **quota** for the model; raise if needed.
5. Set a **GCP Billing budget + alert** on Vertex spend against the $25k pool (50/80/100% alerts).

Capture: confirmed model id, region, SA email.

---

## Phase 1 — Proxy provider abstraction + Vertex upstream (platform)

**Files:** `backend/src/environment.ts`, `backend/src/modules/wizard/wizard.service.ts`,
`backend/src/modules/wizard/wizard.controller.ts`, `backend/src/modules/wizard/wizard.service.test.ts`,
`backend/package.json` (+ `google-auth-library`).

1. **Env (toggle for safe rollout/rollback):**
   - `WIZARD_LLM_PROVIDER`: `"anthropic" | "vertex"` (default `"anthropic"` until cutover).
   - `VERTEX_PROJECT_ID`, `VERTEX_REGION`.
   - `WIZARD_LLM_MODEL` → Vertex model id when provider=vertex (e.g. `claude-sonnet-4-5@20250929`);
     for anthropic keep `claude-sonnet-4-5` / current.
   - Keep `ANTHROPIC_*` so we can flip back instantly.

2. **Auth:** add `google-auth-library`; get an access token from ADC (Cloud Run metadata server) via
   `GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getAccessToken()`.
   Cache the token until ~5 min before expiry.

3. **Request translation** (new `buildVertexProxyRequest`, sibling to `buildAnthropicProxyRequest`):
   - URL: `https://{region}-aiplatform.googleapis.com/v1/projects/{proj}/locations/{region}/publishers/anthropic/models/{model}:streamRawPredict`
     (use `:rawPredict` for non-streaming / count_tokens).
   - Body: take the Anthropic Messages body, **remove top-level `model`**, **add `anthropic_version: "vertex-2023-10-16"`**.
     Keep the max_tokens clamp.
   - Headers: `Authorization: Bearer <gcp-token>`, `content-type: application/json`. (No `x-api-key`.)
   - Branch on `WIZARD_LLM_PROVIDER` in `proxyLlmRequest`.

4. **Unchanged & reused:** model pinning, max_tokens clamp, per-project token budget, rate limits, and the
   in-stream metering (`createWizardMeteringStream`) — Vertex returns the same Anthropic SSE/`usage` shape,
   so `extractWizardTokenTotal` works as-is.

5. **Tests:** unit-test `buildVertexProxyRequest` (URL shape, `anthropic_version` added, `model` stripped,
   bearer header, max_tokens clamp). Gate: `cd backend && bun run build && bunx vitest run src/modules/wizard && bun run format:check`.

6. **Rollout:** deploy with `WIZARD_LLM_PROVIDER=anthropic` (no behavior change), then flip the env to
   `vertex` once a staging install passes. Instant rollback by flipping back.

---

## Phase 2 — Cost controls for the $25k pool

- Pin **Sonnet 4.5** (done via `WIZARD_LLM_MODEL`). ~5x cheaper than Opus.
- Ensure **prompt caching** stays on (Vertex supports Anthropic caching; cache reads ~10% cost) — biggest lever.
- Keep/tune the per-project daily **token budget** (now reliable after the metering fix). With Sonnet a real
  install ≈ a dollar or two, so $25k ≈ thousands of installs; set a generous daily cap + the GCP billing alert.
- Consider lowering `WIZARD_LLM_MAX_OUTPUT_TOKENS`.

---

## Phase 3 — Wizard repo (optional, cosmetic)

- `src/agent/runner.ts` pins `HONCH_AGENT_MODEL = "claude-opus-4-8"` and sends it; the proxy coerces/strips it,
  so **no functional change is required**. Optional: update the string to `claude-sonnet-4-5` for honest logs.

---

## Open items / verify
- Confirm exact Vertex model id + region availability for Sonnet 4.5 at build time.
- Confirm Vertex supports the `anthropic-beta` features we allow (e.g. `context-1m-2025-08-07`) — may differ.
- Streaming via `:streamRawPredict` returns SSE; confirm the wizard SDK (includePartialMessages:false) parses it
  (it should — same Anthropic format).
- This is independent of the in-flight metering fix on branch `fix/wizard-metering-reliability` (merge that first).
