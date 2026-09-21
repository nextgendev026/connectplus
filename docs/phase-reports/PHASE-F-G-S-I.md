# Phase reports — F (queries/cache/retention), G (memory & evidence), S1–S3 (Studio), I1 (integrations)

Branch `phase-a/baseline-audit-and-docs` · base `main` · 2026-09-21

Written in the 18-point format the briefs ask for. Where a point is "none" it is stated once rather
than omitted, so the report can be walked as a checklist. Two things this document does **not** do,
stated up front because the alternative is a report that reads as complete when it is not:

1. **The Studio UI was not redesigned.** Phase S5 (mobile-first three-panel/bottom-sheet layout) is
   not implemented. The save state is now visible on every breakpoint and conflicts have a banner,
   but the layout itself is unchanged.
2. **Playwright was understated, then run.** Playwright *does* exist here — six specs
   (`studio-checks`, `studio-pilot-review`, `mobile-first`, `sports-responsive`, `ads-pipeline`,
   `smoke`) — and an earlier draft of this document claimed otherwise. The bundled chromium cannot be
   downloaded in this environment (`playwright install` fails on the network), but
   `playwright.config.ts` already carries a `PLAYWRIGHT_CHANNEL` escape hatch and the machine's Chrome
   is installed, so the suite runs with `PLAYWRIGHT_CHANNEL=chrome`. **All 8 specs in
   `studio-pilot-review.spec.ts` pass, including the two stale-reply tests added here**, so the
   refusal, the opt-in and the forced-undo path are verified in a browser and not merely asserted at
   the unit level.

Validation, run just before writing this: `npm run typecheck` exit 0 · `npm run lint` **0 errors**,
96 warnings (unchanged from baseline) · `npm test` **102 files, 1653 passed, 1 skipped** (baseline
98/1511 → +4 files, +142 tests) · `npm run build` not runnable here (F-01: needs a live database on
the prerender path).

---

# Phase F — queries, cache and analytics retention

## F.1–F.2 Summary

The intelligence layer's regional and growth reports were the most expensive thing the platform did,
for a reason no call site revealed: **they ran a query per region and a query per day.** Three
distinct shapes:

| Call | Before | After |
| --- | --- | --- |
| `getRegionalIntelligence()` | 2N queries, **N unbounded** | 2 grouped scans |
| `getGrowthReport()` | 3 × 30 = **90 round trips** | 3 grouped scans |
| `analyzeUsers()` | 1 + 2N **plus** `findMany({select:{authorId}})` over every published post | `COUNT(DISTINCT "authorId")` |
| `getPlatformStats()` | 1 + 2N | 2 grouped scans |

Cost grew with the size of the platform, permanently, without anyone editing the file. Two grouped
scans are constant whether there are 4 regions or 400.

Notably, "one clever query with CTEs" was **rejected** on purpose: three narrow `GROUP BY
date_trunc(...)` scans hit three indexes, where a joined statement forces a plan that scans the
largest table and then joins it. The round-trip count is what mattered.

## F.3 Files created

| File | Purpose |
| --- | --- |
| `src/lib/query-budget.ts` | Four named budgets, client-side timeouts, slow-query log, health line |
| `src/lib/queries/analytics.ts` | `regionalBreakdown`, `platformTotals`, `dailySeries`, `weeklyTrend` |
| `src/lib/cache-policy.ts` | Registry of 11 cache resources + `guardCacheWrite`, wired into the write path |
| `src/lib/analytics-retention.ts` | Retention policy table, daily rollup, bounded prune, privacy deletion |
| `prisma/migrations/20260921130000_daily_metric/migration.sql` | `DailyMetric` rollup table |
| tests | `query-budget` (14), `cache-policy` (23), `analytics-retention` (30) |

## F.4 Files modified

