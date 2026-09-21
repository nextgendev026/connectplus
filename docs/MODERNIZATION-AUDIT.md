# ConnectPlus Modernization Audit

**Phase A deliverable.** Companion to `docs/INTELLIGENCE-HARDENING-PLAN.md` (the detailed plan for the
AI phases G–K) and to `docs/FREE-TIER.md` / `docs/SYNDICATION.md` (existing infrastructure notes).

What Phase A actually changed, what it ran, what failed and what remains manual is recorded in
[`docs/phase-reports/PHASE-A.md`](./phase-reports/PHASE-A.md). Findings below are **not** fixed by this
phase unless the row says so.

| | |
| --- | --- |
| Branch | `phase-a/baseline-audit-and-docs` |
| Base commit | `main` @ `1d3f11b` |
| Audit date | 2026-09-21 |
| Scope | whole application, all 16 areas from Phase A |
| Method | direct inspection + four baseline command runs; every finding names the command or file that produced it |

---

## 0. Phase A declaration (required before any change)

**Will change.** Documentation only, plus three narrow code fixes that unblock the gate every later
phase depends on: two `npm run lint` errors in repo source, and two `globalIgnores` entries so local
lint stops grading gitignored scratch and generated code. Plus a drift test that stops the
documentation from falling out of step again.

**Will not change.** No runtime behaviour. No route handler logic. No schema. No Prisma migration. No
environment variable. No dependency. No auth, payment, sports, radio, cache or brain behaviour.
`src/proxy.ts` keeps its exact rate limits and Redis/in-memory fallback — only a `let` becomes `const`.

**Risk.** Low. The two source edits are mechanically equivalent to the code they replace (verified by
`npm run typecheck`, `npm test` and `npm run lint` after the change). The `globalIgnores` additions
remove files from lint coverage that are either generated or gitignored, so no hand-written file
loses coverage.

**Rollback.** `git revert` the Phase A commit. Nothing is stateful; no migration ran; no deploy
happened. If only the ignore entries are suspect, delete the two lines and lint returns to its prior
(2 real errors + 718 noise) state.

**Tests that prove completion.**
`npm run typecheck` → exit 0 · `npm run lint` → exit 0 · `npm test` → 1137 passed, 1 skipped ·
`npm run build` → blocked by environment (F-01) · new `tests/unit/docs-drift.test.ts` → passes.

---

## 1. Baseline results (verbatim, before changes)

| Command | Result | Evidence |
| --- | --- | --- |
| `npm ci` | **not run (deliberate)** | It deletes and reinstalls `node_modules`. The existing install is already proven by a green suite and a passing typecheck; a reinstall here would risk the working tree for no new information. CI runs `npm ci` on every push, which is the authoritative check. |
| `npm run typecheck` | ✅ exit 0 | `reports/baseline/typecheck.log` |
| `npm run lint` | ❌ exit 1 — 3122 problems (718 errors, 2404 warnings) | `reports/baseline/lint.log` |
| `npm test` | ✅ 83 files, 1137 passed, 1 skipped | `reports/baseline/test.log` |
| `npm run build` | ❌ exit 1 — `P2024` Prisma pool timeout prerendering `/tags/government` | `reports/baseline/build.log` |
| `npm run test:e2e` | **not run** — requires a live server and a reachable database; the build could not complete locally (F-01), and `playwright.config.ts` boots `npm run build && npm run start` under `CI`. CI runs it (`.github/workflows/webpack.yml:69`). |

**Breakdown of the 718 lint errors — this is the finding that mattered most.**

| Source | Errors | Real? |
| --- | --- | --- |
| `.freebuff/pg-client/**` (17 files) | 716 | No — gitignored local scratch containing a vendored third-party `pg` client |
| `convex/_generated/**` (4 files) | 0 errors, 4 warnings | No — Convex codegen, regenerated on deploy |
| `src/proxy.ts:147` | 1 | **Yes** — `prefer-const` |
| `tests/unit/brain-operations.test.ts:168` | 1 | **Yes** — names a variable `module` |

So the application's *real* lint debt was two one-line issues, and it was invisible behind 716 lines
of noise from a directory that is not even in the repository.

---

## 2. Findings

