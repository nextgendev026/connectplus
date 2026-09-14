/**
 * ConnectPlus edge proxy (Cloudflare Workers, free tier).
 *
 * Two jobs on one worker:
 *
 *  1. **Cache proxy** in front of the Vercel deployment, so repeat traffic is
 *     answered from Cloudflare's cache and Vercel never sees it:
 *       - less Fast Origin Transfer (bytes pulled from the Vercel origin)
 *       - less Fluid Active CPU (functions not invoked on a cache HIT)
 *
 *  2. **Livescore edge tier.** The live board polls on a timer — every 15s
 *     while a match is in play — which is exactly the traffic shape that melts
 *     a serverless origin: N viewers × 4 requests/minute each. With a hundred
 *     people watching a derby that is ~400 origin invocations a minute for data
 *     that is identical for every one of them. The worker collapses all of it
 *     into one origin fetch per TTL window and serves the rest from the edge.
 *
 * Safety model — the whole design hinges on this:
 *   We ONLY cache anonymous requests. Any request carrying a Cookie or an
 *   Authorization header is passed straight through, untouched and uncached,
 *   and any origin response carrying Set-Cookie is never stored. That means a
 *   signed-in reader can never be served someone else's HTML. Anonymous page
 *   views (crawlers, new visitors, most feed reads) are what get cached.
 *
 * Free-tier budget: Workers free plan is 100k requests/day with a 10ms CPU
 * ceiling per request. This worker does no parsing, no crypto and no loops over
 * payloads — it is a lookup plus a fetch — so it stays far inside that.
 */

/** Origin defaults to the production Vercel host; override with the ORIGIN var. */
const DEFAULT_ORIGIN = "https://connectplusapp.vercel.app";

/** Static build output never changes under a given filename. */
const IMMUTABLE_PREFIXES = ["/_next/static/", "/fonts/", "/screenshots/"];
const IMMUTABLE_EXT =
  /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico|txt|xml|map)$/i;
const IMMUTABLE_TTL = 60 * 60 * 24 * 365;

/**
 * Files served from the app root (`/favicon.ico`, the PWA icons, `/sw.js`,
 * `/robots.txt`, `/sitemap.xml`, `/feed.xml`) match the extension rule above
 * but are NOT content-hashed — their URLs survive a redeploy, so an immutable
 * TTL pins the old bytes for a year. That is exactly how a freshly fixed
 * favicon keeps showing the framework default to every reader while the
 * origin serves the brand mark. An hour keeps them nearly free and still lets
 * a repainted logo or regenerated sitemap land on its own.
 */
const ROOT_TTL = 60 * 60;

/**
 * Cache-key version. The Cache API has no purge hook, so the only way to stop
 * serving an entry stored under a bad policy is to ask for a different key:
 * bump this and every entry is refetched.
 *
 *   v2 — drops the year-long root-file entries (`/favicon.ico` among them)
 *        created before root files were carved out of the immutable rule.
 *   v3 — adds the livescore edge tier, which stores short-TTL JSON under a
 *        `__edge=live` key shape the older entries never used.
 *   v4 — adds the worker-owned snapshots (the cron's cache-first check) and the
 *        cached status payload, both under key shapes v3 never wrote.
 */
const CACHE_VERSION = "4";

/** Anonymous HTML: short TTL so breaking news still lands fast. */
const HTML_TTL = 60;

/** Next's image optimizer output per URL — aligned with its 30-day cache. */
const IMAGE_OPT_TTL = 60 * 60 * 24 * 30;

/**
 * Livescore tier. `ttl` is how long an entry is considered fresh; `swr` is how
 * much longer we are willing to answer from it *while refreshing in the
 * background*. Keeping `swr` well above `ttl` is the point: a viewer arriving
 * between polls gets an instant score that is at most one poll old, instead of
 * a spinner or an origin round trip.
 *
 * TTLs track what the data actually is. A goal can land any second, so 15s on
 * the board; the tips board changes when a pick settles, not every few seconds;
 * partner offers are near-static and only need to survive a traffic spike.
 */