`src/lib/neural-mind.ts` (four methods rewired; `learnFromUrl` now uses `safeFetch`; per-entity
creates batched into `createMany`), `src/lib/redis.ts` (the guard), `src/lib/cron-jobs.ts` +
`src/lib/cron-schedule.ts` + `src/inngest/functions.ts` (the `analytics-retention` job),
`README.md` (job table).

## F.5 Migrations

One, additive: `DailyMetric`, with a unique key on `(metric, dimension, day)` so a re-run of a
partial rollup updates rather than double-counts. **Aggregation has to ship with pruning** — the
growth charts read `PageView`, so pruning without first writing a rollup would delete the history
the console displays. That ordering is enforced in code (`pruneAnalytics` refuses without an
`aggregated` acknowledgement), not documented.

## F.6–F.8

No new env vars (two retention windows are overridable: `RETENTION_PAGEVIEW_DAYS` et al.). No new API
contracts or permissions.

## F.9 Security and correctness improvements

- **Cache privacy became enforceable.** `redisSetEx` accepts any key from any caller; nothing stopped
  a user-scoped value entering a shared layer. `guardCacheWrite` now refuses it at the write —
  enforced centrally rather than by care at 40 call sites.
- **Two financial and governance tables are explicitly retained** (`PaymentEvent`, `ModerationLog`)
  with the reason attached, so the decision is visible rather than merely absent.
- Unread notifications are never pruned: a notification nobody has seen is a pending obligation.
- `learnFromUrl` was a **live SSRF primitive** — it took a URL from a human or a model and read it
  server-side, so `http://169.254.169.254/latest/meta-data/` was a legal argument.

## F.10–F.13 Tests

67 added, all passing. The ones worth naming: the overrun log is asserted bounded under 70 overruns;
the retention window resolves `0` to "keep everything" rather than "delete everything older than
now"; the cache registry is asserted to expose **exactly ten of twenty-one class/layer combinations**;
and `pruneAnalytics` is asserted to touch neither `findMany` nor `deleteMany` when the rollup has not
been acknowledged.

**One real defect found by the tests.** The cache-policy invariant "every TTL is inside the cache
layer's hard cap" failed on `job-heartbeat`: `lib/job-heartbeat.ts` asks for a **30-day** TTL and
`lib/redis.ts` `MAX_TTL_SECONDS` silently clamps every write to **24h**. The registry now records the
effective 24h and the clamp is recorded as **F-36**. Left unfixed deliberately — raising the cap
changes every cache write on the platform.

## F.14 Not run / not done

- The migration was not applied anywhere. It is additive and dormant.
- The remaining outbound fetches (image proxy, thumbnail recovery, RSS ingest) still use plain
  `fetch`; only `web-research` and `learnFromUrl` are converted (F-06 remainder).
- No materialised daily aggregates beyond what `dailySeries` computes on the fly.

## F.15 Known risks

The prune is opt-in per table and has never run against real rows. A first-ever prune of a large table
is capped at 20,000 rows per run and reports truncation, so the backlog drains over successive runs
rather than being one long transaction that could be killed midway.

## F.16 Rollback

