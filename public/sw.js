/* connectPlus service worker — hardened offline shell + push + update channel.
 * Bump CACHE_VERSION whenever app-shell URLs or cache policies change. It is
 * also the only purge lever a service worker has: bumping it drops every prior
 * cache on the next activation, which is what a stale install needs.
 *
 * Same-origin assets are stale-while-revalidate (NOT cache-first): production
 * chunk URLs are content-hashed, but a SW that blindly cache-firsts /_next/
 * can serve stale JS after a recompile, which bricks the app. SWR returns the
 * cached copy instantly on repeat loads and revalidates in the background, so
 * it is just as fast and cannot serve a permanently-wrong bundle. */
const CACHE_VERSION = "connectplus-v6";
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
  "/favicon.ico",
];

const API_SWR = ["/api/posts", "/api/radio/status", "/api/weather"];

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
   * radio status, and weather stay usable offline without going stale. */
  if (url.pathname.startsWith("/api/") && API_SWR.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(swrApi(request, url));
    return;
  }

  /* Navigations: network-first, fall back to the cached shell per-URL, then "/". */
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request, url));
    return;
  }

  /* Next.js optimized images — cache-first with size cap to save mobile data. */
  if (url.pathname.startsWith("/_next/image")) {
    event.respondWith(cacheFirstImage(request));
    return;
  }

  /* Same-origin static assets (JS/CSS/fonts): stale-while-revalidate. */
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/images/") ||
    url.pathname.endsWith(".woff2")
  ) {
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
    if (res.ok) {
      const keys = await cache.keys();
      if (keys.length >= IMAGE_CACHE_MAX) {
        await cache.delete(keys[0]);
      }
      cache.put(request, res.clone()).catch(() => {});
    }
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
      cache.put(request, res.clone()).catch(() => {});
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
    if (res.ok) {
      const copy = res.clone();
      const headers = new Headers(copy.headers);
      headers.set("sw-fetched", String(Date.now()));
      cache.put(url.href, new Response(copy.body, { status: copy.status, statusText: copy.statusText, headers }));
    }
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

