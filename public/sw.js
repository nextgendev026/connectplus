/* connectPlus service worker — hardened offline shell + push + update channel.
 * Bump CACHE_VERSION whenever app-shell URLs or cache policies change. It is
 * also the only purge lever a service worker has: bumping it drops every prior
 * cache on the next activation, which is what a stale install needs.
 *
 * Same-origin assets are never blindly cached: PRODUCTION chunk URLs are
 * content-hashed and safe to stale-while-revalidate, but a DEV server serves
 * `/_next/static/chunks/main-app.js` at a stable, unhashed URL and overwrites it
 * in place on every recompile. Caching that URL — even with SWR, which revalidates
 * only *after* handing over the cached copy — makes the next load paint the
 * previous build's JS, so the page renders copy that no longer exists in the
 * source. Only content-hashed asset URLs are cached; everything else under
 * /_next/ is network-first and never stored. */
const CACHE_VERSION = "connectplus-v9";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;
const API_CACHE = `${CACHE_VERSION}-api`;
const PRECACHE = [
  "/",
  "/offline",
  "/manifest.webmanifest",
  "/icon-32.png",
  "/icon-48.png",
  // The official mark, so the offline shell and the install screens show the
  // real emblem rather than a hole where a logo should be.
  "/brand/mark.png",
  "/favicon.ico",
];

const API_SWR = ["/api/posts", "/api/radio/status", "/api/weather"];

/* The reader-scoped queries on those same paths.
 *
 * `/api/posts` is on the SWR list because its anonymous form is byte-identical
 * for every visitor. `?personalized=true` and `?mine=true` are not: one is
 * ranked for the signed-in reader, the other is authored by them. Matching on the
 * pathname alone put both in a disk cache keyed by a URL that names nobody, so on
 * a shared or handed-down phone the next person was served the previous reader's
 * feed. These never touch the cache, in either direction. */
const READER_SCOPED_KEYS = ["mine", "personalized"];

const isReaderScoped = (url) => READER_SCOPED_KEYS.some((k) => url.searchParams.get(k) === "true");

/* Cache ceilings. A phone that opens the app every day for a year must not have
 * an unbounded disk cache on it; the shell is capped well above the precache
 * list, and the API cache well above a feed's worth of pages. */
const SHELL_CACHE_MAX = 40;
const API_CACHE_MAX = 60;

/* Private/authenticated areas are never intercepted. Caching a signed-in
 * page means the next person on the same phone (or the same user after
 * signing out) can be handed someone else's HTML from disk — the classic
 * shared-device PWA leak. These go straight to the network, always. */
const NEVER_INTERCEPT = [
  /^\/admin(\/|$)/,
  /^\/settings(\/|$)/,
  /^\/studio(\/|$)/,
  /^\/api\/admin(\/|$)/,
  /^\/api\/auth(\/|$)/,
  /^\/api\/subscription(\/|$)/,
  // Payments. Listed explicitly rather than left to fall through: the status
  // poll a member's checkout page runs is reader-scoped, and a cached "pending"
  // is a member waiting on a prompt that already settled. Today nothing matches
  // these paths — but that safety is incidental, and one catch-all rule added
  // later would silently make a payment state cacheable.
  /^\/api\/payments(\/|$)/,
  /^\/api\/notifications(\/|$)/,
  /^\/api\/upload(\/|$)/,
  /^\/login(\/|$)/,
  /^\/register(\/|$)/,
];

const isPrivate = (pathname) => NEVER_INTERCEPT.some((re) => re.test(pathname));

/* A production chunk carries its content hash in the path
 * (`main-app-9f2a1b3c4d5e6f7a.js`); a dev chunk does not (`main-app.js`). Vercel
 * deployments also stamp `?dpl=` on asset URLs. Either is proof that this exact
 * URL's bytes are immutable, which is the only thing that makes caching safe. */
const HASHED_ASSET = /\/_next\/static\/[^?]*[.-][0-9a-f]{8,}\.[a-z0-9]+$/i;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

function isImmutableAsset(url) {
  // A dev server on loopback is never cached, whatever the URL looks like —
  // this is the case that used to serve stale chunks to the Preview tab.
  const hostname = (self.location && self.location.hostname) || "";
  if (LOOPBACK_HOST.test(hostname)) return false;
  return HASHED_ASSET.test(url.pathname) || url.searchParams.has("dpl");
}

