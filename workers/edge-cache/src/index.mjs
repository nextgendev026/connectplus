/**
 * ConnectPlus edge cache proxy (Cloudflare Workers, free tier).
 *
 * Sits in front of the Vercel deployment and answers as much traffic as
 * possible from Cloudflare's edge cache, so Vercel never sees it:
 *   - less Fast Origin Transfer (bytes pulled from the Vercel origin)
 *   - less Fluid Active CPU (functions not invoked on a cache HIT)
 *   - less bandwidth/storage pressure downstream
 *
 * Safety model — the whole design hinges on this:
 *   We ONLY cache anonymous requests. Any request carrying a Cookie or an
 *   Authorization header is passed straight through, untouched and uncached,
 *   and any origin response carrying Set-Cookie is never stored. That means a
 *   signed-in reader can never be served someone else's HTML. Anonymous page
 *   views (crawlers, new visitors, most feed reads) are what get cached.
 *
 * Free-tier budget: Workers free plan is 100k requests/day with a 10ms CPU
 * ceiling per request. This worker does no parsing, no crypto and no loops
 * over payloads — it is a lookup + a fetch — so it stays far inside that.
 */

/** Origin defaults to the production Vercel host; override with the ORIGIN var. */
const DEFAULT_ORIGIN = "https://connectplusapp.vercel.app";

/** Static build output never changes under a given filename. */
const IMMUTABLE_PREFIXES = ["/_next/static/", "/fonts/", "/screenshots/"];
const IMMUTABLE_EXT =
  /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico|txt|xml|map)$/i;
const IMMUTABLE_TTL = 60 * 60 * 24 * 365;

/** Anonymous HTML: short TTL so breaking news still lands fast. */
const HTML_TTL = 60;

/** Next's image optimizer output per URL — aligned with its 30-day cache. */
const IMAGE_OPT_TTL = 60 * 60 * 24 * 30;

/** Read-only JSON that is identical for every anonymous caller. */
const API_ALLOWLIST = [
  { test: /^\/api\/trending\/topics/, ttl: 120 },
  { test: /^\/api\/posts\/check/, ttl: 30 },
  { test: /^\/api\/subscription\/plans/, ttl: 600 },
];

/** Never cache these, even anonymously (sessions, writes, telemetry). */
const NEVER_CACHE = [
  /^\/api\/auth/,
  /^\/api\/upload/,
  /^\/api\/track/,
  /^\/api\/stripe/,
  /^\/api\/status\//,
  /^\/api\/rss/,
];

const SWR_SECONDS = 300;

const hasCredentials = (request) =>
  request.headers.has("Cookie") || request.headers.has("Authorization");

const isNever = (pathname) => NEVER_CACHE.some((re) => re.test(pathname));

const isImmutable = (pathname) =>
  IMMUTABLE_PREFIXES.some((p) => pathname.startsWith(p)) || IMMUTABLE_EXT.test(pathname);

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
  // Covers and generated thumbnails are content-addressed and immutable.
  if (pathname.startsWith("/api/thumb")) return IMMUTABLE_TTL;
  // Image optimizer output: one immutable artifact per url+width+quality+format.
  if (pathname.startsWith("/_next/image")) return IMAGE_OPT_TTL;
  if (isImmutable(pathname)) return IMMUTABLE_TTL;
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

const tagged = (response, state) => {
  const res = new Response(response.body, response);
  res.headers.set("X-Edge-Cache", state);
  res.headers.set("X-Edge-Origin", "vercel");
  return res;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = (env.ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");

    // Cheap liveness probe for the status page / uptime monitor.
    if (url.pathname === "/__edge") {
      return Response.json({ ok: true, origin, now: new Date().toISOString() });
    }

    const originUrl = origin + url.pathname + url.search;

    // Writes, credentialed traffic and never-cache paths go straight through.
    if (request.method !== "GET" || hasCredentials(request) || isNever(url.pathname)) {
      const res = await fetch(originUrl, request);
      return tagged(res, "BYPASS");
    }

    const varies = url.pathname.startsWith("/_next/image") || url.pathname.startsWith("/api/thumb");
    const keyUrl = varies
      ? `${url.toString()}${url.search ? "&" : "?"}__edge=${variantKey(request)}`
      : url.toString();
    const cacheKey = new Request(keyUrl, { method: "GET" });
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("X-Edge-Cache", "HIT");
      return hit;
    }

    const res = await fetch(originUrl, {
      method: "GET",
      headers: { accept: request.headers.get("accept") ?? "*/*" },
      redirect: "manual",
    });

    const ttl = ttlFor(url.pathname, res);
    if (ttl === 0 || !cacheableResponse(res)) {
      return tagged(res, "MISS-UNCACHEABLE");
    }

    const body = await res.arrayBuffer();
    const headers = new Headers(res.headers);
    headers.delete("Set-Cookie");
    headers.set(
      "Cache-Control",
      `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${SWR_SECONDS}`
    );
    const storable = new Response(body, { status: res.status, statusText: res.statusText, headers });

    // Store a copy, then answer this caller from the buffered body.
    await caches.default.put(cacheKey, storable.clone());
    return tagged(new Response(storable.body, storable), "MISS");
  },
};
