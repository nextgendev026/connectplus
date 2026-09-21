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
- **AI Providers:** OpenRouter (free tier) and OpenCode Zen — dynamically fetched model lists, free-tier-only by policy, with a deterministic builtin fallback when no key is configured. No other provider is routable: the `openaiApiKey` / `anthropicApiKey` settings exist for the integrations probe but the gateway never calls them (`docs/MODERNIZATION-AUDIT.md` F-04)

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
- **Two payment rails, because the audience is two audiences** — Safaricom
  **Daraja (M-Pesa)** for a Kenyan handset and **PayPal** for cards and diaspora
  members. Stripe was removed: it does not serve East Africa, so every paid plan
  was unreachable for the people this platform is built for.
- **M-Pesa via STK push** — the member enters a phone number, a payment prompt
  arrives on the handset, and the plan activates when Safaricom confirms.
  Checkout polls `/api/payments/intents/<id>`, which asks Safaricom directly, so
  a payer sees the outcome even if the callback is slow or cannot reach a local
  dev machine. M-Pesa settles in **whole shillings**: USD plans are converted at
  `MPESA_KES_PER_USD` and rounded, because a fractional shilling cannot be
  charged.
- **PayPal via Orders or Subscriptions** — a plan with a PayPal plan id buys a
  true recurring subscription that PayPal renews by itself; without one, the
  member pays a single period and renews deliberately, so nothing auto-charges
  by accident. PayPal cannot settle KES, so its prices are USD.
- **Money is never trusted from a callback.** Every checkout writes a
  `PaymentIntent` **first**, and each notification is matched back to it by the
  reference we issued. A Daraja "success" with no `MpesaReceiptNumber`, or with
  an amount that does not match what we asked for, is refused and logged; a
  PayPal webhook that fails signature verification is answered 503 rather than
  trusted. Both deliveries are claimed in a `PaymentEvent` ledger first, so a
  retry — Safaricom repeats, PayPal retries for days — can never extend a
  membership twice.
- **Self-service controls** — subscribe, cancel (at period end, propagated to
  PayPal so it genuinely stops billing), reactivate. Usage tracking per cycle.
- **Admin console** — **Payments** shows each rail, the exact environment
  variables still missing, a live credential check, settlement prices per rail,
  revenue split per currency, every attempt with the provider's failure reason,
  and the inbound notification ledger. Operators can reconcile a membership
  against PayPal, expire lapsed periods, mark a payment refunded, or grant a
  plan for money taken outside the app.
- **Scheduled reconciliation** — `payments-lifecycle` repairs PayPal drift and
  ends lapsed periods every six hours, from Inngest and from the Cloudflare edge
  Worker, so a webhook that never arrived is corrected rather than permanent.

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
- **Real crests and form** — provider crest URLs are rendered on every row with an
  initials monogram fallback, so a hotlink-blocked badge degrades to a lettered
  chip instead of a broken image, and each side's last five results show as
  compact W/D/L pills straight from the fixture payload.
- **Head-to-head and recent form** — opening a fixture loads `/api/sports/h2h`,
  which resolves both sides' last results and any direct meetings from real played
  matches (cached on the team pair, and on Redis for ten minutes, so two fixtures
  involving the same club cost one round trip). Team names are reconciled across
  providers — `Chelsea FC` and `Chelsea` are the same club — but the match stays
  strict, because collapsing `Arsenal` into `Arsenal de Sarandi` and handing one
  club's form to another is far worse than simply not knowing.
- **Real evidence in the model** — the Poisson grid's strength estimate used to be
  a hash of the team *name*, carrying no football information at all. Real recent
  results now replace it (weighted by sample size, three matches before it is
  trusted at all) and head-to-head totals gently shape the fixture, so the base
  model reasons from matches these teams actually played.
- **Admin console** — source health per feed (fetched vs on-the-board counts),
  provider/key status, referral partner CRUD with referral-code injection,
  14-day activity, the model record, and alert-pipeline counters.

### Operator Directives

The admin console's chat is not just a question box — it **teaches the combined
mind**. A standing instruction typed there ("favour home teams in La Liga",
"avoid high scoring in Serie A", "strongly favour Gor Mahia") is parsed into a
bounded numeric nudge, stored as a mind memory under `source: "operator"`, and
consulted by every sports prediction from the next model pass onward. Directives
are managed from the widget's **Directives** tab (or
`/api/admin/neural/directives`) and can be revoked without being deleted, so the
model's past behaviour stays explainable.