const POLLABLE = [
  { test: /^\/api\/sports\/live/, ttl: 15, swr: 45 },
  { test: /^\/api\/sports\/predictions/, ttl: 30, swr: 90 },
  { test: /^\/api\/sports\/referrals/, ttl: 300, swr: 900 },
  // One fixture's deep read. An open match panel polls this every 30s while the
  // game is live, and the payload is identical for every anonymous reader — so
  // the edge answers it and the origin sees one fetch per window rather than one
  // per viewer per poll. Short TTL because a goal must land quickly; the SWR
  // window is what keeps it instant under load.
  { test: /^\/api\/sports\/match/, ttl: 20, swr: 60 },
  // Form and head-to-head. Slow-moving, reader-independent, and previously a
  // round trip per opened fixture.
  { test: /^\/api\/sports\/h2h/, ttl: 300, swr: 900 },
  // The fixture calendar: generated once, identical for everyone, and expensive
  // upstream (a league sweep per date range), which is exactly the shape that
  // should never be recomputed per viewer.
  { test: /^\/api\/sports\/calendar/, ttl: 900, swr: 1800 },
  // The status payload. This is the single most expensive read in the app — it
  // probes the database, Redis, sampled radio streams, forex, weather, the
  // payment rails and this worker — and every reader landing on /status used to
  // pay for the whole round. It is anonymous and identical for every caller, so
  // the edge answers it and the origin probes once per window. `cors: false`
  // because the status page reads it same-origin: the worker should not
  // advertise this JSON to arbitrary sites the way it does the live board.
  { test: /^\/api\/status$/, ttl: 60, swr: 300, cors: false },
];

/**
 * Snapshots the worker keeps its own copy of.
 *
 * These are the payloads a cron tick used to rebuild blindly: every two minutes
 * the worker pinged `/api/cron?trigger=sports-live` and the origin re-ran the
 * whole snapshot + settle pass, whether or not anyone was watching and whether
 * or not the data had moved. The copy below is the fix — the worker holds these
 * payloads itself, answers readers from them, and a tick only reaches the
 * origin when a copy is genuinely old.
 *
 * Two properties make that filter honest:
 *
 *  1. The copy is *shared with reader traffic*. A poll of the canonical form of
 *     one of these paths stores its response under the same snapshot key the
 *     cron reads, so a board a hundred people are watching is already current
 *     and the tick does nothing at all. The cron is a watchdog for the quiet
 *     hours, not a second scheduler racing the readers.
 *  2. When a copy *is* stale the tick rebuilds and then re-warms it, so the
 *     next tick reads a fresh entry rather than pinging again. Without that the
 *     check would collapse back into "ping every tick" the moment traffic
 *     stopped.
 *
 * The work itself stays the app's: the worker decides *whether* a job is worth
 * running, never what it does (see src/lib/cron-schedule.ts).
 */
const SNAPSHOTS = [
  {
    id: "livescore-football",
    path: "/api/sports/live?sport=football",
    // The board refreshes every 15s and a goal can land in any of them, so a
    // copy older than a couple of cron ticks is worth the rebuild.
    ttl: 120,
    trigger: "sports-live",
  },
  {
    id: "livescore-basketball",
    path: "/api/sports/live?sport=basketball",
    ttl: 120,
    trigger: "sports-live",
  },
  {
    id: "status",
    path: "/api/status",
    // Service health moves in minutes, not seconds, and probing it costs the
    // origin eight upstream round trips — so a five-minute copy still answers
    // the status page from the edge.
    ttl: 300,
    trigger: "radio-status-sweep",
  },
];

/**
 * When an entry was written, recorded by us, in epoch milliseconds.
 *
 * This cannot be derived from the `Date` header. Cloudflare's Cache API rewrites
 * `Date` to the moment of the *hit*, so a live board entry eight seconds old
 * comes back claiming to be one second old, and a snapshot two minutes old
 * reports as brand new. Every freshness decision here — a reader's TTL, the
 * stale-while-revalidate window, and the cron's "is this snapshot worth a
 * rebuild?" — is read from this stamp instead.
 *
 * The failure it prevents is silent in the worst direction: an age that always
 * reads zero makes the cron conclude it never has anything to rebuild, so the
 * jobs it drives stop running while `/__edge` cheerfully reports everything
 * fresh. Entries written before this stamp existed read as undateable, which
 * the callers treat as stale — one rebuild, then accurate again.
 */
