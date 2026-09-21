# ConnectPlus — Studio, Copilot, Publishing and Sports Audit

Branch `phase-a/baseline-audit-and-docs` · base `main` · 2026-09-21

This is the pre-implementation audit the brief requires. Every claim below is grounded in a file
and line inspected during this session; nothing is inferred from naming. Where the repository is
already in good shape I say so, because a plan that treats a working subsystem as broken wastes the
effort that subsystem deserves.

Companion documents: `docs/MODERNIZATION-AUDIT.md` (platform-wide findings, stable IDs `F-nn`),
`docs/INTELLIGENCE-HARDENING-PLAN.md` (intelligence scope), `docs/ADMIN-INTEGRATIONS-AUDIT.md`
(integrations scope), `docs/phase-reports/PHASE-B-E.md` (completed work).

Baseline at audit time: `npm run typecheck` exit 0 · `npm run lint` 0 errors, 96 warnings ·
`npm test` **98 files, 1511 passed, 1 skipped** · `npm run build` blocked by F-01 (needs a live
database on the prerender path), unchanged from Phase A.

## Status after implementation

Updated at the end of this work. Read this before the findings below, or the document reads as a
list of everything still wrong.

| Finding | State | Where |
| --- | --- | --- |
| S-01 duplicate drafts from autosave | **Fixed and wired** | `lib/studio/composer.ts`, `studio/page.tsx`, `api/posts` |
| S-02 stale Copilot result overwriting newer work | **Fixed in the pilot path** (refused until opted in; undo preserves the newer draft). Other Copilot actions still unguarded | `lib/studio/composer.ts`, `studio/page.tsx`, `PilotReview.tsx` |
| S-04 free-text Copilot suggestions | **Correction: this finding was wrong.** The pilot already returns structured `PilotOp`s staged for review. `lib/studio/operations.ts` is a *second*, parallel model that the live path does not use | `lib/brain-pilot.ts` |
| S-03/S-05/S-06 undo, drafts | Autosave/recovery pieces in place (`composer.ts`); operation-level undo built | — |
| S-07 recovery for `?edit=` documents | **Not done** | — |
| S-08 publish path shared with autosave | **Not done** | — |
| S-09 mobile-first Studio layout | **Not done** | — |
| S-10 writing-check rule packs | **Not done** | — |
| S-11 Article Forge hardening | **Not done** | — |
| S-12 sports provider health / calibration | **Not done** | — |

Full detail, including what is deliberately not claimed, is in `docs/phase-reports/PHASE-F-G-S-I.md`.
The single most important row is S-02: the revision guard exists, is tested, and **no caller uses it
yet**.

---

## 1. Current architecture (as it bears on this work)

| Layer | Where | Notes |
| --- | --- | --- |
| Studio UI | `src/app/(public)/studio/page.tsx` (885 lines, one client component) | All state in one `useState` set; `StudioSidebar` is a further 1457 lines |
| Studio components | `src/components/studio/` — `CheckedEditor`, `StudioSidebar`, `StudioToolbar`, `StudioPreview`, `PilotReview` | `CheckedEditor` is a `textarea` wrapper (475 lines) |
| Copilot brain | `src/lib/brain-pilot.ts` (660), `src/lib/copilot-skills.ts` (278), `src/lib/neural-studio.ts` (586) | Deterministic skills + model path |
| Writing checks | `src/lib/writing-checks.ts` (435) | Deterministic, range-based |
| Article generation | `src/lib/article-forge.ts` (665) | Plan + per-section generation |
| AI API | `src/app/api/ai/studio/route.ts` (164) | One route, action-dispatched |
| Posts API | `src/app/api/posts/route.ts`, `src/app/api/posts/[id]/route.ts` | Create / update / delete |
| Moderation | `moderateContent` on the write path, `ModerationLog` | Server-side, not bypassable from the client |
| Sports | `src/lib/sports*.ts`, `platform-facts.ts`, sports routes | Multi-provider, canonical identity, prediction unique index |

## 2. Current Studio editor flow

`studio/page.tsx` holds `title`, `content`, `excerpt`, `tags`, `categoryId/Name`, `coverImage`,
`editingId`, `editStatus`, `scheduledFor`, `lastSaved` as independent `useState` values, plus
`contentRef` pointing at the `<textarea>`.

`CheckedEditor` wraps that textarea and renders `writing-checks` findings. `insertMarkdown()` reads
`contentRef.current.selectionStart/End` imperatively and rewrites the whole string, then restores
the selection in a `requestAnimationFrame`. **There is no selection state in React, no revision
counter and no content hash anywhere in the flow.**

## 3. Current Copilot flow