Revert the commit. `DailyMetric` is additive and unread until the job runs; `DROP TABLE` restores the
prior state. The retention job is disabled by unsetting `RETENTION_*` (a value of `0` means "keep
everything").

## F.17 Manual configuration

Set `RETENTION_PAGEVIEW_DAYS` etc. to override a window. Nothing is required for the phase to be safe:
the default is 90/180/120 days on an opt-in table list.

## F.18 Recommended next

Phase G, as run.

---

# Phase G — memory provenance, untrusted content, retrieval and intent

## G.1–G.2 Summary

The hive could accumulate knowledge but had no vocabulary for *knowing* it. Every memory carried a
`confidence` float, which answers "how sure is the model" and none of the four questions that decide
an answer: where did this come from, is it still true, has anyone checked, and does it contradict
something we hold.

Four modules, each a separate concern:

| Module | Answers |
| --- | --- |
| `lib/memory-provenance.ts` | Verification vocabulary, volatility/expiry, contradiction detection, visibility, prompt summarisation |
| `lib/untrusted.ts` | How external text enters a prompt, and what it cannot do |
| `lib/retrieval.ts` | What reaches the prompt, in what order, and why |
| `lib/neural-intent.ts` (extended) | Confidence calibration, ambiguity, the mutation guard, learned-alias precedence |

## G.3 Files created

`src/lib/memory-provenance.ts`, `src/lib/untrusted.ts`, `src/lib/retrieval.ts`,
`prisma/migrations/20260921140000_memory_provenance/migration.sql`, and four test files (46 + 30 +
33 + 26 = 135 tests).

## G.4 Files modified

`prisma/schema.prisma` (`NeuralMemory`: 13 provenance columns, five indexes, three CHECK
constraints), `src/lib/hive-brain.ts` (`recall` now reads through `retrieveMemories`),
`src/lib/neural-intent.ts` (`scoreAllIntents` extracted; guard added).

## G.5 Migrations

Additive and dormant: every column is nullable or defaulted. The defaults are chosen to be the
*honest* classification for pre-existing rows rather than a flattering one — `verificationStatus`
defaults to `unverified`, because a memory whose provenance was never recorded has not been verified
and saying otherwise would launder it. Rollback statements are in the migration header.

## G.8 New contracts

`OutputMode = deterministic | model | degraded | unverified` is declared in `lib/studio/operations.ts`
for Phase S3. It is **not yet on the Studio API response** — see S.14.

## G.9 The design decisions worth naming

- **Expiry is computed, not trusted.** A row still marked `corroborated` whose `expiresAt` has passed
  is `expired` the moment it is examined. A sweep can fail, be disabled, or simply not have run since
  the moment passed.
- **Provenance weight is multiplicative** (state × reliability), so a high state cannot rescue an
  untrustworthy origin and a trusted origin cannot promote a claim nobody verified.
- **Contradiction detection is deliberately narrow** — same subject, different number only. A false
  positive destroys a memory; a false negative leaves the status quo.
- **`frameSources` does not claim to prevent prompt injection**, and says so in its own doc comment.
  It frames, detects and records. The load-bearing protections are architectural: tool selection is
  separate from generation, the approval boundary needs a human, and scopes are derived from an
  authenticated role.
- **The delimiter is a per-call nonce.** A fixed tag is trivially forged by content containing it.

## G.10–G.13 Tests

135 added, all passing. Two **real defects found by writing them**:

1. The `approval-bypass` pattern was `(approv|…)s?\b`, which **cannot match "Approval"** — the `\b`
   falls between `approv` and `al`. So the single most relevant phrase in the list, an attacker
   declaring that approval is not required, went undetected.
2. `retrieveMemories` tested `includeExpired` against the *rejected* case as well, so a caller asking
   for historical rates silently **reinstated claims an operator had explicitly disbelieved.**

And one design flaw restructured by a test: the contradiction pass originally stopped at `limit`, so
whether a disagreement was recorded depended on where the loser ranked. A contradicting memory scoring
third was never examined and the answer presented the winner as settled fact. Grouping now runs over
every eligible candidate and the limit is applied to representatives afterwards.

## G.14 Not run / not done

- `pgvector` search is **not** implemented. `PostEmbedding.pgVec` is declared
  `Unsupported("vector(384)")` and unused; retrieval still hashes embeddings. The abstraction is in
  place (`similarity` is an optional input to scoring) but no vector tier was added.
- No real embedding provider. F-16 remains open.
- Retention/deletion behaviour for provenance rows themselves is not implemented beyond the
  `expiresAt` index.

## G.15 Known risks

`hiveBrain.recall`'s `audience` parameter defaults to `operator`, matching current callers. A future
public surface **must** pass `audience: "public"` explicitly — the default is deliberate, but it means
the safety is a caller's responsibility rather than the default's.

## G.16–G.18

Rollback: revert; the columns can be dropped with the statements in the migration header, losing only
what they recorded. Manual configuration: none. Next: Phase H (approval revalidation) was **not**
run — see "What remains".

---

# Phase S1–S3 — Studio autosave integrity, revision conflicts and structured operations

## S.1–S.2 Summary

The brief names three product problems. All three are now fixed at the module level and wired into
the Studio, with the exact defect for each recorded.

**S-01 duplicate drafts — fixed.** The bug was a captured-value race, and it is worth stating
precisely because the fix is not the obvious one. `editingId` is *derived* from a create response, so
until React committed that update an in-flight save's closure still read `null` and issued a second
`POST`. A ref is read synchronously and cannot be stale, so `saveInFlightRef` refuses the second save
outright. A longer debounce would have narrowed the window without closing it.

Two further contributors were removed: the autosave effect called `loadMyStories()` after **every**
save (a full `GET /api/posts?mine=true&limit=50` per keystroke-save), and a failed save was swallowed
by `catch {}`.

**S-02 stale Copilot results — fixed in the pilot path.** `checkPilotStale` compares the staged base
against the live composer and reports which field moved; applying a divergent reply is refused until
the writer opts in, and when they do, the undo origin becomes the *current* draft rather than the
stale one.

**S-04 free-text suggestions — a correction to this report's first version.** The audit claimed the
Copilot returned free text and that a structured operation set had to be invented. **That was wrong.**
`lib/brain-pilot.ts` already defines `PilotOp` (`kind`/`text`/`find`), `reviewPilotEdits` already
builds a per-op diff, and `PilotReview` already stages every edit for individual accept/reject before
anything lands, with the ranges that were measured *before* the request travelling with the ops. The
planning prose described a gap that did not exist.

So `lib/studio/operations.ts` is a **second** operation model, not the first. That is worth naming
plainly: it has eight kinds and undo transactions where `PilotOp` has a smaller set, and the live
Studio path uses `PilotOp`. Two models for one job is exactly the drift these briefs exist to remove,
and the honest recommendation is to consolidate on one — not to wire the parallel one in beside it.

## S.3 Files created

| File | Purpose |
| --- | --- |
| `src/lib/studio/composer.ts` | `ComposerState`, save-state machine, hashing, idempotency key, staleness |
| `src/lib/studio/operations.ts` | The operation set, validation, application, undo/redo transactions |
| `src/lib/studio/save-ledger.ts` | Durable claim-then-complete idempotency ledger |
| `prisma/migrations/20260921150000_studio_save_claim/migration.sql` | `StudioSaveClaim` |
| tests | `studio-composer` (39), `studio-operations` (37), `studio-save-ledger` (24) = 100 |

## S.4 Files modified

`src/app/(public)/studio/page.tsx` (save guard, idempotency header, save-state display, error and
conflict banners, story refresh only on a new draft), `src/app/api/posts/route.ts` (claim / complete /
release), `prisma/schema.prisma`.

## S.5 Migrations

One, additive: `StudioSaveClaim`. It lives in Postgres rather than Redis **deliberately**:
`lib/cache-policy.ts` (Phase F) classifies anything scoped to one writer as user-scoped and refuses it
on a shared layer, correctly, and beyond privacy "cannot create a duplicate" has to survive a cache
eviction.

## S.6 API changes

`POST /api/posts` gains optional idempotency. With an `Idempotency-Key` header it claims, and answers:

| Outcome | Response |
| --- | --- |
| new | `201` with the post |
| key already completed | `200` with the existing post and `idempotent: true` |
| key in flight | `409` `SAVE_IN_FLIGHT` with `Retry-After: 1` |
| claim outlived its document | `409` `SAVE_CLAIM_STALE` |
| ledger unreachable | proceeds, and logs the degradation |

A request without the header behaves **exactly** as before, so the migration is deployable ahead of
the client and every other client is unaffected.

## S.7 UI changes

- The header status now shows the real save state (`All changes saved`, `Saving…`, `Save failed —
  …`, `Conflict — …`) with `role="status" aria-live="polite"`, instead of a hardcoded "autosave on"
  that was hidden below `sm` and so absent entirely on mobile.
- An amber banner on a failed save: *"This draft is not saved to the server"* with the reason and the
  reassurance that the local backup survives a reload. Autosave used to fail silently, so this state
  was previously indistinguishable from success.
- A separate amber banner on a conflict, naming the cause.

## S.9 Security and data-safety improvements

- A failed save can no longer look successful.
- A claim is released on failure, so a transient error does not permanently poison a key and refuse
  the writer's retry.
- A claim belonging to **another writer** never resolves to their draft, even though keys are
  per-session by construction.
- A key is read from a header with a bounded length and a character allowlist, because it becomes a
  primary key value and an arbitrary header is not safe to put there.

## S.10–S.13 Tests

100 added, all passing. Notable assertions: a second save while one is in flight is **refused**; a
save that completes while the writer kept typing stays **dirty**; a no-op `setContent` does not spend
a revision; a pure selection change is not an edit; one Ctrl+Z undoes a whole operation set; edits are
applied in **reverse document order** so a later operation does not shift an earlier one's offsets; an
ambiguous `find` is refused rather than resolved by taking the first occurrence; two overlapping
operations are refused; `claimCreate` never answers "existing" for an uncompleted claim; and
`maskSecretHint`/`providerCredentialStatus` are asserted never to contain a credential.

## S.14 Not run / not done — the honest list

- **Phase S4 (shared publish path and readiness report) is not done.** `publishPost` still builds its
  own payload, so publish and autosave validation can still drift. This is the largest remaining gap
  against the brief.
- **Phase S5 (mobile-first Studio UI) is not done.** No drawer, no bottom sheet, no status bar, no
  readiness panel, no revision timeline. The two banners and the save-state line are the whole of it.
- **The Copilot API still returns free text.** `bible-pilot`/`api/ai/studio` were not changed to emit
  `ComposerOperation[]`, and `PilotReview` still consumes `data.text`. The operation layer, its
  validation and its undo transaction are built and tested, and **no caller uses them yet** — which is
  the most important thing in this document to be clear about.
- `OutputMode` is declared and unused by the API.
- Draft recovery for a story opened with `?edit=` (S-07) is unchanged: the local backup is still
  ignored when a document is loaded.
- Article Forge, the writing-check rule packs and Copilot learning were not touched.
- Sports provider health (S-12) was not implemented.

## S.15 Known risks

- **The pilot path is revision-guarded; the rest of the Copilot is not.** `rewrite`, `continue`,
  `summarize`, `headline`, `tags`, `curate`, `assist`, `seo`, `plagiarism` and `optimize` write into
  `copilotResult`, which carries no revision or hash, so a slow answer can still arrive after the
  writer has moved on. Only `pilot` — the path that writes into the draft — is guarded.
- **Two operation models coexist** (`PilotOp` in the live path, `ComposerOperation` in
  `lib/studio/operations.ts`). This is a maintenance hazard and is listed as work item 1.
- The `StudioSaveClaim` table is written on every create. The opportunistic sweep is rate-limited to
  once an hour per instance rather than being a cron job — a deliberate choice, documented in
  `save-ledger.ts`, because a heartbeat that says "this household chore is late" is noise.

## S.16 Rollback

Each piece is separable. Reverting `studio/page.tsx` restores the previous client behaviour and leaves
the API's idempotency additive and inert. `DROP TABLE "StudioSaveClaim"` removes the ledger; the route
then always reports `unavailable` and proceeds, which is the documented degraded path.

## S.17 Manual configuration

None. The migration must be applied before the ledger does anything; until then every request sees
`unavailable` and proceeds exactly as before.

## S.18 Recommended next

Phase S3 wiring — make `api/ai/studio` return `ComposerOperation[]` and have `PilotReview` consume it
through `validateOperations` → `applyOperations`. That is the change that turns the tested operation
layer into the fix the brief asks for.

---

# Phase I1 — one provider registry

## I.1–I.2 Summary

Three modules answered "which AI providers exist" and disagreed: the gateway could route
`openrouter`/`opencode`, `settings.ts` offered `openaiApiKey`/`anthropicApiKey` fields, and
`integrations.ts` probed both as **AI provider health**. So an admin could store a key for a provider
the gateway will never call, from a console that offered the field, and then see the Integrations page
confirm it as provisioned. Two surfaces agreed a configuration worked while nothing could use it.

`src/lib/providers/registry.ts` is now the single source, and `settings.ts` and `integrations.ts`
derive from it.

## I.3 A correction to the audit, recorded because it matters

The audit's first version called `openaiApiKey` dead wiring. **It is not** — `lib/visual-studio.ts:96`
reads it to decide whether image generation runs at full quality. What was wrong is narrower: the
catalog hint claimed "AI headline/excerpt generation when provider is openai" (there is no such
provider), and the console probed it under the AI category.

So the registry models three categories rather than two: `routable` providers, `CREDENTIAL_CONSUMERS`
(with a `consumedBy` of `image-generation` / `none`), and `ABSENT_PROVIDERS`. `anthropicApiKey` is
genuinely read by nothing and is now labelled as such rather than silently deleted, so an existing
stored value stays visible instead of becoming invisible dead data.

## I.4 Files

Created: `src/lib/providers/registry.ts`, `tests/unit/providers-registry.test.ts` (38).
Modified: `src/lib/settings.ts` (hint derived from the registry; three hints corrected),
`src/lib/integrations.ts` (AI fields derived; a wrong provider name is now reported as wrong rather
than as degraded), `tests/unit/docs-drift.test.ts` (+4 assertions).

## I.5–I.8

No migrations, no env vars, no schema change. New contracts: `ProviderCredentialStatus` (a shape that
is *incapable* of carrying a secret — there is no field for a value), `validateCredential`,
`maskSecretHint`, `credentialFingerprint`.

## I.9 Security improvements

- A credential for a non-routable provider is refused at the write, naming the real reason.
- `maskSecretHint` reveals four trailing characters **only** for values of at least 12, because
  revealing four of eight characters is half the credential — the mistake a "masked" display usually
  makes.
- `providerCredentialStatus` is asserted, serialised and searched, never to contain the credential.

## I.10–I.13 Tests

38 added. Notable: the registry is asserted to expose **exactly** `["openrouter", "opencode"]`; the
masked hint is asserted null for short values; a `Bearer ` prefix is refused with the specific message
*before* the generic whitespace check, because it is the most common copy-paste mistake; and
`registryInvariants()` is asserted empty — which caught two real bugs, a false positive on `gemini`
(correctly both absent and known-unsupported) and `validateCredential` collapsing three distinct
refusals into one unhelpful "not a known provider".

The drift test now pins four consumers rather than only the documentation: the gateway union ↔ the
registry, the settings catalog ↔ the registry, integrations-derived fields, and — from the
integrations audit, I-03 — **every `managedBySetting` reference must resolve to a real catalog key**,
which is what made stale wiring detectable.

## I.14 Not done

I-02 (shared `requireAdmin` via `lib/policies`), I-03's typed references beyond the drift test, I-04
(the probe contract), I-05 (per-integration history), I-07 (central URL validation) and I-09 (the
wider test list) are **not** implemented. The registry was the one that removed a false confirmation,
which is why it went first.

## I.15 Known risks

`KNOWN_UNROUTABLE_NAMES` is a hand-maintained prose list. It is now checked against the routable set
rather than against every id, which fixes the false positive, but adding a name to it is still manual.

## I.16–I.18

Rollback: revert the registry and the two consumers; no schema or data change. Manual configuration:
none. Next: I-04/I-05 — extract a probe contract and record per-integration history, so an
intermittent provider is visibly intermittent.

---

# What remains, ranked

| Rank | Item | Phase | Why it matters |
| --- | --- | --- | --- |
| 1 | Consolidate `lib/studio/operations.ts` with `brain-pilot.ts`'s `PilotOp` | S3 | Two operation models exist for one job; the live path uses `PilotOp`, so the parallel one should be merged into it or deleted |
| 2 | Extend the staleness guard to the non-pilot Copilot actions | S2/S3 | `pilot` is now guarded; `rewrite`/`continue`/`summarize` stage into `copilotResult` with no revision check |
| 3 | Shared publish path + readiness report | S4 | Two payload builders still exist, so publish and autosave validation can drift; publish is irreversible in user-visible terms |
| 4 | Mobile-first Studio layout | S5 | The brief's clearest UX ask; largest diff, lowest behavioural risk |
| 5 | Approval-time revalidation and bounded self-healing | H | F-18/F-19; the approval boundary exists but a proposal's target is not re-read at approval time |
| 6 | Engineering Mind (read-only) | I/J/K | The "fourth intelligence domain"; the SSRF guard, query budgets and operation validation it would rely on are now in place |
| 7 | Provider probe contract + per-integration history | I-04/I-05 | An intermittent provider currently reads healthy between failures |
| 8 | Sports provider health and per-market calibration | S6 | Reporting only, on machinery that already exists |
| 9 | pgvector retrieval and a real embedding provider | G | F-16; the abstraction accepts a `similarity` input already |
| 10 | Frontend accessibility and PWA UX | L | Unstarted |
| 11 | Versioned `/api/v1` surface completion + OpenAPI | M | 4 of the required surfaces exist |
| 12 | Observability series (metrics, not logs) | O | F-24; in-process counters exist for query budgets, cache policy and intent accuracy but nothing exports them |

## Final validation

```
npm run typecheck   exit 0
npm run lint        0 errors, 96 warnings
npm test            102 files, 1666 passed, 1 skipped   (baseline 98 / 1511)
npm run build       not runnable — F-01, needs a live database on the prerender path
npm run test:e2e    PLAYWRIGHT_CHANNEL=chrome, studio-pilot-review.spec.ts — 8 passed (25.4s)
```

### The pilot staleness fix, in detail

The defect: `decidePilotEdit` and `keepAllPilotEdits` applied the staged ops against
`pilotReview.base` — the snapshot taken when the *request* went out — and wrote the result over the
live composer. Anything typed while the review panel was open was discarded, and because
`commitComposer`'s undo captured the same old snapshot, **Undo restored the pre-review draft and
destroyed the newer work permanently.** The writer's own paragraph was the only casualty and there was
no way back to it.

What replaced it:

- `checkPilotStale(staged, current)` in `lib/studio/composer.ts`, recomputed every render from the live
  composer, so the warning appears the moment the writer types and disappears if they undo back.
- A refusal in both apply paths before `applyPilotOps` runs, so a keyboard shortcut cannot bypass it.
- An explicit opt-in (`I understand — apply against the current draft`) surfaced in `PilotReview`
  *above* the diffs, because on a stale reply every diff below is rendered against text the writer has
  since changed.
- `undoOrigin`, which becomes the current draft once the opt-in is given — the decision that makes
  "apply anyway" recoverable instead of merely warned about.

One test caught a genuine inconsistency in my own first cut: `hashPilotBase` trimmed the title and
excerpt while `checkPilotStale` compared them raw, so the two could disagree about whether anything
had changed. The body is intentionally compared raw (an inserted blank line moves every offset a
selection rewrite addresses) and the other three canonically; both now share one canon.

Not covered: the non-pilot Copilot actions (`rewrite`, `continue`, `summarize`, …) still stage into
`copilotResult` with no revision check. They are read-only suggestions the writer copies, so the blast
radius is smaller, but "smaller" is not "none".

Not stated: that the platform is secure, complete or bug-free. What is stated: the tests above pass,
the defects named in this document were reproduced before and after their fixes, and the list in
"What remains" is the honest gap.