Severity: **P0** breaks the gate / correctness or money · **P1** security or contract defect ·
**P2** maintainability, scale or resilience · **P3** cosmetic.
Complexity: S ≤ half a day · M ≤ two days · L > two days.

### P0

**F-01 — `npm run build` cannot pass in a local/CI-equivalent environment.** · Area: Deployment, Testing
*Evidence:* `reports/baseline/build.log` — `Invalid prisma.post.count() invocation: Timed out fetching a
new connection from the connection pool (Current connection pool timeout: 20, connection limit: 5)`,
raised while **prerendering** `/(public)/tags/[slug]/page` → `Export encountered an error on
/(public)/tags/government, exiting the build.`
*Risk:* the "build passes" gate in the Definition of Done is unverifiable off-Vercel. Static
generation depends on a live, unsaturated Postgres, so a build is coupled to database availability —
which is also why CI's Build step needs `DATABASE_URL` and can fail for reasons unrelated to the code.
*Recommended change:* Phase F/O — bound prerendering (`export const revalidate`, or `dynamic` on
DB-backed catalogue routes), raise the pool for the build phase, and make the build's DB dependency
explicit rather than incidental. Do not "fix" this by removing prerendering from public content.
*Complexity:* M. *Test:* a build run in CI against a seeded database, asserting the route count.
*Rollback:* revert the route-level rendering directive; behaviour returns to today's.

**F-02 — CI has been red on `main`, which silently disabled production migrations.** · Area: CI, Database
*Evidence:* `npm run lint` is CI step `.github/workflows/webpack.yml:39`; the `migrate` job is
`needs: check` and gated on `main` (line 80–96). Two real errors failed `check`, so **the migrate job
never ran** on any push to `main` — meaning `npx prisma migrate deploy` has not been executing
automatically. Confirmed fixed after Phase A edits: `npm run lint` → exit 0, 0 errors.
*Risk:* schema drift between `prisma/schema.prisma` and the deployed database accumulates with nothing
reporting it; a later phase that adds a model could ship code against a table that does not exist.
*Recommended change:* Phase A (done) — fix the two errors, ignore scratch/generated code. Phase O —
add a required status check on `main` so a red gate blocks merge instead of merely being noticed.
*Complexity:* S. *Test:* `npm run lint` exits 0; assert via branch protection (manual, recorded in the
Phase O report). *Rollback:* revert the two edits.

**F-03 — Money is stored as `Float`.** · Area: Database, Payments
*Evidence:* `prisma/schema.prisma` — `SubscriptionPlan.priceMonthly`/`priceYearly` (:491–492),
`PaymentIntent.amount`/`listAmount` (:569, :572), `Tip.amount` (:895),
`CreatorPayout.amount`/`feeAmount` (:930, :932) are all `Float`.
*Risk:* IEEE-754 drift on every amount, fee, split and payout. Reconciliation compares our stored
value against a provider amount (`PaymentEvent`, Daraja's `TransAmount`, PayPal's order total); a
float that reads back as `499.99999999999994` is a mismatch that fails a legitimate payment or, worse,
passes an illegitimate one near a boundary. Fee arithmetic (revenue split) compounds the error per row.
*Recommended change:* **Phase E** — migrate to integer minor units (KES cents, USD cents) or
`Decimal(18,2)`; add `>= 0` constraints, currency validity and lifecycle-state constraints; convert
comparisons to exact arithmetic; add migration fixtures and reconciliation tests.
*Complexity:* L — it touches schema, all payment writers, the admin revenue split and the ledger.
*Test:* property-style tests that `sum(fees) + sum(net) == sum(gross)` exactly at 2dp for random
amounts; round-trip reconciliation against stored provider amounts.
*Rollback:* the migration adds new columns rather than renaming; both can coexist for one release, and
dropping the new columns restores today's behaviour.