const STAMP_HEADER = "x-edge-stored-at";

/** Epoch milliseconds an entry was stored at, or null when it carries no stamp. */
function storedAtMs(response) {
  const raw = Number(response.headers.get(STAMP_HEADER));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Snapshot keys are host-independent on purpose: a Cron Trigger carries no
 * request URL, so the scheduled handler has no origin of its own to key off.
 * The request path writes under the same synthetic host.
 */
const snapshotKey = (id) =>
  new Request(`https://snapshot.edge.internal/${id}?v=${CACHE_VERSION}`, { method: "GET" });

/**
 * Where the last tick's outcome is kept.
 *
 * A Cron Trigger has no request and no reader, so a handler that throws is
 * silent: no response, no log anybody is watching, and the only symptom is a
 * job that quietly stops running — which is the exact failure this worker was
 * built to cover for. The tick therefore records what it decided, and `/__edge`
 * reports it, so "is the edge cron alive?" has an answer that does not require
 * the Cloudflare dashboard.
 */
const tickKey = () =>
  new Request(`https://snapshot.edge.internal/tick?v=${CACHE_VERSION}`, { method: "GET" });

/** Read back the last tick's record, or null when there has never been one. */
async function lastTick() {
  const cached = await caches.default.match(tickKey());
  if (!cached) return null;
  return cached.json().catch(() => null);
}

/** Look a snapshot up by id. */
const snapshotById = (id) => SNAPSHOTS.find((s) => s.id === id) ?? null;

/** The snapshot a canonical path warms, or null when this request is not it. */
function snapshotFor(pathname, params) {
  if (pathname === "/api/status") return snapshotById("status");
  if (pathname !== "/api/sports/live") return null;
  // Only the live board is shared with the cron's copy. The board's poll sends
  // today's date (that is what makes it *today's* fixture list), so today counts
  // as the live read; a specific past day is a historical view and must not
  // refresh the "now" snapshot. Junk in `date` is snapped away by the alias and
  // lands here as the live read, which is where the origin would route it too.
  const date = params.get("date") ?? "";
  if (date && date !== new Date().toISOString().slice(0, 10)) return null;
  return snapshotById(params.get("sport") === "basketball" ? "livescore-basketball" : "livescore-football");
}

/** Age of a worker-owned snapshot in seconds, or null when missing/unusable. */
async function snapshotAge(snapshot) {
  const cached = await caches.default.match(snapshotKey(snapshot.id));
  if (!cached) return null;
  // An undateable copy is not a fresh copy. The tick rebuilds it instead of
  // trusting a header we did not write.
  if (storedAtMs(cached) === null) return null;
  return ageSeconds(cached);
}

/** Read-only JSON that is identical for every anonymous caller. */
const API_ALLOWLIST = [
  { test: /^\/api\/trending\/topics/, ttl: 120 },
  { test: /^\/api\/posts\/check/, ttl: 30 },
  { test: /^\/api\/subscription\/plans/, ttl: 600 },
  // Which rails are live and what each charges — identical for every visitor
  // until an admin edits a plan, so a long TTL costs nothing.
  { test: /^\/api\/payments\/providers/, ttl: 300 },
];

/**
 * Scheduled jobs this worker drives.
 *
 * Cloudflare Cron Triggers are the one scheduler that is free, always on, and
 * independent of both Vercel and Inngest — which matters because the jobs here
 * are the ones that quietly rot when nothing is watching them: the radio
 * metadata sweep (whose staleness is exactly the "radio degraded" warning the
 * admin console raises) and the livescore/prediction sweep that keeps the board
 * and the model current.
 *
 * The worker does no work itself. It pings the app's registry-driven endpoint,
 * so the jobs, their cadence and their heartbeats stay owned by
 * `src/lib/cron-schedule.ts` and this table cannot drift into a second, wrong
 * definition of what a job does — only of when it runs, which is one line here
 * against one cron expression there.
 */
const SCHEDULES = [
  { cron: "*/2 * * * *", trigger: "sports-live" },
  { cron: "*/5 * * * *", trigger: "sports-notify" },
  { cron: "*/15 * * * *", trigger: "radio-status-sweep" },
  { cron: "*/30 * * * *", trigger: "sports-intel" },
  { cron: "30 */6 * * *", trigger: "payments-lifecycle" },
];

/**
 * What to ping when a trigger fires: the trigger named in SCHEDULES, or the
 * single job named in the `CRON_TRIGGER` var for a hand-rolled schedule.
 */
function triggersFor(cron, env) {
  const fromTable = SCHEDULES.filter((s) => s.cron === cron).map((s) => s.trigger);
  if (fromTable.length > 0) return fromTable;
  const fallback = (env.CRON_TRIGGER || "").trim();
  return fallback ? [fallback] : [];
}

/** Never cache these, even anonymously (sessions, writes, telemetry). */
const NEVER_CACHE = [
  /^\/api\/auth/,
  /^\/api\/upload/,
  /^\/api\/track/,
  // Payments: callbacks and webhooks are writes, and the status poll is
  // reader-scoped. `/api/payments/providers` is the one public read and is
  // explicitly allowlisted below instead.
  /^\/api\/payments\/(?!providers$)/,
  /^\/api\/status\//,
  /^\/api\/rss/,
  /^\/api\/cron/,
  // Per-reader sports state: favourites and reminders are scoped to a session.
  /^\/api\/sports\/(follows|reminders|track)/,
];

const SWR_SECONDS = 300;

const hasCredentials = (request) =>
  request.headers.has("Cookie") || request.headers.has("Authorization");

/**
 * CORS for the public livescore tier.
 *
 * The app fetches `<edge>/__livescore` cross-origin, so the browser needs an
 * explicit allow header to hand the JSON to the page. `*` is safe here for the
 * same reason the tier is cacheable at all: it only ever carries the anonymous,
 * identical-for-everyone payload. Anything reader-scoped is in NEVER_CACHE and
 * never reaches this path. Deliberately no `Allow-Credentials` — the worker
 * bypasses any request that carries a Cookie anyway, so advertising credential
 * support would promise something it does not do.
 */
function withCors(response) {
  const res = new Response(response.body, response);
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  // The public tier is read by the app's origin, so say that explicitly rather
  // than leaving every browser's default for a cross-origin response to decide.
  res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return res;
}

/** True when a path in the JSON tier may be read cross-origin (the public ones). */
const corsFor = (rule) => Boolean(rule) && rule.cors !== false;

/**
 * Baseline hardening for every response the worker hands back.
 *
 * The origin's headers are copied through, so this only fills gaps and covers
 * the edge hop. `nosniff` is the one that matters most: this worker caches JSON
 * and image bytes, and a browser left to re-sniff a cached payload for its
 * content type is how a stored response becomes a script. `X-Frame-Options` is
 * only defaulted, never overwritten — the origin decides whether its own HTML
 * may be framed, and overruling it here would be the worker inventing a policy.
 */
function harden(headers) {
  // Our own bookkeeping, not the reader's business: `X-Edge-Age` is the
  // diagnostic derived from it.
  headers.delete(STAMP_HEADER);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!headers.has("X-Frame-Options")) headers.set("X-Frame-Options", "DENY");
  return headers;
}

