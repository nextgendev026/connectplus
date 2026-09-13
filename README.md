# connectPlus

Full-stack publishing and live-sports platform built with Next.js 16 (App Router), Prisma ORM + PostgreSQL, and NextAuth.js. Designed for East African audiences and creators — multi-regional node support, Kenyan radio streaming, RSS ingestion, a dual-intelligence Neural Mind system, a real-time multi-source livescore desk with a benchmarked betting model, a comprehensive monetization pipeline, and a savanna-inspired brand.

## Tech Stack

- **Framework:** Next.js 16 (App Router, React 19)
- **Database:** PostgreSQL via Prisma ORM (Supabase)
- **Auth:** NextAuth.js v5 (Credentials + JWT sessions)
- **Storage:** Supabase Storage bucket (`uploads`, public, 5MB limit)
- **Styling:** Tailwind CSS with CSS variable theming (light/dark mode, WCAG-compliant)
- **Charts:** Recharts · **Icons:** Lucide React
- **Streams:** RSS parsing via `rss-parser`
- **Background Jobs:** Inngest (serverless cron — RSS poll and per-feed drain, status watchdog, thumbnail recovery, scheduled publishing, livescore heartbeat, favourite alerts, model intelligence, nightly training)
- **Cache:** Redis (Cloud) with in-memory fallback
- **Edge:** Cloudflare Workers fronting the origin — anonymous HTML, read-only API JSON and optimised images are answered at the edge, and the live scores board has its own short-TTL / stale-while-revalidate tier (`workers/edge-cache`)
- **Sports data:** multi-source, keyless-capable — football-data.org, TheSportsDB, ESPN's public scoreboard, OpenLigaDB, coalesced onto one normalised fixture
- **Realtime Views:** Convex (article view counters, ad metrics offloaded from Supabase)
- **AI Providers:** OpenRouter (free tier), OpenCode Zen, OpenAI, Anthropic — dynamically fetched model lists

## Features

### Content & Editorial
- **Neural feed** — the home feed ranks stories with a hybrid neural-intent scoring pipeline combining text analysis, recency, engagement, and regional relevance.
- **Creator Studio + Brain Copilot** — markdown editor with insert-at-cursor formatting toolbar, drag-and-drop cover upload, real auto-save, edit mode, and a My Stories manager. The Brain Copilot reads the current draft + text selection and writes results back at the cursor (Polish / Continue / Outline / Curate), or fills in title / excerpt / tags.
- **AI Pipeline** — dynamic provider system with auto-discovered free models from OpenRouter and OpenCode Zen. Admins inject API keys, pick a model from a live dropdown, and set the default AI that powers inline curation, brain training, and the copilot. Built-in deterministic fallback when no key is configured.
- **Neural Mind chat** — admin chat brain answers dynamically: platform intents (health, growth, moderation, trends), content creation (write, polish, summarize, headlines, tags, outlines), with one-click Open in Studio / Save as draft / Copy.
- **RSS ingestion** — per-feed polling with batched inserts, thumbnail recovery, feed health tracking (status/error/lastError), and Inngest-scheduled execution. 11+ feeds covering BBC Africa, TechCabal, SautiBus, and more.

### Social Layer
- **Follows & bookmarks** — toggle with denormalized counters, profile pages with tabs (posts / saved / about / stats).
- **Share system** — robust share popup (X, Facebook, LinkedIn, WhatsApp, Telegram, email, copy) with live link-preview card, SEO-optimized share URLs, and mobile-friendly positioning.
- **Profile** — avatar upload, cover images, bio, follower/following lists, verified writer badges.

### Monetization Pipeline
- **First-party ads** — admin-created creatives (image + click-through tracking) served per-slot (feed-inline, article-top, article-inline, article-sidebar, radio-hero) with weight-based rotation.
- **Third-party ad slots** — inject Google AdSense, Facebook Audience Network, MGID, Propeller, or custom HTML `<script>` tags into any placement. Server-rendered, no client-side auction.
- **Real-time ad analytics** — impression and click tracking for both first-party and third-party slots, displayed in the admin Monetization console.

### Subscription System
- **3 tiers × 2 audiences** — Free / Pro / Premium for both Readers and Writers.
- **Reader plans:** unlimited reading → ad-free + AI recommendations → exclusive content + offline reading.
- **Writer plans:** 5 articles/month → unlimited + AI editor + SEO → team collab + API + revenue share.
- **User controls** — subscribe, cancel (at period end), reactivate. Usage tracking per billing cycle.
- **Admin console** — manage plans, view features/pricing cards, filter by audience.

