# Phase A report — baseline audit and documentation correction

Branch `phase-a/baseline-audit-and-docs` · base `main` @ `1d3f11b` · 2026-09-21

---

## 1. Phase completed

Phase A — **baseline audit and documentation correction**. No later phase was started; none was
skipped ahead to.

## 2. Summary of implementation

Two things: an honest baseline was established and recorded, and ten documentation claims that
disagreed with the code were corrected.

The baseline exposed something the plan had not anticipated. `npm run lint` fails on `main` with two
real errors, and lint is the step the `migrate` CI job is gated behind — so **`prisma migrate deploy`
has not been running on push to `main`**. That is a live operational defect, not a linting nuisance:
the schema the code expects and the schema the database has were free to diverge with nothing
reporting it. Both errors are fixed and lint now passes.

A drift test now pins the relationships that had rotted (Next.js major, routable providers, the cron
registry ↔ README job table, the env checklist ↔ the keys the code reads, no hard-coded counts). It
was verified by deliberately reintroducing the original `Next.js 15` claim and confirming the test
fails with a message that names both sides.

## 3. Files created

| File | Purpose |
| --- | --- |
| `docs/MODERNIZATION-AUDIT.md` | Phase A deliverable: 29 findings, severity + evidence + fix + complexity + test + rollback, across all 16 areas |
| `docs/phase-reports/PHASE-A.md` | this report |
| `tests/unit/docs-drift.test.ts` | 8 assertions keeping prose and code from diverging again |
| `docs/INTELLIGENCE-HARDENING-PLAN.md` | (already written, now subordinate) the detailed plan for the AI phases G–K |

## 4. Files modified

| File | Change |
| --- | --- |
| `src/proxy.ts` | one `prefer-const` fix; rate limits, keys and the Redis/in-memory fallback are unchanged |
| `tests/unit/brain-operations.test.ts` | renamed a loop variable that shadowed `module` |
| `eslint.config.mjs` | ignore `convex/_generated/**` and `.freebuff/**` |
| `ARCHITECTURE.md` | Next 16; provider truth; endpoint count removed; four-scheduler table |
| `README.md` | provider truth; job table now all 16 registry entries with real crons; test count removed |
| `AGENTS.md` | de-duplicated the Supabase section; added a reading order and a Phase E caveat |
| `DEPLOYING.md` | AI key row corrected; the dead-migrate-job defect documented |
| `.env.example` | added the AI provider section (the checklist omitted the only two providers that work) |

## 5. Database migrations

**None.** No schema change, no `db push`, no `migrate deploy`. Nothing in Phase A touches the database.

## 6. New environment variables

**None added.** `.env.example` now *documents* `OPENROUTER_API_KEY` and `OPENCODE_API_KEY`, which the
code has always read; no new variable is introduced, and no value was written.

## 7. New API contracts

**None.** Error-envelope and `/api/v1` work is Phase B.

## 8. New permissions

**None.** The authorization layer is Phase C.

## 9. Security improvements

- `.env.example` no longer implies that `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` enable AI capability,
  narrowing the set of credentials an operator is invited to spend.
- No secrets were read, printed, or committed. `.env.example` is the only env file touched, and it
  holds placeholders only. Verified: `git status` lists no `.env*` other than `.env.example`.
- The two real lint errors were fixed, restoring the gate that would have caught a *future* problem —
  the CI check itself is the security control, and it had been red.

## 10. Tests added

`tests/unit/docs-drift.test.ts` — 8 tests:

1. Next.js major stated in every doc equals the one `package.json` pins.
2. The `AiProviderName` union equals the implemented gateway records, and every routable provider is
   named in `README.md` and `ARCHITECTURE.md`.
3. No doc *offers* a provider the gateway cannot route (a mention is allowed only in a sentence that
   says it is not in use).
4. Every `CRON_JOBS` id appears in the README scheduled-jobs table, and the table invents no job.
5. Every `*_API_KEY` `ai-provider.ts` reads appears in `.env.example`; the checklist never lets an
   operator assign a key the gateway cannot use.
6. No doc hard-codes an endpoint or test count.
7. `AGENTS.md` contains the Supabase section exactly once.
8. The audit exists and is referenced from `AGENTS.md`.

## 11. Commands executed

```
git checkout -b phase-a/baseline-audit-and-docs
npm run typecheck      (before and after)
npm run lint           (before and after; before = 718 errors)
npm test               (before and after)
npm run build          (recorded as blocked by the environment)
npx eslint src tests convex workers scripts   (CI-equivalent, to isolate real errors from noise)
npx vitest run tests/unit/docs-drift.test.ts
git status / git diff --stat
```

`npm ci` was **not** run: it deletes and reinstalls `node_modules` for no new information here, and CI
already runs it on every push. `npm run test:e2e` was **not** run: it needs a live server and a
reachable database, and the local build cannot complete (F-01).

## 12. Tests passed

| Check | Before | After |
| --- | --- | --- |
| `npm run typecheck` | exit 0 | exit 0 |
| `npm run lint` | **exit 1 — 718 errors** | **exit 0 — 0 errors, 92 warnings** |
| `npm test` | 83 files, 1137 passed, 1 skipped | 84 files, 1145 passed, 1 skipped |
| `docs-drift.test.ts` | n/a | 8 passed |
| drift gate negative check | n/a | fails as designed |

## 13. Tests failed

None outstanding. Two transient failures occurred during the phase and were resolved:
`docs-drift.test.ts` first flagged the sports-source table's `demo` row as an undocumented cron job
(the reverse check is now scoped to the scheduled-jobs section), and `tsc` rejected a possibly-undefined
`next` version until it was defaulted. Neither was suppressed or skipped.