const isNever = (pathname) => NEVER_CACHE.some((re) => re.test(pathname));

const isImmutable = (pathname) =>
  IMMUTABLE_PREFIXES.some((p) => pathname.startsWith(p)) || IMMUTABLE_EXT.test(pathname);

/** A file at the app root (one path segment) — never content-hashed. */
const isRootFile = (pathname) => /^\/[^/]+$/.test(pathname);

/** The pollable rule for a path, if it has one. */
const pollableFor = (pathname) => POLLABLE.find((entry) => entry.test.test(pathname)) ?? null;

/**
 * The optimizer and the cover route negotiate a format from `Accept`, and the
 * Cache API keys on the URL alone (it ignores Vary). Without this the first
 * AVIF-capable caller could poison the cache for browsers that only take WebP,
 * so the negotiated family becomes part of the key.
 */
function variantKey(request) {
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("image/avif")) return "avif";
  if (accept.includes("image/webp")) return "webp";
  return "std";
}

/** TTL for a path, or 0 when this proxy should not cache it at all. */
function ttlFor(pathname, response) {
  // Checked before the immutable rule: a root file with a "static" extension
  // is still mutable, and a year is far too long to be wrong about.
  if (isRootFile(pathname) && IMMUTABLE_EXT.test(pathname)) return ROOT_TTL;
  // Covers and generated thumbnails are content-addressed and immutable.
  if (pathname.startsWith("/api/thumb")) return IMMUTABLE_TTL;
  // Image optimizer output: one immutable artifact per url+width+quality+format.
  if (pathname.startsWith("/_next/image")) return IMAGE_OPT_TTL;
  if (isImmutable(pathname)) return IMMUTABLE_TTL;
  if (pollableFor(pathname)) return pollableFor(pathname).ttl;
  for (const entry of API_ALLOWLIST) {
    if (entry.test.test(pathname)) return entry.ttl;
  }
  // Everything else: only renderable HTML documents are edge-cached.
  const type = response.headers.get("Content-Type") ?? "";
  if (type.includes("text/html")) return HTML_TTL;
  return 0;
}

