# ConnectPlus Intelligence Platform — Implementation Plan

Status: **plan for review, no code changed.**
Baseline verified on `main` @ `1d3f11b`, working tree clean.
Baseline suite: `npm test` → **83 files, 1137 passed, 1 skipped** (green).

> Scope note: the brief was received up to §14 ("HARDEN THE APPROVAL SYSTEM"), which is
> truncated mid-sentence at *"Proposal-time target snapshots -"*. This plan covers §1–§13 and
> the visible part of §14. Sections after that point are **unplanned** — see "Open items".

---

## 1. Current intelligence architecture (verified)

Four real components, one facade:

| Module | Role | Size | Registered in console |
| --- | --- | --- | --- |
| `src/lib/hive-brain.ts` | Long-term memory: learned lessons, reinforcement, decay | 712 lines | `hive-memory`, `hive-engagement` |
| `src/lib/neural-mind.ts` | Reasoning: intent, analysis, conversation, research | 2 354 lines | `neural-reasoner`, `neural-research`, `neural-authoring` |
| `src/lib/platform-intelligence.ts` | Senses: creators, traffic, economy, region | 1 249 lines | `platform-senses` |
| `src/lib/app-brain.ts` | Facade: `think()` / `chat()` / `diagnose()` / `report()`, `BRAIN_SUBSYSTEMS` registry | 1 236 lines | the registry itself |

Supporting layers: `brain-readings.ts` (ground-truth probes), `brain-awareness.ts`,
`brain-issues.ts` (self-filed issue register), `brain-pilot.ts` (editor ops),
`brain-approvals.ts` (write queue), `brain-repair.ts` (self-heal envelope),
`mind-actions.ts` (mutating tools), `mind-directives.ts`, `mind-knowledge.ts`,
`knowledge-retention.ts` (decay + consolidation), `neural-intent.ts` (classification),
`neural-vector.ts` + `embeddings.ts` (retrieval), `web-research.ts` (keyless web/RSS reading).

**Taxonomy today:** `export type BrainMind = "hive" | "neural" | "platform"` (app-brain.ts:70) with
7 subsystems in `BRAIN_SUBSYSTEMS` (app-brain.ts:86–135). This is the single registration point a
fourth mind must join.

**Entry paths:** `POST /api/admin/neural/chat` → `appBrain.chat()`; `POST /api/admin/brain/operate`
→ operations; `POST /api/admin/brain/approvals` → decisions. 12 admin brain/neural route handlers.

### Deployment reality that constrains everything below

- **One serverless Next.js app on Vercel** (`fra1`), 111 `route.ts` handlers, no long-lived worker.
- **Zero shell execution today.** `grep -rn "child_process|execSync|spawn(" src/` → no matches.
  There is no existing sandbox, no Docker, no worktree tooling. Tier 1/2 execution in §6–§9 is
  therefore *entirely new attack surface*, not a hardening of something present.
- CI exists as GitHub Actions (`.github/workflows/webpack.yml`: typecheck → lint → test → build).
- Postgres via Prisma, 43 models, migrations directory in use (`prisma/migrations/*`).
- Redis with in-memory fallback; Convex offload; Cloudflare Worker + Inngest + Vercel safety-net
  cron (three schedulers over one `CRON_JOBS` registry of 16 ids).

---

## 2. Existing capabilities

**Already implemented** (do not rebuild):

- Platform diagnostics: 8 independent probes, self-test, persisted diagnosis, issue register with
  a 3-run persistence threshold.
- Bounded self-healing: repair catalog bound to a finding id, `off|observe|enforce` (default
  `observe`), `MAX_REPAIRS_PER_RUN = 3`, idempotent repairs, outcome recorded to hive memory.
- Approval queue: 12 allowlisted tools, model-independent summary derivation, atomic claim
  (`updateMany` gated on `PENDING`), 24h TTL, risk label, named reviewer, result recorded.
- Web/RSS research: DuckDuckGo + Wikipedia, time-boxed, tag-stripping, `[]` on failure.
- Memory: single `NeuralMemory` table, confidence, tags, `sourceUrl`, retention decay
  (45-day half-life), consolidation, canonical dedupe key.