Three call sites, all `POST /api/ai/studio` with `{ action, title, content, excerpt, tags, category,
prompt, selection }` and all reading `data.text` — a **free-text string** (`page.tsx:662`, `:711`,
`:725`). The response shape is `{ text, alternatives, meta }`, stored with
`setCopilotResult({ action, text, alternatives, meta })` and consumed by `PilotReview`.

Consequences, all confirmed by reading the code:

- **The result carries no revision and no hash**, so nothing can tell whether it was produced
  against the text currently on screen. This is finding **S-02** below and the single most
  important thing this work fixes.
- **The result is prose, not an operation.** Applying it means the caller decides how to place a
  string. There is no field, no range, no `find`, and therefore no way to validate a suggestion
  before it lands.
- `selection` is sent but is a bare string with no offsets, so a suggestion cannot be anchored to
  the range it was written for.

## 4. Current autosave behavior — **S-01, duplicate drafts**

```ts
// page.tsx:264 — savePost
let postId = editingId;
if (!postId) { const res = await fetch("/api/posts", { method: "POST", ... }); ... postId = data?.post?.id; if (postId) setEditingId(postId); }
else { await fetch("/api/posts/" + postId, { method: "PUT", ... }); }

// page.tsx:275 — the autosave effect
useEffect(() => { ... const timer = setTimeout(async () => { await savePost("DRAFT"); ... }, AUTOSAVE_MS); ... },
  [title, content, excerpt, coverImage, tags, categoryId, categoryName, canAutoSave, savePost, loadMyStories]);
```

The defect is a captured-value race, and it is reachable by ordinary typing:

1. A new story has `editingId === null`, so the first autosave issues `POST /api/posts`.
2. `setEditingId(postId)` is asynchronous. Until React commits, `savePost`'s closure still sees
   `editingId === null`.
3. The effect's dependency list includes `savePost`, whose identity changes on **every** keystroke
   (`useCallback` over `title`, `content`, …). The effect therefore re-runs, clears its timer and
   re-arms it — and any re-run that resolves before step 2's commit issues a **second `POST`**.

Two rows, one document. There is no idempotency key on the request, so the server has no basis to
recognise the second one as the same save. The brief's requirement — "a session should have one
stable document ID" — is not met: `editingId` is *derived* from a response, never *established*
before the first save.

Two further problems in the same code:

- **`loadMyStories()` runs after every autosave** (`page.tsx:275`), so a writer typing steadily
  triggers a full `GET /api/posts?mine=true&limit=50` per save. Not a correctness bug, but it is
  how a slow network turns autosave into a request storm.
- **A failed save is swallowed**: `try { await savePost("DRAFT") } catch {}`. The writer is shown
  `setSaving(false)` and no error. The brief requires that a failed save must not silently lose the
  local draft — the local backup does survive (see §5), but the writer is not told the server copy
  is stale.

## 5. Local backup and recovery (works, with one gap)

`localStorage` under `BACKUP_KEY` is written 800 ms after any change (`page.tsx:256`) and restored
**only when there is no `?edit=` parameter** (`page.tsx:252`). So a new story recovers correctly,
but a writer who was editing an existing story, lost their connection and reloaded gets the server
copy with the local backup silently ignored. `newStory()` and a successful publish both clear the
key; `openStory()` does not.

## 6. Current publish flow

`publishPost` (`page.tsx:~700–735`) **rebuilds its own payload** rather than reusing `savePost`:

- it re-derives `finalStatus` locally (`"DRAFT" | "PUBLISHED"`) from `postStatus`/`isScheduled`;
- if `excerpt` or `tags` are missing it calls the brain, **writes the results into component
  state**, and returns with "click Publish again" — a two-step the writer must notice;
- it sends the payload to `PUT /api/posts/:id` using `editingId`, with **no revision or hash**, so
  a publish racing an autosave is last-write-wins;
- it treats a `2xx` as "published" and then branches on `data.moderationStatus` — it does read the
  server's moderation answer, which is good, but it has no representation of *downstream* state
  (embedding, tagging, hive ingestion, syndication).

Two different code paths construct the same payload for the same document. That is the structure
that lets publishing validation and autosave validation drift, and it is the reason the brief asks
for one shared validation.

## 7. Current moderation flow (in good shape)

`moderateContent` runs server-side on the write path; `data.moderationStatus` is surfaced back to
the Studio and the writer is told the story is under review. **The client cannot bypass it**, which
is the property that matters. No change is proposed here beyond making the state machine explicit
(§11).

## 8. Current sports pipeline (substantially better than the brief assumes)

The brief anticipates a pipeline with duplicate predictions, no canonical identity and no provider
health. The repository already has more than that, and it is worth being precise:

- **Canonical identity exists**: `canonicalMatchKey()` (`sports.ts:1018`) with club-suffix stripping
  (`:1003`) and league-name folding (`:1045`), explicitly for cross-provider deduplication.
