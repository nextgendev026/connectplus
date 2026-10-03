/**
 * Runtime detection for the Prisma driver adapter.
 *
 * Prisma 6's default client ships a query engine binary that cannot run on
 * Cloudflare Workers. On Workers the client must instead go through a driver
 * adapter (`@prisma/adapter-pg`), which uses the `pg` driver over Cloudflare's
 * Node socket API (`nodejs_compat`) and — more importantly — avoids holding a
 * module-level pool across requests, which Workers forbid: a socket opened
 * during one request cannot be reused by the next, so a shared pool works for
 * the first request and hangs the second.
 *
 * The app is published on two runtimes at once during the Vercel → Cloudflare
 * move, so this is a capability check rather than a build flag: the same bundle
 * works on Node (Vercel, local dev) and on Workers. `navigator.userAgent` is
 * `"Cloudflare-Workers"` on the workerd runtime; the `caches` global is the
 * belt-and-braces second signal, since a bare `navigator` check can be
 * polyfilled.
 */
export function isCloudflareWorkers(): boolean {
  try {
    const ua = typeof navigator !== "undefined" ? (navigator as { userAgent?: string }).userAgent ?? "" : "";
    if (ua === "Cloudflare-Workers") return true;
    // Workers expose the Cache API at module scope; Node does not.
    const g = globalThis as { caches?: unknown; WebSocketPair?: unknown };
    return typeof g.caches !== "undefined" && typeof g.WebSocketPair !== "undefined";
  } catch {
    return false;
  }
}