- Retrieval: hashed-token embeddings (384-dim, `hash-minilm`), `PostEmbedding` with `dim`,
  `model`, and an unused `pgVec Unsupported("vector(384)")?` pgvector mirror column.
- Intent: pattern table + learned aliases, confidence, `applyLearnedAliases`.
- Content/editorial: copilot skills, article forge, writing checks, studio prompts.

**Existing safety controls** (the envelope to preserve and extend):

| Control | Where | Property |
| --- | --- | --- |
| Tool allowlist | `brain-approvals.ts:60–74` | unknown tool id = rejection, not capability |
| Derived summaries | `brain-approvals.ts` `describe()` | model prose cannot under-describe an action |
| Atomic decision | `decideProposal()` | double-click cannot double-execute |
| Proposal TTL | `PROPOSAL_TTL_HOURS = 24` | stale approvals retire |
| Repair envelope | `brain-repair.ts` | finding-bound, capped, observe-by-default |
| Constant-time secrets | `shared-secret.ts` | unset secret **refuses** (fail closed) |
| Input validation | `api-validation.ts` + `schemas/validators.ts` | Zod, typed handler input |
| HTML sanitisation | `content-processor.ts` | allow-list; frames, handlers, styles dropped |
| Response hardening | `next.config.mjs` + `vercel.json` | pinned by `security-headers.test.ts` |
| Free-model guard | `ai-provider.ts` `freeOrFallback` | paid id never called by accident |
| Secrets hygiene | `.gitignore` `.env*`, `.freebuff/` | only `.env.example` tracked — **verified** |

---

## 3. Documentation and version drift audit (brief §3)

Every row below is a confirmed discrepancy with the evidence that proves it.

