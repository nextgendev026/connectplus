# connectPlus

Full-stack social blogging platform built with Next.js 14, Prisma ORM, SQLite, and NextAuth.js. Designed for East African content creators with multi-regional node support, Kenyan radio streaming, RSS integration, and a dual-intelligence Neural Mind system.

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Database:** SQLite via Prisma ORM
- **Auth:** NextAuth.js v4 (Credentials provider)
- **Styling:** Tailwind CSS with CSS variable theming
- **Charts:** Recharts
- **Icons:** Lucide React

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env and set NEXTAUTH_SECRET to a random string

# Initialize database
npx prisma db push
npx prisma generate

# Seed database
npm run db:seed

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database Seeding

The seed script creates sample data including users, posts, categories, tags, and RSS feeds. After seeding, you can log in with the seeded admin account.

**Important:** Change all default passwords before deploying to production.

## Features

### Public
- **Feed** — Browse published articles with filtering by category, tag, and search
- **Article Detail** — Full article view with comments, likes, and author info
- **Profile** — User profiles with posts, followers, and regional node
- **Studio** — Rich text editor for creating and editing posts
- **Radio** — Kenyan radio station streaming with equalizer UI, favorites, and search

### Admin
- **Command Center** — Platform overview with live stats, regional nodes, and trending topics
- **Neural Mind** — Dual-intelligence system combining internal platform analytics with external web learning. Features streaming chat, auto-learning from RSS feeds, knowledge base, and live insights
- **Moderation** — Content moderation queue with approve/flag/reject actions
- **Analytics** — Charts and metrics for users, posts, views, and engagement
- **Users & Nodes** — User management with role assignment and regional tracking
- **RSS Feeds** — RSS feed management with polling, importing, and neural learning

### Theme System
Dark and light modes via CSS variables. Toggle from the navbar. All components use `surface-*` tokens that automatically flip between themes.

## API Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/auth/register` | POST | No | Create account |
| `/api/auth/[...nextauth]` | ALL | No | NextAuth endpoints |
| `/api/posts` | GET/POST | GET: No / POST: Yes | List/create posts |
| `/api/posts/[id]` | GET/PUT/DELETE | GET: No / PUT/DELETE: Yes | Post CRUD |
| `/api/comments` | GET/POST | GET: No / POST: Yes | Comments |
| `/api/upload` | POST | Yes | File uploads |
| `/api/admin/stats` | GET | Admin | Platform statistics |
| `/api/admin/moderation` | GET/PUT | Admin | Moderation queue |
| `/api/admin/users` | GET/PUT | Admin | User management |
| `/api/admin/neural/chat` | POST | Admin | Neural Mind chat (streaming) |
| `/api/admin/neural/insights` | GET | Admin | Platform insights |
| `/api/admin/neural/learn` | POST | Admin | Trigger external learning |
| `/api/admin/neural/memory` | GET | Admin | Knowledge base |
| `/api/admin/neural/memory/[id]` | DELETE | Admin | Delete memory entry |
| `/api/rss/feeds` | GET/POST/PUT/DELETE | Admin | RSS feed management |
| `/api/rss/poll` | POST | Admin | Trigger RSS polling |
| `/api/rss/articles` | GET | Admin | RSS articles |
| `/api/rss/import` | POST | Admin | Import article as post |

## Security

- All admin routes require `ADMIN` or `SUPER_ADMIN` role
- Rate limiting on all API endpoints
- Security headers (CSP, X-Frame-Options, HSTS, etc.)
- Input validation and length limits on all user inputs
- Authentication errors use generic messages to prevent user enumeration
- File uploads validated by MIME type with size limits

## Project Structure

```
src/
├── app/
│   ├── (auth)/           # Auth pages (signin, signup, error)
│   ├── (public)/         # Public pages (feed, article, profile, studio, radio)
│   ├── (admin)/          # Admin pages with AdminLayout
│   └── api/              # API routes
├── components/
│   ├── admin/            # Admin-specific components (NeuralChat, NeuralInsights, etc.)
│   ├── blog/             # Blog components (PostCard, CommentSection, etc.)
│   ├── layout/           # Layout components (Navbar, Footer, AdminLayout)
│   ├── providers/        # ThemeProvider, SessionProvider
│   └── ui/               # Shared UI components (Logo, Button, etc.)
├── lib/
│   ├── auth.ts           # NextAuth configuration
│   ├── prisma.ts         # Prisma client singleton
│   ├── utils.ts          # Shared utilities
│   ├── neural-mind.ts    # Neural Mind intelligence engine
│   ├── neural-intent.ts  # Intent classification
│   └── neural-text.ts    # Text analysis (TF-IDF, sentiment, entities)
└── middleware.ts          # Rate limiting middleware
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite connection string |
| `NEXTAUTH_SECRET` | Yes | Random secret for JWT signing |
| `NEXTAUTH_URL` | Yes | App URL (http://localhost:3000 for dev) |
| `SUPABASE_URL` | No | Supabase project URL |
| `SUPABASE_ANON_KEY` | No | Supabase anonymous key |

## License

Private — All rights reserved.