**F-03b — A payment callback accepted an amount up to one whole unit wrong (found while implementing Phase E).** · Area: Payments
*Evidence:* `src/app/api/payments/daraja/callback/route.ts:114` —
`if (callback.amount != null && Math.abs(callback.amount - intent.amount) > 1)`. The tolerance is ±1
**major** unit, because amounts are stored in major units: up to one whole shilling on the M-Pesa rail,
and up to one whole **dollar** on the USD-priced plans. The `!= null` guard also skipped the comparison
entirely for a callback that declared no amount, so a payload with a receipt and no `TransAmount` was
granted a membership.
*Risk:* the check's own comment says "the STK push fixed the amount, so a different one means the
payload was not produced by that request" — which is exactly what ±1 stopped being true of. A callback
claiming `$499` against a `$500` plan was accepted and a year of membership granted. This is the same
root cause as F-03, seen from the direction that matters most: not a rounding drift in a report, but a
verification that could not fail.
*Recommended change:* **Phase E (done)** — compare exact integer minor units, with `null` on the
provider side treated as a mismatch rather than as agreement (`amountMismatch` in `src/lib/money.ts`).
This is a deliberate behaviour change: a callback that declares no amount is now refused.
*Complexity:* S. *Test:* `tests/unit/money.test.ts` — a one-shilling and a one-dollar difference are
both refused, a single cent in either direction is refused, and a missing amount is refused.
*Rollback:* restore the tolerance, which also restores the bug.

### P1

**F-04 — AI provider configuration has three disagreeing sources of truth, and the docs promise a provider that does not exist.** · Area: AI, Documentation
*Evidence:* `src/lib/ai-provider.ts:4` — `AiProviderName = "builtin" | "openrouter" | "opencode"`.
`src/lib/settings.ts:479–505` defines `openaiApiKey`, `anthropicApiKey`, `anthropicModel`.
`src/lib/integrations.ts:821–868` probes `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` as if they were
providers. `src/lib/visual-studio.ts:96` reads `OPENAI_API_KEY` directly. `ARCHITECTURE.md:20`
advertises "OpenAI / Anthropic / OpenRouter / **Gemini**"; no Gemini code exists anywhere.
*Risk:* an operator stores a key and a model for a provider the gateway will never call, and the
Integrations console reports it healthy — a misconfiguration that presents as an outage. Documented
credentials that do nothing also widen the secret surface for no capability.
*Recommended change:* one registry (`src/lib/ai-providers.ts`) as the single source of truth; derive
`settings.ts` and `integrations.ts` from it; either route the extra providers genuinely or stop
offering them as selectable. **Phase G** (with Phase B providing the contract).
*Complexity:* M. *Test:* the drift test added in Phase A plus a "picker options ⊆ routable providers"
assertion. *Rollback:* the registry is additive; the old union can be restored.

**F-05 — Anonymous rate limiting trusts `x-forwarded-for` unconditionally.** · Area: Security
*Evidence:* `src/proxy.ts:25–27` — `const forwarded = request.headers.get("x-forwarded-for"); const ip = forwarded?.split(",")[0]?.trim() || "anonymous";`
*Risk:* any client can set the header and mint a fresh rate-limit bucket per request, so every
anonymous ceiling in the table (sign-in 10/15min, register 5/15min, upload 20/min, payments 120/min)
is bypassable by rotating one header. The distributed limiter inherits the same key.
*Recommended change:* **Phase D** — only honour forwarded headers when the peer is a known proxy
(Vercel/Cloudflare), otherwise use the platform-provided client address, with a documented fallback.
*Complexity:* S–M. *Test:* unit test asserting a spoofed header does not produce a new bucket.
*Rollback:* the resolution function returns today's expression.

**F-06 — No SSRF protection on any outbound fetch of a user- or feed-supplied URL.** · Area: Security
*Evidence:* `src/lib/web-research.ts:39` sets `redirect: "follow"` explicitly, and the module contains
**zero** matches for localhost, private ranges or metadata IPs (`grep -c` → 0). The same pattern
applies to RSS ingestion, thumbnail recovery and the image proxy; `next.config.mjs` allows
`{ protocol: "https", hostname: "**" }` in `images.remotePatterns`.
*Risk:* an RSS item, an admin-learned URL or a publisher page can point the server at
`169.254.169.254`, `localhost:6379`, or an internal service, turning the app into a request proxy
against its own network. Redirects are followed without revalidation, so a benign-looking URL can hop
to a private target.
*Recommended change:* **Phase D** — one `safe-fetch` used by every outbound path: http/https only,
DNS-resolved IP checked against private/link-local/metadata ranges, every redirect revalidated, size
and content-type caps, connection and read timeouts.
*Complexity:* M. *Test:* table-driven refusals (localhost, `127.0.0.1`, `::1`, RFC1918, `169.254.169.254`,
`file://`, redirect-to-private, oversize body, disallowed content type).
*Rollback:* callers revert to plain `fetch` one at a time; the guard is per-call-site.

