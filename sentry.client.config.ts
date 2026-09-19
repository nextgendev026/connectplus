/**
 * Sentry client-side configuration.
 *
 * Runs in the browser. Catches unhandled JavaScript errors, network failures,
 * and component render errors. The client config is deliberately conservative:
 * it only samples errors (not every click/hover) and attaches user context
 * only when the admin explicitly sets it.
 */

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN || undefined,

  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,

  environment: process.env.NODE_ENV || "development",

  enabled:
    process.env.NODE_ENV !== "test" &&
    typeof window !== "undefined" &&
    window.location.hostname === "connectplusapp.vercel.app",

  sendDefaultPii: false,

  // Replay: only on production to capture the session after a crash.
  replaysSessionSampleRate: process.env.NODE_ENV === "production" ? 0.01 : 0,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  beforeSend(event) {
    // Ignore errors from browser extensions and third-party scripts.
    const culprit = event.exception?.values?.[0]?.stacktrace?.frames?.slice(-1)?.[0]?.filename ?? "";
    if (culprit.startsWith("chrome-extension://") || culprit.startsWith("moz-extension://")) return null;
    return event;
  },
});