function cacheableResponse(response) {
  if (response.status !== 200) return false;
  if (response.headers.has("Set-Cookie")) return false;
  // A cached 401/redirect would be wrong for the next anonymous visitor.
  const type = response.headers.get("Content-Type") ?? "";
  return (
    type.includes("text/html") ||
    type.includes("application/json") ||
    type.startsWith("image/") ||
    type.includes("text/css") ||
    type.includes("javascript")
  );
}

/**
 * How long ago this response was stored, in seconds.
 *
 * The stamp we write at store time is authoritative. `Date` is only a fallback
 * for entries stored before the stamp existed, and it is a poor clock even
 * then: the platform rewrites it on every hit, so such an entry reads as
 * "brand new" and is simply served until the cache evicts it.
 */
function ageSeconds(response) {
  const storedAt = storedAtMs(response);
  if (storedAt !== null) return Math.max(0, (Date.now() - storedAt) / 1000);
  const date = response.headers.get("Date");
  if (!date) return 0;
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, (Date.now() - parsed) / 1000);
}

/** The origin URL for a request, with `/__livescore` rewritten to the real API. */
function resolveOriginPath(url) {
  if (url.pathname !== "/__livescore") return url.pathname + url.search;

  /**
   * Canonical livescore alias.
   *
   * The board's real query string is open-ended, and every distinct query is a
   * distinct edge-cache entry — so a page that appends cache-busting params
   * would shred the cache into one useless entry per viewer. This alias keeps
   * only the params that actually change the payload and snaps them to a closed
   * set, so the cardinality is "2 sports × distinct dates" and nothing else.
   */
  const sport = url.searchParams.get("sport") === "basketball" ? "basketball" : "football";
  const rawDate = url.searchParams.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : "";
  const fresh = url.searchParams.get("fresh") === "1" ? "&fresh=1" : "";
  return `/api/sports/live?sport=${sport}${date ? `&date=${date}` : ""}${fresh}`;
}

const tagged = (response, state) => {
  const res = new Response(response.body, response);
  harden(res.headers);
  res.headers.set("X-Edge-Cache", state);
  res.headers.set("X-Edge-Origin", "vercel");
  return res;
};

/**
 * Store a response, and mirror it into the snapshot namespace when this request
 * is the canonical form of a worker-owned snapshot. The mirror is what keeps a
 * busy board's cache and the cron's freshness check talking about one document:
 * reader traffic refreshes the very entry the tick reads.
 *
 * The mirror gets the *snapshot's* lifetime, not the reader's. The Cache API
 * derives an entry's life from these response headers, so a copy stored under
 * the board's own `max-age=15` was evicted within seconds — the tick then always
 * saw an empty namespace and rebuilt every time, which is exactly the behaviour
 * this whole mechanism exists to avoid. (A unit test that stores responses in a
 * plain Map cannot catch that: only a real cache expires anything.)
 */
