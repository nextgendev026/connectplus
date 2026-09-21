# Phase reports B–E

Branch `phase-a/baseline-audit-and-docs` (continued) · base `main` @ `1d3f11b` · 2026-09-21

Four phases, implemented in the order §22 of the brief requires: B (application contracts), C
(centralized authorization), D (security hardening), E (database and data integrity). Each section
below covers the 18 points the brief asks a phase report to contain; where a point is "none" it is
stated once per phase rather than omitted, so the report can be walked as a checklist.

Two things this run did **not** do, and would rather say plainly than imply otherwise:

1. No Phase E payment *writer* was rewritten beyond the Daraja amount check. The primitive, the
   migration, the guard and the backfill are in place; moving `Tip`, `CreatorPayout`,
   `SubscriptionPlan` and the intent writer onto integer arithmetic is mechanical but touches
   settlement code that cannot be integration-tested here. See §E.17.
2. Phase D's admin-security (MFA, session revocation) and upload magic-byte work is **not done**. The
   SSRF, CSRF and rate-limit-attribution work — the three that were live, exploitable defects — is
   done and tested.

---

# Phase B — standardize application contracts

## B.1–B.2 Summary

One error vocabulary and one response envelope, enforced by a wrapper rather than by convention, plus
the first four `/api/v1` routes as the reference implementation. The existing 111 routes are untouched:
v1 is additive, and the brief explicitly forbids migrating everything at once.

The design decision worth naming: `apiHandler` is what makes the contract real. A route that throws a
Prisma error out of a `findMany` still answers with an envelope and a request id, because the catch
lives in one place instead of 111.

## B.3 Files created

| File | Purpose |
| --- | --- |
| `src/lib/errors/index.ts` | The code union, status map, `AppError`, and the only place a failure becomes a body |
| `src/lib/request-context/index.ts` | requestId / actor / platform / versions / locale / timezone |
| `src/lib/contracts/index.ts` | Envelope, metadata, cursors, response validation, `apiHandler`, `NO_STORE` |
| `src/lib/queries/posts.ts` | Keyset-paginated published-post read, shared by v1 |
| `src/app/api/v1/posts/route.ts` | Public feed, cursor pagination, response validated |
| `src/app/api/v1/notifications/route.ts` | Reader-scoped feed, 401 when anonymous |
| `src/app/api/v1/auth/session/route.ts` | Identity + derived scopes |
| `src/app/api/v1/health/route.ts` | Version and client echo, no DB |
| `tests/unit/api-contracts.test.ts` | 29 tests |

## B.4 Files modified

`src/lib/api-validation.ts` (400s now use the shared envelope — this covers the 12 routes already
calling `validateBody`), `src/lib/api-response.ts` (was unused; now a deprecation shim emitting the one
canonical shape, so a second shape cannot circulate).

## B.5 Database migrations / B.6 env vars / B.7 permissions

None. Phase E owns the migration; Phase C owns permissions.

## B.8 New API contracts

`/api/v1/health`, `/api/v1/posts`, `/api/v1/notifications`, `/api/v1/auth/session`.
Success is `{ data, meta }` (+ `pagination`); failure is `{ error: { code, message, details, requestId } }`.
The two are disjoint, which is asserted.

## B.9 Security improvements

Unexpected errors can no longer disclose anything: `INTERNAL_ERROR` and `DATABASE_UNAVAILABLE` always
answer with a fixed sentence, whatever message the call site passed, and the real text goes to the log
with the request id. Before this, an unhandled Prisma error was one `error.message` away from naming a
connection string.

## B.10–B.13 Tests

29 added, all passing. Notable: a stack trace and a connection string are asserted *absent* from a 500
body; a spoofed `x-request-id` is replaced rather than echoed; a cursor that is malformed, oversized or
not a string is refused without failing the request; an over-long `search` is refused before it reaches
the database.

## B.14 Not run

`npm run build` and `npm run test:e2e` — unchanged from Phase A (F-01: the build is blocked by a live
database on the prerender path).

## B.15 Known risks

- The 396 v0 error call sites are unchanged. A client using v0 sees the old shapes; that is the point
  of the additive approach, but "one consistent shape" is only true of v1 until Phase M.
- `posts` search still does an unindexed `contains` across three text columns (F-13/F-23 territory).

## B.16–B.17 Rollback / manual configuration

Revert the commit. `/api/v1` is additive, so nothing else depends on it. No manual configuration.

## B.18 Recommended next

Phase C, as run.

---

# Phase C — centralized authorization

## C.1–C.2 Summary

`src/lib/policies` replaces 72 routes' worth of inline role checks with named predicates and a scope
table. Two properties are load-bearing and tested:

1. **Scopes are derived, never asserted.** `scopesForRole` is a pure function of the role that
   `auth.ts` resolves from the database. A client cannot send a scope list; the `scopes` array it
   receives from `/api/v1/auth/session` is for its own UI, and enforcement re-derives it.
2. **Deny is the default.** An unrecognised role holds nothing — it does not fall back to `USER`.

## C.3–C.5 Files

Created: `src/lib/policies/index.ts`, `tests/unit/policies.test.ts` (18 tests).
Modified: `src/app/api/v1/auth/session/route.ts` (now derives scopes; no longer builds its own 401).
Migrations, env vars: none.

## C.7–C.9 Contracts, permissions, security

Twelve scopes (`posts:read|write`, `moderation:write`, `payments:read|write`, `ai:use|propose|approve`,
`operations:diagnose|repair`, `deploy:staging|production`). An `ADMIN` deliberately does **not** hold
`ai:approve`, `payments:write` or either `deploy:` scope — approving the brain's own proposals, moving
money and deploying stay with `SUPER_ADMIN`, which is the two-person boundary the approval queue exists
to enforce. `requireOwnership` treats a missing owner as a refusal, not as public.

## C.10–C.13 Tests

18 added, all passing: escalation (admin ⊃ user, superadmin ⊃ admin), refusal of every dangerous scope
for `ADMIN`, 401-vs-403 distinction, unknown role holds nothing, unowned row refused, unverified account
refused only where asked.

## C.14 Not run

The 72 existing routes and 31 admin routes were not converted. Converting them is the safe way to do it
(one at a time, with the route-inventory test from §4.C), but it is not what this phase's code change
was.

## C.15 Known risks

- Until the v0 routes are converted, authorization is *available* centrally but still applied locally
  in most places. The audit's F-09 is therefore only partly closed, and the phase map says so.
- `requireReauthentication` exists and is tested at the policy level, but nothing calls it yet: it
  belongs on the Tier-3 actions that Phase H introduces.

## C.16–C.18

Rollback: revert. Manual configuration: none. Next: Phase D, as run.

---

# Phase D — security hardening

## D.1–D.2 Summary

Three live, exploitable defects closed, each with the refusal set enumerated in tests.

**SSRF (audit F-06).** `src/lib/safe-fetch.ts` is now the only way this application fetches a URL it did
not choose. Two holes mattered: `redirect: "follow"` meant the URL we validated was not the URL we
fetched, and nothing checked resolved addresses, so an RSS item pointing at `169.254.169.254` turned
the importer into a credential-disclosure tool. Redirects are now followed manually and re-validated,
and **every** resolved address is checked, because a name answering with one public and one private
record is a bypass.

**CSRF (F-07).** Cookie-authenticated mutations must present an origin that is ours. The rule is
deliberately narrow: safe methods pass, a request with no `Cookie` passes (nothing to forge with — which
is what keeps native clients and service callers working), verified webhooks and shared-secret service
calls are exempt, and everything else must match.

**Rate-limit attribution (F-05).** The anonymous key was the *first* value of `x-forwarded-for` — a
header the caller sets, so rotating one header minted a fresh bucket per request and every anonymous
ceiling was bypassable. Now the platform's own header is preferred and an unattributable caller is
bounded by a **shared** bucket as well, so a spoof buys nothing.

## D.3–D.4 Files

Created: `src/lib/safe-fetch.ts`, `tests/unit/safe-fetch.test.ts` (30 tests),
`tests/unit/proxy-security.test.ts` (19 tests).
Modified: `src/proxy.ts` (identity resolution, CSRF, shared ceiling, 429 in the shared envelope, more
rate-limit names), `src/lib/web-research.ts` (all outbound reads through the guard; `timedFetch`
removed).

## D.5–D.8

No migrations, no env vars, no new contracts. One behaviour change: `src/proxy.ts` now answers 403 and
429 in the API's error envelope instead of `{ error: "..." }`. Nothing consumed the old body (verified
before the change).

## D.9 Security improvements

As above, plus: the 30-minute `AbortSignal`-style timeout is now enforced per hop, response bodies are
capped while being read (not from a `Content-Length` claim), and media types are restricted per call
site.

## D.10–D.13 Tests

49 added, all passing. The SSRF suite walks every blocked IPv4 range **and its neighbours** (`126.255.255.255`
and `172.32.0.0` are public; a check that refuses them breaks legitimate feeds), the non-canonical
spellings of loopback (`127.1`, `2130706433`, `0x7f.1`), IPv4-mapped IPv6 (`::ffff:169.254.169.254`),
zoned link-local, and a redirect chain into a private range — which is the case a `follow`-based
implementation cannot catch.

## D.14 Not run / not done

- **F-10 (MFA, reauthentication, session revocation) is not implemented.**
- **F-20 (upload magic bytes) is not implemented** — uploads still validate size, per-type caps,
  storage quota and client-declared MIME, and still do not sniff content.
