# Deploying ConnectPlus

This document covers how ConnectPlus gets from a developer's machine to production, what to check before and after, and how to roll back when something goes wrong.

---

## How Deployment Works

**Cloudflare Workers is the publishing pipeline — front end and back end.** The
Vercel deployment is paused (usage limits exhausted, `DEPLOYMENT_DISABLED`) and
is no longer in the request path.

```
git push origin main
  → GitHub Actions (quality checks)
    → OpenNext build → connectplus-app Worker   (Next.js: pages + all route handlers)
      → connectplus-edge Worker                 (cache + media plane, in front)
        → Production (https://connectplus-edge.connectplusapp.workers.dev)
```

The `deploy-cloudflare` CI job does this on every push to `main`, after the
`check` job passes. There is no manual step for a normal deploy. The whole
process takes 3-6 minutes.

### Two Workers, two roles

| Worker | Source | Role |
|---|---|---|
| `connectplus-app` | `wrangler.toml` + `open-next.config.ts` | The Next.js app — every page and route handler, via `@opennextjs/cloudflare` |
| `connectplus-edge` | `workers/edge-cache/` | Cache in front of the app, plus the media plane (`/__media`) and the five cron triggers |

`connectplus-edge`'s `ORIGIN` var points at `connectplus-app`'s `workers.dev`
URL. To point it somewhere else (a preview, a rollback), set `ORIGIN=...` when
running `scripts/deploy-worker.mjs`.

### Manual deploy

```bash
# Build and deploy the app Worker
npm run cf:build      # prisma migrate deploy + generate + opennextjs-cloudflare build
npm run cf:deploy     # opennextjs-cloudflare deploy

# Push environment variables to it as Worker secrets (write-only)
npm run cf:secrets    # reads .env, pushes every key the app needs

# Redeploy the edge worker (cache + media + crons)
node --env-file=.env scripts/deploy-worker.mjs
```

### Why the app builds on CI but may not on Windows

The OpenNext build's last step symlinks `node_modules` into
`.open-next/middleware/`. Windows requires Developer Mode or elevation for
symlink creation and fails with `EPERM`. That is a local-environment limitation,
not a code problem: the Linux CI runner completes the same build. On Windows,
either enable Developer Mode or run the build under WSL.

---

## Pre-Flight Checklist

Before pushing to `main`, run these in order:

```bash
# 1. Type checking — catches type errors before they ship
npm run typecheck

# 2. Linting — catches code quality issues. Runs with `--max-warnings 0`, so a
#    single new warning fails this step; fix the warning or, if the pattern is
#    deliberate, add a targeted `eslint-disable-next-line` with a reason.
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

### Prisma stays on 6.x until the schema is ported

`prisma` and `@prisma/client` are held on the 6.x line. This is a deliberate ceiling, not
staleness — a Prisma major is a migration, not a version bump.

Prisma 7 removed the `url` and `directUrl` properties from the `datasource` block. Move the CLI
to 7 while the schema still declares them and `prisma generate` fails with `P1012`, which fails
`postinstall`, which fails the build before a single line of app code is compiled. That is what
a red Cloudflare deploy preview on a Dependabot branch looks like.

Porting to 7 is three coupled changes, and they land together or not at all:

1. Move the connection URLs out of `prisma/schema.prisma` and into a new `prisma.config.ts`.
2. Provide a driver adapter (for example `@prisma/adapter-pg`) to the `PrismaClient`
   constructor — Prisma 7 no longer reads a URL out of the schema at runtime.
3. Move `prisma` and `@prisma/client` to 7.x in the same commit.

`.github/dependabot.yml` ignores Prisma majors so the half-migration is not proposed again. Test
the whole thing on a branch against a copy of the database before lifting that ignore.

---

## What Gets Deployed

Vercel deploys:

- **Serverless functions** — all Route Handlers in `src/app/api/`
- **Static pages** — pre-rendered public pages (home, feeds, sports, etc.)
- **Client bundles** — JavaScript and CSS for client-side interactivity
- **Service worker** — `public/sw.js` (cached, updated on deploy)
- **PWA assets** — icons, manifest, favicon

Vercel does **not** deploy:

- Database migrations — these are applied by the **`migrate` CI job**, not by Vercel. See the
  warning below: that job only runs when the `check` job passes, so a red lint or test step silently
  stops migrations from being applied at all.
- Background workers (the Cloudflare worker is deployed independently)
- Inngest functions (registered automatically when the app starts)

> **Known defect, fixed in Phase A.** `npm run lint` previously failed on `main` with two errors,
> which failed the `check` job it is gated behind — so `.github/workflows/webpack.yml`'s `migrate`
> job never ran and `prisma migrate deploy` was not executing on push to `main`. Lint is green again
> as of the `phase-a/baseline-audit-and-docs` branch; a required status check on `main` is still
> pending (Phase O). Until both the migrations are confirmed applied and the status check exists,
> run `npx prisma migrate status` before trusting that production carries the schema in
> `prisma/schema.prisma`. See `docs/MODERNIZATION-AUDIT.md` F-02.

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

### Verifying the intelligence pipeline after a deploy

```bash
# 6. The agent's tool loop is off unless a gateway key resolves. This endpoint is
#    Super Admin only, so an anonymous 401 is the expected answer and it confirms
#    the route exists rather than 404ing.
curl -s -o /dev/null -w "%{http_code}" https://connectplusapp.vercel.app/api/neural-chat
# Expected: 401
```

Then, signed in as a Super Admin, open **Admin → Neural Mind** and read the four stat cards.
They are the deploy's own health report, and each one maps to a specific failure:

| Card | Reads | If it is wrong |
|------|-------|----------------|
| Memories | `hiveBrain.status().total` | `0` means the hive could not be read — not that the platform has learned nothing |
| Awaiting approval | pending `BrainActionProposal` rows | A number that stays high after a deploy means nobody is working the queue |
| Open issues | the self-filed issue register | Findings persist across runs by design; they close only when the finding stops reproducing |
| **Engines degraded** | `collaboration.degraded` | Read the sub-label. `N unmeasured` is *not* a fault on the same card — an unmeasured engine has not been observed, and the Pipeline tab names which probe was blind |

Two readings are worth knowing how to interpret before you see them in production:

- **`No run recorded by any of the 17 jobs`** on the Pipeline tab means the heartbeat ledger has
the correct answer of "nothing yet" — the ordinary state of a fresh instance. If it persists on a
long-running production deployment, check that Inngest and the Cloudflare edge cron are actually
delivering; a scheduler that has never run is indistinguishable from one that is broken, so the
console reports the measurement it has rather than inventing a cause.
- **`Models: no gateway key configured`** means `aiProvider` is `builtin` and no key resolved, so the
deterministic engines answer and the agent's tool loop stays off. That is a supported configuration
and is reported as a configuration gap, not as a broken engine. Set a free OpenRouter or OpenCode
key under **Admin → AI** (or `OPENROUTER_API_KEY` in the environment) to turn both on.

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

### Migrations run automatically on deploy

You do not normally need to run `prisma migrate deploy` by hand. The Vercel build command is
`npm run vercel-build`, which is:

```
db:guard  →  prisma migrate deploy  →  prisma generate  →  db:ensure  →  next build
```

So a push to `main` applies pending migrations **before** the new code goes live, and the
`db:guard` step in front of it refuses to touch a database that is not the intended target. That
ordering matters: the guard runs first, so a misconfigured `DATABASE_URL` fails the build instead of
migrating the wrong project.

To confirm there is nothing pending, anywhere:

```bash
npx prisma migrate status
# → "Database schema is up to date!"  (with the migration count)
```

If this reports pending migrations after a deploy, the build did not reach the migration step —
look at the build log for a `db:guard` refusal, which is the guard doing its job.

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

Environment variables live as **Cloudflare Worker secrets** on `connectplus-app`,
pushed from the local `.env` by `npm run cf:secrets`. They are **not** in the
repository. Non-secret configuration (URLs, `NODE_ENV`) lives in the `[vars]`
block of `wrangler.toml`.

### Adding a new environment variable

1. Add the variable to `.env.example` (with a placeholder value)
2. Add its name to the `SECRETS` list in `scripts/cf-secrets.mjs`
3. Put the real value in `.env` and run `npm run cf:secrets`
4. If the value is not a secret, put it in `wrangler.toml` `[vars]` instead

Cloudflare secrets are write-only — the API will not read them back. The local
`.env` (and the dashboards that issued the values) remain the source of truth.

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
| `OPENROUTER_API_KEY` | AI content generation, copilot, and the agent's tool loop (the routed provider) |
| `OPENCODE_API_KEY` | The same, on the other routed provider |
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
