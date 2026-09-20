# Free-tier distribution of platform functions

Every external service this app depends on has a free tier with a *different
shape of limit*, and the failure mode of getting the distribution wrong is never
a clean outage. It is one subsystem quietly exhausting one quota and degrading —
a view counter that stops counting, a cron whose ledger stops being written, a
feed that keeps serving yesterday's stories. This document is the map: what each
provider is good at, which functions belong on it, and where the ceilings are.

Read it before adding a new background job, a new cached route, or a new
high-frequency write. The question to answer is not "which service is fastest"
but **"which quota does this consume, and how much of it is left?"**

## The providers, and the shape of each limit

| Provider | Free allowance | Limit shape | Fails how |
| --- | --- | --- | --- |
| **Vercel** | Fluid Active CPU + Fast Origin Transfer + 100 GB bandwidth (Hobby) | Compute *time*, not requests | Functions start returning 5xx once the CPU budget is gone |
| **Supabase / Postgres** | 500 MB DB, 5 GB egress, limited pooler connections | Storage + connection count | Connection pool exhaustion reads as random timeouts |
| **Convex** | 1M function calls/month, 1 GB | Calls and stored data | Function calls start rejecting |
| **Upstash / Vercel KV** | ~500k commands/month (Upstash) | **Commands**, not bytes | Cache writes silently no-op once the monthly cap is hit |
| **Cloudflare Workers** | 100k requests/day, 10 ms CPU/request | **Requests** and per-request CPU | Requests are refused |
| **Cloudflare KV** | **100k reads/day, 1k writes/day** | Reads and *writes*, separately | Writes fail; reads fail; both look like "no record" |
| **Inngest** | 50k runs/month (free) | Runs | Events are dropped; jobs stop firing |
| **Resend / mail** | 100 emails/day (typical free tier) | Messages | Alerts stop arriving exactly when they matter |

The two limits that dictated most of this design are **Cloudflare KV's hard 1,000
writes/day** (a write-per-cron-tick design blows it in a day) and **Vercel's CPU
metering** (any work that can be answered from a cache must not run a function).

## Where each class of work belongs

| Function | Lives on | Why not elsewhere |
| --- | --- | --- |
| **Anonymous page HTML, `/api/thumb/*`, `/_next/image`** | Cloudflare Worker cache | 0 CPU and 0 origin egress on a HIT. This is the single biggest lever on Vercel's CPU and Fast Origin Transfer meters. |
| **Live scores + the status payload** | Worker cache + `/__livescore` alias | Identical for every anonymous reader and polled every 15s — the exact traffic shape that melts a serverless origin. |
| **Article views, ad impressions/clicks** | **Convex**, folded into Postgres nightly | Highest write volume by far. `50k views` on Postgres would also be 50k pooler round trips; Convex counts them and Supabase receives one folded update per post. See `src/lib/convex.ts` and `src/lib/view-sync.ts`. |
| **Session/token lookups, settings, hot JSON** | **Upstash / Vercel KV REST** | Commands are cheap and the tier holds no connection. Preferred over TCP Redis on serverless: no per-instance socket, no connection-limit spike. See `src/lib/redis.ts`. |
| **Relational truth: users, posts, comments, payments** | **Supabase** | Reads that need joins and indexes. |
| **Scheduled jobs (cron)** | **Inngest** (primary) + **Vercel safety net** + **Cloudflare Cron Triggers** | Three schedulers over one registry (`src/lib/cron-schedule.ts`). Each is independently free, and each backs up the others. |
| **High-frequency job ticks** | **Cloudflare Cron Triggers** | Free, always on, and *not the thing being watched* — a scheduler that fails alongside what it schedules is useless. |
| **The worker's own durable bookkeeping** | **Sharded**: Upstash for high-frequency records, Cloudflare KV for the rest | KV's 1k writes/day cannot absorb a ledger rewritten every 2 minutes. See below. |
| **Images** | Supabase Storage + worker image cache | One optimize pass at upload, one at the edge; never repeated per request. |
| **Email** | Resend free tier, alert-deduped per episode | Alerts are rate-limited to one per *incident*, not one per check. |

## The KV write budget, distributed

This is the specific distribution the design required, and the one most likely to
be re-broken by a well-meaning change.

