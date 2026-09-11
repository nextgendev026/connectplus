# connectPlus

Full-stack social blogging platform built with Next.js 16 (App Router), Prisma ORM + PostgreSQL, and NextAuth.js. Designed for East African content creators — with multi-regional node support, Kenyan radio streaming, RSS ingestion, a dual-intelligence Neural Mind feed system, a comprehensive monetization pipeline, and a savanna-inspired brand.

## Tech Stack

- **Framework:** Next.js 16 (App Router, React 19)
- **Database:** PostgreSQL via Prisma ORM (Supabase)
- **Auth:** NextAuth.js v5 (Credentials + JWT sessions)
- **Storage:** Supabase Storage bucket (`uploads`, public, 5MB limit)
- **Styling:** Tailwind CSS with CSS variable theming (light/dark mode, WCAG-compliant)
- **Charts:** Recharts · **Icons:** Lucide React
- **Streams:** RSS parsing via `rss-parser`
- **Background Jobs:** Inngest (serverless cron — RSS poll, status watchdog, thumbnail recovery, scheduled publishing, nightly training)
- **Cache:** Redis (Cloud) with in-memory fallback
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
- **Settings & Integrations** — site identity, SEO, analytics, chat widget, feature flags, API keys.
- **Sticky sidebar** — stays in view while scrolling on desktop.

### SEO & Performance
- **Structured data** — JSON-LD Article schema, Open Graph, Twitter cards per article.
- **Sitemap & robots.txt** — auto-generated, indexable when enabled.
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
| `INNGEST_SIGN_KEY` / `INNGEST_EVENT_KEY` | Inngest cloud queue keys (setup fallback for cron jobs) |
| `OPENROUTER_API_KEY` | OpenRouter API key (free models available) |
| `OPENCODE_API_KEY` | OpenCode Zen API key |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Optional paid AI providers |
| `CRON_SECRET` | Shared secret the `/api/cron` and `/api/rss/cron` triggers verify (Bearer / `x-cron-secret`) |
| `CRONJOB_TOKEN` | cron-job.org API key — schedules the heavy jobs via `/api/cron` (`npm run cronjob:sync`) |
| `APP_URL` | Deployment base URL cron-job.org should hit (default `https://connectplusapp.vercel.app`) |
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

## Database Seeding

`prisma/seed.ts` creates sample data: users (including an `admin`), categories, tags, and published posts. After seeding, sign in with:

- Regular creators: `user@connectplus.io` with password `Password123!`
- Admin: `connect@plus.com` / `Mtemi@254#`

## Deploying

- **Vercel** — connect the repo; set all env vars in project settings. Inngest handles background jobs via cloud queue. Daily cron serves as a fallback floor.
- **GitHub Actions** — typecheck, lint, unit tests, and build on every push/PR.

## Architecture

```
connectPlus/
├── src/
│   ├── app/
│   │   ├── (public)/          # Public pages (home, article, profile, radio, studio)
│   │   ├── (admin)/admin/     # Admin console (dashboard, neural, ai, moderation, etc.)
│   │   ├── api/               # API routes (posts, auth, ads, subscription, rss, etc.)
│   │   ├── feed.xml/          # RSS feed
│   │   ├── sitemap.ts         # Dynamic sitemap
│   │   └── robots.ts          # Robots.txt
│   ├── components/            # React components (ads, admin, layout, profile, radio, ui, weather)
│   ├── lib/                   # Core libraries (ai-provider, ads, feed-ranker, hive-brain, etc.)
│   ├── inngest/               # Inngest functions (rss-poll, status, thumbnails, etc.)
│   └── proxy.ts               # Rate limiting middleware
├── convex/                    # Convex functions (views, ads — offloaded from Supabase)
├── prisma/                    # Schema, migrations, seed
└── public/                    # PWA assets, icons, manifest
```

## Testing

- **Unit (Vitest)** — `npm test` covers utilities, intent classifier, keyword extraction, sentiment analysis.
- **E2E (Playwright)** — `npm run test:e2e` smoke-checks public pages and sign-in.