### Sports Hub

- **Multi-source livescores** — one normalised board merged from every configured feed:
  football-data.org (key), TheSportsDB, ESPN's public scoreboard and OpenLigaDB.
  Sources run in parallel and are coalesced per fixture, so a source filling only
  part of a fixture (odds, venue, live minute) contributes that part instead of
  being discarded, and one throttled feed never empties the page.
- **Edge-served live board** — the board polls `<edge>/__livescore`, a canonical
  alias that collapses every viewer's poll into one origin fetch per TTL window
  (15s fresh, 45s stale-while-revalidate) and answers cross-origin from
  Cloudflare's edge. Unset `NEXT_PUBLIC_EDGE_URL` and it falls back to the app's
  own route, same payload, no edge tier.
- **Keyless by default** — with no API keys at all the hub still shows real
  fixtures from TheSportsDB's public key, ESPN and OpenLigaDB rather than
  synthetic data; the demo feed is only ever a last resort.

| Source | Key | Covers | Priority |
| --- | --- | --- | --- |
| football-data.org | `SPORTS_API_KEY` | Live scores, odds, xG-ish detail for major leagues | 1 |
| TheSportsDB | `SPORTSDB_API_KEY` (public key by default) | Wide league coverage, venues, badges | 2 |
| ESPN scoreboard | none | Live state and minute, basketball included | 3 |
| OpenLigaDB | none | German league depth, historical fixtures | 4 |
| `demo` | none | Synthetic fixtures with a moving clock — only when every real source is unavailable, and always labelled as such in the UI | last |

Each adapter normalises onto one `NormalizedMatch` shape, so the public hub, the
betting analyser and the hive-mind learner all speak the same language and adding
a feed never touches the UI.
- **Relevance-ranked** — a wide aggregator returns hundreds of fixtures from
  leagues nobody here can watch; regional leagues rank first, then the big
  european competitions, then everything else, so the first screen is always the
  football this audience cares about.
- **In-app betting analysis** — four markets (1X2, over/under 2.5, BTTS, correct
  score) derived from one Poisson grid, blended with the de-vigged market price
  and the **combined mind's** own learned lessons (result history and learned
  competition scoring), each with a written rationale.
- **Betting tips tab** — the published model's highest-conviction pending picks,
  filterable by market and sortable by confidence or edge over the closing line.
- **Benchmarked model** — a `market-baseline` strategy that simply follows the
  closing odds is graded through the identical settlement path, so the admin
  model record can answer whether the model beats the line.
- **Favourite alerts** — star a fixture (or follow a team) and a five-minute job
  notifies the reader at kick-off, on going live, at full time and when a pick on
  that match settles. Delivery is idempotent: a `(reader, fixture, event)` ledger
  means the 2-minute livescore heartbeat can never double-send.
- **Admin console** — source health per feed (fetched vs on-the-board counts),
  provider/key status, referral partner CRUD with referral-code injection,
  14-day activity, the model record, and alert-pipeline counters.

### Live Radio
- **Kenyan + regional radio** — 30+ stations (Capital FM, Kiss FM, NRG, Radio Citizen, Clouds, etc.) with server-side stream proxy to strip ICY metadata corruption and deliver clean audio.
- **HD mode** — optional direct-stream bypass for higher bitrate.
- **Radio page** — hero section, station grid, mini-player with pause/resume, session persistence.

### Admin Console
- **Command Center** — dashboard with key metrics.
- **Neural Mind** — chat interface for platform intelligence.
- **AI Pipelines** — semantic index coverage, moderation queue, learning loop, A/B experiments, agent control panel.
- **Moderation** — post moderation queue with approve/reject/flag.
- **Content Console** — manage posts, toggle featured, categorize RSS imports.
- **Monetization** — first-party ad manager, third-party ad slot configurator.
- **Subscriptions** — plan management cards with pricing and features.
- **RSS Feeds** — feed health dashboard with status, error rates, last polled.
- **Integrations** — one console over every platform connection (Cloudflare edge, Inngest, Postgres, Redis, Convex, storage, Stripe, Resend, AI providers, RSS, alerts, hosting, PWA): live health probes, credential audit per env var, and a scheduled-jobs table with run-now.
- **Settings** — site identity, SEO, analytics, chat widget, feature flags, API keys.
- **Sticky sidebar** — stays in view while scrolling on desktop.