/**
 * Next.js build output. Immutable, hashed releases get the fast SWR path; dev
 * chunks and anything unrecognised go straight to the network. Falling back to
 * the cache is allowed only when the network fails, so an offline load still
 * works without ever preferring an outdated bundle while the origin is up.
 */
async function nextAsset(request, url) {
  if (isImmutableAsset(url)) return swrAsset(request);
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(request)) || Response.error();
  }
}

/**
 * A navigation response is only safe to store when it is anonymous and
 * genuinely revalidatable: a 200 that set no cookie and asked not to be
 * stored privately must never make it into the shell cache.
 */
function storableNavigation(request, response) {
  if (request.method !== "GET") return false;
  if (response.status !== 200) return false;
  if (response.headers.has("Set-Cookie")) return false;
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (/no-store|private/i.test(cacheControl)) return false;
  const type = response.headers.get("content-type") ?? "";
  return type.includes("text/html");
}

/**
 * The same gate for a public API read.
 *
 * A 200 is not by itself permission to keep a copy. A response that set a cookie
 * or asked not to be stored is a response that knows something about who asked
 * for it — and this cache is keyed by URL alone, so anything personal that lands
 * in it is served to whoever requests that URL next.
 */
function storableApi(response) {
  if (response.status !== 200) return false;
  if (response.headers.has("Set-Cookie")) return false;
  const cacheControl = response.headers.get("cache-control") ?? "";
  return !/no-store|private/i.test(cacheControl);
}

/**
 * Write into a cache that is not allowed to grow forever.
 *
 * `caches` has no quota of its own that the app controls, and both the image and
 * API caches are filled from URLs a visitor chooses one click at a time. Without
 * a ceiling the only eviction policy is the browser's, which starts discarding
 * the things the offline shell depends on. The oldest entry makes way for the
 * incoming one; rewriting an existing URL never evicts anything.
 */
async function putCapped(cache, max, request, response) {
  const keys = await cache.keys();
  const known = keys.some((k) => k.url === request.url);
  if (!known && keys.length >= max) {
    const victim = keys[0];
    if (victim) await cache.delete(victim);
  }
  await cache.put(request, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* Update channel: pages post { type: "SKIP_WAITING" } to activate a fresh SW. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept non-GET, cross-origin, stream, private, or auth traffic.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/radio/stream")) return;
  if (url.pathname.startsWith("/auth")) return;
  if (isPrivate(url.pathname)) return;

  /* Public read APIs: stale-while-revalidate with a small TTL so the feed,
   * radio status, and weather stay usable offline without going stale. The
   * reader-scoped variants are not public and are left entirely alone. */
  if (url.pathname.startsWith("/api/") && API_SWR.some((p) => url.pathname.startsWith(p))) {
    if (isReaderScoped(url)) return;
    event.respondWith(swrApi(request, url));
    return;
  }

  /* Navigations: network-first, fall back to the cached shell per-URL, then "/". */
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request, url));
    return;
  }

  /* Covers and Next.js optimized images — cache-first with a size cap to save
   * mobile data. `/api/thumb/` is the same pipeline from the other end: it is
   * where every card cover, hero and RSS cover resolves to, so caching it here is
   * what lets a story's card keep its picture offline instead of collapsing to an
   * empty gradient. Both are immutable-by-URL and bounded. */
  if (url.pathname.startsWith("/_next/image") || url.pathname.startsWith("/api/thumb/")) {
    event.respondWith(cacheFirstImage(request));
    return;
  }

  /* Next.js build output — hashed releases cached, dev chunks never (see
   * `nextAsset`). */
  if (url.pathname.startsWith("/_next/")) {
    event.respondWith(nextAsset(request, url));
    return;
  }

  /* Our own static assets (fonts, /images): stale-while-revalidate. */
  if (url.pathname.startsWith("/images/") || url.pathname.endsWith(".woff2")) {
    event.respondWith(swrAsset(request));
    return;
  }

  /* PWA icons + favicons — cache-first, never re-fetch. */
  if (
    url.pathname.startsWith("/icon-") ||
    url.pathname.startsWith("/pwa-") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico")
  ) {
    event.respondWith(cacheFirstPermanent(request));
    return;
  }
});

async function swrAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

/** Cache-first for Next.js optimized images — saves mobile data by not
 *  re-fetching images already downloaded. Cap at 200 entries to limit storage. */