**F-07 — No CSRF or origin validation on cookie-authenticated mutations.** · Area: Security
*Evidence:* no origin/`Referer` check and no CSRF token anywhere in `src/proxy.ts` or the route
handlers; sessions are cookie-borne (NextAuth JWT). The only cross-site control is `SameSite`
defaults.
*Risk:* state-changing endpoints (post creation, follows, bookmarks, subscription management, admin
actions) are reachable from a cross-site form post in browsers that do not enforce `SameSite=Lax` on
the path in question, and the pattern is fragile if a handler is later changed to a different method.
*Recommended change:* **Phase D** — validate `Origin`/`Referer` for cookie-authenticated mutations,
reject cross-site, and exempt only verified webhook and service-to-service routes.
*Complexity:* M. *Test:* a forged-origin request must 403 on every mutating route.
*Rollback:* the check is a single predicate in the request pipeline.

**F-08 — No standard API error contract; 396 ad-hoc error responses.** · Area: API
*Evidence:* `grep -c 'NextResponse.json({ error' src/app/api` → **396**; 33 of those are bare string
literals (`"Unauthorized"`, `"Forbidden"`, `"Not found"`). `src/lib/api-validation.ts` returns
`{ error, details[] }` for Zod failures, which is one of several shapes in circulation.
*Risk:* clients cannot distinguish "not signed in" from "not permitted" from "missing" without
string-matching prose; nothing carries a `requestId`, so a user-reported error cannot be traced to a
log line. Every future mobile client pays this cost again.
*Recommended change:* **Phase B** — one error envelope with code/message/details/requestId, a request
context carrying `requestId`, and `/api/v1` introduced alongside the existing routes (no big-bang
migration).
*Complexity:* L (gradual, per-route). *Test:* contract tests asserting status ↔ code mapping
(400/401/403/404/409/429 + `Retry-After`) and no stack traces in responses.
*Rollback:* `/api/v1` is additive; un-migrated routes keep today's shape.

**F-09 — Authorization is inline and repeated, with no reusable policy layer.** · Area: Auth
*Evidence:* 72 route files call `auth()` directly; 31 admin route files reference `ADMIN`/`SUPER_ADMIN`
themselves. There is no `src/lib/authz*`; the existing `src/lib/permissions.ts` is a **browser**
permissions helper (notifications, geolocation), not authorization.
*Risk:* each new route re-implements the check, so a single omission is an unprotected endpoint and
nothing detects it. No scopes exist, so `ai:propose` and `operations:repair` cannot be granted
separately, and destructive operations cannot demand recent authentication.
*Recommended change:* **Phase C** — `requireUser()`/`requireAdmin()`/`requireSuperAdmin()`/
`requireRole()`/`requireScope()`/`requireOwnership()`/`requireReauthentication()` in
`src/lib/policies/`, adopted route by route, with a test asserting every protected route refuses
anonymous and insufficiently-scoped callers.
*Complexity:* L (gradual). *Test:* a route-inventory test that fails when a new route lacks a
declared policy.
*Rollback:* helpers wrap today's checks, so a route can be converted back individually.

**F-10 — Admin accounts have no MFA, no reauthentication and no session revocation.** · Area: Admin security
*Evidence:* NextAuth credentials/JWT sessions with no second factor, no step-up before high-risk
actions and no server-side revocation list (`grep` finds no MFA/TOTP/reauth path).
*Risk:* one phished admin password becomes full control of publishing, moderation, payments settings
and (after Phase H) the self-heal envelope. Approving a queued `publish_post` and flipping
`brainSelfHeal` to `enforce` are currently the same privilege as reading a dashboard.
*Recommended change:* **Phase D/F** — MFA requirement for superadmins, reauthentication for
production-risk actions, session revocation, admin sign-in alerts, failed-login monitoring.
*Complexity:* M–L. *Test:* login-without-second-factor is refused for superadmin; a stale session
cannot approve after revocation.
*Rollback:* MFA can be flipped to optional per account; the enforcement flag is a setting.