### SEO & Performance
- **Structured data** — site-wide `WebSite` + `SearchAction` + `Organization`
  graph in the root layout (sitelinks search box and knowledge panel), a
  `CollectionPage` + `BreadcrumbList` on the sports desk, and JSON-LD `Article`
  schema, Open Graph and Twitter cards per article.
- **Sitemap & robots.txt** — auto-generated and indexable when enabled. The
  sitemap gives each route its own cadence rather than one blanket "weekly":
  the live scores desk and home feed are `hourly`, radio/categories `daily`,
  legal pages `yearly`. Published stories and authors-with-published-work
  profiles are included, each query independently guarded so one unavailable
  table can't drop the whole route from the crawl.
- **Feed cache** — Redis-backed with in-memory fallback, 3-tier fallback (live → Redis → memory).
- **Feed resilience** — three-tier fetch with `force-dynamic` on query-driven routes, correct `Cache-Control` headers per endpoint.

### Weather Widget
- **Real-time location** — GPS tracking with cookie persistence (accept once, no more prompts).
- **Animated** — SVG cloud, sun, rain, and snow animations.
- **Forecast** — hourly + 7-day with temperature, humidity, wind.

### PWA
- **Installable** — web manifest, service worker, splash screen, app icons.
- **Offline** — cached shell for offline reading.

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Fill in the keys below, then apply the schema
npm run db:migrate
npm run db:generate

# Seed the database (optional but recommended)
npm run db:seed

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Migrations:** always change the schema via `npm run db:migrate` (Prisma `migrate dev`). Avoid `db:push` for shared/production schemas.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` / `DIRECT_URL` | Prisma PostgreSQL connection (pooled + direct) |
| `AUTH_SECRET` | NextAuth v5 secret (JWT signing) |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` / `AUTH_URL` | Legacy auth secret / canonical URL |
| `AUTH_TRUST_HOST` | Set `1` when behind a proxy (Vercel) |
| `SUPABASE_URL` | Supabase project URL (uploads + storage) |
| `SUPABASE_SERVICE_KEY` | Service key for Storage uploads (server-only) |
| `SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_STORAGE_BUCKET` | Storage bucket name (default `uploads`) |
| `REDIS_URL` | Redis Cloud connection string |
| `INNGEST_SIGN_KEY` / `INNGEST_EVENT_KEY` | Inngest cloud queue keys — Inngest owns every scheduled job's cadence |
| `INNGEST_MANAGEMENT_KEY` | Optional — read-only run history from Inngest's API on `/status` |
| `EDGE_URL` | Public URL of the Cloudflare edge Worker; probed at `<url>/__edge`. Editable from Admin → Integrations when unset |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Only needed to deploy the edge Worker from CI (`scripts/deploy-worker.mjs`) |
| `NEXT_PUBLIC_EDGE_URL` | Edge URL used **by the browser** for the livescore poll (`<url>/__livescore`). Leave blank to poll the app route instead |
| `SPORTS_PROVIDER` | `auto` \| `football-data` \| `sportsdb` \| `espn` \| `openligadb` \| `demo` |
| `SPORTS_API_KEY` | football-data.org token — highest-priority source |
| `SPORTSDB_API_KEY` | TheSportsDB key; falls back to the public key when unset or rejected |
| `SPORTS_KEYLESS` | `on`/`off` — include the keyless tier (ESPN, OpenLigaDB) |
| `SPORTS_CACHE_TTL_SECONDS` | Live snapshot cache (default 30) |
| `SPORTS_DAY_CACHE_TTL_SECONDS` | Past/future day snapshot cache (default 600) |
| `OPENROUTER_API_KEY` | OpenRouter API key (free models available) |
| `OPENCODE_API_KEY` | OpenCode Zen API key |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Optional paid AI providers |
| `CRON_SECRET` | Shared secret the `/api/cron` and `/api/rss/cron` triggers verify (Bearer / `x-cron-secret`) |
| `CRONJOB_TOKEN` | cron-job.org API key — schedules the heavy jobs via `/api/cron` (`npm run cronjob:sync`) |
| `APP_URL` | Deployment base URL cron-job.org should hit (default `https://connectplusapp.vercel.app`) |
| `RSS_POLL_MAX_FEEDS_PER_RUN` | Max feeds polled per cron cycle (default 10) — caps free-tier egress when feeds fall behind |
| `THUMB_RECOVERY_MAX_NETWORK` | Max publisher page fetches per thumbnail-recovery run (default 12) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe API key + webhook signing secret (billing for paid plans) |
| `RATE_LIMIT_<KEY>` / `RATE_LIMIT_DEFAULT` | Optional rate-limit overrides |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` for server logging |

## Scripts

- `npm run dev` — development server
- `npm run build` — production build
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm test` / `npm run test:watch` — unit tests (Vitest)
- `npm run test:e2e` — E2E smoke tests (Playwright)
- `npm run db:migrate` / `db:migrate:prod` — dev / deploy migrations
- `npm run db:seed` — seed creators + content
- `npm run db:promote-admin` — promote all ADMIN accounts to SUPER_ADMIN
- `npm run db:feed-mind` — seed the Neural Mind knowledge base
- `npm run cronjob:sync` — legacy: push `/api/cron` schedules to cron-job.org (`scripts/cronjob-sync.mjs`). Inngest owns the cadence now; keep this only if you still want an external scheduler calling the manual endpoints
- `npm run supabase:cron:install` — apply the DB-only maintenance jobs (`supabase/cron-maintenance.sql`) to Supabase pg_cron, so pruning runs inside Postgres instead of on Vercel

