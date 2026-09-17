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
| **`/api/status`** | **60s / 300s SWR** | the status page's health payload |

Never cached: `/api/auth*`, `/api/upload`, `/api/track`, `/api/payments/*`
(except the public `/api/payments/providers` allowlist), `/api/cron*`,
`/api/status/*` (the uptime probe and the status sub-routes — `/api/status`
itself is the allowlisted read above), `/api/rss*`, the reader-scoped sports
routes (`/api/sports/follows`, `/api/sports/reminders`, `/api/sports/track`),
every non-GET method.

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

### The tick is cache-first

The worker still does **no work itself** — it pings
`/api/cron?trigger=<job id>&source=cloudflare-cron` with the shared secret, so the
job definitions, their cadence and their heartbeats stay owned by
`src/lib/cron-schedule.ts`. `SCHEDULES` in `src/index.mjs` maps a cron expression
to a job *id*, and a unit test asserts every id it names still exists in the
registry — a rename fails the build instead of pinging a 404 forever.

What it no longer does is ping *blindly*. Before a tick reaches Vercel it reads
its own copy of what the job produces (`SNAPSHOTS` in `src/index.mjs`) and only
rebuilds when that copy is genuinely old:

| Snapshot | Path | Fresh for | Guards |
| --- | --- | --- | --- |
| `livescore-football` | `/api/sports/live?sport=football` | 120s | `sports-live` |
| `status` | `/api/status` | 300s | `radio-status-sweep` |
| `radio-stations` | `/api/radio/stations` | 120s | `radio-status-sweep` |

Three properties make that check honest rather than optimistic:

1. **The copy is shared with reader traffic.** A poll of the canonical form of a
   snapshot path (today's date counts as canonical — that is what makes it
   *today's* board) is stored under the very key the tick reads, so a board a
   hundred people are watching is already current and the tick does nothing at
   all. The cron is a watchdog for the quiet hours, not a second scheduler
   racing the readers. The mirrored copy carries the *snapshot's* lifetime
   rather than the reader's: the Cache API expires an entry from its response
   headers, and a copy left holding the board's 15s `max-age` is evicted long
   before the tick's 120s window opens — which turns the check back into a
   rebuild on every tick.
2. **A trigger with several snapshots is only skipped when every one of them is
   fresh.** `radio-status-sweep` refreshes service health and the station list in
   a single run, so skipping while only one of the two has gone cold would
   silently stop grading the other.
3. **The durable copy outlives its own freshness window.** Each snapshot is
   mirrored into the `SNAPSHOTS` KV namespace as well as the per-colo cache, and
   that record is kept for eight times its TTL. Expiring it at exactly the TTL
   would delete the copy and its staleness in the same instant, so "forty
   seconds past due" and "never stored at all" would both report as `null` —
   the ambiguity that made the cron question unanswerable. A cold board now
   reports its real age instead. Readers are unaffected: they are served from
   the Cache API copy, whose lifetime still comes from its own `Cache-Control`.
4. **Stale means ping *and* re-warm.** The tick pings the app, then takes a
   fresh copy of exactly what was stale, so the next tick has something to
   measure instead of collapsing back into "ping every tick".

Jobs with no snapshot entry (`sports-notify`, `sports-intel`,
`payments-lifecycle`) are untouched and ping on every tick: their output is a
notification or a reconciliation, not a payload the edge can hold.

`/__edge` reports the age and freshness of every snapshot, which is the number
to look at when asking why the edge did or did not rebuild this hour:

```bash
curl -s https://connectplus-edge.connectplusapp.workers.dev/__edge | jq .snapshots
```

### Silence is a failure mode

A Cron Trigger has no request and no reader, so a handler that throws is silent:
no response, no page anybody loads, just a job that stops running. For the two
jobs this worker owns, the symptom is a scoreboard and a radio panel that quietly
go stale — which is exactly what the edge cron was added to prevent, so it cannot
be allowed to fail the same way.

Three rules follow from that, and the unit tests pin all three:

1. **Every trigger is contained.** One job failing never silences the others,
   and nothing throws out of the handler.
2. **An unreadable snapshot counts as stale.** A scheduler has to fail towards
   running the job; skipping because the cache was unreachable is worse than
   doing the work twice.
3. **The tick records its decisions.** `lastTick` on `/__edge` lists what each
   trigger did (`rebuilt`, `skipped-fresh`, `unmapped-cron`, `error`) and the
   origin status it got, so "the edge cron is silent" and "the edge cron decided
   there was nothing to do" stop looking identical from outside — which is how
   the first production tick was diagnosed:

```bash
curl -s https://connectplus-edge.connectplusapp.workers.dev/__edge | jq .lastTick
```

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
- a `/api/status` snapshot is same-origin: it shares the JSON tier's staleness
  policy but not its CORS header, so the health payload is not published to
  arbitrary sites the way the live board deliberately is

This is what makes edge-caching a server-rendered app with sessions safe: a
signed-in reader can never be handed another visitor's HTML.

Every response the worker hands back is also hardened on the way out:
`X-Content-Type-Options: nosniff` (it caches JSON and image bytes, and a browser
left to re-sniff a cached payload is how a stored response becomes a script),
`Referrer-Policy: strict-origin-when-cross-origin`, and `X-Frame-Options: DENY`
**only when the origin sent none** — the origin owns its own framing policy and
the edge must not overrule it. The public tier additionally carries
`Cross-Origin-Resource-Policy: cross-origin` for the callers it explicitly
allows.

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
fetch — so it stays well inside that ceiling. One KV namespace backs the
`SNAPSHOTS` binding, and KV has its own free tier (100k reads/day, 1k writes/day)
that three snapshots refreshed on a two-minute cadence sit far inside; there are
no Durable Objects and no R2. The worker is written to work with the binding
absent, so a deploy that cannot create it loses global visibility, not function.