**F-11 — 121 of 161 React files are client components, with no accessibility or visual regression gate.** · Area: Frontend
*Evidence:* `grep -rl '"use client"' src/components src/app` → 121; `*.tsx` count → 161 (75%). CI runs
no axe, no a11y assertion and no visual diff. `tests/unit/contrast.test.ts` covers colour tokens only.
*Risk:* hydration and bundle cost on a mobile-first, low-bandwidth, East-African audience; whole
screens become client-rendered for one interactive child. Accessibility regressions (focus, dialog
semantics, reduced motion, touch-target size) are currently caught by nobody.
*Recommended change:* **Phase L** — reduce unnecessary client boundaries, lazy-load charts and
defer admin-only modules, add axe + visual regression, and add explicit loading/empty/error/offline
states.
*Complexity:* L. *Test:* axe assertions on public routes; bundle-size budget in CI; offline and PWA
behaviour on Android Chrome and iOS Safari.
*Rollback:* per-component; each extraction is independently revertable.

**F-12 — CI omits every security gate except the build.** · Area: CI
*Evidence:* `.github/workflows/webpack.yml` steps are: `npm ci` → `prisma generate` → typecheck →
lint → unit tests → build → Playwright e2e. No dependency audit, secret scanning, SAST, migration
drift validation or contract/authorization test suite.
*Risk:* a vulnerable dependency, a committed credential or a schema/migration divergence reaches
`main` with a green tick. The e2e step already exists, so the runner cost of adding more is understood.
*Recommended change:* **Phase O** — add `npm audit --audit-level=high`, secret scanning, SAST,
migration drift check, and fail the build on security-critical test failures.
*Complexity:* S–M. *Test:* deliberately-introduced findings must fail the pipeline.
*Rollback:* each step is an independent workflow entry.

### P2