## Database Seeding

`prisma/seed.ts` creates sample data: users (including an `admin`), categories, tags, and published posts. After seeding, sign in with:

- Regular creators: `user@connectplus.io` with password `Password123!`
- Admin: `connect@plus.com` / `Mtemi@254#`

## Deploying

- **Vercel** — connect the repo; set all env vars in project settings. Inngest owns every scheduled job; Vercel's single cron slot runs the safety net.
- **GitHub Actions** — typecheck, lint, unit tests, and build on every push/PR.

### Scheduled jobs

**Inngest owns every cadence.** The cron triggers live in
`src/inngest/functions.ts` and mirror `src/lib/cron-schedule.ts`, which is the
registry the admin console reads:

| Job | Cadence | Essential |
| --- | --- | --- |
| Scheduled publishing | every 5 min | ✅ |
| Status watchdog | every 5 min | ✅ |
| RSS syndication | hourly | ✅ |
| Livescore heartbeat | every 2 min | |
| Favourite alerts | every 5 min | |
| Radio metadata sweep | every 15 min | |
| Sports intelligence | every 30 min | |
| Thumbnail recovery | every 6 h | |
| Nightly hive training | 01:00 UTC | |
| Semantic index | 01:30 UTC | |
| Daily status snapshot | 00:05 UTC | |

Every run — Inngest cron, an admin "Run now", or an external trigger — stamps a
heartbeat in Redis. That ledger is what makes the fallback cheap:

- **Vercel** keeps exactly **one** cron: `/api/cron/safety-net` daily at 00:15
  UTC. It reads the heartbeats and re-runs **only the essential jobs that have
  gone stale**. While Inngest is healthy it is a no-op — a few Redis reads, no
  database or upstream traffic.
- `/api/cron?trigger=…` remains for cron-job.org and the admin console, and
  `?force=1` on the safety net runs all essentials immediately.

**The trigger list is derived from the registry**, never hand-kept: every id in
`CRON_JOBS` is automatically a valid `/api/cron?trigger=<id>`, so adding a job
cannot leave the external scheduler behind. `GET /api/cron` (no trigger) returns
the discovery payload — every job with its cron expression, heartbeat and
staleness — which is what you paste into cron-job.org:

```
URL           https://<your-domain>/api/cron?trigger=sports-live
Schedule      every 2 minutes
Header        Authorization: Bearer <CRON_SECRET>
```

Legacy trigger names (`recover-thumbnails`, `radio-sweep`) still resolve, so an
already-configured scheduler keeps working.

Inngest cron triggers only fire while the app is synced to Inngest Cloud; if the
app is unsynced or paused, the daily safety net is what keeps publishing, the
feed and the watchdog alive.

### Cloudflare edge cache (free tier)

Cloudflare sits in front of the Vercel deployment so anonymous traffic never
reaches an origin function. On an edge HIT the Vercel function is not invoked
and no bytes travel origin→edge, which is what keeps **Fast Origin Transfer**
and **Fluid Active CPU** flat.

