# ConnectPlus Architecture

This document describes how ConnectPlus is built, why it is built that way, and where the important decisions live. It is written for a developer joining the project, and for the team that needs to make changes without re-discovering the reasoning.

---

## Overview

ConnectPlus is a Next.js 16 App Router application backed by PostgreSQL (Supabase), with optional offloading to Convex for high-frequency view tracking and ad metrics. It runs as a single serverless deployment on Vercel, with a Cloudflare Worker providing the livescore data proxy and the edge cache.

**Stack:**

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 16, React 19, Tailwind CSS | Server-rendered pages, client interactivity |
| API | Next.js Route Handlers (App Router) | One handler file per endpoint, serverless functions |
| Database | PostgreSQL via Supabase + Prisma ORM | All persistent data |
| Cache | Upstash Redis (or in-memory fallback) | Rate limiting, session caching, API SWR |
| Offload | Convex (optional) | View counts, ad metrics — high-frequency writes |
| AI | OpenRouter (free tier) · OpenCode Zen · deterministic builtin fallback | Content generation, analysis, copilot. The `openaiApiKey` / `anthropicApiKey` settings exist but are **not** routable by the gateway — see `docs/MODERNIZATION-AUDIT.md` F-04 |
| Push | Web Push (VAPID) | Browser notifications, sports alerts |
| Media | Image optimizer (`/api/optimize`) | Resizing, compression, AVIF/WebP negotiation |
| Scheduler | Inngest (owns every cadence) · Vercel safety-net cron · Cloudflare Worker cron triggers · cron-job.org (legacy) | RSS intake, feed health, nightly sweeps, live scores. All four derive from `src/lib/cron-schedule.ts` |

---

## Folder Structure

```
src/
├── app/                        # Next.js App Router
│   ├── (auth)/                 # Auth flows (sign in, sign up, error)
│   ├── (admin)/admin/          # Admin console (health, neural, ads, etc.)
│   ├── (public)/               # Public pages (home, feeds, sports, etc.)
│   └── api/                    # Route Handlers, one file per endpoint (see `find src/app -name route.ts`)
│       ├── admin/              # Admin-only endpoints
│       ├── ai/                 # AI features (studio, generate, enhance)
│       ├── brain/              # Brain approvals (chat-initiated writes)
│       ├── edge/               # Edge KV proxy (distributed cache)
│       ├── notifications/      # Push subscription, test alerts
│       ├── posts/              # CRUD + search
│       ├── sports/             # Live scores, calendar, predictions
│       └── thumb/              # Image optimization
├── components/                 # React components
│   ├── admin/                  # Admin panels (BrainChat, Diagnostics, etc.)
│   ├── ads/                    # Ad slot rendering
│   ├── feed/                   # Feed cards, hero slideshow
│   ├── notifications/          # Bell, sound settings
│   ├── sports/                 # Scores board, ticker, calendar
│   ├── studio/                 # Composer, copilot, pilot review
│   └── ui/                     # Reusable (OptimizedImage, ViewCount, etc.)
├── lib/                        # Core business logic
│   ├── ai/                     # The acting half of the intelligence pipeline (see docs/agent.md)
│   │   ├── agent-loop.ts       # Bounded tool loop, streamed as tool_call / tool_result / prediction
│   │   ├── agent-trigger.ts    # Decides agent vs. grounded record answer, and reports why
│   │   ├── approval.ts         # Stateless HMAC approval tokens, bound to exact arguments
│   │   ├── guardrails.ts       # Risk tiering, path policing, redaction, sandboxed runner
│   │   ├── git-staging.ts      # Disposable-branch staging with real rollback
│   │   ├── tools.ts            # Repository and diagnostics tools
│   │   └── sports-tools.ts     # Prediction tools, wrapping `sports-forecast.ts`
│   ├── app-brain.ts            # Unified brain facade (hive + neural + platform)
│   ├── brain-approvals.ts      # Write-request queue (propose → approve → execute)
│   ├── brain-issues.ts         # Self-filed issue register
│   ├── brain-pilot.ts          # Editor pilot (ops, reply parser)
│   ├── brain-readings.ts       # Live platform readings (read access)
│   ├── brain-awareness.ts      # Per-domain calibration (ok / warn / unproven)
│   ├── brain-repair.ts         # Self-healing envelope
│   ├── chat-history.ts         # Saved-chat read path: prompt turns, list rows, turn evidence
│   ├── pipeline-health.ts      # Age of evidence per pipeline (blindness ≠ quiet)
│   ├── job-heartbeat.ts        # Cron heartbeat ledger (Redis → Postgres), with tier state
│   ├── query-budget.ts         # Named query ceilings, fail-fast instead of hang
│   ├── hive-brain.ts           # Long-term memory (learned lessons)
│   ├── neural-mind.ts          # Reasoning engine (intent, analysis, actions)
│   ├── platform-intelligence.ts # Senses (creators, traffic, economy, region)
│   ├── ai-provider.ts          # Model gateway (OpenAI, Anthropic, etc.)
│   ├── notification-sounds.ts  # Distinct sound per notification kind
│   ├── mind-actions.ts         # Mutating tools (publish, schedule, flag, etc.)
│   ├── article-forge.ts        # Full-article generation with completion detection
│   ├── copilot-skills.ts       # Copilot learning from kept/discarded edits
│   ├── cron-schedule.ts        # Job registry (Inngest + safety-net parity)
│   ├── cron-jobs.ts            # Job implementations
│   ├── feed-health.ts          # Own-feed validation
│   ├── image-src.ts            # Optimizer URL builder
│   ├── permissions.ts          # Browser permission helpers (notifications, geo)
│   ├── push.ts                 # Web Push delivery
│   ├── seo.ts                  # Metadata builders, JSON-LD
│   ├── settings.ts             # Platform settings (cached)
│   ├── schemas/validators.ts   # Zod schemas for all API input
│   └── ...
├── proxy.ts                    # Middleware (rate limiting, security headers)
├── inngest/                    # Inngest function definitions
└── prisma/                     # Schema + migrations
```

