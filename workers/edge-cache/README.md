# Cloudflare edge cache

A single-purpose Cloudflare Worker that sits in front of the Vercel deployment
and answers anonymous traffic from Cloudflare's cache.

```
reader ──▶ Cloudflare edge (Worker) ──▶ Vercel origin
                 │
                 └─ HIT: never touches Vercel
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
| `/api/trending/topics` | 120s | identical for every anonymous reader |
| `/api/posts/check` | 30s | |
| `/api/subscription/plans` | 600s | |

Never cached: `/api/auth*`, `/api/upload`, `/api/track`, `/api/stripe*`,
`/api/status/*`, `/api/rss*`, every non-GET method.

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
| `MISS` | fetched from the origin, then stored |
| `MISS-UNCACHEABLE` | origin response can't be cached |
| `BYPASS` | credentialed/write/never-cache request passed through |

`/__edge` is also the endpoint the app's `/status` page probes when `EDGE_URL`
is set.

## Free tier

Workers free plan: **100,000 requests/day**, 10 ms CPU per request. This worker
does no parsing, no crypto and no loops over payloads — a cache lookup and a
fetch — so it stays well inside that ceiling. It uses only the Cache API: no KV,
no Durable Objects, no R2 bindings, so there are no billable line items.
