// `@sentry/nextjs/config`, not `@sentry/nextjs`: the root export is deprecated and
// the build warns about it on every run. It stops working in Sentry v11, so this
// is the kind of warning that becomes a broken build on a dependency bump rather
// than at the moment someone changes the code.
import { withSentryConfig } from "@sentry/nextjs/config";

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

/**
 * The origin the browser polls for livescores (the Cloudflare worker).
 *
 * It has to be in `connect-src` or the board's own poll is blocked by our CSP —
 * which is exactly what used to happen when an edge URL was configured, since
 * the policy only allowed `'self'`, Supabase, ipapi and BigDataCloud. Reading it
 * from the same env var the client uses keeps the two from drifting.
 */
const edgeOrigin = (() => {
  const raw = (process.env.NEXT_PUBLIC_EDGE_URL ?? "").trim();
  if (!raw) return [];
  try {
    return [new URL(raw).origin];
  } catch {
    return [];
  }
})();

/** Read-only JSON the browser reads from hosts we do not own outright. */
const CONNECT_SRC = [
  "'self'",
  "https://*.supabase.co",
  "wss://*.supabase.co",
  // Convex buffer for article views / ad metrics (see src/lib/convex.ts).
  "https://*.convex.cloud",
  "wss://*.convex.cloud",
  // Any worker on workers.dev: the subdomain is assigned per account and can
  // change on redeploy, so pinning the exact host would break the board.
  "https://*.workers.dev",
  ...edgeOrigin,
  "https://ipapi.co",
  "https://api.bigdatacloud.net",
  // GPS weather on the home page reads Open-Meteo straight from the browser.
  "https://api.open-meteo.com",
];

/**
 * Response hardening, in one place because two files have to agree: these run
 * for everything Next serves (`headers()` below) and vercel.json repeats the
 * transport-level ones for whatever Vercel answers first. A header that exists
 * in only one of them is a header that is missing on some responses.
 *
 * Deliberate choices, so a future edit does not "fix" them back:
 *
 *  • `'unsafe-eval'` is **development only**. Next's dev server needs it for the
 *    HMR runtime; the production App Router runtime does not, and it is the
 *    single biggest weakening left in a default Next CSP.
 *  • `'unsafe-inline'` on script-src stays: Next inlines its own bootstrap and
 *    hydration payload. Removing it needs nonces threaded through every route,
 *    which is a real piece of work, not a header edit — an inline-script tag
 *    injected here is blocked by nothing, so treat post bodies (and the
 *    sanitizer that scrubs them) as the XSS boundary.
 *  • No `upgrade-insecure-requests`: it rewrites http subresources to https, and
 *    a good number of Kenyan radio streams are http-only. Upgrading them breaks
 *    playback, and `media-src ... http:` is allowed on purpose.
 *  • `X-XSS-Protection: 0`, not `1; mode=block`. The legacy auditor was removed
 *    from every current browser, and its filter was itself an XSS vector
 *    (selective script stripping). Disabling it is the hardened value now.
 */
const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-XSS-Protection", value: "0" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  {
    key: "Permissions-Policy",
    // Nothing here uses a sensor, a camera or a microphone. `browsing-topics`
    // and `interest-cohort` opt the origin out of ad-topic / FLoC inference,
    // which otherwise happens with no visible prompt.
    value:
      "camera=(), microphone=(), geolocation=(self), payment=(self), browsing-topics=(), interest-cohort=()",
  },
  // Sign-in is a full-page redirect, never a popup, so severing `window.opener`
  // to other origins costs nothing and closes the reverse-tabnabbing path.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https: http:",
      "font-src 'self' data: https://fonts.gstatic.com",
      `connect-src ${CONNECT_SRC.join(" ")}`,
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      // No plugins, no third-party framing, no base rewrites, no off-site posts.
      // `frame-src 'self'` (not 'none') because admin-supplied ad creatives may
      // frame our own origin; every other plugin/frame surface is 'none'.
      "object-src 'none'",
      "frame-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

/**
 * HSTS is deliberately not sent in development: pinning `localhost` to https in
 * a developer's browser survives long after the change that caused it, and a
 * year-long max-age is not something a dev server should be able to set.
 */