- **Worker:** `workers/edge-cache` — deployed as `connectplus-edge` and served at
  `https://connectplus-edge.connectplusapp.workers.dev`
- **Deploy:** `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/deploy-worker.mjs`
  (no wrangler install required; `wrangler.toml` is there if you prefer it)
- **What is cached:** anonymous HTML (60s), read-only API JSON (30–600s), covers,
  optimised images and static assets (immutable). Root files that are not
  content-hashed — `/favicon.ico`, the PWA icons, `/sw.js`, `robots.txt`, the
  sitemap — get an hour instead, so a fixed icon actually reaches readers.
  AVIF and WebP are cached as separate variants so the first caller can't
  poison the other format.
- **Livescore tier:** sports JSON gets a short TTL with a much longer
  `stale-while-revalidate` window (15s / 45s for the board, 30s / 90s for the
  tips, 300s / 900s for partner offers). Past its TTL the edge hands the reader
  the stale copy **immediately** and refreshes behind them in `ctx.waitUntil`,
  so a viewer never waits on the origin — a 15-second-old score beats a spinner.
  `/__livescore` is the canonical alias: it keeps only the params that change the
  payload (`sport`, `date`) and snaps them to a closed set, so cache-busting
  params can't shred the cache into one entry per viewer. `X-Edge-Age` reports
  the served age.
- **Safety model:** any request carrying `Cookie` or `Authorization`, plus any
  response carrying `Set-Cookie`, is passed through and never stored — a
  signed-in reader can never be served another visitor's HTML. Reader-scoped
  sports routes (follows, reminders, tracking) are never cached at all.
- **Observability:** set `EDGE_URL` (env, or the Cloudflare edge URL field in
  Admin → Integrations) and the worker shows up on `/status` alongside the
  database, Redis and Inngest.
- **Audit:** Admin → **Integrations** probes the worker live and reports its
  origin, latency and credential state next to every other integration.
- **Free-tier budget:** Workers free plan is 100k requests/day with a 10ms CPU
  ceiling; the worker is a lookup plus a fetch and uses no KV, Durable Objects
  or R2 bindings.

> **R2 storage offload is not active yet.** R2 requires an activated
> subscription on the Cloudflare account before even the first bucket can be
> created, so uploads and covers still use Supabase Storage. `R2_*` vars are
> declared in `.env.example` for the day it is switched on.

## Architecture

```
connectPlus/
├── src/
│   ├── app/
│   │   ├── (public)/          # Public pages (home, article, profile, radio, sports, studio)
│   │   ├── (admin)/admin/     # Admin console (dashboard, neural, ai, moderation, rss, sports, etc.)
│   │   ├── api/               # API routes (posts, auth, ads, subscription, rss, sports, etc.)
│   │   ├── feed.xml/          # RSS feed
│   │   ├── sitemap.ts         # Dynamic sitemap
│   │   └── robots.ts          # Robots.txt
│   ├── components/            # React components (ads, admin, layout, profile, radio, sports, ui, weather)
│   ├── lib/                   # Core libraries (sports + sports-intelligence + sports-accuracy,
│   │                          #   sports-notifications, sports-endpoint, db-retry, ai-provider,
│   │                          #   ads, feed-ranker, hive-brain, cron-schedule, etc.)
│   ├── inngest/               # Inngest functions (rss poll + drain, sports live/notify/intel, etc.)
│   └── proxy.ts               # Rate limiting middleware
├── convex/                    # Convex functions (views, ads — offloaded from Supabase)
├── workers/edge-cache/        # Cloudflare Worker: edge cache + livescore tier
├── prisma/                    # Schema, migrations, seed
└── public/                    # PWA assets, icons, manifest
```

## Testing

- **Unit (Vitest)** — `npm test` (225 tests). Beyond utilities, intent classification
  and sentiment, the suite pins the contracts that were expensive to learn:
  RSS due-feed ordering and per-run batching (`rss-poll-order`), cron registry ↔
  Inngest wiring (`cron-wiring`), multi-source coalescing and competition relevance
  (`sports-sources`, including live-minute parsing), market grading
  (`sports-markets`), calibration bucketing and strategy comparison
  (`sports-accuracy`), the combined-mind ensemble (`sports-mind`), transient-DB
  retry (`db-retry`), and WCAG AA contrast for both themes (`contrast`).
- **E2E (Playwright)** — `npm run test:e2e` smoke-checks public pages and sign-in.

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
