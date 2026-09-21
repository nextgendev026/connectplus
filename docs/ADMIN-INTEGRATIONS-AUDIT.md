# Admin Integrations — Audit and Plan

Branch `phase-a/baseline-audit-and-docs` · base `main` · 2026-09-21

The pre-implementation audit the brief requires for the admin console's integration layer. Every
claim is grounded in a file inspected during this session.

Companion documents: `docs/MODERNIZATION-AUDIT.md` (platform findings `F-nn`),
`docs/CONNECTPLUS-AI-IMPLEMENTATION-AUDIT.md` (Studio/Copilot/sports).

Baseline: `npm run typecheck` exit 0 · `npm run lint` 0 errors · `npm test` 98 files, 1511 passed.

## Status after implementation

| Finding | State | Where |
| --- | --- | --- |
| I-01 three disagreeing provider registries | **Fixed** — one registry, both consumers derive from it | `lib/providers/registry.ts` |
| I-01b `openaiApiKey` called dead wiring | **Corrected** — it is read by `lib/visual-studio.ts:96` for image generation | `lib/providers/registry.ts` |
| I-03 `managedBySetting` pointing at a non-existent key | **Detectable** — asserted by the drift test | `tests/unit/docs-drift.test.ts` |
| I-02 shared `requireAdmin` via `lib/policies` | **Not done** (the module exists from Phase C) | — |
| I-04 provider probe contract | **Not done** | — |
| I-05 per-integration status history | **Not done** | — |
| I-07 central URL/callback validation | **Not done** — SSRF guard exists from Phase D | `lib/safe-fetch.ts` |
| I-09 wider integration test list | **Partly done** (38 registry tests) | `tests/unit/providers-registry.test.ts` |

The registry went first because it was the finding that let two surfaces confirm a configuration that
nothing could use. Detail: `docs/phase-reports/PHASE-F-G-S-I.md`.

---

## 1. Architecture

```
src/app/(admin)/admin/integrations/page.tsx   ──►  GET  /api/admin/integrations
src/app/(admin)/admin/settings/page.tsx       ──►  GET/POST /api/admin/settings
                                                        │
                          src/lib/integrations.ts ──────┤ (probes + field catalog, 1100+ lines)
                          src/lib/settings.ts     ──────┘ (catalog + cached read, 455 keys)
                                                        │
                          src/lib/platform-settings (PlatformSetting rows)  +  process.env
```

Two admin pages, two route handlers, two server-side modules. `lib/integrations.ts` holds a flat
array of **19 integration records** — `cloudflare-edge`, `inngest`, `database`, `redis`, `cache-tier`,
`convex`, `supabase-storage`, `daraja`, `paypal`, `resend`, `rss`, `ai`, `upstream-data`, `radio`,
`alerts`, `vercel`, `google-oauth`, `pwa`, `web-push` — each a ~40–60 line object literal that
inlines its own probe logic beside its own metadata (first at `:203`, last at `:1124`).

## 2. The settings / integrations model

`IntegrationField` (`integrations.ts:26`) is the join between the two systems, and it is the best
idea in the file:

```ts
{ label, env?, present, value?, required, hint?, managedBySetting? }
```

`env` names the environment variable; `managedBySetting` names the **catalog key** in
`lib/settings.ts` when the value is administered from the console rather than the environment. So
the console can render "present because it was set here" distinctly from "present because the
deployment provides it" — which is exactly the distinction the brief asks for (§D: "separate
provider connection, status, validation and health").

What is missing is any enforcement that `managedBySetting` names a key that **exists** in the
settings catalog. See §6, I-03.

## 3. Provider configuration patterns — three disagreeing registries (**I-01, P1**)

The same question — "which AI providers does this platform support?" — is answered in three places,
and they disagree:

| Location | Answer |
| --- | --- |
| `src/lib/ai-provider.ts` (`AiProviderName` union + `OPENAI_COMPATIBLE` gateway records) | `builtin`, `openrouter`, `opencode` |
| `src/lib/settings.ts:479–505` | exposes `openaiApiKey`, `anthropicApiKey`, `anthropicModel` |
| `src/lib/integrations.ts:821–868` | probes `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` and reports them as provider health |

The consequences are concrete, not theoretical:

- An admin can **save an API key for a provider the gateway will never call**, from a settings
  console that offers the field, and then see the Integrations console report it as provisioned.
  Two separate surfaces confirm a configuration that does nothing.
- `ARCHITECTURE.md` advertised Gemini until Phase A removed it — the documentation was the fourth
  copy of the list, and the one that drifted first.
- Phase A added `tests/unit/docs-drift.test.ts`, which pins the *documentation* to the gateway
  (`AiProviderName` ↔ `OPENAI_COMPATIBLE` ↔ prose). It does **not** pin the settings catalog or the
  integrations probes, because neither of those reads the gateway. That is the gap this work closes.