| ID | Finding | Evidence | Recommended change (phase) |
| --- | --- | --- | --- |
| F-13 | Offset pagination on the public posts API | `src/app/api/posts/route.ts:65–92` — `page`/`limit`, `skip = (page-1)*limit`, `take: limit`, max 50; no cursor | Cursor pagination in `/api/v1` (**M**) |
| F-14 | Cache policy is spread across three places with no privacy test | `next.config.mjs` `headers()`, `vercel.json` `headers`, worker Cache API, plus per-route `Cache-Control`; the blanket `/api/:path*` is `no-store` and later rules override it | Phase F — one documented cache table per resource (owner, key, TTL, SWR, privacy class, invalidation), plus cache-privacy tests (**M**) |
| F-15 | `NeuralMemory` has no provenance or expiry | `prisma/schema.prisma` `NeuralMemory` — `source`, `category`, `content`, `tags`, `confidence`, `metadata`, `sourceUrl`, `sourceFeedId` only | Phase G — verification states, source hash, observed/expires, scope, sensitivity, supersedes, contradiction group, embedding model/version (**M**) |
| F-16 | Retrieval is hashed-embedding cosine with no weighting, scope filter, reranking or budget | `src/lib/neural-vector.ts`, `src/lib/embeddings.ts` (`EMBEDDING_DIM = 384`, `hash-minilm`); `PostEmbedding.pgVec Unsupported("vector(384)")` is declared but unused | Phase G — retrieval abstraction with pgvector → hashed → lexical fallback, freshness/reliability/verification weighting, reranking, context budget, retrieval reasons (**L**) |
| F-17 | Intent has no calibration, ambiguity path, versioning or metrics | `src/lib/neural-intent.ts` — `classifyIntent`, `applyLearnedAliases`, no metrics or version record | Phase G — calibration, ambiguity → clarification, versioned aliases, operator corrections, per-intent accuracy (**M**) |
| F-18 | Approval proposals have no canonical args, target snapshot or revalidation | `src/lib/brain-approvals.ts` `proposeAction` / `decideProposal`; `BrainActionProposal` stores `args` as opaque JSON | Phase H — canonical serialisation + `argsHash`, proposal-time target snapshot, approval-time re-read and material-change detection, two-person rules (**M**) |
| F-19 | Self-healing has no cooldown, backoff, circuit breaker, maintenance window or post-verification | `src/lib/brain-repair.ts` — `MAX_REPAIRS_PER_RUN = 3`, finding-bound, `observe` default; confirmation is deferred to the next diagnosis | Phase H — per-repair cooldown, attempts, exponential backoff, circuit breaker, preconditions, post-repair verification of the original finding (**M**) |
| F-20 | Upload validation lacks magic-byte and filename checks | `src/app/api/upload/route.ts:27–108` — per-type size limits, storage quota, MIME from the client; no magic-byte sniff, no `..`/extension denylist | Phase D — validate magic bytes, normalise filenames, reject dangerous extensions, decompression limits, signed upload URLs (**M**) |
| F-21 | No `/api/v1`, no DTOs, no OpenAPI, no versioning or conditional requests | `src/app/api/v1` does not exist; responses are route-specific | Phase M — versioned surface over stable DTOs, cursor pagination, ETags, deprecation headers, contract tests (**L**) |
| F-22 | No device registration or offline sync | no device model; `public/sw.js` handles push and caching only | Phase M — device registry with push-token rotation/revocation, deep links, versioned offline sync with conflict resolution (**L**) |
| F-23 | Analytics retention is undefined for high-volume tables | `PageView`, `ModelFeedback`, `SportsActivity`, `SportsNotificationLog`, `NeuralMemory.accessCount` grow without a documented prune; `supabase/cron-maintenance.sql` exists but is not part of the schema contract | Phase F — retention policy, date indexes, daily aggregates, pruning, privacy deletion (**M**) |
| F-24 | Observability is logs + Sentry, with no metrics or traces | `src/lib/logger.ts`, `sentry.*.config.ts`; no latency/hit-rate/job-staleness metrics exporter; `/api/status` is a snapshot, not a series | Phase O — instrument requests, queries, cache, jobs, providers, AI calls, tool calls, approvals, repairs (**L**) |
| F-25 | Documentation drift (details in §3 below) | see the drift table | Phase A fix applied; drift test added (**S**) |
| F-32 | The intelligence layer ran unbounded per-item query loops | `src/lib/neural-mind.ts` before Phase F: `getPlatformStats()` 1+2N, `analyzeUsers()` 1+2N **plus** a full-table `findMany({select:{authorId}})` over every published post, `getRegionalIntelligence()` 2N with **no bound at all**, `getGrowthReport()` 3×30 = 90 round trips. Cost grew with the platform's size, not with the question asked | Phase F — `src/lib/queries/analytics.ts` grouped aggregates, `src/lib/query-budget.ts` budgets/timeouts/slow-query log (**M**) |
| F-33 | No query timeout anywhere; a slow query waits until the platform kills the request | every `prisma.*` call; `src/lib/prisma.ts` sets no `statement_timeout` and no client-side abort | Phase F — `withinBudget()` / `withinBudgetOrNull()`, four named budgets, overrun log and a health line (**S**) |
| F-34 | Analytics retention was undefined and unenforceable (F-23, now implemented) | `PageView`, `ModelFeedback`, `SportsActivity`, `Notification`, `SportsNotificationLog` grew without a prune; growth charts read `PageView`, so a prune without a rollup would delete reported history | Phase F — `src/lib/analytics-retention.ts`, `DailyMetric` + migration `20260921130000_daily_metric`, rollup-then-prune ordering enforced in code, `analytics-retention` cron job (**M**) |
| F-35 | Cache privacy was a convention with no enforcement and no test | `src/lib/redis.ts` `redisSetEx` accepted any key from any caller; nothing prevented a user-scoped value entering a shared layer | Phase F — `src/lib/cache-policy.ts` registry (11 resources) + `guardCacheWrite` wired into the single write path, 23 tests (**S**) |
| F-36 | `job-heartbeat.ts` asks for a 30-day TTL and `lib/redis.ts` silently clamps every write to 24h | `src/lib/job-heartbeat.ts:42` `TTL_SECONDS = 30 * 24 * 60 * 60` vs `src/lib/redis.ts` `MAX_TTL_SECONDS = 86_400`; `redisSetEx` clamps without returning a signal that it did | Phase F documented the effective 24h in the cache registry and flagged it here. Left unfixed deliberately: raising the cap changes every cache write on the platform. A `clamped` flag on `redisSetEx` would let callers with a durability need (heartbeat, rate-limit ledger) notice. Survivable today because `job-heartbeat.ts` keeps the Postgres row as the durable copy (**S**) |
| F-31 | `zod` is imported across `src/lib` but is **not a declared dependency** (found while implementing Phase B) | `src/lib/api-validation.ts:24`, `src/lib/schemas/validators.ts` import from `zod`; `package.json` lists no `zod` — it resolves only because a transitive dependency hoists it | Add `zod` to `dependencies` at the installed major. A transitive dependency can drop it on any upgrade, and `npm ci` in CI would then fail on an import that has always "worked". Phase O (dependency hygiene) (**S**) |