| # | Claim | Where | Reality | Impact |
| --- | --- | --- | --- | --- |
| D1 | "Next.js **15**" (×2) | `ARCHITECTURE.md:9,15` | `next: ^16.3.4` (package.json); README says 16 | Wrong major version → agents follow 15-era APIs. Highest-value fix: `AGENTS.md` explicitly warns this Next has breaking changes. |
| D2 | AI = "OpenAI / Anthropic / OpenRouter / **Gemini**" | `ARCHITECTURE.md:20` | `AiProviderName = "builtin" \| "openrouter" \| "opencode"` (`ai-provider.ts:4`). No Gemini code exists anywhere. | Docs promise a provider that cannot be selected. |
| D3 | AI = "OpenRouter, OpenCode Zen, **OpenAI, Anthropic**" | `README.md` Tech Stack | Only openrouter + opencode are wired into `getAiConfig()`. But `settings.ts:479–505` exposes `openaiApiKey`/`anthropicApiKey`/`anthropicModel`, `integrations.ts:821–868` probes `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` as providers, and `visual-studio.ts:96` reads `OPENAI_API_KEY` directly. | **Three disagreeing registries.** An admin can store a key + model for a provider the gateway will never call, while the Integrations console reports it healthy. This is the §3 "single source of truth" violation, and it is a correctness bug, not just docs. |
| D4 | "107 endpoints" (×2) | `ARCHITECTURE.md:16,35` | 111 `route.ts` files | Cosmetic but churns every feature. Replace with a non-numeric description or a tested count. |
| D5 | "344 tests" | `README.md` Testing | 1137 passing / 83 files | Undersells the suite ~3.3×; stale hand-maintained count. |
| D6 | Scheduler = Inngest only | `ARCHITECTURE.md:23,147` | Four schedulers: Inngest, Vercel `crons` (1 entry, verified in `vercel.json`), Cloudflare Worker `[triggers] crons` (`workers/edge-cache/wrangler.toml:74`), cron-job.org. | Hides the real critical path; the worker owns the 2-minute jobs. |
| D7 | 12 scheduled jobs tabled | `README.md` | `CRON_JOBS` holds **16** ids (`cron-schedule.ts:56–239`: adds `sports-live`, `payments-lifecycle`, `marketing-sweep`, `feed-health`, `platform-pulse`, `brain-diagnose`, `embed-posts`, `status-daily-snapshot`) | The registry is tested; the prose table is not. |
| D8 | Provider/API env vars listed | `README.md` env table, `ARCHITECTURE.md` env table | `.env.example` contains **none** of `OPENROUTER_API_KEY`, `OPENCODE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | The documented deployment checklist omits the only two providers that work. |
| D9 | Duplicated block | `AGENTS.md` | The entire "Supabase topology — TWO accounts" section appears **twice**, verbatim (lines ~7–45 and ~46–80) | Copy-paste rot in the file agents are told to read first. |
| D10 | `src/lib/permissions.ts` commented "(notifications, geo)" | `ARCHITECTURE.md` folder map | file exists — accurate | ok |

**Resolution approach (§3 obligations):**

1. Create **one** provider registry — `src/lib/ai-providers.ts` — exporting the canonical
   `AiProviderName` union, per-provider metadata (label, env var, key setting, base URL, default
   model, gateway shape), and `isFreeModelFor(provider, id)`. `ai-provider.ts` consumes it rather
   than declaring its own union/record.
2. Make `settings.ts` AI keys and `integrations.ts` provider probes **derive** from that registry,
   so a provider that cannot be routed is never offered as configurable. Either wire OpenAI/Anthropic
   through the gateway or drop them from settings + console; the plan's recommendation is **drop
   them from the selectable set and document the two supported gateways**, because §2/§8 of the brief
   permit no unbounded credential surface and `openaiApiKey` currently exists solely to be probed.
3. Add `scripts/check-docs-drift.mjs` + `tests/unit/docs-drift.test.ts` that asserts:
   - `next` major in `package.json` equals the version stated in `ARCHITECTURE.md` and `README.md`;
   - every provider in the registry appears in README + ARCHITECTURE, and no documented provider is
     absent from the registry (regex over the two markdown files);
   - every `CRON_JOBS` id appears in the README job table, and the table has no extras;
   - `route.ts` count matches any number the docs still state (or the number is removed);
   - env vars named in docs exist in `.env.example` (allowing a documented "optional/absent" marker);
   - test count is not hard-coded in prose.
   This keeps the invariant enforced by CI instead of by memory.

---

## 4. Missing capabilities (gap analysis against the brief)

| Brief § | Capability | Status | Gap |
| --- | --- | --- | --- |
| §4 | Engineering Mind (4th mind) | **absent** | no `src/lib/engineering/`, no engineering subsystem in `BRAIN_SUBSYSTEMS` |
| §5 | Unified `BrainTask` contract with steps | **absent** | `BrainActionProposal` is per-action, has no plan/steps/evidence, no `running/verifying` states |
| §6 | Typed tool registry (schemas, timeout, retry, idempotency, environment) | **partial** | `APPROVAL_TOOLS` has id/label/risk/required/describe/run — **no** input/output schema, no timeout, no retry policy, no idempotency declaration, no execution-environment field |
| §7 | Tier 0–4 risk authorisation | **partial** | 3-level `low/medium/high` only; no tier model, no two-person approval, no explicit Tier 4 denylist |
| §8 | Sandbox runner | **absent** | nothing |
| §9 | Engineering workflow (observe→diagnose→research→plan→patch→verify→review) | **absent** | only the platform-diagnosis analogue exists |
| §10 | Memory provenance + verification states | **partial** | `NeuralMemory` has `confidence`, `sourceUrl` only — no `sourceHash`, `observedAt`, `expiresAt`, `verificationStatus`, `sourceReliability`, `scope`, `sensitivity`, `supersedes`, `contradictionGroup`, `embeddingModel/Version` |
| §11 | Untrusted web/RSS ingestion hardening | **partial** | `web-research.ts` strips tags and time-boxes, but performs **no** SSRF guard: no localhost/private-IP/metadata block, no redirect validation, no size or content-type limit, no canonical URL or content hash, no `expiresAt` marking. `redirect: "follow"` is set explicitly (`web-research.ts:39`). |
| §12 | Retrieval abstraction with reranking + freshness/reliability weighting | **partial** | `neural-vector.ts` does cosine over hashed vectors; no fallback chain, no pgvector path used, no scope filter, no reranking, no retrieval-reason, no context budget |
| §13 | Intent confidence calibration, ambiguity → clarify, versioned aliases, metrics | **partial** | confidence exists; no calibration, no ambiguity→clarification path, no versioning of learned aliases, no per-intent metrics, no separation of tool selection from response generation |
| §14 | Canonical argument serialization, target snapshots | **absent** in visible text | `JSON.stringify` of args happens in `proposeAction` but is not canonicalised or hashed |

**Non-duplication check:** every gap above is additive. Nothing in the brief asks for a second
diagnostics engine, a second approval queue, or a second memory store. New work must *reuse*
`gatherReadings`, `APPROVAL_TOOLS`, `NeuralMemory`, and `COUNTER`. Where a concept already exists
(risk levels, repair envelope, TTL, allowlist) the plan extends it in place rather than forking it.

---

## 5. Data-model changes

All additive, all via `npm run db:migrate`. **No `db:push`.**

```prisma
// extended: NeuralMemory  (provenance + trust)
sourceType        String?   // "operator" | "web" | "rss" | "model" | "platform" | "repair"
sourceHash        String?   // sha256 of canonical content — dedupe + tamper detection
canonicalUrl      String?   // normalised URL (lowercase host, strip tracking params, no fragment)
observedAt        DateTime?
expiresAt         DateTime? // time-sensitive facts must die on their own
verificationStatus String  @default("unverified") // unverified|observed|corroborated|operator_confirmed|rejected|expired
sourceReliability Float    @default(0.5)
scope             String    @default("global")    // global | platform | sports | creator | engineering
sensitivity       String    @default("normal")    // normal | internal | restricted
supersedesId      String?   // this memory replaces that one
contradictionGroup String?  // mutually exclusive claims share a group
embeddingModel    String?
embeddingVersion  String?

