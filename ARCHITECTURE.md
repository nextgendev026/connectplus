# ConnectPlus Architecture

This document describes how ConnectPlus is built, why it is built that way, and where the important decisions live. It is written for a developer joining the project, and for the team that needs to make changes without re-discovering the reasoning.

---

## Overview

ConnectPlus is a Next.js 15 App Router application backed by PostgreSQL (Supabase), with optional offloading to Convex for high-frequency view tracking and ad metrics. It runs as a single serverless deployment on Vercel, with a Cloudflare Worker providing the livescore data proxy.

**Stack:**

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 15, React 19, Tailwind CSS | Server-rendered pages, client interactivity |
| API | Next.js Route Handlers (App Router) | 107 endpoints, serverless functions |
| Database | PostgreSQL via Supabase + Prisma ORM | All persistent data |
| Cache | Upstash Redis (or in-memory fallback) | Rate limiting, session caching, API SWR |
| Offload | Convex (optional) | View counts, ad metrics — high-frequency writes |
| AI | OpenAI / Anthropic / OpenRouter / Gemini | Content generation, analysis, copilot |
| Push | Web Push (VAPID) | Browser notifications, sports alerts |
| Media | Image optimizer (`/api/optimize`) | Resizing, compression, AVIF/WebP negotiation |
| Scheduler | Inngest (serverless cron) | RSS intake, feed health, nightly sweeps |

---

## Folder Structure

```
src/
├── app/                        # Next.js App Router
│   ├── (auth)/                 # Auth flows (sign in, sign up, error)
│   ├── (admin)/admin/          # Admin console (health, neural, ads, etc.)
│   ├── (public)/               # Public pages (home, feeds, sports, etc.)
│   └── api/                    # 107 Route Handlers
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
│   ├── app-brain.ts            # Unified brain facade (hive + neural + platform)
│   ├── brain-approvals.ts      # Write-request queue (propose → approve → execute)
│   ├── brain-issues.ts         # Self-filed issue register
│   ├── brain-pilot.ts          # Editor pilot (ops, reply parser)
│   ├── brain-readings.ts       # Live platform readings (read access)
│   ├── brain-repair.ts         # Self-healing envelope
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

### 5. Cron parity

Both the Inngest scheduler and the safety-net cron registry derive from the same `CRON_JOBS` array. A job that exists in one but not the other is caught by a test. The `cron-wiring.test.ts` file enforces this invariant.

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