### P3

| ID | Finding | Evidence |
| --- | --- | --- |
| F-26 | 92 lint warnings remain across `src` (mostly `no-explicit-any` and unused vars), tolerated by project policy | `reports/baseline/lint-after.log` |
| F-27 | `AGENTS.md` duplicates its entire Supabase-topology section verbatim | lines 13 and 48 |
| F-28 | `reports/` and `.freebuff/` scratch accumulate in the working tree | both gitignored, so no repository impact; recorded so it is not mistaken for tracked state |
| F-29 | `ARCHITECTURE.md` folder map omits whole modules that exist (`mind-actions`, `brain-approvals` are listed; `payment` internals, `sports-*`, `neural-*` families are not) | `ARCHITECTURE.md:44–80` vs `src/lib/` |

---

## 3. Documentation drift (corrected in this phase)

| Claim | Where | Reality | Fixed |
| --- | --- | --- | --- |
| "Next.js **15**" ×2 | `ARCHITECTURE.md:9,15` | `next: ^16.3.4` | ✅ |
| AI = "OpenAI / Anthropic / OpenRouter / **Gemini**" | `ARCHITECTURE.md:20` | `builtin \| openrouter \| opencode` (`ai-provider.ts:4`) | ✅ |
| AI = "…OpenAI, Anthropic" as selectable providers | `README.md` Tech Stack | not routable; keys exist in settings/integrations only (F-04) | ✅ |
| "107 endpoints" ×2 | `ARCHITECTURE.md:16,35` | 111 `route.ts` files | ✅ |
| "344 tests" | `README.md` Testing | 1137 passing / 83 files | ✅ |
| Scheduler = Inngest only | `ARCHITECTURE.md:23,147` | Inngest + Vercel safety-net + Cloudflare Worker crons + cron-job.org | ✅ |
| 12 scheduled jobs tabled | `README.md` | `CRON_JOBS` holds 16 ids | ✅ |
| Union of env vars the app reads | `README.md`, `ARCHITECTURE.md` | `.env.example` contained none of the AI provider keys | ✅ |
| `OPENAI_API_KEY` "enables AI content generation and copilot" | `DEPLOYING.md` env table | it enables nothing in the AI path (F-04) | ✅ |
| Deploy flow "no manual deploy step" / migrations "run separately" | `DEPLOYING.md` | CI's `migrate` job runs `prisma migrate deploy` on `main` — and was dead while lint was red (F-02) | ✅ |
| Duplicated Supabase block | `AGENTS.md:13,48` | duplication removed | ✅ |

---

## 4. Area-by-area summary

| # | Area | State | Headline |
| --- | --- | --- | --- |
| 1 | Frontend | Works, unmeasured | 75% client components; no a11y or visual gate (F-11) |
| 2 | API | Works, per-route contract | 111 handlers, 396 ad-hoc error shapes, no request ID (F-08) |
| 3 | Auth & authorization | Correct but inline | 72 routes self-check; no scopes or policy layer (F-09) |
| 4 | Database & migrations | Works, money unsafe | `Float` money (F-03); CI migrate job was dead (F-02); 43 models, migrations in use |
| 5 | Caching | Effective, undocumented contract | 3 places define headers; no privacy test (F-14) |
| 6 | Background jobs | Solid and unusually well-tested | 16 jobs, 4 schedulers, registry↔Inngest parity enforced by test |
| 7 | AI & memory | Broad, shallow trust | Provenance, expiry, retrieval weighting and injection defence all missing (F-15/16/17) |
| 8 | Security | Good baseline, real gaps | Headers/sanitizer/secret handling solid; SSRF, CSRF, forwarded-IP trust missing (F-05/06/07) |
| 9 | Payments | Careful design, unsafe arithmetic | Intent-first + event ledger + signature verification are strong; `Float` undermines them (F-03) |
| 10 | Sports | Multi-source, well-factored | Normalisation and identity tests exist; provider freshness/source-per-field not recorded (Phase N) |
| 11 | Radio | Purpose-built, ad-aware | Reconnect floors and station memory exist; no health export to diagnostics (Phase N) |
| 12 | PWA & offline | Functional | Install, offline shell, push handled; no offline sync/conflict model (F-22) |
| 13 | Multiplatform readiness | Web-only | No `/api/v1`, no DTOs, no device registry (F-21/22) |
| 14 | Testing & CI | Suite strong, gates weak | 1137 tests green (and better than documented); build DB-coupled (F-01); no security gates (F-12) |
| 15 | Observability | Logs, no metrics | Sentry + `createLogger` + `/api/status`; no latency/hit-rate/job series (F-24) |
| 16 | Documentation | Was drifting | Ten corrections applied; drift now enforced by test |