- **F-06's remaining call sites**: `web-research` is converted; the image proxy, thumbnail recovery and
  RSS ingestion still use plain `fetch`.

## D.15 Known risks

- The CSRF rule depends on `Origin`/`Referer` being present, which every browser sends. A future native
  client that sends cookies *and* no origin would be refused; the correct fix then is a non-cookie auth
  scheme, not a hole in this check.
- The shared unattributable bucket is a deliberate trade: during a flood, anonymous traffic competes for
  one ceiling. That is the right direction for a limit whose job is protecting the origin, and it is the
  reason the multiplier is 8× rather than 1×.

## D.16–D.18

Rollback: revert `src/proxy.ts` alone to restore the previous middleware. Manual configuration: none.
Next: Phase E, as run.

---

# Phase E — database and data integrity

## E.1–E.2 Summary

**The finding that justified the phase was not in the plan.** Reading the payment callbacks to decide
where integer arithmetic mattered most turned up
`Math.abs(callback.amount - intent.amount) > 1` in the Daraja callback: a tolerance of one **major**
unit — a whole shilling, or a whole dollar on the USD-priced plans — plus a `!= null` guard that skipped
the comparison entirely when the payload declared no amount. A `$499` callback against a `$500` plan was
accepted and a year of membership granted. Both halves are now exact (`amountMismatch`), and a missing
amount is a mismatch rather than agreement. That is a deliberate behaviour change.

Alongside it: exact money arithmetic (`src/lib/money.ts`), explicit lifecycle validators
(`src/lib/state-machines.ts`), the legacy-database guard (`src/lib/db-target.ts` +
`scripts/assert-db-target.ts`), and an additive migration with a backfill.

## E.3 Files created

| File | Purpose |
| --- | --- |
| `src/lib/money.ts` | Exact minor-unit arithmetic; strict and rounding parsers; fee split; rail rounding |
| `src/lib/state-machines.ts` | Seven lifecycle machines with a total, closed state set |
| `src/lib/db-target.ts` | Legacy-project classification (dependency-free, so a migration can use it) |
| `scripts/assert-db-target.ts` | The pre-migration guard, exits non-zero |
| `scripts/backfill-money-minor.ts` | Idempotent, `--dry-run`-able Float → minor-unit backfill |
| `prisma/migrations/20260921120000_money_minor_units/migration.sql` | Additive columns + CHECK constraints |
| `tests/unit/money.test.ts` (31), `tests/unit/state-machines.test.ts` (26), `tests/unit/db-target.test.ts` (11) | |

## E.4 Files modified

`prisma/schema.prisma` (nullalbe `*Minor` columns on `PaymentIntent`, `SubscriptionPlan`, `Tip`,
`CreatorPayout`), `src/app/api/payments/daraja/callback/route.ts`, `package.json` (guard wired in front
of `db:push`, `db:migrate`, `db:migrate:prod`, `db:migrate:deploy` and `vercel-build`),
`scripts/tsconfig.script.json`.

## E.5 Database migrations

One, **additive and dormant**: every new column is nullable, nothing reads them, so deploying it cannot
change behaviour. Note that the migration file is written by hand rather than generated by
`prisma migrate dev` — that command needs a shadow database, and generating a migration against a live
project is precisely the risk this phase is about. `prisma validate` passes and `prisma generate`
succeeds, so the schema and client are consistent.

The CHECK constraints (`>= 0`, known currency) are not modelled by Prisma; they are intentional and
documented in the migration. One constraint that looked obviously right was **removed** after
consideration: `feeAmountMinor <= amountMinor` would refuse a legitimate platform share above 50%.

## E.6 New environment variables

None. `MPESA_KES_PER_USD` keeps its existing meaning; `rateHundredths()` is the one-line bridge from a
whole-number rate to the scaled integer the conversion needs.

## E.7 New API contracts

None.

## E.8 New permissions

None.

## E.9 Security improvements

- A verification that could not fail (the amount tolerance) now can.
- A migration aimed at the legacy read-only project is now refused by code, before the tool runs, in
  front of every migration command including `vercel-build` — the previous control was a paragraph in
  `AGENTS.md`.
- The guard checks `DIRECT_URL` as well as `DATABASE_URL`, because Prisma migrates over the direct
  connection; a guard that inspected one of them would have a hole in the place that matters.
- Money can no longer silently lose precision: a strict parse refuses a third decimal place on a
  provider declaration, and an overflow throws rather than rounding.

## E.10–E.13 Tests

68 added, all passing. The ones worth naming: `fee + net === gross` is asserted across 11 rates × 12
grosses including values that do not divide evenly; a one-cent and a one-dollar difference are both
refused; a payload with no amount is refused; an unknown status is a refusal rather than a pass;
`paid → paid` is refused; and the guard was exercised **as a program** in four configurations (legacy
refuses, active passes, mixed refuses on `DIRECT_URL`, unset passes).