## 14. Tests not run and why

- `npm ci` — deletes and reinstalls `node_modules`; no diagnostic value, real risk to the working tree.
- `npm run test:e2e` — needs a live server plus a reachable database. `npm run build` cannot complete
  in this environment (finding **F-01**, Prisma connection-pool timeout while prerendering
  `/tags/government`), so the suite's precondition is absent. Its existence and CI wiring are
  verified; its result is not.
- `npm run build` — executed, **failed**, and recorded rather than hidden. The failure is environmental
  (DB pool), not a compile error: typecheck passes and the build reached prerender.

## 15. Known risks

1. **The migrate job is restored but unproven.** Lint passing again means `check` passes, which means
   the `migrate` job can run — but whether production schema is currently in sync was not checked, and
   could not be without touching the database. `npx prisma migrate status` should be run deliberately
   before Phase E adds a migration.
2. **`main` has no required status check.** Lint is green, but nothing prevents the next red gate from
   silently disabling migrations again. Tracked as Phase O.
3. **Two docs now record a defect that is still unfixed** (F-04: the `openaiApiKey`/`anthropicApiKey`
   settings remain in the admin console and the integrations probe). The documentation is honest about
   it, but an operator can still set a key that does nothing until Phase G.
4. **The audit's absence-of-control findings** (F-05 forwarded-IP trust, F-06 SSRF, F-07 CSRF, F-10 MFA)
   are established by searching for a control and not finding one. Each is re-checked at the start of
   its phase in case a mitigation exists in a form grep cannot see.
5. **Windows line endings.** Git reports that LF in the edited files will be normalised to CRLF on the
   next touch. The diffs themselves are correct; a later `git add` on a different platform may show
   line-ending churn.

## 16. Rollback instructions

Nothing is stateful, so rollback is a revert:

```bash
git checkout main
git branch -D phase-a/baseline-audit-and-docs
```

Per-file, if only part is unwanted: reverting `src/proxy.ts` and `tests/unit/brain-operations.test.ts`
restores the two lint errors (and the red gate); deleting the two `globalIgnores` entries restores lint
noise; the documentation files are independent of each other. **No database change and no deploy
happened, so no data rollback is required.**

## 17. Manual configuration still required

1. Run `npx prisma migrate status` against production and apply anything outstanding — the CI job that
   would have done it was dead until this phase.
2. Add a **required status check** on `main` for the `Build` workflow's `check` job (Phase O work, but
   it is a dashboard setting, so it needs a human).
3. Decide F-04: either route OpenAI/Anthropic through the gateway or remove them from the admin
   console. The audit recommends removing them and keeping two free gateways.
4. Decide whether `npm run build`'s dependency on a live database (F-01) is acceptable, or whether the
   DB-backed catalogue routes should be made build-independent.

## 18. Recommended next phase

**Phase E (database integrity, money types, transitions, legacy guard)** rather than Phase B.

The required order puts B (contracts) before E, and B is the better foundation in the abstract — but
Phase A changed the risk picture. CI's migration job has been dead, so the first thing that touches
the schema should be a deliberate, guarded migration, and Phase E is where `Float` money becomes exact
accumulated behaviour rather than a latent one. Phase E is also the only phase whose defect (F-03)
corrupts *stored* values: every day it waits, another row of `Tip.amount` or
`CreatorPayout.feeAmount` accumulates a float error that a later migration has to interpret.

**Recommendation: Phase E next, with the legacy-DB guard from §6.E written before the money migration
touches anything — the guard is what makes this migration safe on a database CI has not migrated.**

If the order is to be followed literally, Phase B is the alternative and is unaffected by Phase A.

## Definition of Done — position after Phase A

| Criterion | Status |
| --- | --- |
| TypeScript passes | ✅ exit 0 |
| ESLint passes | ✅ exit 0 (was failing) |
| Unit tests pass | ✅ 1145 passed, 1 skipped |
| Build passes | ❌ blocked by environment (F-01) — recorded, not hidden |
| E2E passes where available | ⬜ not runnable here (F-01); wired in CI |
| No secrets committed | ✅ `.env.example` only |
| Production credentials not exposed to the AI | ✅ nothing read |
| Centralized authorization | ⬜ Phase C |
| Distributed rate limiting active | ⚠️ present but spoofable (F-05) — Phase D |
| SSRF protection active | ⬜ Phase D |
| Webhooks verified and idempotent | ✅ already the case (ledger + signature check) |
| Money uses safe arithmetic | ❌ F-03 — Phase E |
| Migrations guarded | ❌ Phase E |
| AI memories have provenance and expiry | ❌ F-15 — Phase G |
| External content treated as untrusted | ⚠️ sanitised, not SSRF-guarded (F-06) |
| AI mutations require approval | ✅ already the case |
| Approval targets revalidated | ❌ F-18 — Phase H |
| Self-healing bounded and verified | ⚠️ bounded, verification deferred (F-19) — Phase H |
| Public caches cannot hold private responses | ⚠️ policy sound, untested (F-14) |
| API contracts documented | ❌ F-08 — Phase B |
| Versioned endpoints for clients | ❌ F-21 — Phase M |
| Offline sync with conflict handling | ❌ F-22 — Phase M |
| PWA behaviour tested | ⚠️ partially — Phase L |
| Integrations report health | ✅ already the case |
| Brain activity observable | ⚠️ logs and console, no metrics (F-24) |
| Every patch reviewable | ✅ this one is |
| No automatic production deploy from an AI session | ✅ none performed |
