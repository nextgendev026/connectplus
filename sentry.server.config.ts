/**
 * Sentry server-side configuration.
 *
 * This file is imported by Next.js on every server request. The init call is
 * harmless when SENTRY_DSN is unset — Sentry no-ops rather than throwing —
 * so the app can be deployed without the key configured, and the moment the
 * DSN is added, error tracking begins.
 *
 * The `tracesSampleRate` is set to 0.2 (20% of transactions). In development
 * it is set to 1.0 so every request is sampled for local debugging. On
 * production this keeps the Sentry bill under control while still catching
 * slow queries, errors and performance anomalies.
 */

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN || undefined,

  // Adjust the sample rate in production. 100% catches everything but costs
  // more; 20% is enough to spot trends and outliers.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,

  // Use environment-aware release tracking so errors are grouped by deploy.
  // The value is set by `withSentryConfig` in next.config.mjs when the
  // Sentry plugin is active; otherwise it falls back to the git sha.
  release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,

  environment: process.env.NODE_ENV || "development",

  // Do not send PII. User IDs are attached manually where needed via
  // `Sentry.setUser`, not automatically.
  sendDefaultPii: false,

  // Disable Sentry in test to avoid noise in CI.
  enabled: process.env.NODE_ENV !== "test",

  // beforeSend drops noisy errors that are already handled elsewhere.
  beforeSend(event) {
    // Rate-limit noise from service worker updates and HMR.
    const culprit = event.exception?.values?.[0]?.stacktrace?.frames?.slice(-1)?.[0]?.filename ?? "";
    if (culprit.includes("/sw.js") || culprit.includes("hmr")) return null;
    return event;
  },
});