if (!isDev) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  });
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    /**
     * A custom loader, because Vercel's optimizer is what ran out.
     *
     * With no `loader`, every `<Image>` resolves to Vercel's `/_next/image`,
     * metered against a separate Image Optimization allowance that is billed
     * apart from function invocations. See `src/lib/image-loader.ts` for what
     * replaces it — in short: Cloudflare Image Resizing when configured, and the
     * original URL otherwise, so no image request touches Vercel compute at all.
     *
     * Two settings below become inert once a custom loader is in place, and are
     * kept rather than deleted because removing them would silently change the
     * behaviour of anything that still reaches the optimizer in a deployment
     * without this loader. `formats` and `dangerouslyAllowSVG` +
     * `contentSecurityPolicy` configure the built-in optimizer only; the custom
     * loader is handed the width and returns the final URL itself.
     *
     * `remotePatterns` is likewise no longer the security boundary it looks
     * like — the optimizer is not fetching anything. The boundary is inside
     * `/api/optimize`, which resolves every target through the SSRF guard in
     * `lib/image-proxy.ts` (http(s) only, no private or loopback hosts, sane
     * ports, redirects re-checked, body capped). Kept as documentation of the
     * hosts this deployment expects.
     */
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "**.unsplash.com" },
      { protocol: "https", hostname: "i.pravatar.cc" },
      { protocol: "https", hostname: "picsum.photos" },
      // RSS ingestion pulls covers from any publisher domain on the web —
      // allowlisting the open web through the optimizer (which re-serves
      // everything as AVIF/WebP from our own origin) is what keeps every
      // imported story illustrated. http sources get upgraded to https
      // delivery, which also kills mixed-content warnings on mobile.
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    // The /api/thumb fallback covers are self-generated SVG (all dynamic
    // text is XML-escaped server-side, no scripts emitted). Allow them
    // through the optimizer sandboxed so generated covers behave exactly
    // like uploaded JPEG/PNG covers everywhere next/image is used.
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  experimental: {
    optimizeCss: false,
  },
  /**
   * The auth URLs people actually type.
   *
   * The routes live under `/auth/*`, which is right for the file tree and wrong
   * for a human: `/signin` is what a reader guesses, what an old link says, and
   * what the smoke test asserted. Each of these used to 404 — a dead end at the
   * exact moment someone is trying to sign in, from an email, a bookmark or the
   * bottom bar. Permanent redirects, so the correction is remembered.
   */
  async redirects() {
    return [
      { source: "/signin", destination: "/auth/signin", permanent: true },
      { source: "/login", destination: "/auth/signin", permanent: true },
      { source: "/signup", destination: "/auth/signup", permanent: true },
      { source: "/register", destination: "/auth/signup", permanent: true },
      { source: "/verify-email", destination: "/auth/verify-email", permanent: true },
      // The singular spelling of the topic route. Nothing linked to it except
      // the trending sidebar, which now uses `/tags/`, but a shared or
      // bookmarked link should still land on the topic rather than a dead end.
      { source: "/tag/:slug", destination: "/tags/:slug", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/api/:path*",
        headers: [
          ...securityHeaders,
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate",
          },
        ],
      },
      // Allow public caches for read-only API endpoints
      //
      // The blanket `/api/:path*` rule above is `no-store`, which is right for
      // anything user-specific but wrong for these: each is anonymous, identical
      // for every caller, and polled on a timer from the client. Left at
      // `no-store` every poll invoked a function, and the invocation count — not
      // the data volume — is what was exhausting the hosting allowance. A CDN
      // hit costs no invocation at all, so the fix is to make the common case a
      // hit. `stale-while-revalidate` is the other half: a reader after the TTL
      // is served the previous copy instantly while the refresh happens behind
      // them, so freshness never costs a visitor a wait.
      { source: "/api/radio/stations", headers: [...securityHeaders, { key: "Cache-Control", value: "public, s-maxage=30, stale-while-revalidate=120" }] },
      { source: "/api/sports/live", headers: [...securityHeaders, { key: "Cache-Control", value: "public, s-maxage=15, stale-while-revalidate=45" }] },
      { source: "/api/sports/calendar", headers: [...securityHeaders, { key: "Cache-Control", value: "public, s-maxage=900, stale-while-revalidate=1800" }] },
      { source: "/api/forex", headers: [...securityHeaders, { key: "Cache-Control", value: "public, s-maxage=300, stale-while-revalidate=600" }] },
      {
        source: "/api/posts",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "public, s-maxage=60, stale-while-revalidate=120" },
        ],
      },
      {
        source: "/api/posts/check",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "public, s-maxage=30, stale-while-revalidate=60" },
        ],
      },
      {
        source: "/api/trending/topics",
        headers: [
          ...securityHeaders,
          { key: "Cache-Control", value: "public, s-maxage=120, stale-while-revalidate=300" },
        ],
      },
      // Covers — every story's picture, and the most-requested asset in the app.
      //
      // The blanket `/api/:path*` rule above is `no-store`, and these rules are
      // applied last so this one wins for the thumb paths. That mattered here
      // more than anywhere else: `/api/thumb/post/<id>` sets its own week-long
      // Cache-Control, but a config header overrides a route's own, so every card
      // cover, hero image, PWA card picture and og:image was going out
      // uncacheable — the CDN re-fetched and re-encoded a multi-hundred-kilobyte
      // JPEG once per card per visitor. The route already serves immutable bytes
      // (content-addressed by post id) from a 30-day optimizer cache, so this is
      // the header that matches what it actually returns.
      {
        source: "/api/thumb/:path*",
        headers: [
          ...securityHeaders,
          {
            key: "Cache-Control",
            value: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Automatically tree-shake Sentry logger statements in production builds.
  silent: process.env.NODE_ENV !== "production",
  // Disable Sentry's auto-instrumentation of webpack for now — it can slow
  // builds. Re-enable after measuring the impact on build time.
  disableWebpackPlugin: true,
});