**This is the single highest-value item in this audit**: one source of truth, consulted by all four
consumers.

## 4. Route / handler usage

| Route | Methods | Authorisation | Notes |
| --- | --- | --- | --- |
| `/api/admin/integrations` | GET, POST | local `requireAdmin()` (`:13`) calling `auth()` and checking `session.user.role` | 73 lines; POST dispatches an action such as a targeted probe |
| `/api/admin/settings` | GET, POST | same pattern (duplicated) | POST restricts writes to catalog keys (`:49`) and blocks `CODE_INJECTION_KEYS` (`:14`, `:59`) |

The settings route's guards are genuinely good and are the model to follow:

- **Catalog guard**: "only allow catalog keys (prevents arbitrary row creation)" (`:49`) — an admin
  cannot create a settings row the code does not know about.
- **Injection guard**: a named `CODE_INJECTION_KEYS` set, with the comment "these are the only keys
  that can turn a settings write into stored XSS" (`:14`). Whoever wrote this understood the threat
  precisely.

The weakness is that `requireAdmin()` is **re-implemented locally in each route** rather than using
`lib/policies` (built in Phase C). Two copies today; the third would be the one that gets it wrong.

## 5. Webhook flow and validation

| Provider | Handler | Signature verification |
| --- | --- | --- |
| Daraja (M-Pesa) | `src/app/api/payments/daraja/callback/route.ts` | shared-secret / path check; **amount comparison was `Math.abs(diff) > 1`** — fixed in Phase E to exact minor-unit equality, and a missing amount is now a mismatch rather than agreement |
| PayPal | `src/app/api/payments/paypal/webhook/route.ts` | signature verification present |
| Payment ledger | `PaymentEvent` table | events are claimed in a ledger, so a retry cannot extend a membership twice |

Webhook verification is in better shape than the brief assumes. The related finding is F-36's
neighbour: proxy and origin handling (`src/proxy.ts`, hardened in Phase D with trusted-proxy-aware
client IP resolution and origin/CSRF validation).

## 6. Findings

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| **I-01** | **P1** | Three independent AI-provider registries that disagree; a key can be saved for a provider the gateway cannot route, and the console then reports it healthy | `ai-provider.ts`, `settings.ts:479–505`, `integrations.ts:821–868` |
| **I-02** | **P2** | `requireAdmin()` duplicated per route instead of using `lib/policies` | `api/admin/integrations/route.ts:13`, `api/admin/settings/route.ts` |
| **I-03** | **P2** | `IntegrationField.managedBySetting` is not validated against the settings catalog: a typo or a renamed key renders as "configured from Settings" while nothing reads it | `integrations.ts:26` vs `settings.ts` catalog; no test |
| **I-04** | **P2** | 19 integration records each inline their probe, so a provider cannot be tested, mocked or replaced without editing a 1100-line file; the shape of a "probe" is not a contract | `integrations.ts:203–1180` |
| **I-05** | **P2** | No per-integration history: last success, last failure, error code, latency over time. `latencyMs` is the *current* probe only, so an intermittent provider reads as healthy between failures | `Integration.latencyMs`, `IntegrationsReport` |
| **I-06** | **P2** | Secret handling is display-only masking with no shared helper, so "never log a credential" is a per-call-site convention | `IntegrationField.value`, `value?: string \| null` documented as "Masked or non-sensitive" |
| **I-07** | **P3** | No validation of admin-supplied URLs (callback hosts, webhook endpoints, provider base URLs) beyond whatever each probe does ad hoc | `integrations.ts` probes; `brain-pilot`/settings forms |
| **I-08** | **P3** | No config migration path: a renamed or removed setting key has no compatibility layer, so its stored value becomes dead wiring that still reads as configured | `settings.ts` catalog; `PlatformSetting` rows |
| **I-09** | **P3** | No test coverage for the integration layer itself: config validation, secret masking, provider status transitions and stale-config handling are untested | `tests/unit` has `admin-console-theme`, `admin-intelligence`, `integration-scripts` — none cover `lib/integrations.ts` |

## 7. Secret handling and leakage risk

Current state: secrets are never returned by the API in cleartext — `IntegrationField.value` is
documented as masked or non-sensitive, and the settings POST guards injection keys. The risk is not
a known leak; it is that **nothing enforces the rule**. There is no function that all display paths
go through, so a future field added with `value: process.env.SOME_KEY` would ship. That is what I-06
names, and it is cheap to close with a masking helper plus a scanning test.

## 8. Stale config and dead wiring risk

The mechanism exists but is unverified end to end:

- A field can be `managedBySetting: "someKey"` — a string, not a typed reference (I-03).
- A settings key can be removed from the catalog while a `PlatformSetting` row keeps its value. The
  row is invisible to the admin UI (which renders from the catalog) but still present in the
  database.
