# Free-tier budget

ConnectPlus runs entirely on free tiers. That is a hard constraint, not a
preference, and it is the reason several pieces of the architecture look the way
they do. This document records the ceilings we are actually operating under and
the mechanism that keeps each one from being the next outage.

The two outages that prompted this document are worth naming, because both were
"the platform was fine, the allowance was not":

- **Vercel** — usage limits reached, deployment disabled. Every origin route
  answered `402 DEPLOYMENT_DISABLED`. Nothing code-side fixes that, which is why
  the origin moved.
- **Supabase** — 5 GB/month storage egress exhausted. The Storage API answered
  `402 exceed_egress_quota` to *uploads* as well as reads, so publishing broke
  even though the database was healthy.

## The ceilings

| Platform | Free allowance | What burns it | Our mitigation |
|---|---|---|---|
| **Cloudflare Workers** | 100k requests/day, 10 ms CPU/request | Every origin request | Edge worker caches the public surface; cached responses cost no invocation |
| **Cloudflare KV** | 1,000 writes/day | Cron tick ledger (~1,150/day) | Durable records sharded to `/api/edge/kv`; a soft daily write budget (800) refuses writes before the platform does |
| **Cloudflare R2** | 10 GB storage, **zero egress** | Nothing — egress is free | The media plane: every stored image is served from R2/KV behind the edge, not from Supabase |
| **Cloudflare cron triggers** | 5 per Worker | Adding a 6th schedule | Exactly five registered; everything else belongs to Inngest |
| **Supabase Postgres** | 500 MB database, shared pooler | Connection fan-out, build-time prerendering | `experimental.cpus` caps build workers; edge Prisma adapter pools `max: 1` per request |
| **Supabase Storage** | 1 GB storage, **5 GB/month egress** | Serving every image directly | Uploads and reads now go to the edge media plane first; Supabase is the fallback, not the default |
| **Upstash Redis** | 10k commands/day | Per-request cache reads | Named query budgets (`query-budget.ts`); cron heartbeat falls back to Postgres |
| **Inngest** | 50k function runs/month | Every cadence | Owns cadences off Vercel; the five high-frequency jobs stay on Cloudflare cron |
| **OpenRouter / OpenCode** | Free model tiers | Token volume | Model-first routing: greetings and record questions never call a model at all |

## The rule that falls out of the table

**Reads must be cacheable, and writes must be budgeted.**

Every public JSON route carries an explicit `s-maxage` + `stale-while-revalidate`
pair (in both `next.config.mjs` and — while it lasted — `vercel.json`, now
mirrored as Worker cache rules). A route that is polled on a timer and answered
from cache costs no invocation at all; the same route answered per request is
what exhausts an allowance. This is why `/api/thumb/*`, `/api/posts`,
`/api/settings/public` and the livescore endpoints all have long TTLs.

The write side is the same idea with a different lever: anything that writes on
a schedule (the tick ledger, the KV mirror, the media plane) charges a named
daily budget before it writes, so the platform's own limit is the backstop and
not the first line of defence. `storage.kvWriteBudget` in `/__edge` reports the
day's spend.

## Media: the fix that removes the bill instead of moving it

The Supabase egress problem has exactly one permanent fix: stop serving images
from a metered origin. `/__media/<kind>/<owner>/<file>` on the edge worker does
that — R2 when enabled, its KV stop-gap until then, the per-colo Cache API in
front of both. The URL shape is identical on every backend, so switching from KV
to R2 later is a redeploy with no data migration.

`scripts/backfill-media-to-edge.mjs` moves existing rows onto it, idempotently:
it only touches rows still holding a Supabase URL, preserves the object key, and
updates a row only after the edge PUT has succeeded. While Supabase is
restricted the downloads fail with 402 and those rows are reported and left
alone — re-run it after the egress quota resets.

## Postgres: connections, not storage, is the real ceiling

The free-tier database's binding constraint is the connection pooler, not the
500 MB. Two places would blow it if left alone:

1. **Build-time prerendering.** Each static-generation worker opens its own
   pool. `experimental.cpus: Math.min(4, osCores)` caps that fan-out.
2. **Edge concurrency.** Every concurrent Worker request could open its own
   connection. The Cloudflare Prisma adapter is built with `max: 1` so the
   request opens one and closes it; the pooler multiplexes across requests.

The article and tag `generateStaticParams` deliberately return an empty array,
so the build prerenders no slugs and pays a fraction of the round trips it used
to. This is documented rather than accidental — see the comment in
`next.config.mjs`.

## What to watch

- `/__edge` on the edge worker: `media`, `storage.kvWriteBudget`, tick state.
- The admin **Health → Pipeline** tab: per-job evidence age. `unknown` means a
  pipeline was not observed, which is different from it failing.
- Cloudflare dashboard → Workers → Metrics: requests/day against 100k.
- Supabase dashboard → Reports: egress against 5 GB, connections against the
  pooler cap.