const IMAGE_CACHE_MAX = 200;
async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    // Only a real 200 is worth keeping: a 404 for a cover whose upstream died,
    // or a 400 from a malformed thumb code, would otherwise be cached forever
    // and outlive the fix.
    if (res.ok) putCapped(cache, IMAGE_CACHE_MAX, request, res.clone()).catch(() => {});
    return res;
  } catch {
    return Response.error();
  }
}

/** Permanent cache for icons/SVGs — never re-fetch once cached. */
async function cacheFirstPermanent(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch {
    return Response.error();
  }
}

async function networkFirstNavigation(request, url) {
  try {
    const res = await fetch(request);
    // Only anonymous, revalidatable documents are stored (see above); a
    // response that sets a cookie or forbids storage is returned untouched.
    if (storableNavigation(request, res)) {
      const cache = await caches.open(SHELL_CACHE);
      putCapped(cache, SHELL_CACHE_MAX, request, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return (
      (await caches.match("/offline")) ||
      (await caches.match("/")) ||
      new Response(
        "<!doctype html><meta charset=utf-8><title>Offline</title><meta name=viewport content=\"width=device-width,initial-scale=1\"><body style=\"font:16px system-ui;background:#0E1114;color:#F9FAFB;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h1 style=\"color:#ff6b00\">connectPlus</h1><p>You're offline and this page isn't saved yet.</p></div>",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
      )
    );
  }
}

async function swrApi(request, url) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(url);
  const fresh = cached && Date.now() - new Date(cached.headers.get("sw-fetched") || 0) < 30_000;
  if (fresh) return cached;

  try {
    const res = await fetch(request);
    if (storableApi(res)) {
      const copy = res.clone();
      const headers = new Headers(copy.headers);
      headers.set("sw-fetched", String(Date.now()));
      putCapped(
        cache,
        API_CACHE_MAX,
        url.href,
        new Response(copy.body, { status: copy.status, statusText: copy.statusText, headers })
      ).catch(() => {});
    }
    // The fresh answer is returned whether or not it was storable — a response
    // we declined to keep is still the right response to hand over.
    return res;
  } catch {
    return cached || Response.error();
  }
}

/* ------------------------------------------------------------------ */
/* Push + notification UX                                            */
/* ------------------------------------------------------------------ */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "connectPlus", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "connectPlus";
  const options = {
    body: payload.body || "Something new from connectPlus",
    icon: payload.icon || "/pwa-192.png",
    badge: "/pwa-192.png",
    data: { url: payload.url || "/" },
    tag: payload.tag || `connectplus-${Date.now()}`,
    renotify: true,
    requireInteraction: payload.important === true,
    actions: payload.actions || [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("navigate" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

/* Subscription rotation.
 *
 * The browser retires a push endpoint on its own schedule — a key rotation, an
 * evicted storage bucket, an install left dormant for months — and fires this.
 * Nothing handled it, which made it the quietest failure in the notification
 * pipeline: the row on the server kept pointing at an endpoint the push service
 * no longer serves, so alerts simply stopped arriving. No request failed, no
 * error was raised, and neither the reader nor the admin console had anything to
 * look at. Re-registering here is what keeps delivery working while the app is
 * closed, which is the only time background push matters at all.
 *
 * Order is the whole point. The NEW endpoint is registered and acknowledged
 * first; the old one is released only after that. If either call fails — no
 * session (both requests are same-origin, so the browser attaches the cookie),
 * or the server refuses — the reader keeps the last row that points at a live
 * device instead of being left with none.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const previous = event.oldSubscription?.endpoint ?? null;
      const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;

      const subscription =
        event.newSubscription ||
        (await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          ...(applicationServerKey ? { applicationServerKey } : {}),
        }));

      const json = subscription.toJSON ? subscription.toJSON() : {};
      const response = await fetch("/api/notifications/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: json.keys || {},
        }),
      });

      // Only once the replacement is safely on the server, and never for the
      // endpoint we just registered.
      if (!response.ok || !previous || previous === subscription.endpoint) return;
      await fetch(`/api/notifications/push?endpoint=${encodeURIComponent(previous)}`, {
        method: "DELETE",
      });
    })().catch(() => {
      /* A failed rotation must not surface as an unhandled rejection. */
    })
  );
});