---

## Data Flow

### Read path (page load)

```
Browser → Next.js server → Route Handler → Prisma (Postgres)
                                          ↕ Upstash Redis (cache)
                                          ↕ Convex (view counts)
                 ↓
         Server-rendered HTML + client hydration
```

### Write path (create post)

```
Browser → POST /api/posts → auth() → validateBody(CreatePostSchema)
                                    → prisma.post.create()
                                    → trigger inngest (publish notifications, learn)
                                    → return 201
```

### Brain chat path

```
Admin → POST /api/admin/neural/chat → appBrain.chat()
                                    → gatherReadings() (every subsystem)
                                    → model answer over readings (or fallback)
                                    → neuralMind.processQuery() (if action intent)
                                      → brain-approvals.proposeAction()
                                    → stream response + readings + proposals
```

### Agent path (action requests)

Only requests that *ask for work* take this path — see `agent-trigger.ts`. Record questions stay on
the grounded answer, because reading a number out of the database beats asking a model to recall it.

```
Admin → POST /api/neural-chat (Super Admin)
        → resolveToolCallingTarget()      same gateway as the rest of the platform
        → streamAgentEvents()
             ├── tool_call        args validated (zod) → risk tier → run()
             ├── tool_result      wrapped in <observation> tags and redacted
             ├── prediction       match-model output, rendered as a card
             └── approval         high-risk: stops here, route mints an HMAC token
        → POST /api/neural-chat/approve   consumes the token, runs exactly that operation
```

The approval token never reaches the model: a high-risk tool returns `needsApproval` and stops,
and the route emits the token on a UI-only event. If the tool returned it, the token would enter
the message history on the next step and the model could approve itself.

### Push notification path

```
Event (comment, follow, match) → createNotification()
                                → sendPushToUser() → webpush.sendNotification()
                                                     ↓
Browser push service → SW push handler → notification with kind + vibration
```

---

## Key Design Decisions

### 1. Single brain, not three

The platform grew three intelligence layers (hive mind, neural mind, platform intelligence) independently. `app-brain.ts` is the facade that composes them: `think()` and `chat()` are the two public entry points, `diagnose()` turns the brain on itself, and `readings()` gives it ground truth. Every engine keeps its own tests.

### 2. Read freely, write with approval

The brain has unrestricted read access to the platform (gatherReadings). Every mutation it proposes is filed as a `BrainActionProposal` that a named admin approves in the console. "Yes, publish it" in chat no longer executes anything — it files. This asymmetry exists because a model can type "confirm" as easily as a person can.

