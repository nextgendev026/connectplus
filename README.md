# connectPlus

Full-stack social blogging platform built with Next.js 16 (App Router), Prisma ORM + PostgreSQL, and NextAuth.js. Designed for East African content creators — with multi-regional node support, Kenyan radio streaming, RSS ingestion, a dual-intelligence Neural Mind feed system, and a savanna-inspired brand.

## Tech Stack

- **Framework:** Next.js 16 (App Router, React 19)
- **Database:** PostgreSQL via Prisma ORM
- **Auth:** NextAuth.js v5 (Credentials + JWT sessions)
- **Storage:** Supabase Storage bucket (`uploads`, public, 5MB limit)
- **Styling:** Tailwind CSS with CSS variable theming (savanna palette)
- **Charts:** Recharts · **Icons:** Lucide React
- **Streams:** RSS parsing via `rss-parser`

## Features

- **Neural feed** — the home feed ranks stories with a hybrid neural-intent scoring pipeline (`src/lib/neural-*.ts`) combining text analysis, recency, engagement, and regional relevance; a Brain Chat widget (`/radio`) answers fact-based questions with citations.
- **Creator Studio** — markdown editor (insert-at-cursor formatting toolbar), drag-and-drop cover upload via `/api/upload`, real auto-save to DRAFT (debounced), `?edit=<id>` edit mode, and a My Stories manager (list / edit / delete).
- **Social layer** — follows (`/api/follows`, toggling with denormalized counters), bookmarks (`/api/bookmarks/*`), profile pages with tabs (posts / saved / about / stats), follow & bookmark buttons across feeds and articles.
- **Account settings** — profile, avatar & cover uploads, email change (current-password verified), and password change (`/api/user/settings`, `/api/user/password`).
- **Savanna branding** — generated in `scripts/generate-assets.mjs` (canvas-rendered sun-plus roundel): `favicon.ico`, `icon-*.png`, `pwa-192/512(+maskable)`, web manifest, warm amber/terracotta theme + warm glows.
- **Admin console** — moderation, user management, RSS control, and analytics under `/admin` (ADMIN / SUPER_ADMIN only).
- **Mobile-first navigation** — fixed bottom nav on small screens, responsive cards and articles.
- **Seed data** — 10 creators, categories, tags, and published stories via `prisma/seed.ts`.

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Fill in the keys below, then apply the schema (creates versioned migrations)
npm run db:migrate
npm run db:generate

# Seed the database (optional but recommended)
npm run db:seed

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Migrations:** always change the schema via `npm run db:migrate` (Prisma `migrate dev`), which generates a timestamped migration file and applies it. Avoid `db:push` for shared/production schemas — it syncs the schema but creates no migration history, causing drift on other environments and CI. The `migrate deploy` step in CI applies committed migrations to production automatically.

> Tip: `next dev` is run with `--webpack` in this environment; the plain `npm run dev` uses the default bundler. Use `next watch --webpack` / `next build --webpack` if you need to force webpack.

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
| `MAX_FILE_SIZE` | Overall upload cap in bytes (default 5MB) |
| `MAX_<TYPE>_SIZE` | Per-type upload caps, e.g. `MAX_GIF_SIZE` (GIF default 8MB) |
| `UPLOAD_DIR` | Local fallback upload directory |
| `RSS_POLL_INTERVAL_SECONDS` | Default per-feed RSS poll interval (default 3600) |
| `CRON_SECRET` | Bearer secret for the `/api/rss/cron` Vercel Cron trigger |
| `RATE_LIMIT_<KEY>` / `RATE_LIMIT_DEFAULT` | Optional rate-limit overrides (`limit:windowMs`) |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` for server logging |

## Scripts

- `npm run dev` — development server
- `npm run build` — production build (`next build`; add `--webpack` for webpack)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm test` / `npm run test:watch` — unit tests (Vitest)
- `npm run test:e2e` — E2E smoke tests (Playwright; run `npx playwright install chromium` once)
- `npm run db:migrate` / `db:migrate:prod` — dev / deploy migrations
- `npm run db:push` — push schema without migrations (dev-only; prefer `db:migrate`)
- `npm run db:seed` — seed 10 creators + content
- `npm run db:studio` — Prisma Studio

## Database Seeding

`prisma/seed.ts` creates sample data: users (including an `admin`), categories, tags, and published posts. After seeding, sign in with:

- Regular creators: `user@connectplus.io` pattern with password `Password123!`
- Admin: `connect@plus.com` / `Mtemi@254#`

## Deploying

- **Vercel** — connect the repo; the `next.config.mjs` CSP, `vercel.json` cron, and runtime config are build-ready. Set all env vars above in the project settings (including `CRON_SECRET` for the hourly RSS job).
- **GitHub Actions** — `.github/workflows/webpack.yml` runs typecheck, lint, unit tests, and `next build --webpack` on every push/PR; a Playwright E2E job runs against Chromium; and a `migrate` job applies `prisma migrate deploy` to production on `main`.

## Testing

- **Unit (Vitest)** — `npm test` covers the pure logic: `slugify`/excerpt utilities and the Neural Mind's intent classifier, keyword extraction, and sentiment analysis (`tests/unit/*`).
- **E2E (Playwright)** — `npm run test:e2e` boots the dev server and smoke-checks public pages and the sign-in form (`tests/e2e/smoke.spec.ts`).

## Production Hardening Roadmap

Items below need external infrastructure or are deliberately scoped out for now:

- **Redis caching & BullMQ** — cache hot feeds/sessions and run scheduled RSS/vector jobs off a queue instead of `vercel.json` cron. Add `REDIS_URL`, use `ioredis` + `bullmq`.
- **Sentry** — `@sentry/nextjs` for error tracking; Vercel Analytics for RUM/performance.
- **Chunked/large uploads** — the upload route supports per-type caps today; switch to Tus for video (>10MB).
- **Rate limiting to Upstash** — the in-memory limiter in `src/proxy.ts` is per-instance; Upstash Ratelimit (`@upstash/ratelimit`) makes it shared across serverless instances when you scale horizontally.
- **i18n** — `next-intl` when expanding beyond the East African market.
- **Rehype sanitisation** — no markdown→HTML renderer exists today (article bodies are rendered as escaped text), so XSS risk is low; adopt `rehype-sanitize` the day a rich renderer is added.

Migrations must be applied before the first deploy using `prisma migrate deploy` (the CI `migrate` job does this automatically against `DATABASE_URL`).