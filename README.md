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
# Fill in the keys below, then apply the schema
npm run db:push
npm run db:generate

# Seed the database (optional but recommended)
npm run db:seed

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
| `MAX_FILE_SIZE` | Upload limit in bytes (default 5MB) |
| `UPLOAD_DIR` | Local fallback upload directory |

## Scripts

- `npm run dev` — development server
- `npm run build` — production build (`next build`; add `--webpack` for webpack)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm run db:migrate` / `db:migrate:prod` — dev / deploy migrations
- `npm run db:push` — push schema without migrations
- `npm run db:seed` — seed 10 creators + content
- `npm run db:studio` — Prisma Studio

## Database Seeding

`prisma/seed.ts` creates sample data: users (including an `admin`), categories, tags, and published posts. After seeding, sign in with:

- Regular creators: `user@connectplus.io` pattern with password `Password123!`
- Admin: `connect@plus.com` / `Mtemi@254#`

## Deploying

- **Vercel** — connect the repo; the `next.config.mjs` CSP and runtime config are build-ready. Set all env vars above in the project settings.
- **GitHub Actions** — `.github/workflows/webpack.yml` runs typecheck, lint, and `next build --webpack` on push.

Migrations must be applied before the first deploy using `npm run db:migrate:prod` (or `prisma migrate dev` locally) against your production `DATABASE_URL`.