### 3. Notifications are distinct by kind

Each notification type has its own synthesised motif, vibration pattern, and tag. The kind travels in the push payload so a closed app buzzes like the event it is. This is a deliberate UX decision: a reader who is not looking at the screen can still tell a comment from an approval from a match goal.

### 4. Images through one pipeline

Every image — covers, avatars, RSS imports, uploaded photos — goes through `/api/optimize`, which negotiates format (AVIF → WebP → JPEG) and resizes by preset (`cover`, `thumbnail`, `avatar`, `og`). Legacy images are backfill-optimized. The optimizer URL is the single source of truth; `OptimizedImage` is the single component.

### 5. One gateway, two models

`ai-provider.ts` resolves every model call, including the agent's. There is no second provider
configuration, so a deployment with OpenRouter or OpenCode already configured gets a working agent
without another key — and `resolveToolCallingTarget()` returns `null` when the resolved provider is
`builtin`, which callers must treat as "tools unavailable" rather than "no such feature".

The **writing** model and the **tool-calling** model are chosen separately on purpose. Prose models
are picked for tone and cost; a small one will accept a tool schema and then answer in prose without
calling anything, which reads as the agent being lazy rather than the model being unable. Tool use
needs a model that reliably emits structured calls.

### 6. Unmeasured is not degraded

A subsystem that could not be measured and a subsystem that measured badly are different facts, and
this codebase keeps them apart at every layer that reports health:

- `pipeline-health.ts` yields `unknown`, never `ok`, when evidence is absent — "blindness is reported
  as blindness".
- `brain-awareness.ts` mirrors the severity of the checks under it, so an unmeasurable pipeline
  becomes `unproven` rather than `warn`.
- `admin-intelligence.ts` counts `unproven` **separately from** `degraded`, because an engine nobody
  has observed is a gap in observation. The prompt in that module already said it: *an unproven
  model is not a failing one.*

This is not cosmetic. Before it, a fresh instance with no recorded cron run reported "17 of 17 jobs
behind", and the console's "engines not green" count mixed faults with things nobody had looked at
— which is how a health board trains its operator to ignore it.

### 7. Cron parity

**Four** schedulers can run a job, and all of them read the same `CRON_JOBS` registry:

| Scheduler | Owns |
| --- | --- |
| Inngest | every cadence — the intended owner |
| Vercel cron (`vercel.json`) | exactly one entry: `/api/cron/safety-net`, daily at 00:15 UTC |
| Cloudflare Worker (`workers/edge-cache`) | the five high-frequency jobs, every 2–360 minutes |
| cron-job.org | legacy external trigger for `/api/cron?trigger=<id>` |

A job that exists in the registry but not in the Inngest wiring is caught by a test, and the Vercel
cron count is pinned by another. Before Phase A this section said Inngest was the only scheduler,
which hid the fact that the edge Worker owns the two-minute board. See
`docs/MODERNIZATION-AUDIT.md` for the full drift list.

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | Session encryption key |
| `NEXTAUTH_URL` | Yes | App URL for session callbacks |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | No | Google OAuth |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | No | Web Push notifications |
| `OPENAI_API_KEY` | No | OpenAI model access |
| `ANTHROPIC_API_KEY` | No | Claude model access |
| `OPENROUTER_API_KEY` | No | OpenRouter gateway |
| `SENTRY_DSN` | No | Error tracking |
| `NEXT_PUBLIC_SENTRY_DSN` | No | Client-side error tracking |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | No | Distributed cache/rate limiting |
| `NEXT_PUBLIC_CONVEX_URL` | No | Convex offload for views/ads |

---

## Testing Strategy

| Layer | Tool | What it covers |
|-------|------|----------------|
| Unit tests | Vitest | Business logic, schemas, validators, pure functions |
| E2E tests | Playwright | Studio flow, sports board, feed rendering |
| Build checks | `npm run build` | Compilation, tree-shaking, route generation |
| Runtime probes | Readings pack | Live database connectivity, subsystem health |

Run `npm test` for the full suite. Run `npx vitest run tests/unit/brain-approvals.test.ts` for a single file.

---

## Deployment

See [DEPLOYING.md](./DEPLOYING.md) for the deployment process, pre-flight checks, and rollback plan.
