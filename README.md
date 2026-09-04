# connectPlus

> Stories that connect East Africa

A modern social blogging platform built with Next.js 14, Prisma, Supabase PostgreSQL, and Tailwind CSS. Featuring a public feed, story editor, creator profiles, and a full admin command center.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Database:** PostgreSQL (Supabase) via Prisma ORM
- **Auth:** NextAuth.js v4 (Credentials provider)
- **Styling:** Tailwind CSS with custom dark theme
- **Charts:** Recharts
- **Icons:** Lucide React
- **Runtime:** Node.js 18+

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up database

```bash
# Generate Prisma client
npx prisma generate

# Push schema to Supabase
npx prisma db push

# Seed with demo data
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
```

### 3. Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Default Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@connectplus.io | Password123! |
| Creator | amara@connectplus.io | Password123! |
| Creator | kwame@connectplus.io | Password123! |
| Creator | fatima@connectplus.io | Password123! |

## Pages

### Public
- `/` — Home feed with bento grid, categories, trending
- `/article/[slug]` — Article detail with comments, related stories
- `/profile/[username]` — Creator profile with posts, stats
- `/studio` — Story editor with markdown support
- `/auth/signin` — Sign in
- `/auth/signup` — Sign up

### Admin (requires ADMIN role)
- `/admin` — Command center with AI chat, metrics, nodes
- `/admin/moderation` — AI-assisted content moderation queue
- `/admin/analytics` — Charts, regional breakdown, trends
- `/admin/users` — User directory, verification, bot logs

## API Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | User registration |
| GET/POST | `/api/posts` | List/create posts |
| GET/PUT/DELETE | `/api/posts/[id]` | Single post CRUD |
| GET/POST | `/api/comments` | List/create comments |
| POST | `/api/upload` | Image upload (public/uploads/) |
| GET | `/api/admin/stats` | Admin dashboard stats |
| GET/PUT | `/api/admin/moderation` | Moderation queue |
| GET/PUT | `/api/admin/users` | User management |

## Image Uploads

Images are stored locally in `public/uploads/` with UUID filenames. Max 10MB, supports JPEG, PNG, WebP, GIF.

## Database Schema

- **User** — accounts, roles (USER/CREATOR/ADMIN/SUPER_ADMIN), node assignment
- **Post** — articles with categories, tags, moderation status, view counts
- **Comment** — threaded replies, likes
- **Tag/Category** — content classification
- **Like** — post and comment likes
- **ModerationLog** — audit trail for content review
- **PageView** — analytics tracking by city/region

## Environment Variables

See `.env` for the full list. Key variables:
- `DATABASE_URL` — Supabase pooled connection
- `DIRECT_URL` — Supabase direct connection (for migrations)
- `NEXTAUTH_SECRET` — Auth session secret
- `SUPABASE_ANON_KEY` — Client-side Supabase key
- `SUPABASE_SERVICE_ROLE_KEY` — Server-side Supabase key