async function store(cacheKey, snapshot, response) {
  await caches.default.put(cacheKey, response.clone());
  if (!snapshot) return;
  const headers = new Headers(response.headers);
  // The mirror is written now, so it is stamped now — independent of whatever
  // the response we are copying happened to carry.
  headers.set(STAMP_HEADER, String(Date.now()));
  headers.set("Cache-Control", `public, max-age=${snapshot.ttl}, s-maxage=${snapshot.ttl}`);
  await caches.default.put(
    snapshotKey(snapshot.id),
    new Response(await response.clone().arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  );
}

/**
 * Stamp a `Date` when the origin sent none.
 *
 * The moment we know the response exists is the moment to record it, in a stamp
 * of our own: the platform's `Date` is rewritten on retrieval and cannot carry
 * a write time forward (see STAMP_HEADER).
 */
function stamped(headers) {
  headers.set(STAMP_HEADER, String(Date.now()));
  if (!headers.has("Date")) headers.set("Date", new Date().toUTCString());
  return headers;
}

const shortError = (err) => (err && err.message ? err.message : String(err));

/** Record a tick outcome for `/__edge`. Best-effort: never fails the invocation. */
async function recordTick(record) {
  try {
    await caches.default.put(
      tickKey(),
      new Response(JSON.stringify(record), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
      })
    );
  } catch (err) {
    console.log(`edge-cron: could not record tick — ${shortError(err)}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = (env.ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");

    // Cheap liveness probe for the status page / uptime monitor. It also
    // reports the snapshot ages, which is the number to watch when asking why
    // the edge cron did or did not rebuild this hour.
    if (url.pathname === "/__edge") {
      const snapshots = await Promise.all(
        SNAPSHOTS.map(async (s) => {
          const age = await snapshotAge(s);
          return {
            id: s.id,
            ttl: s.ttl,
            trigger: s.trigger,
            ageSeconds: age === null ? null : Math.round(age),
            fresh: age !== null && age <= s.ttl,
          };
        })
      );
      return Response.json({
        ok: true,
        origin,
        now: new Date().toISOString(),
        livescore: `${url.origin}/__livescore`,
        status: `${url.origin}/api/status`,
        snapshots,
        // The last tick's decisions. Without this, "the edge cron is silent"
        // and "the edge cron decided there was nothing to do" look identical.
        lastTick: await lastTick(),
        schedules: SCHEDULES.map((s) => `${s.cron} → ${s.trigger}`),
        cronSecret: Boolean(env.CRON_SECRET),
      });
    }

    const isLiveAlias = url.pathname === "/__livescore";
    const originUrl = origin + resolveOriginPath(url);
    const pathname = isLiveAlias ? "/api/sports/live" : url.pathname;

    // A preflight for the cross-origin livescore poll. No cookies, no
    // credentials — just permission to read a public JSON document. The status
    // payload shares this tier but is read same-origin, so it is not announced.
    if (request.method === "OPTIONS" && (isLiveAlias || corsFor(pollableFor(pathname)))) {
      return withCors(new Response(null, { status: 204 }));
    }

    // Writes, credentialed traffic and never-cache paths go straight through.
    if (request.method !== "GET" || hasCredentials(request) || isNever(pathname)) {
      const res = await fetch(originUrl, request);
      return tagged(res, "BYPASS");
    }

    const varies = pathname.startsWith("/_next/image") || pathname.startsWith("/api/thumb");
    const poll = pollableFor(pathname);
    const variant = poll ? "live" : varies ? variantKey(request) : "std";
    // The worker-owned snapshot this request refreshes, if it is the canonical
    // form of one — reader traffic and the edge cron then share one copy.
    const snapshot = snapshotFor(pathname, url.searchParams);
    // The alias is its own key space so a `/api/sports/live` entry and a
    // `/__livescore` entry never collide despite the shared origin path. The
    // origin is prefixed explicitly because `new Request` needs an absolute
    // URL — a bare path throws, which would take down the whole tier.
    const keyPath = isLiveAlias ? `${url.origin}/__livescore${url.search}` : url.toString();
    const separator = keyPath.includes("?") ? "&" : "?";
    const cacheKey = new Request(`${keyPath}${separator}__edge=${variant}&v=${CACHE_VERSION}`, {
      method: "GET",
    });

    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const age = ageSeconds(cached);

      // Fresh: answer immediately, no origin involvement at all.
      if (!poll || age <= poll.ttl) {
        const hit = new Response(cached.body, cached);
        harden(hit.headers);
        hit.headers.set("X-Edge-Cache", "HIT");
        hit.headers.set("X-Edge-Age", Math.round(age).toString());
        return corsFor(poll) ? withCors(hit) : hit;
      }

      // Stale but still within the window: hand the reader the stale copy NOW
      // and refresh behind them. This is the property that keeps a live board
      // instant under load — nobody waits on the origin, and the next caller
      // gets the refreshed entry.
      if (age <= poll.ttl + poll.swr) {
        ctx.waitUntil(
          fetch(originUrl, {
            method: "GET",
            headers: { accept: request.headers.get("accept") ?? "*/*" },
            redirect: "manual",
          })
            .then(async (res) => {
              if (!cacheableResponse(res)) return;
              const body = await res.arrayBuffer();
              const headers = stamped(new Headers(res.headers));
              headers.delete("Set-Cookie");
              headers.set(
                "Cache-Control",
                `public, max-age=${poll.ttl}, s-maxage=${poll.ttl}, stale-while-revalidate=${poll.swr}`
              );
              await store(
                cacheKey,
                snapshot,
                new Response(body, { status: res.status, statusText: res.statusText, headers })
              );
            })
            .catch(() => {})
        );
        const stale = new Response(cached.body, cached);
        harden(stale.headers);
        stale.headers.set("X-Edge-Cache", "HIT-STALE");
        stale.headers.set("X-Edge-Age", Math.round(age).toString());
        return corsFor(poll) ? withCors(stale) : stale;
      }
      // Past the stale window — fall through and refetch synchronously.
    }

    const res = await fetch(originUrl, {
      method: "GET",
      headers: { accept: request.headers.get("accept") ?? "*/*" },
      redirect: "manual",
    });

    const ttl = ttlFor(pathname, res);
    if (ttl === 0 || !cacheableResponse(res)) {
      return tagged(res, "MISS-UNCACHEABLE");
    }

    const body = await res.arrayBuffer();
    const headers = stamped(new Headers(res.headers));
    headers.delete("Set-Cookie");
    headers.set(
      "Cache-Control",
      `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${
        poll ? poll.swr : SWR_SECONDS
      }`
    );
    const storable = new Response(body, { status: res.status, statusText: res.statusText, headers });

    // Store a copy, then answer this caller from the buffered body.
    await store(cacheKey, snapshot, storable);
    const answered = tagged(new Response(storable.body, storable), "MISS");
    return corsFor(poll) ? withCors(answered) : answered;
  },

  /**
   * Cron Trigger handler — cache-first.
   *
   * Fires the app's own scheduler endpoint for the jobs this worker owns, but
   * only after checking the worker's own copy of what the job produces. The
   * shared secret is sent as both `x-cron-secret` and a bearer token, matching
   * what `/api/cron` accepts, so the same secret works whichever scheduler
   * calls it.
   *
   * The check is the change that matters: a snapshot that is still fresh is a
   * rebuild the origin does not need, and under reader traffic the board keeps
   * that copy current by itself. When a copy is stale the worker pings, then
   * re-warms its own copy so the next tick has something to measure.
   *
   * Nothing here may throw out of the handler. A Cron Trigger has no request
   * and no reader, so an exception is silent: no response, no page anybody is
   * loading, just a job that stops running — and for the two jobs this worker
   * owns, the symptom is a scoreboard and a radio panel that quietly go stale.
   * So each trigger is contained, a cache that cannot be read counts as stale,
   * and the tick's decisions land in a record `/__edge` reports.
   */
  async scheduled(event, env) {
    const origin = (env.ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");
    const triggers = triggersFor(event.cron, env);
    const tick = { at: new Date().toISOString(), cron: event.cron, triggers: [] };

    if (triggers.length === 0) {
      // This used to return silently, which is indistinguishable from a cron
      // that never fired. It is now logged *and* reported on /__edge.
      console.log(`edge-cron: no trigger mapped to "${event.cron}" — add it to SCHEDULES`);
      tick.triggers.push({ trigger: null, action: "unmapped-cron" });
      await recordTick(tick);
      return;
    }

    const headers = { accept: "application/json" };
    const secret = (env.CRON_SECRET || "").trim();
    if (secret) {
      headers["x-cron-secret"] = secret;
      headers.authorization = `Bearer ${secret}`;
    }

    /**
     * Take the worker's own copy of a snapshot, straight from the public route.
     * Runs after the rebuild ping so the copy reflects it, but deliberately not
     * *conditioned* on that ping succeeding: a missing CRON_SECRET must not also
     * cost readers a warm board.
     */
    const warm = async (snapshot) => {
      try {
        const res = await fetch(`${origin}${snapshot.path}`, {
          method: "GET",
          headers: { accept: "application/json" },
          redirect: "manual",
        });
        if (!cacheableResponse(res)) {
          console.log(`edge-cron: ${snapshot.id} not storable (${res.status})`);
          return;
        }
        const body = await res.arrayBuffer();
        const snapshotHeaders = stamped(new Headers(res.headers));
        snapshotHeaders.delete("Set-Cookie");
        snapshotHeaders.set(
          "Cache-Control",
          `public, max-age=${snapshot.ttl}, s-maxage=${snapshot.ttl}`
        );
        await caches.default.put(
          snapshotKey(snapshot.id),
          new Response(body, { status: res.status, statusText: res.statusText, headers: snapshotHeaders })
        );
        console.log(`edge-cron: ${snapshot.id} snapshot warmed`);
      } catch (err) {
        console.log(
          `edge-cron: ${snapshot.id} warm failed — ${err && err.message ? err.message : err}`
        );
      }
    };

    const run = async (trigger) => {
      // Which of the worker's own copies does this job refresh? A snapshot that
      // is still fresh means there is nothing here worth a Vercel invocation.
      const guarded = SNAPSHOTS.filter((s) => s.trigger === trigger);
      // A snapshot we cannot read counts as stale, never as fresh: a scheduler
      // has to fail towards running the job. Skipping because the cache was
      // unreachable is the one outcome nobody notices until the board is hours
      // old, which is precisely what this worker exists to prevent.
      let ages;
      try {
        ages = await Promise.all(guarded.map((s) => snapshotAge(s)));
      } catch (err) {
        console.log(`edge-cron: ${trigger} snapshot read failed — ${shortError(err)}`);
        ages = guarded.map(() => null);
      }
      const stale = guarded.filter((s, i) => ages[i] === null || ages[i] > s.ttl);

      if (guarded.length > 0 && stale.length === 0) {
        const detail = guarded
          .map((s, i) => `${s.id} ${Math.round(ages[i])}s/${s.ttl}s`)
          .join(", ");
        console.log(`edge-cron: ${trigger} skipped — cached snapshot still fresh (${detail})`);
        return { trigger, action: "skipped-fresh", snapshots: guarded.map((s) => s.id) };
      }

      const url = `${origin}/api/cron?trigger=${encodeURIComponent(trigger)}&source=cloudflare-cron`;
      let ping = "ok";
      try {
        const res = await fetch(url, { method: "GET", headers });
        const body = await res.text();
        ping = String(res.status);
        console.log(`edge-cron: ${trigger} (${event.cron}) → ${res.status} ${body.slice(0, 200)}`);
      } catch (err) {
        ping = shortError(err);
        console.log(`edge-cron: ${trigger} failed — ${ping}`);
      }

      // Re-warm only what was stale — the tight copy needs no help, and this is
      // the one origin read the tick still makes.
      await Promise.all(stale.map((s) => warm(s)));

      return {
        trigger,
        action: "rebuilt",
        ping,
        stale: stale.map((s) => s.id),
      };
    };

    // Each trigger is contained and awaited. Awaiting matters: a Cron Trigger
    // has no response to return early from, so `waitUntil` was only ever buying
    // the illusion of a shorter invocation — and if the work rejected there, it
    // took the whole tick's log with it. `allSettled` because one job failing
    // must never silence the others.
    const settled = await Promise.allSettled(triggers.map((t) => run(t)));
    for (const [i, outcome] of settled.entries()) {
      tick.triggers.push(
        outcome.status === "fulfilled"
          ? outcome.value
          : { trigger: triggers[i], action: "error", detail: shortError(outcome.reason) }
      );
    }
    await recordTick(tick);
  },
};