Cloudflare KV allows **1,000 writes/day**. The edge worker's cron tick cadence
is `*/2`, `*/5`, `*/15`, `*/30` and `30 */6` — about **1,152 ticks a day**. Writing
one ledger record per tick therefore exceeds the allowance *on its own*, before
any snapshot is stored. The symptom is not an error: `/__edge` simply stops
having a `lastTick`, which is indistinguishable from "the cron never ran" — the
exact ambiguity the ledger was introduced to remove.

So records are **sharded by write frequency** across two stores — and, after the
first version of this table was proven wrong, **everything routine goes to the
remote tier**, with Cloudflare KV kept as a fallback:

| Record | Store |
| --- | --- |
| `tick` ledger | Upstash (remote) |
| `snapshot:livescore-football` | Upstash (remote) |
| `snapshot:status` | Upstash (remote) |
| `snapshot:radio-stations` | Upstash (remote) |
| any new `snapshot:*` | Upstash (remote) |
| *fallback, when the remote tier is down* | Cloudflare KV |

### Why the first split was wrong

The original table put `status` and `radio-stations` on KV on the arithmetic
"~384 writes/day, comfortably inside 1,000". The arithmetic was right and the
model was wrong: those figures are **per colo**. The Cache API is per data
centre, so the mirror in `store()` fires once per *colo* per window — twenty
colos serving a five-minute status window write that record twenty times, and
every colo that has ever seen traffic does the same. That fan-out, not the
cadence, is what kept reaching the 1,000/day ceiling.

The correction is not a smaller number, it is a different store: KV's allowance
is measured in writes-per-day and cannot absorb a per-colo fan-out at any
cadence, while the remote tier is counted in commands. So KV is now written
**only** as a fallback, which is bounded and rare, and the shard rule is
"everything, unless the remote tier is unreachable".

Rules that keep this safe to change:

1. **Reads consult both stores and take the newer copy.** A record written before
   an assignment changed, or during an outage of one store, is still found. Shards
   can be moved without a migration.
2. **Writes fall back to the other store.** Losing the record is strictly worse
   than spending the write we were trying to save.
3. **Shard keys are the stable record id (no cache version).** A
   `CACHE_VERSION` bump must never silently move a record to a store it was not
   chosen for.
4. **`REMOTE_KV_URL` unset ⇒ previous behaviour exactly.** Distribution is an
   optimisation, never a dependency.

The second store is reached at `POST /api/edge/kv`, guarded by `CRON_SECRET`,
namespaced under `edgekv:`, TTL-capped, and refusing non-JSON values — a
write-anything endpoint on the app's own domain would be a cache-poisoning
surface.

`/__edge` reports the live assignment so the budget is checkable from outside
the Cloudflare dashboard:

```bash
curl -s https://connectplus-edge.<subdomain>.workers.dev/__edge | jq .storage
```

## Adding something new: the checklist

1. **Does it write on a timer?** Count the writes per day against the target
   store's allowance *before* writing the code. If it is more than a few hundred,
   it does not belong on Cloudflare KV.
2. **Can it be answered identically for every anonymous reader?** If yes, it
   belongs behind the edge worker, not in a route handler.
3. **Is it a high-volume counter?** It belongs on Convex (offloaded, folded
   periodically), never on Postgres per-event.
4. **Does it need a connection?** Prefer the REST cache tier on serverless; TCP
   Redis multiplies connections by instance count.
5. **Is it a new scheduled job?** Register it once in `src/lib/cron-schedule.ts`.
   The HTTP route, the Inngest function and the parity tests all derive from that
   registry, so a second registration is how two schedulers drift apart.
6. **Does it alert?** Dedupe per episode (Redis key with a TTL). An hourly check
   that emails hourly is an outage of its own.
7. **Does it have a fallback?** Every offload in this app degrades to the
   relational store rather than failing the request. Follow that.

## Verifying the distribution

| Question | Where to look |
| --- | --- |
| Is the edge cache absorbing anonymous traffic? | `X-Edge-Cache` header on any public URL |
| Which store holds each durable record? | `/__edge` → `.storage` |
| Are the cron ticks landing, and where? | `/__edge` → `.lastTick` |
| Are we inside Cloudflare's KV write budget? | `.storage.shards` — any record on `remote` is a write KV did not spend |
| Is the Convex offload working? | Admin → Health → "Views waiting", and `view-sync` evidence |
| Which cache tier is live? | Admin → Health → Brain diagnostics (cache finding), or `cacheBackendDetail()` |
| Is anything silently stalled? | Admin → Health → **Brain diagnostics** — eight probes including a self-test of the deterministic engines |