Two rules keep it safe. Parsing is conservative: without an explicit instruction
verb *and* a resolvable numeric effect (or a forced `directive:` prefix), ordinary
conversation parses to nothing, so chat about fixtures cannot silently bend the
model. And the effect is bounded — at most 20 probability points on the home/away
split and 0.8 goals of scoring expectation, however emphatically it is phrased.
Every applied directive is named in the published rationale, so a reader can
always see that a human, not the model, moved a pick.

### Live Radio
- **Kenyan + regional radio** — 30+ stations (Capital FM, Kiss FM, NRG, Radio Citizen, Clouds, etc.) with server-side stream proxy to strip ICY metadata corruption and deliver clean audio.
- **HD mode** — optional direct-stream bypass for higher bitrate.
- **Radio page** — hero section, station grid, mini-player with pause/resume, session persistence.
- **Ad interruptions kept off the dial.** Several free relays (Zeno, Radiojar,
  RadioKin, shoutcast resellers) sell listener time, so a *new* HTTP session can
  open with a pre-roll spot. The player used to reconnect three seconds after
  any hiccup — and because every reconnect opens a fresh session, one advert
  became an endless chain of them. Reconnects are now floored at 8s, resume the
  last channel that actually produced audio instead of blindly re-dialling
  channel 0, and auto-tune picks the least ad-prone mount first. A long stall on
  an ad-prone relay is labelled an ad break with a one-tap skip, rather than an
  unexplained "reconnecting…".
- **Live scores strip** — a compact, self-refreshing scoreboard sits under the
  market exchange, live matches first, so a reader who came for the dial can see
  what is being played right now without leaving the page. It shares the full
  board's endpoint (and therefore the Cloudflare edge entry on a configured
  deploy) and renders nothing at all when it has nothing to show, because a
  sports feed having a bad day must not leave an error box under the radio dial.

### Admin Console
- **Command Center** — dashboard with key metrics.
- **Neural Mind** — chat interface for platform intelligence, with four tabs:
  **Ask** (the conversational brain), **Brains** (corpus health plus manual
  training passes), **Directives** (standing instructions to the model, see
  Operator Directives above), and **Train** — point the combined mind at a
  subject it has no way to know about (a league, a market, a competitor) and it
  researches the open web and *keeps* what it reads, so the next question is
  answered from memory instead of fetched again. Tick **Tag as sports** to make
  it citable by the prediction engine.
- **AI Pipelines** — semantic index coverage, moderation queue, learning loop, A/B experiments, agent control panel.
- **Moderation** — post moderation queue with approve/reject/flag.
- **Content Console** — manage posts, toggle featured, categorize RSS imports.
- **Monetization** — first-party ad manager, third-party ad slot configurator.
- **Subscriptions** — plan management cards with pricing and features.
- **RSS Feeds** — feed health dashboard with status, error rates, last polled.
- **Integrations** — one console over every platform connection (Cloudflare edge, Inngest, Postgres, Redis, Convex, storage, Safaricom Daraja, PayPal, Resend, AI providers, RSS, alerts, hosting, PWA): live health probes, credential audit per env var, and a scheduled-jobs table with run-now.
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

### Notifications

Two tiers, because they answer different questions:

- **In-app** — a notification row per recipient, read by the bell and the
  `/notifications` page. Always on; needs nothing configured.
- **Background push** — the same event delivered to the operating system, so it
  arrives with the app closed. Requires a VAPID key pair
  (`node scripts/generate-vapid-keys.mjs`). Until both halves are set, the bell
  says so plainly instead of offering a button that does nothing.

Sources of notifications: replies and follows, newly published stories from
writers you follow, and **your followed teams and starred fixtures** — kick-off,
live, full-time, and how a model pick on them settled. Match alerts are
idempotent per `(user, match, event)`, so a job that runs every two minutes can
never double-send, and per-reader pushes are aggregated so a busy afternoon
cannot stack three banners for three different matches.

`POST /api/notifications/test` writes a real notification on demand — the fastest
way to tell "nothing has happened yet" apart from "delivery is broken".

