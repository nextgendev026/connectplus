/**
 * Sentry Edge Runtime configuration.
 *
 * Runs in middleware and any route handler that uses the Edge Runtime.
 * Edge functions have a smaller API surface than Node.js, so the config
 * is simpler — no replay, no performance tracing, just error capture.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,

  tracesSampleRate: 0.1,

  release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,

  environment: process.env.NODE_ENV || "development",

  enabled: process.env.NODE_ENV !== "test",

  sendDefaultPii: false,
});