## E.14 Tests not run and why

- No integration test against a real database: the migration was not applied anywhere. It is additive
  and dormant by construction, and applying it is a decision for the operator (E.17).
- `scripts/backfill-money-minor.ts` was executed only against an unreachable database, to confirm it
  fails loudly (it exits 1 with a clear message) rather than silently. Its happy path has never run
  against real rows.

## E.15 Known risks

1. **The migration has not been applied.** It must run before the backfill, and the backfill before any
   writer starts trusting `*Minor`.
2. **The payment writers still compute in Floats.** `money.ts` is the authority now, but `Tip`,
   `CreatorPayout` and the subscription pricing path do not call it yet, so the Float columns remain the
   de-facto source for everything except the amount check that was fixed.
3. **The backfill is lossy in one direction only** (Float → 2dp, half-up). Rows it cannot read are
   reported with their ids rather than guessed at, and the count is a to-do list.
4. `sportsPrediction` settlement is deliberately excluded from the state machines — the analyser
   re-settles picks in place, so marking `WON` terminal here would break a real path. Phase N owns it.

## E.16 Rollback

- Migration: `ALTER TABLE … DROP COLUMN` on the seven added columns; no data is lost because the Float
  columns they mirror are untouched. Full statements in the migration's header comment.
- Backfill: nothing to undo — it fills NULLs only, never rewrites a Float.
- Amount check: reverting restores the tolerance and the bug.
- Guard: remove the `db:guard` prefix from the scripts.

## E.17 Manual configuration still required

1. Apply the migration: `npm run db:backfill-money` is the only way to know a row was unreadable.
2. Run `npm run db:backfill-money -- --dry-run`, then for real, then check the unreadable-row report.
3. Decide when the Float columns stop being written (a later migration drops them), and in the meantime
   keep both in step in every writer that touches money — the drift between the two is the next thing to
   watch.
4. Move the remaining outbound fetches (image proxy, thumbnail recovery, RSS ingest) onto `safe-fetch`.
5. Implement upload magic-byte validation and the admin-security items (F-10, F-20), which Phase D did
   not reach.

## E.18 Recommended next phase

**Phase F (queries, caching, retention)** is next in the required order and needs no decision. Two things
from this phase deserve to travel with it:

- The `SubscriptionPlan` and intent writers should be moved onto `money.ts` **before** F's aggregation
  work, because a daily revenue aggregate computed from Floats reproduces the float error in a table
  nobody will think to re-derive.
- The unused index situation is now visible from two directions: `Post` has no `@@index` that serves
  `(status, moderationStatus, createdAt)` — the exact keyset the new v1 feed pages on — and the search
  path scans three text columns. Both are F's subject and both were found by writing Phase B's query.

---

## Definition of Done — position after Phase E

| Criterion | Status |
| --- | --- |
| TypeScript passes | ✅ |
| ESLint passes | ✅ 0 errors |
| Unit tests pass | ✅ 1309 passed, 1 skipped (88 → 92 files) |
| Build passes | ❌ F-01, environment (unchanged) |
| E2E passes where available | ⬜ not runnable here (F-01) |
| No secrets committed | ✅ `.env.example` only |
| All sensitive routes have centralized authorization | ❌ available (Phase C) but applied in 4 v1 routes only |
| Distributed rate limiting active | ⚠️ real Redis-backed limiting, so **no** — it was never in-memory-only, and the spoofable key is now fixed |
| SSRF protection active | ⚠️ `web-research` converted; image proxy, thumb recovery, RSS ingest outstanding |
| Webhooks verified and idempotent | ✅ unchanged, and the amount check is now exact |
| Money uses safe arithmetic | ⚠️ primitive, migration, guard and one critical comparison done; writers outstanding |
| Database migrations are guarded | ✅ `db:guard` in front of every migration command including `vercel-build` |
| AI memories have provenance and expiry | ❌ Phase G |
| External content treated as untrusted | ⚠️ sanitised and now SSRF-guarded where it is read |
| AI mutations require approval | ✅ unchanged |
| Approval targets revalidated | ❌ Phase H |
| Self-healing bounded and verified | ⚠️ F-19 — Phase H |
| Public caches cannot hold private responses | ⚠️ `NO_STORE` on the two reader-scoped v1 routes; policy still untested (F-14) |
| API contracts documented | ✅ envelope + metadata + cursors on `/api/v1` (OpenAPI is Phase M) |
| Versioned endpoints for clients | ⚠️ 4 of the required surfaces |
| Offline sync / PWA / payments / sports / radio / observability | ❌ Phases L, M, N, O |
| Every patch reviewable | ✅ |
| No automatic production deploy from an AI session | ✅ none performed |