### PWA
- **Installable** — web manifest, service worker, splash screen, app icons.
- **Offline** — cached shell for offline reading.
- **Push-ready** — the service worker handles `push` and `notificationclick`,
  focusing an existing tab or opening the target URL.

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
| `NEXT_PUBLIC_VAPID_KEY` | Web push public key — `node scripts/generate-vapid-keys.mjs`. Must keep the `NEXT_PUBLIC_` prefix so Next inlines it into the client bundle |
| `VAPID_PRIVATE_KEY` | Web push private key (server-only). Both halves are required; with only the public key the browser subscribes and the server can never sign a send |
| `VAPID_SUBJECT` | Contact address sent to the push services, e.g. `mailto:you@example.com` |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL — off-Supabase buffer for article views and ad metrics. Unset falls back to Postgres for both |
| `CONVEX_DEPLOY_KEY` | Only needed to push Convex functions (`npx convex deploy`) |
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
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | **Not routed.** Stored and probed by the Integrations console, but the AI gateway only speaks OpenRouter and OpenCode Zen — setting these enables no AI capability today (`docs/MODERNIZATION-AUDIT.md` F-04) |
| `CRON_SECRET` | Shared secret the `/api/cron` and `/api/rss/cron` triggers verify (Bearer / `x-cron-secret`) |
| `CRONJOB_TOKEN` | cron-job.org API key — schedules the heavy jobs via `/api/cron` (`npm run cronjob:sync`) |
| `APP_URL` | Deployment base URL cron-job.org should hit (default `https://connectplusapp.vercel.app`) |
| `RSS_POLL_MAX_FEEDS_PER_RUN` | Max feeds polled per cron cycle (default 10) — caps free-tier egress when feeds fall behind |
| `THUMB_RECOVERY_MAX_NETWORK` | Max publisher page fetches per thumbnail-recovery run (default 12) |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | Safaricom Daraja app credentials (M-Pesa checkout) |
| `MPESA_SHORTCODE` / `MPESA_PASSKEY` | Paybill/till number and its Lipa na M-Pesa passkey |
| `MPESA_ENV` | `production` for live money; anything else uses the Daraja sandbox |
| `MPESA_KES_PER_USD` | Rate used to price a USD plan on the M-Pesa rail (default 129) |
| `MPESA_CALLBACK_URL` / `MPESA_CALLBACK_TOKEN` | Optional callback override and shared secret appended to the callback URL |
| `MPESA_CALLBACK_IP_CHECK` / `MPESA_ALLOWED_IPS` | Optional Safaricom source-IP allowlist for the callback |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | PayPal REST app credentials |
| `PAYPAL_WEBHOOK_ID` | Required to verify inbound webhooks — without it they are refused, not trusted |
| `PAYPAL_ENV` | `live` for production; anything else uses the PayPal sandbox |
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

- **Vercel** — the repo is linked to the `connectplus` project (`project.json`
  in `.vercel/` carries the project and org ids), deploys from `main`, region
  `fra1`, with `npm run vercel-build` as the build command: migrate → generate →
  ensure settings → `next build`. Every runtime secret lives in **project
  settings → Environment Variables**; `.env.example` is the checklist, and
  Admin → Integrations / Payments reports which of them are still absent at
  runtime. Vercel's single cron slot runs the safety net only (`vercel.json`
  declares exactly one entry, a contract a unit test enforces).
- **GitHub Actions** — typecheck, lint, unit tests, and build on every push/PR.

### Scheduled jobs

**Inngest owns every cadence.** The cron triggers live in
`src/inngest/functions.ts` and mirror `src/lib/cron-schedule.ts`, which is the
registry the admin console reads:

The table below is the whole registry. It is checked against `CRON_JOBS` by
`tests/unit/docs-drift.test.ts`, so a job added to the code and not here fails the suite instead of
becoming invisible.

| Job id | Name | Cron | Essential |
| --- | --- | --- | --- |
| `publish-scheduled` | Scheduled publishing | `*/5 * * * *` | ✅ |
| `status-watchdog` | Status watchdog | `*/5 * * * *` | ✅ |
| `rss-poll` | RSS syndication | `0 */12 * * *` | ✅ |
| `sports-live` | Livescore heartbeat | `*/2 * * * *` | |
| `sports-notify` | Favourite alerts | `*/5 * * * *` | |
| `marketing-sweep` | Self-marketing sweep | `*/15 * * * *` | |
| `radio-status-sweep` | Radio metadata sweep | `*/15 * * * *` | |
| `sports-intel` | Sports intelligence | `*/30 * * * *` | |
| `thumbnail-recovery` | Thumbnail recovery | `15 */6 * * *` | |
| `payments-lifecycle` | Payment reconciliation | `30 */6 * * *` | |
| `platform-pulse` | Platform pulse | `45 */6 * * *` | |
| `feed-health` | Outbound feed health | `30 * * * *` | |
| `status-daily-snapshot` | Daily status snapshot | `5 0 * * *` | |
| `hive-sweep` | Nightly hive training | `0 1 * * *` | |
| `embed-posts` | Semantic index | `30 1 * * *` | |
| `analytics-retention` | Analytics retention | `30 2 * * *` | |
| `brain-diagnose` | Brain self-diagnosis | `15 3 * * *` | |