// new: BrainTask  (the §5 contract)
model BrainTask {
  id           String   @id @default(cuid())
  requestId    String
  actorId      String?
  goal         String   @db.Text
  intent       String
  risk         String   // read | sandbox | repository_change | production_change | prohibited
  status       String   @default("planned")
  evidence     String   @db.Text  // EvidenceReference[]
  plannedSteps String   @db.Text  // TaskStep[]
  outputs      String   @db.Text  // TaskOutput[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  proposalId   String?  // link to BrainActionProposal when a step needed approval
  @@index([actorId, createdAt])
  @@index([status])
}

// extended: BrainActionProposal
argsHash       String?  // canonical serialisation hash — decision-time integrity check
targetSnapshot String?  @db.Text // what the target looked like at proposal time
requiredApprovals Int   @default(1)
approvals      String?  @db.Text // [{actorId, at, note}] for two-person approval

// new: BrainToolAudit  (one row per tool invocation, Tier 0–3)
model BrainToolAudit {
  id         String   @id @default(cuid())
  taskId     String?
  toolId     String
  tier       Int      // 0..3
  actorId    String?
  requestId  String
  argsHash   String
  argsRedacted String @db.Text
  ok         Boolean
  durationMs Int
  bytesOut   Int      @default(0)
  environment String  // "request" | "sandbox" | "worktree"
  error      String?  @db.Text
  createdAt  DateTime @default(now())
  @@index([toolId, createdAt])
  @@index([actorId, createdAt])
}