**Worth stating plainly, because the audit should not read as an indictment:** the existing
engineering is above average in the places that are hardest to get right. The cron registry and
Inngest wiring are kept in parity by a test. Payment events are claimed in a ledger so a retry cannot
extend a membership twice, and a callback that fails verification is refused rather than trusted.
Rate-limit keys distinguish users from IPs so shared NAT does not throttle a signed-in writer.
Container-query cookies and authorisation headers are excluded from edge caching. The brain's write
path files proposals instead of executing them. Those are the load-bearing decisions, and they are
already right — this audit is mostly about the missing edges around them.

---

## 5. Phase map (from the required implementation order)

Status reflects `docs/phase-reports/PHASE-B-E.md`.

| Order | Phase | This audit's findings | Blocked by | Status |
| --- | --- | --- | --- | --- |
| A | Baseline audit + docs | F-02, F-25, F-27; baseline recorded | — | **done** |
| B | Contracts: context, errors, `/api/v1` | F-08 | A | **done** — contract layer + 4 v1 routes; 396 v0 call sites migrate in Phase M |
| C | Centralized authorization | F-09 | B | **done** — `src/lib/policies`; 72 v0 routes still self-check |
| D | Rate limits, CSRF, SSRF, upload, admin | F-05, F-06, F-07, F-10, F-20 | C | **partial** — F-05/F-06/F-07 done and tested; F-10 (MFA) and F-20 (upload magic bytes) outstanding |
| E | DB integrity, money, transitions, legacy guard | F-03, F-03b | A | **partial** — money primitive, machines, guard, migration and backfill landed; payment *writers* still populate Floats |
| F | Queries, caching, retention | F-13, F-14, F-23 | E |
| G | AI memory provenance, injection defence, retrieval | F-04, F-15, F-16, F-17 | B |
| H | Approval revalidation, bounded self-healing | F-18, F-19 | G |
| I | Engineering Mind, read-only | — (new capability) | H |
| J | Sandboxed execution | — (new surface) | I |
| K | Patch + PR preparation | — | J |
| L | Frontend a11y, perf, offline, PWA | F-11 | D |
| M | Versioned multiplatform API | F-21, F-22 | B, C |
| N | Payments, sports, radio, providers | F-03 (arithmetic), F-06 (SSRF) | E, F |
| O | Observability, CI security, release safety | F-01, F-12, F-24 | D, M |

Nothing in order I–K may begin before H, and H must not begin before G. The audit recommends the
sequence be respected literally: the autonomous-capability phases are the ones whose correctness
depends on the guardrails the earlier phases install.

---

## 6. Known limits of this audit

- `npm ci` and `npm run test:e2e` were not executed locally (reasons in §1). The e2e suite's *result*
  is therefore unverified in this environment; its *existence and CI wiring* are verified.
- Findings F-05, F-06, F-07, F-09 and F-10 are established from the absence of a control (grep across
  the whole `src/` tree) rather than from a failing test. Absence-of-control findings can miss an
  indirect mitigation; each is re-checked at the start of its phase.
- `Float` money (F-03) is a **type-level** finding. Whether it has already produced a real discrepancy
  in `PaymentEvent` reconciliation is a data question and was **not** investigated — this audit did not
  read production rows.
- No production data, credentials, `.env` values or payment payloads were read at any point.
