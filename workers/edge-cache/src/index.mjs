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
 */
const CACHE_VERSION = "3";

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
];

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
  return res;
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
 * How long ago the origin produced this response, in seconds.
 *
 * The Cache API hands back the headers it stored, and Cloudflare's own `Age`
 * header is not reliable for entries we wrote ourselves — so age is derived
 * from the origin's `Date` header, falling back to "brand new" when the origin
 * sent none (better to over-fetch than to serve something ancient forever).
 */
function ageSeconds(response) {
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
  res.headers.set("X-Edge-Cache", state);
  res.headers.set("X-Edge-Origin", "vercel");
  return res;
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = (env.ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");

    // Cheap liveness probe for the status page / uptime monitor.
    if (url.pathname === "/__edge") {
      return Response.json({
        ok: true,
        origin,
        now: new Date().toISOString(),
        livescore: `${url.origin}/__livescore`,
        schedules: SCHEDULES.map((s) => `${s.cron} → ${s.trigger}`),
        cronSecret: Boolean(env.CRON_SECRET),
      });
    }

    const isLiveAlias = url.pathname === "/__livescore";
    const originUrl = origin + resolveOriginPath(url);
    const pathname = isLiveAlias ? "/api/sports/live" : url.pathname;

    // A preflight for the cross-origin livescore poll. No cookies, no
    // credentials — just permission to read a public JSON document.
    if (request.method === "OPTIONS" && (isLiveAlias || pollableFor(pathname))) {
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
        hit.headers.set("X-Edge-Cache", "HIT");
        hit.headers.set("X-Edge-Age", Math.round(age).toString());
        return poll ? withCors(hit) : hit;
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
              const headers = new Headers(res.headers);
              headers.delete("Set-Cookie");
              headers.set(
                "Cache-Control",
                `public, max-age=${poll.ttl}, s-maxage=${poll.ttl}, stale-while-revalidate=${poll.swr}`
              );
              await caches.default.put(
                cacheKey,
                new Response(body, { status: res.status, statusText: res.statusText, headers })
              );
            })
            .catch(() => {})
        );
        const stale = new Response(cached.body, cached);
        stale.headers.set("X-Edge-Cache", "HIT-STALE");
        stale.headers.set("X-Edge-Age", Math.round(age).toString());
        return withCors(stale);
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
    const headers = new Headers(res.headers);
    headers.delete("Set-Cookie");
    headers.set(
      "Cache-Control",
      `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${
        poll ? poll.swr : SWR_SECONDS
      }`
    );
    const storable = new Response(body, { status: res.status, statusText: res.statusText, headers });

    // Store a copy, then answer this caller from the buffered body.
    await caches.default.put(cacheKey, storable.clone());
    const answered = tagged(new Response(storable.body, storable), "MISS");
    return poll ? withCors(answered) : answered;
  },

  /**
   * Cron Trigger handler.
   *
   * Fires the app's own scheduler endpoint for the jobs this worker owns. The
   * shared secret is sent as both `x-cron-secret` and a bearer token, matching
   * what `/api/cron` accepts, so the same secret works whichever scheduler
   * calls it.
   *
   * Failures are swallowed after being logged: the app heartbeats every run, so
   * a job that stops being reachable shows up in the admin console as stale
   * rather than as a worker throwing into the void — and one bad ping must never
   * cost us the next trigger.
   */
  async scheduled(event, env, ctx) {
    const origin = (env.ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");
    const triggers = triggersFor(event.cron, env);

    if (triggers.length === 0) {
      console.log(`edge-cron: no trigger mapped to "${event.cron}" — add it to SCHEDULES`);
      return;
    }

    const headers = { accept: "application/json" };
    const secret = (env.CRON_SECRET || "").trim();
    if (secret) {
      headers["x-cron-secret"] = secret;
      headers.authorization = `Bearer ${secret}`;
    }

    const run = async (trigger) => {
      const url = `${origin}/api/cron?trigger=${encodeURIComponent(trigger)}&source=cloudflare-cron`;
      try {
        const res = await fetch(url, { method: "GET", headers });
        const body = await res.text();
        console.log(`edge-cron: ${trigger} (${event.cron}) → ${res.status} ${body.slice(0, 200)}`);
      } catch (err) {
        console.log(`edge-cron: ${trigger} failed — ${err && err.message ? err.message : err}`);
      }
    };

    // `ctx.waitUntil` lets one trigger drive several jobs without holding the
    // scheduled invocation open on each response.
    ctx.waitUntil(Promise.all(triggers.map(run)));
  },
};