// new: EngineeringRun  (sandbox/test execution record)
model EngineeringRun {
  id         String   @id @default(cuid())
  taskId     String?
  kind       String   // typecheck | lint | unit | e2e | build | reproduce | apply_patch
  environment String
  ref        String?  // branch / worktree / workflow run id
  command    String   @db.Text
  status     String   // queued | running | passed | failed | timeout | cancelled | rejected
  exitCode   Int?
  logDigest  String?  @db.Text
  logBytes   Int      @default(0)
  artifactUrl String?
  createdAt  DateTime @default(now())
  finishedAt DateTime?
  @@index([taskId])
}
```

Migration strategy: one migration per model group, never a mixed "big bang" migration, so any single
step can be reverted independently. `NeuralMemory` never uses `??`-style data loss: all new columns
are nullable or defaulted, so backfill is a no-op for existing rows and old code keeps working.

Rollback: Prisma forward-migrations have no `down`. Each migration is therefore written so the
**deploy rollback is "ignore the new columns"** (nullable/defaulted, no `NOT NULL` on backfilled
data, no rename, no drop). The companion `docs/MIGRATION-ROLLBACK.md` records, per migration, the
exact `ALTER TABLE … DROP COLUMN` statement to run if a revert is truly required, plus whether the
column is safe to leave in place (preferred).

---

## 6. New modules

```
src/lib/engineering/
  types.ts               BrainTask, TaskStep, EvidenceReference, ToolSpec, Tier, Environment
  tool-registry.ts       the typed registry + risk/tier lookup + audit emit (§6, §7)
  repository-tools.ts    read-only: tree, read file, git diff, package manifest, schema, CI run   [Tier 0]
  code-search.ts         text + symbol search with path/glob allowlists                            [Tier 0]
  dependency-inspector.ts package-lock/advisory inspection, licence + version drift                 [Tier 0]
  diagnostics.ts         stack-trace parsing, failure classification, reproduction planning         [Tier 0]
  patch-planner.ts       plan + unified-diff production (never writes)                              [Tier 1]
  patch-verifier.ts      verification matrix: what was run, what passed, what remains uncertain     [Tier 1]
  test-runner.ts         sandbox executor client (dispatches to the out-of-band runner)             [Tier 1]
  engineering-policy.ts  tier rules, path allow/deny, two-person rules, Tier 4 denylist             [policy]
  engineering-audit.ts   BrainToolAudit + EngineeringRun writers, log digests                       [all]
  workflow.ts            the §9 observe→…→review state machine over BrainTask                       [orchestration]
  index.ts               public surface (mirrors how the other engines export one instance)

src/lib/ai-providers.ts      the single provider registry (§3)
src/lib/memory-provenance.ts verification states, canonical URL/hash, contradiction handling (§10)
src/lib/safe-fetch.ts        SSRF-guarded fetch: scheme allowlist, IP-range denylist with DNS
                             resolution, redirect re-validation, size/content-type caps (§11)
src/lib/retrieval.ts         retrieval abstraction: pgvector → hashed → lexical, weighted +
                             reranked, with retrieval reasons and a context budget (§12)
src/lib/intent-calibration.ts  calibrated confidence, ambiguity detection, clarify responses,
                             versioned alias records (§13)