- `settings.ts` is 455 keys; nothing asserts that every `managedBySetting` reference resolves, and
  nothing reports keys that exist as rows but no longer in the catalog.

## 9. Admin console UI flow

`admin/integrations/page.tsx` renders the report: per integration, a status chip, a detail line, a
latency, a field list distinguished by `env` vs `managedBySetting`, and links. The information model
is sound. What the brief asks for and the UI does not have: an explicit active / misconfigured /
failing / stale state distinct from the four-value `IntegrationStatus`, and per-integration actions
(enable, disable, test, refresh, reconnect) beyond the single POST probe.

Mobile: the page is a stacked card list, which degrades acceptably, but there is no test and no
stated target. I-09 covers it.

## 10. Data flow from admin settings to runtime

`lib/settings.ts` holds a catalog and a cached read (Redis, 300 s TTL, with `cacheSet`/`redisDel` on
write). Phase F added `src/lib/cache-policy.ts`, which registers `platform-settings`
(`settings:v{n}`, public, 300 s, invalidated by `admin-settings-save`) and now **guards every cache
write** — so a settings write that a future edit scoped per-user would be refused rather than leak.
That is the runtime path's safety property and it is tested (23 cache-policy tests).

## 11. Missing validation and security checks

1. Provider credentials are stored without validating that they correspond to a *routable* provider
   (I-01).
2. `managedBySetting` is not validated (I-03).
3. Admin-supplied URLs are not validated centrally (I-07).
4. `requireAdmin()` is duplicated rather than shared (I-02).
5. No masking helper enforcing "never display or log a secret" (I-06).

## 12. Missing tests

Config validation · secret masking · unauthorised admin access · provider health and disconnection
states · stale config handling · integration request retries · admin UI rendering · event dedupe ·
degraded-mode behaviour · runtime fallback. None of these exist today (I-09).

## 13. Migration plan

**Phase I1 — one provider registry (I-01).** Create `src/lib/providers/registry.ts` as the single
source of truth for provider identity, required env vars, routing capability and validation. Make
`ai-provider.ts`, `settings.ts` and `integrations.ts` derive from it, so a provider that cannot be
routed cannot be offered a credential field or reported healthy. Extend the existing drift test to
cover all four consumers rather than only the documentation.

**Phase I2 — shared admin authorisation and secret masking (I-02, I-06).** Both admin routes use
`lib/policies`; every display path goes through one `maskSecret()`; a test scans integration fields
for anything that would return a cleartext credential.

**Phase I3 — validated field catalog and dead-wiring detection (I-03, I-08).** Typed
`managedBySetting` references, a check that every reference resolves, and a report of
`PlatformSetting` rows whose key is no longer in the catalog.

**Phase I4 — provider contract and per-integration history (I-04, I-05).** Extract a probe contract
(name, slug, config schema, validate, healthCheck, test, failure states, retry) and record last
success / last failure / error code / latency so an intermittent provider is visibly intermittent.

**Phase I5 — URL validation for admin-supplied endpoints (I-07).** Reuse `src/lib/safe-fetch`'s
`assessUrl` (Phase D) rather than writing a second URL validator.

## 14. Rollback plan

Each phase is a separate, reviewable change.

- I1: revert the registry and the three consumers. No schema change, no data migration.
- I2: revert the two route handlers; `lib/policies` is already in use elsewhere so reverting one
  route cannot affect them.
- I3: revalidation and reporting only — no stored data is rewritten. A `PlatformSetting` row flagged
  as dead wiring is reported, never deleted.
- I4: additive. The probe contract wraps existing probes; reverting restores the inline versions.
- I5: reverting restores the previous ad-hoc checks.

No phase drops a column, deletes a row, or changes a stored secret.

## 15. Definition of done — position at audit time

| Requirement | Status |
| --- | --- |
| Admin integration settings centralised and consistent | ❌ I-01, I-03 |
| Provider config secure and validated | ⚠️ stored safely; not validated against routability (I-01) |
| Stale or dead config removed or clearly marked | ❌ I-08 |
| Provider status visible and actionable | ⚠️ four-value status exists; no enable/disable/reconnect (I-05) |
| Webhooks and callbacks verified | ✅ (Daraja amount check fixed in Phase E) |
| Admin UI easier to use and responsive | ⚠️ card list; untested on narrow screens (I-09) |
| Provider adapters testable and replaceable | ❌ I-04 |
| Integration failures observable | ⚠️ current probe only; no history (I-05) |
| Degraded states visible and safe | ✅ in the runtime path; ⚠️ in the console |
| No secrets exposed | ⚠️ true today; unenforced (I-06) |
| No dead wiring remains | ❌ I-08 |
| Tests pass | ✅ baseline green (1511) |
| Remaining risks documented | ✅ this document |