Every run — Inngest cron, an admin "Run now", or an external trigger — stamps a
heartbeat. The ledger has **two tiers**: Redis is the fast path, Postgres the
durable one. The fallback is not belt-and-braces for its own sake — with Redis
credentials rejected and no second tier, every job reads back as "never ran",
which surfaces as *"Inngest is degraded — 3 essential jobs past due"* and sends
you to investigate the queue while the real fault is the cache. Staleness has to
be a measurement of the job, not of the cache. The console says which tier
answered.- **Vercel** keeps exactly **one** cron: `/api/cron/safety-net` daily at 00:15
  UTC. It reads the heartbeats and re-runs **only the essential jobs that have
gone stale**. While Inngest is healthy it is a no-op — a few Redis reads, no
database or upstream traffic.
- `/api/cron?trigger=…` remains for cron-job.org and the admin console, and
  `?force=1` on the safety net runs all essentials immediately.

**High-frequency jobs are not in the safety net.** A once-a-day catch-up is the
wrong repair for a two-minute scoreboard, and a job that frequent always looks
stale to a daily check, so it would fire on every pass. Those recover *in
minutes* instead, from the busiest page in the app: `/api/sports/live` schedules
a throttled top-up of picks and favourite alerts with Next's `after()` — i.e.
after the response is flushed, so no visitor ever waits on model training, and
the heartbeat throttle collapses a thousand concurrent viewers into a single
attempt per interval (5 min for picks, 1 min for alerts). Inngest remains the
intended owner; this is what stops its silence from being invisible.

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

### Cloudflare edge cache + edge cron (free tier)

Cloudflare sits in front of the Vercel deployment so anonymous traffic never
reaches an origin function. On an edge HIT the Vercel function is not invoked
and no bytes travel origin→edge, which is what keeps **Fast Origin Transfer**
and **Fluid Active CPU** flat.

The same Worker also **owns the high-frequency jobs**, through Cron Triggers:

| Trigger | Job | Why the edge owns it |
| --- | --- | --- |
| every 2 min | `sports-live` | the board and the model must move without a visitor asking |
| every 5 min | `sports-notify` | kick-off alerts are only useful on time |
| every 15 min | `radio-status-sweep` | the staleness behind the console's "radio degraded" warning |
| every 30 min | `sports-intel` | pick regeneration and model training |
| every 6 h | `payments-lifecycle` | repair PayPal drift, expire lapsed periods |

The Worker does no work itself — it pings `/api/cron?trigger=<job>` with the
shared secret, so the jobs, their cadence and their heartbeats stay owned by
`src/lib/cron-schedule.ts`. A rename in the registry fails a unit test rather
than silently pinging an endpoint that 404s forever. Deploy with
`CRON_SECRET=…` alongside the Cloudflare credentials; without it the pings are
refused with a 401.

**A tick is cache-first.** Before reaching Vercel the worker reads its own copy
of what the job produces — the football and basketball livescore snapshots
(fresh for 120s) and the status payload (300s) — and rebuilds only when that
copy has actually gone stale, then re-warms it so the next tick has something to
measure. A poll from a reader is stored under the very key the tick reads, so a
board people are watching keeps its own copy current and the tick costs the
origin nothing; `sports-notify`, `sports-intel` and `payments-lifecycle` have no
snapshot and still ping every tick. `curl -s <worker>/__edge | jq .snapshots`
reports each copy's age and freshness. `/api/status` is itself edge-cached
(60s), so the most expensive read in the app runs once per window instead of
once per visitor.

- **Worker:** `workers/edge-cache` — deployed as `connectplus-edge` and served at
  `https://connectplus-edge.connectplusapp.workers.dev`
- **Deploy:** `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… CRON_SECRET=… node scripts/deploy-worker.mjs`
  (no wrangler install required; `wrangler.toml` is there if you prefer it).
  The script also registers the Worker's Cron Triggers, so the edge cadence is
  deployed with the code instead of configured by hand in the dashboard.
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