scripts/check-docs-drift.mjs        §3 drift gate
scripts/engineering-runner/         the out-of-band sandbox entrypoint (see §8 decision)
.github/workflows/engineering-sandbox.yml  ephemeral, secret-free verification job
```

**Sandbox decision (§8) — the hard constraint.** A Vercel serverless function cannot satisfy one
requirement in §8, let alone all of them: no ephemeral workspace, no non-root process, no CPU/memory
caps, no Docker socket story, no egress control, and the brief's own "no host filesystem mounts / no
Docker socket / no privileged containers" rules presuppose an environment Vercel does not provide.
Running `npm test` inside a request would also be a 300s-limit, 1GB-RAM, cost-amplifying denial of
service against the production deployment.

Recommended: **the app never executes engineering commands.** It produces a *signed, bounded,
auditable job request*; an existing, already-isolated runner executes it.

| Option | Isolation | Cost | Verdict |
| --- | --- | --- | --- |
| GitHub Actions job (recommended) | ephemeral VM, non-root, no prod secrets, already exists for CI | free on this repo | Phase 2 target. `permissions: contents: read`, dedicated workflow, `--frozen-lockfile`, no repo secrets, token-less egress where possible, artifact-only results. |
| Separate container worker (Fly/Railway) | stronger (hard CPU/mem/egress caps) | new infra + secrets to manage | Phase 4 if Actions proves insufficient |
| In-app child process on Vercel | none | n/a | **Rejected** — violates §8 outright |
| Local dev-machine runner | none (host FS) | n/a | **Rejected** for anything beyond a developer's own manual run |

Under this design, Tier 1 is "the app asked Actions to run the marked test suite on this SHA" — which
is exactly the verification workflow §9 specifies, and it is genuinely sandboxed rather than
simulated. The patch itself is never applied by the model: `patch-planner` emits a unified diff,
`apply_patch` is a Tier 2 tool executed by the runner on a scratch branch, and only the resulting
diff is returned to the platform for human review.

---

## 7. Existing modules to modify

| Module | Change | Risk |
| --- | --- | --- |
| `src/lib/app-brain.ts` | add `"engineering"` to `BrainMind`; register the engineering subsystem; route engineering intents to `engineering/workflow.ts`; expose task state in `chat()` | low (additive registry entry) |
| `src/lib/brain-approvals.ts` | canonical arg serialisation + `argsHash`; target snapshot at proposal time; `requiredApprovals` (2 for destructive Tier 3); derive tier from the unified registry instead of the 3-level label; keep the existing 12 tools working unchanged | **high — this is the safety boundary**; changes must be additive and covered by the existing `brain-approvals.test.ts` |
| `src/lib/ai-provider.ts` | consume `ai-providers.ts`; delete the duplicated union/record | medium |
| `src/lib/settings.ts`, `src/lib/integrations.ts` | derive AI provider config from the registry; stop advertising providers that cannot be routed | medium (console-visible) |
| `src/lib/web-research.ts` | route all fetching through `safe-fetch.ts`; keep the "returns `[]`, never throws" contract | medium |
| `src/lib/neural-vector.ts`, `src/lib/embeddings.ts` | delegate to `retrieval.ts`; keep hashed embeddings as the always-available fallback | medium |
| `src/lib/neural-intent.ts` | move learned aliases to versioned records with metrics; add ambiguity output | medium |
| `src/lib/neural-mind.ts` | consume `retrieval.ts` + provenance-aware memory; **do not** absorb engineering logic | medium |
| `src/lib/knowledge-retention.ts` | decay must respect `verificationStatus` and `expiresAt`; contradicted memories must not rank as current truth | medium |
| `src/lib/cron-schedule.ts` | optional: an `engineering-verify` job only if it can run secret-free | low |
| `ARCHITECTURE.md`, `README.md`, `AGENTS.md` | drift fixes from §3; de-duplicate the Supabase block | low |

---

## 8. Risk classification per proposed change

Brief §7 tiers, applied:

| Phase | Work | Tier | Approval |
| --- | --- | --- | --- |
| 0 | Docs/version/provider drift + drift test; dedupe `AGENTS.md` | Tier 2 (repo change, no runtime effect) | normal PR review |
| 1 | `BrainTask` + `BrainToolAudit` models; typed tool registry over existing tools; memory provenance columns; `safe-fetch`; retrieval abstraction; intent calibration | Tier 1–2 | normal PR review; migrations reviewed by hand |
| 2 | Engineering Mind read-only tools (Tier 0) + diagnostics + patch *planning* (no execution) | Tier 0–1 | normal PR review |
| 3 | Sandbox runner via Actions; `run_typecheck`/`run_lint`/`run_unit_tests`/`run_build`; patch apply on scratch branch; PR preparation | Tier 1–2 | every execution audit-logged; repository change always human-reviewed |
| 4 | Any Tier 3 tool (deploy, migration, payment/auth settings, `set_repair_mode: enforce`) | Tier 3 | explicit approval; **two-person for deploy, migration, and payment/auth changes** |
| — | Tier 4 (arbitrary prod shell, raw secrets, credential extraction, IAM, backup deletion, disabling controls, unreviewed prod DB deletion/deploy) | Tier 4 | **never implemented, enforced by an explicit denylist + tests** |

---

## 9. Testing strategy

Every phase ships tests; the suite is the gate (`npm run typecheck && npm run lint && npm test && npm run build`).

- **Policy tests (the important ones).** Table-driven `engineering-policy.test.ts`: every Tier 4
  request is refused; every Tier 3 tool reports `requiresApproval`; two-person rules hold; unknown
  tool ids are refused; a path outside the allowlist is refused; `.env*`, `node_modules`, `.git`
  internals, and `.freebuff/` are refused as read targets.
- **Registry contract test.** Every tool declares input/output schema, timeout, idempotency, tier,
  and audit event; missing fields fail the test (prevents the §6 field set from eroding).
- **SSRF test suite** for `safe-fetch`: localhost, `127.0.0.1`, `::1`, `10./172.16./192.168.`,
  `169.254.169.254`, `file://`, `gopher://`, a redirect chain into a private range, an oversized
  body, and a disallowed content type — each must be refused, with the refusal asserted exactly.
