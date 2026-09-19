# Deploying ConnectPlus

This document covers how ConnectPlus gets from a developer's machine to production, what to check before and after, and how to roll back when something goes wrong.

---

## How Deployment Works

ConnectPlus deploys automatically on every push to `main`. The flow is:

```
git push origin main
  → GitHub Actions (quality checks)
    → Vercel build (serverless functions + static pages)
      → Production (connectplusapp.vercel.app)
```

There is no manual deploy step. Vercel detects the push, builds the project, and makes it live. The whole process takes 2-5 minutes.

---

## Pre-Flight Checklist

Before pushing to `main`, run these in order:

```bash
# 1. Type checking — catches type errors before they ship
npm run typecheck

# 2. Linting — catches code quality issues
npm run lint

# 3. Unit tests — catches regressions in business logic
npm test

# 4. Build — catches compilation errors and missing exports
npm run build
```

If any of these fail, do not push to `main`. Fix the issue on your branch first.

### Specific checks for schema changes

If you modified `prisma/schema.prisma`:

```bash
# Check if migrations are needed
npx prisma migrate status

# Create a migration if needed
npx prisma migrate dev --name description

# Apply the migration to the database
npx prisma migrate deploy

# Regenerate the client
npx prisma generate
```

**Important:** Never run `prisma migrate dev` against the production database. Only `prisma migrate deploy` is safe for production.

---

## What Gets Deployed

Vercel deploys:

- **Serverless functions** — all Route Handlers in `src/app/api/`
- **Static pages** — pre-rendered public pages (home, feeds, sports, etc.)
- **Client bundles** — JavaScript and CSS for client-side interactivity
- **Service worker** — `public/sw.js` (cached, updated on deploy)
- **PWA assets** — icons, manifest, favicon

Vercel does **not** deploy:

- Database migrations (run separately via `prisma migrate deploy`)
- Background workers (the Cloudflare worker is deployed independently)
- Inngest functions (registered automatically when the app starts)

---

## Post-Deploy Verification

After a push to `main`, check these within 5 minutes:

### Automated checks (if GitHub Actions is configured)

```bash
# The CI pipeline runs typecheck, lint, test, and build automatically.
# Check the GitHub Actions dashboard for pass/fail status.
```

### Manual smoke tests

```bash
# 1. Homepage loads
curl -s -o /dev/null -w "%{http_code}" https://connectplusapp.vercel.app/
# Expected: 200

# 2. Service worker updated
curl -s https://connectplusapp.vercel.app/sw.js | grep -c "CACHE_VERSION"
# Expected: 1 (confirms the new SW is deployed)

# 3. API is reachable
curl -s -o /dev/null -w "%{http_code}" https://connectplusapp.vercel.app/api/posts?limit=1
# Expected: 200

# 4. Auth-gated endpoints reject anonymous requests
curl -s -o /dev/null -w "%{http_code}" https://connectplusapp.vercel.app/api/admin/brain/approvals
# Expected: 401

# 5. Feeds are healthy
curl -s -o /dev/null -w "%{http_code}" https://connectplusapp.vercel.app/feed.xml
# Expected: 200
```

### What to watch for in the first 10 minutes

- **Sentry dashboard** — new errors appearing after deploy are usually regressions
- **Vercel function logs** — timeout errors or cold starts indicate a build issue
- **Database connections** — Prisma connection pool exhaustion shows up as `Timeout attempting to open a database connection`

---

## Running Database Migrations

Migrations are **not** part of the Vercel deploy. They must be run separately.

### Safe approach (recommended)

```bash
# 1. Check what would change
npx prisma migrate status

# 2. Apply the migration
npx prisma migrate deploy

# 3. Verify the schema matches
npx prisma generate
```

### When a migration fails

1. Read the error message carefully — Prisma tells you exactly what went wrong
2. Check if a previous migration left the schema in an inconsistent state
3. If the migration is additive (new table, new column), it is usually safe to retry
4. If the migration is destructive (dropping a column), you need a rollback plan

---

## Rollback Plan

Vercel keeps the last 10 deployments and allows one-click rollback.

### Rolling back a code deploy

1. Go to Vercel dashboard → Deployments
2. Find the last working deployment (before your push)
3. Click "..." → "Promote to Production"
4. The rollback takes effect immediately

### Rolling back a migration

This is harder and should be avoided. If you must:

1. Write a reverse migration (e.g., `ALTER TABLE ... DROP COLUMN`)
2. Run `npx prisma migrate deploy` with the reverse migration
3. Deploy the code rollback
4. Verify everything works

**Prevention is better than rollback:** test migrations on a staging database before production.

---

## Environment Variables

Environment variables are set in the Vercel dashboard under Settings → Environment Variables. They are **not** in the repository.

### Adding a new environment variable

1. Add the variable to `.env.example` (with a placeholder value)
2. Set the actual value in Vercel dashboard
3. Deploy — the variable is available immediately

### Required variables (without these, the app fails to start)

| Variable | Where to get it |
|----------|----------------|
| `DATABASE_URL` | Supabase dashboard → Settings → Database → Connection string |
| `NEXTAUTH_SECRET` | Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://connectplusapp.vercel.app` |

### Optional variables (the app works without them, but features degrade)

| Variable | Feature it enables |
|----------|-------------------|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Browser push notifications |
| `OPENAI_API_KEY` | AI content generation and copilot |
| `SENTRY_DSN` | Error tracking in production |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Distributed rate limiting |
| `NEXT_PUBLIC_CONVEX_URL` | View count offloading |

---

## Troubleshooting

### Build fails on Vercel but works locally

Most common causes:
1. **Missing environment variable** — check Vercel dashboard for any unset vars
2. **Node version mismatch** — Vercel uses Node 20; ensure `engines` in `package.json` matches
3. **Prisma client not generated** — add `prisma generate` to the build script if missing

### Pages load but API routes return 500

Check Vercel function logs. Common causes:
1. **Database connection timeout** — the connection pool may be exhausted
2. **Missing env var** — an API route needs a variable that is not set
3. **Schema mismatch** — the Prisma client was generated against a different schema

### Notifications not delivered

1. Check `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are set
2. Check the push subscription is registered (`/api/notifications/push`)
3. Check the SW is installed and the push event handler is running

### Feed health check reports failures

The feed health check runs hourly and validates `/feed.xml`, `/feed.xml?format=json`, and a category feed. If it reports failures:
1. Check if the feed routes are returning 200
2. Check if the XML is well-formed
3. Check if item links resolve (not 404)

---

## Monitoring

After deploy, monitor these dashboards:

| Dashboard | URL | What to watch |
|-----------|-----|---------------|
| Vercel | vercel.com/dashboard | Build status, function errors, cold starts |
| Sentry | sentry.io | New error types, performance regressions |
| Supabase | app.supabase.com | Database connections, slow queries |
| GitHub Actions | github.com/.../actions | CI pass/fail |

A deploy that passes all checks and shows no new errors in Sentry within 10 minutes is considered healthy.