## Security

Response hardening is declared in **two** places that have to agree —
`next.config.mjs` covers everything Next serves, `vercel.json` repeats the
transport-level keys for whatever Vercel answers before Next runs (static build
output, redirects, error pages). `tests/unit/security-headers.test.ts` fails the
build if either loses a header or the CSP regains a weakening, and
`tests/unit/contrast.test.ts` does the same for the colour tokens.

| Header | Value | Why |
| --- | --- | --- |
| `Content-Security-Policy` | `next.config.mjs`, built per environment | `object-src 'none'`, `frame-ancestors 'none'`, `base-uri`/`form-action 'self'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | production only — never from a dev server |
| `X-Content-Type-Options` | `nosniff` | cached JSON and image bytes must not be re-sniffed |
| `X-Frame-Options` | `SAMEORIGIN` | the Cloudflare worker only defaults this when the origin sent none |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | |
| `Cross-Origin-Opener-Policy` | `same-origin` | sign-in is a redirect, never a popup |
| `Permissions-Policy` | sensors off, `browsing-topics=()`, `interest-cohort=()` | |
| `X-XSS-Protection` | `0` | the legacy auditor is gone and its filter was itself a vector |

Three choices here are deliberate and should not be "fixed" back:

- **`'unsafe-eval'` is development-only.** The dev server's HMR runtime needs
  it; the production bundle contains no `eval(` or `new Function(` at all
  (verified against `.next/static`), so the production policy omits it.
- **`'unsafe-inline'` on `script-src` stays.** Next inlines its own hydration
  payload, and removing it means threading a nonce through every route. That
  makes the sanitizer the real XSS boundary.
- **No `upgrade-insecure-requests`.** It rewrites http subresources to https,
  and a number of Kenyan radio streams are http-only — `media-src ... http:` is
  allowed on purpose.

Shared secrets: every scheduler and drain endpoint (`/api/cron`,
`/api/cron/safety-net`, the RSS stream/drain routes) authorises through
`src/lib/shared-secret.ts`. It compares in constant time, and an unset
`CRON_SECRET` **refuses** rather than skipping the comparison, so a deployment
that forgot the variable has a closed endpoint instead of an open one.

Article bodies — RSS `content:encoded` and composer markdown alike — are
sanitised against an allow-list in `src/lib/content-processor.ts` before they
are injected. Frames are not on that allow-list, and event handlers, `class`,
`style` and every non-`http(s)`/relative URL are dropped.

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
│   │                          #   ads, feed-ranker, hive-brain, cron-schedule, job-heartbeat,
│   │                          #   throttled-job, push, mind-knowledge, notification-display, etc.)
│   ├── inngest/               # Inngest functions (rss poll + drain, sports live/notify/intel, etc.)
│   └── proxy.ts               # Rate limiting middleware
├── convex/                    # Convex functions (views, ads — offloaded from Supabase)
├── workers/edge-cache/        # Cloudflare Worker: edge cache + livescore tier
├── prisma/                    # Schema, migrations, seed
└── public/                    # PWA assets, icons, manifest
```

## Testing

- **Unit (Vitest)** — `npm test`. Beyond utilities, intent classification
  and sentiment, the suite pins the contracts that were expensive to learn:
  RSS due-feed ordering and per-run batching (`rss-poll-order`), cron registry ↔
  Inngest wiring (`cron-wiring`, including the scheduler-independent self-heal),
  multi-source coalescing and competition relevance
  (`sports-sources`, including live-minute parsing), fixture identity and league
  canonicalisation (`sports-fixture-identity` — the duplicate-card regression),
  market grading (`sports-markets`), calibration bucketing and strategy
  comparison (`sports-accuracy`), the combined-mind ensemble (`sports-mind`),
  operator directives (`mind-directives`), notification presentation for sports
  and social types (`notification-display`), the heartbeat ledger's Postgres
  fallback and the throttle built on it (`job-heartbeat-fallback`),
  transient-DB retry (`db-retry`), and WCAG AA contrast for both themes
  (`contrast`). The payment contracts are pinned too (`payments`): Kenyan phone
  normalisation, the Daraja timestamp/password construction, success vs
  cancelled STK callbacks, result-code→status mapping, refundable per-rail
  pricing in whole shillings, and the rule that a webhook with incomplete
  transmission headers is never trusted.
- **E2E (Playwright)** — `npm run test:e2e` smoke-checks public pages and sign-in.

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