- **Approval integrity tests:** canonical serialisation is stable under key reordering; `argsHash`
  mismatch at decision time refuses; target snapshot is captured and compared; two-person approval
  cannot be satisfied by the same actor twice; existing 12 tools behave identically (regression).
- **Memory tests:** expiry hides time-sensitive facts; a contradicted pair never both rank as
  current; `rejected` memories are excluded; scope filtering holds; retrieval explains itself.
- **Drift test:** `docs-drift.test.ts` from §3.
- **Sandbox tests:** runner rejects destructive commands, egress attempts, secret reads, and
  privileged spawns; timeouts kill the process; cleanup runs on failure. Tested against the policy
  function directly (deterministic), not by actually running untrusted commands.
- **No live network in unit tests** — `safe-fetch` and the runner client are dependency-injected.

---

## 10. Phased implementation order

Each phase is independently shippable, leaves the suite green, and preserves all working behaviour.

**Phase 0 — truth first (small, high value).** Fix D1, D6, D7, D8, D9; remove the nonexistent
Gemini/OpenAI/Anthropic provider claims; stand up the single provider registry; add the drift test so
the same rot cannot return. Rationale: every later phase builds on these files, and the docs currently
misleads the agent that reads them (`AGENTS.md` is first in the brief's reading order).

**Phase 1 — contracts and safety substrate.** `BrainTask` + `BrainToolAudit`; typed tool registry
(migrating the 12 existing approval tools into it as the first consumers); canonical args +
target snapshots + two-person support in `brain-approvals.ts`; `safe-fetch` + SSRF tests;
memory provenance columns; `retrieval.ts`; intent calibration. Nothing new is *executable* yet.

**Phase 2 — Engineering Mind, read-only.** Fourth mind registered; Tier 0 tools; diagnostics and
reproduction *planning*; patch planning as a proposal only. At the end of this phase the assistant can
inspect, search, reason about and plan a fix, and can change nothing.

**Phase 3 — verified execution.** Actions-backed sandbox; Tier 1 runs; Tier 2 patch proposal →
scratch branch → diff → tests → review pack. The model still cannot merge or deploy.

**Phase 4 — Tier 3, if ever.** Deploy/migration/settings tools behind explicit + two-person approval.
This phase should probably never ship; it is listed for completeness, and the plan recommends
leaving Tier 3 as "operator does it by hand, the assistant prepares the evidence".

---

## 11. Out of scope / explicitly refused

- An unrestricted autonomous agent; background self-modification of application source.
- Any Tier 4 capability, and any design that makes Tier 4 reachable by configuration alone.
- Raw secret, `.env*`, `.freebuff/*` env-backup, or production-data access from any model context —
  note that `.freebuff/` legitimately holds `.env.prod`, `.env.old` and env backups inside the
  working directory (gitignored, confirmed), so the engineering tools' path allowlist must deny it
  explicitly rather than rely on `.gitignore`.
- Replacing the deterministic brains with an LLM, or making any read path depend on a provider key.
- Broad speculative rewrites of `neural-mind.ts` (2 354 lines) or `platform-intelligence.ts`.

## 12. Open items

1. **The brief is truncated at §14.** Requirements after "Proposal-time target snapshots" are unknown;
   the plan may need a §14+ revision.
2. **Sanity check on D3.** Dropping the OpenAI/Anthropic settings keys is a behaviour change in the
   admin console. If those keys are intentionally reserved for `visual-studio.ts`, the registry should
   model them as a *media* capability rather than an AI chat provider — needs an operator decision.
3. **pgvector availability.** `PostEmbedding.pgVec` is declared but the plan cannot confirm the
   extension is enabled on the target Supabase project; `retrieval.ts` treats it as opportunistic and
   falls back to hashed + lexical search either way.
4. **Sandbox runner approval.** Phase 3 depends on the GitHub Actions decision in §6.