- **The merge is provider-priority ordered** (`sports.ts:1103`) and counts which provider supplied
  each fixture (`bump(provider.id)`), so the shape needed for provider attribution is already there.
- **Prediction duplicates are already solved at the storage layer**: the unique index from
  `prisma/migrations/20260913020000_sports_prediction_unique/migration.sql` on
  `(matchId, market, model)`, with a deduplicating `DELETE` that keeps the settled row. The
  read-then-create race it fixes was already found and closed.
- **A failure policy is stated and honoured**: "a provider error NEVER breaks a page. We fall back
  to the…" (`sports.ts:27`).

What is genuinely missing, and what this work therefore targets:

| Gap | Evidence |
| --- | --- |
| No freshness age per fixture or per provider exposed to the board | `NormalizedMatch` carries `provider` but no `fetchedAt`; merge counts providers but not their staleness |
| No provider-health surface (failure rate, stale count, invalid-odds count, fallback usage) | `platform-facts.ts` records platform facts, not per-provider metrics |
| Calibration is not segmented per provider or per market | accuracy reporting is aggregate |
| No explicit "insufficient sample" state | accuracy percentages are computed even at n=1 |
| Model version is recorded per prediction (`model` column) but not exposed as a calibration dimension | the unique key includes it; the reporting does not use it |

So the sports work is **reporting, freshness and health** — not a rewrite of ingestion, which the
brief implies but the code does not support.

## 9. Current AI guardrails (what exists now, after Phases B–G)

| Guard | Where | State |
| --- | --- | --- |
| Typed error envelope, request IDs, response validation | `src/lib/errors`, `src/lib/contracts`, `src/lib/request-context` | done |
| Role-derived scopes, deny-by-default | `src/lib/policies` | done |
| SSRF guard on outbound research | `src/lib/safe-fetch` | done (`web-research`; image proxy / thumbs / RSS still plain `fetch` — F-06 remainder) |
| Memory provenance, expiry, visibility, contradiction grouping | `src/lib/memory-provenance` | done |
| Untrusted-content framing + injection detection | `src/lib/untrusted` | done |
| Retrieval weighting, reranking, budget, retrieval reasons | `src/lib/retrieval` | done |
| Intent calibration, ambiguity → clarification, mutation guard | `src/lib/neural-intent` | done |
| Durable approvals with human decision | `src/lib/brain-approvals` | exists; **revalidation on approval is not implemented** (F-18) |
| Bounded self-healing, observe by default | `src/lib/brain-repair` | exists; **no cooldown/backoff/breaker/post-verification** (F-19) |

**Not present anywhere:** any notion of an AI output's *mode* (deterministic / model / degraded /
unverified) on the Studio API response. The brief requires it; §12 records the finding.

## 10. Current issues and risks (prioritised)

| ID | Severity | Issue | Evidence |
| --- | --- | --- | --- |
| **S-01** | **P1** | Autosave can create duplicate drafts: `editingId` is derived from a response, never established before the first save, and no idempotency key is sent | `studio/page.tsx:264`, `:275` |
| **S-02** | **P1** | Copilot results carry no revision or hash, so a stale suggestion can overwrite newer writing | `studio/page.tsx:662`, `:711`, `:725`; `api/ai/studio/route.ts` |
| **S-03** | **P1** | Two code paths build the publish payload (`savePost` and `publishPost`), so validation can drift | `studio/page.tsx:264` vs `:~718` |
| **S-04** | **P2** | Copilot returns free text with no structured operation, field, range or `find`, so nothing can be validated before it is applied | `page.tsx:662` |
| **S-05** | **P2** | A failed autosave is swallowed; the writer is not told the server copy is stale | `page.tsx:275` (`catch {}`) |
| **S-06** | **P2** | `loadMyStories()` refetches the whole story list after every autosave | `page.tsx:275` |
| **S-07** | **P2** | Local backup is ignored when a story was opened with `?edit=` — a reconnect loses local edits | `page.tsx:252` vs `:256` |
| **S-08** | **P2** | No document status bar, readiness panel, revision timeline or conflict UI exists | `src/components/studio/` has five files, none of them these |
| **S-09** | **P2** | Studio has no additive mobile layout: a single 885-line page with `sm:` breakpoints and a 1457-line sidebar; no drawer or bottom sheet | `studio/page.tsx`, `StudioSidebar.tsx` |
| **S-10** | **P2** | The Studio API response has no output mode, no warnings and no verification status, so a degraded answer is indistinguishable from a good one | `api/ai/studio/route.ts` |
| **S-11** | **P3** | No revision/version history; undo is the textarea's own (browser) undo and is lost on any programmatic `setContent` | `CheckedEditor.tsx`, `studio/page.tsx` |
| **S-12** | **P3** | Sports provider freshness, health and per-market calibration are absent (§8) | `sports.ts`, `platform-facts.ts` |

