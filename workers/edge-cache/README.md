# Cloudflare edge cache, livescore tier + edge cron

A single-purpose Cloudflare Worker with two jobs: it sits in front of the Vercel
deployment and answers anonymous traffic from Cloudflare's cache (including the
live scores board), and it drives the high-frequency scheduled jobs whose
staleness nobody would otherwise notice.

```
reader ──▶ Cloudflare edge (Worker) ──▶ Vercel origin
                 │
                 ├─ HIT: never touches Vercel
                 └─ HIT-STALE: instant answer, refresh runs behind the reader
```

## Why

Vercel's free tier bills in two places this directly moves:

| Metric | Without the worker | With the worker |
| --- | --- | --- |
| **Fluid Active CPU** | Every page view runs a serverless function | 0 on an edge HIT |
| **Fast Origin Transfer** | Every byte is pulled origin→edge | 0 on an edge HIT |

Storage and Supabase egress stay flat for the same reason: repeat image and
cover requests are answered at the edge, not re-fetched and re-resized.

## What gets cached

| Path | TTL | Notes |
| --- | --- | --- |
| HTML documents | 60s | anonymous only |
| `/_next/image` | 30 days | one entry per url+width+quality+**format** |
| `/api/thumb/*` | 1 year | content-addressed covers |
| `/_next/static/*`, `/fonts/*`, images, css, js | 1 year | immutable build output |
| `/favicon.ico`, `/icon-*.png`, `/apple-touch-icon.png`, `/sw.js`, `/robots.txt`, `/sitemap.xml`, `/feed.xml` | 1h | root files — their URLs never change, so they must not be pinned |
| `/api/trending/topics` | 120s | identical for every anonymous reader |
| `/api/posts/check` | 30s | |
| `/api/subscription/plans` | 600s | |
| **`/__livescore`** (→ `/api/sports/live`) | **15s / 45s SWR** | the live board |
| **`/api/sports/predictions`** | **30s / 90s SWR** | the tips board |
| **`/api/sports/referrals`** | **300s / 900s SWR** | partner offers |

Never cached: `/api/auth*`, `/api/upload`, `/api/track`, `/api/payments/*`
(except the public `/api/payments/providers` allowlist), `/api/cron*`,
`/api/status/*`, `/api/rss*`, the reader-scoped sports routes
(`/api/sports/follows`, `/api/sports/reminders`, `/api/sports/track`), every
non-GET method.

## The edge cron

A cache worker that can also *schedule* is a deliberately cheap trade: Cloudflare
Cron Triggers are free, always on, and independent of both Vercel and Inngest,
so the jobs that quietly rot when nothing is watching them get a scheduler that
is not the thing being watched.

| Trigger | Job |
| --- | --- |
| every 2 min | `sports-live` — snapshot + settle picks |
| every 5 min | `sports-notify` — favourite match alerts |
| every 15 min | `radio-status-sweep` — now-playing / listener counts |
| every 30 min | `sports-intel` — model training + pick regeneration |
| every 6 h | `payments-lifecycle` — reconcile PayPal, expire lapsed plans |

The worker does **no work itself**. It pings
`/api/cron?trigger=<job id>&source=cloudflare-cron` with the shared secret, so the
job definitions, their cadence and their heartbeats stay owned by
`src/lib/cron-schedule.ts`. `SCHEDULES` in `src/index.mjs` maps a cron expression
to a job *id*, and a unit test asserts every id it names still exists in the
registry — a rename fails the build instead of pinging a 404 forever.

Requires `CRON_SECRET` (the same value the app verifies). Without it the pings
are sent but the app answers 401, which the admin console reports as stale jobs
rather than as silence. Register the triggers with the deploy script
(`CRON_SECRET=… node scripts/deploy-worker.mjs`) or from `wrangler.toml`.

```bash
curl -s https://connectplus-edge.connectplusapp.workers.dev/__edge | jq .schedules
```

## The livescore tier

The live board polls on a timer — every 15s while a match is in play. That is
the traffic shape that melts a serverless origin: N viewers × 4 requests/minute
each, all asking for a payload that is byte-identical for every one of them. A
hundred people watching a derby is ~400 origin invocations a minute for the same
JSON.

So sports JSON gets its own cache class with three properties:

1. **A short `ttl`** (15s) — a goal can land any second.
2. **A much longer `swr` window** (45s). An entry past `ttl` is served
   *immediately* as `HIT-STALE` while a refresh runs in `ctx.waitUntil`. Nobody
   ever waits on the origin, and the next caller gets the refreshed copy. A
   15-second-old score beats a spinner every time.
3. **A canonical alias, `/__livescore`.** The board's real query string is
   open-ended and every distinct query is a distinct cache entry, so a caller
   that appends cache-busting params would shred the cache into one useless
   entry per viewer. The alias keeps only the params that change the payload
   (`sport`, `date`) and snaps them to a closed set — cardinality is
   "2 sports × distinct dates", nothing else.

Point the app at it with `NEXT_PUBLIC_EDGE_URL`; leave that unset and the board
falls back to the app's own `/api/sports/live` route, same payload, no edge tier.

```bash
NEXT_PUBLIC_EDGE_URL=https://connectplus-edge.<subdomain>.workers.dev
```

The tier answers cross-origin with `Access-Control-Allow-Origin: *`. That is
safe for the same reason it is cacheable at all: it only ever carries the
anonymous, identical-for-everyone payload. Reader-scoped sports routes are in
`NEVER_CACHE` and never reach this path.

## Safety model

The worker **only** caches anonymous traffic:

- a request with `Cookie` or `Authorization` → straight through, never cached
- a response with `Set-Cookie` → never stored
- non-2xx responses, redirects and non-renderable content types → never stored

This is what makes edge-caching a server-rendered app with sessions safe: a
signed-in reader can never be handed another visitor's HTML.

Two details worth keeping:

1. **Format variants.** The image optimizer and cover route negotiate AVIF vs
   WebP from `Accept`. The Cache API keys on the URL and ignores `Vary`, so the
   negotiated format is folded into the cache key (`?__edge=avif|webp|std`).
   Removing that reintroduces a real bug: the first AVIF caller poisons every
   WebP caller.
2. **HTML TTL is short (60s).** That keeps the cache useful for traffic spikes
   while still letting breaking news land quickly.
3. **Root files get an hour, not a year.** `/favicon.ico`, the PWA icons, the
   service worker, `robots.txt` and the sitemap all match the "static
   extension" rule but are not content-hashed. Treating them as immutable is
   how a fixed favicon keeps showing the old bytes: the origin serves the new
   mark, the edge keeps handing out the cached one for 365 days.
4. **`CACHE_VERSION` in `src/index.mjs` is the purge lever.** The Cache API has
   no purge endpoint, so an entry stored under a bad policy can only be
   dropped by changing its key. Bump the version whenever the caching rules
   change and every entry is refetched on the next request.

## Deploy

No wrangler install needed:

```bash
CLOUDFLARE_API_TOKEN=… \
CLOUDFLARE_ACCOUNT_ID=… \
ORIGIN=https://your-app.vercel.app \
node scripts/deploy-worker.mjs
```

The script uploads the module through the Workers API and enables the public
`workers.dev` route, then prints the live URL. With wrangler instead:

```bash
npx wrangler deploy --config workers/edge-cache/wrangler.toml
```

## Verify

```bash
curl -s https://connectplus-edge.connectplusapp.workers.dev/__edge
```

Every response carries `X-Edge-Cache`:

| Value | Meaning |
| --- | --- |
| `HIT` | served from the edge, Vercel untouched |
| `HIT-STALE` | served past its TTL; a refresh is running behind the reader |
| `MISS` | fetched from the origin, then stored |
| `MISS-UNCACHEABLE` | origin response can't be cached |
| `BYPASS` | credentialed/write/never-cache request passed through |

`X-Edge-Age` carries the age in seconds for the sports tier, which is the
number to watch when tuning the TTLs.

```bash
curl -sI https://connectplus-edge.connectplusapp.workers.dev/__livescore?sport=football
```

`/__edge` is also the endpoint the app's `/status` page probes when `EDGE_URL`
is set.

## Free tier

Workers free plan: **100,000 requests/day**, 10 ms CPU per request. This worker
does no parsing, no crypto and no loops over payloads — a cache lookup and a
fetch — so it stays well inside that ceiling. It uses only the Cache API: no KV,
no Durable Objects, no R2 bindings, so there are no billable line items.