## 11. Current tests, and the gaps that matter

Existing (all passing): `article-forge`, `brain-pilot`, `copilot-skills`, `neural-writing`,
`studio-copilot`, `writing-checks` (6 files).

**Missing, and named as missing because the brief requires them:**

| Required by the brief | Present? |
| --- | --- |
| Autosave dedupe / stable document ID | ❌ |
| Stale-response prevention (revision + hash) | ❌ |
| Copilot operation validation | ❌ |
| Draft recovery from local backup | ❌ |
| Revision-conflict handling | ❌ |
| Publish readiness / shared validation | ❌ |
| Scheduling rules equal to immediate publish | ❌ (partial: no test) |
| Duplicate detection on publish | ❌ |
| Sports provider health | ❌ |
| Per-market calibration + insufficient-sample state | ❌ |
| Notification fan-out dedupe, referral replay | ❌ |
| Mobile/desktop Studio UI (Playwright) | ❌ — no Playwright suite exists in this repo at all |

## 12. Files likely to be touched

New: `src/lib/studio/composer.ts`, `src/lib/studio/operations.ts`, `src/lib/studio/save-guard.ts`,
`src/lib/studio/readiness.ts`, `src/lib/sports/provider-health.ts`, tests for each.

Modified: `src/app/(public)/studio/page.tsx`, `src/app/api/ai/studio/route.ts`,
`src/app/api/posts/route.ts`, `src/app/api/posts/[id]/route.ts`, `src/components/studio/*`,
`src/lib/brain-pilot.ts`, `src/lib/article-forge.ts`, `src/lib/writing-checks.ts`,
`src/lib/sports.ts` (additive), `src/lib/platform-facts.ts` (additive).

## 13. Phased implementation plan

Ordered by risk retired per unit of change, and deliberately starting with the two P1s the brief
names first.

**Phase S1 — Autosave integrity (S-01, S-05, S-06, S-07).** Establish a stable `documentId` for a
session, send an idempotency key on every save, make save-state transitions explicit, surface a
failed save, stop the per-save story refetch, and restore the local backup for an opened story.
Risk: medium (touches the write path). Rollback: revert the module and the caller.

**Phase S2 — Revision and hash conflict detection (S-02, S-08).** `ComposerState` with `revision`
and `contentHash`; every Copilot request carries both; a response whose base revision or hash no
longer matches the composer is **rejected** with a conflict, never applied. Risk: medium.

**Phase S3 — Structured Copilot operations (S-04, S-10).** Replace the free-text result with a
validated `ComposerOperation[]` (id, kind, field, text, find, baseRevision, baseHash, reason,
range), previewed before application, each acceptance recorded as an undoable transaction. Add
`mode: deterministic | model | degraded | unverified` and warnings to the API response. Risk: high
(API shape change) — mitigated by returning the structured form *alongside* the legacy `text` until
callers migrate.

**Phase S4 — Shared publish path and readiness (S-03).** One payload builder used by autosave,
manual save and publish; a readiness report (blockers vs warnings) shown before confirm; the
publishing state machine made explicit; partial success reported honestly. Risk: medium-high.

**Phase S5 — Studio UI, mobile-first (S-09, S-08).** Desktop three-panel with editor focus; mobile
full-screen editor with a bottom-sheet Copilot; visible save state in the header; touch targets;
keyboard and screen-reader support; no desktop sidebar on mobile. Risk: high (largest diff) —
mitigated by being purely additive in layout terms with behaviour unchanged.

**Phase S6 — Sports provider health and calibration (S-12).** Additive freshness and health
reporting on top of the existing canonical-identity and merge machinery; per-provider/per-market
calibration with an explicit insufficient-sample state. Risk: low (reporting only).

**Phase S7 — Tests and validation.** Playwright does not exist in this repository, so the brief's
"Playwright tests" requirement cannot be met without first introducing a browser-test harness — a
change of scope in its own right. The plan is to state that plainly rather than to claim coverage:
DS1–DS6 add unit and integration tests through the existing vitest suite, and the e2e gap is
recorded as an open item.

## 14. Risk classification

| Phase | Risk | Why |
| --- | --- | --- |
| S1 | Medium | Changes the write path for drafts; a mistake duplicates or loses drafts |
| S2 | Medium | Rejecting a response is safe; *failing* to reject is not |
| S3 | High | API response shape; mitigated by additive migration |
| S4 | Medium-high | Publish is irreversible in user-visible terms |
| S5 | High by size | Large UI diff; low by behaviour (layout only) |
| S6 | Low | Additive reporting |

## 15. Definition of done — position at audit time

Nothing in §13 has been implemented yet. The document exists so that the implementation has a
stated order, and so that the next reader can tell what was skipped rather than inferring it.
