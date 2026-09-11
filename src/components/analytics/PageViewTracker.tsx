"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * First-party page-view beacon.
 *
 * Fires once per URL change (App Router navigations do not reload the page, so
 * a mount-only effect would miss everything after the first route). Sends the
 * path plus, for article routes, the slug so the brain can rank posts without
 * the client having to resolve an id first.
 *
 * Respects the analytics-consent cookie: when a visitor has explicitly opted
 * out, nothing is sent at all.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;

    // Honour an explicit opt-out.
    try {
      const consent = document.cookie.match(/(?:^|;\s*)cp_consent=([^;]+)/)?.[1];
      if (consent && decodeURIComponent(consent) === "essential") return;
    } catch {
      // No cookie access (rare) — treat as consent-by-default since we store
      // no personal identifier either way.
    }

    const match = pathname.match(/^\/article\/([^/?#]+)/);
    const payload = {
      path: pathname,
      postSlug: match?.[1] ?? null,
      referrer: typeof document !== "undefined" ? document.referrer || null : null,
    };

    const send = () => {
      try {
        const body = JSON.stringify(payload);
        // sendBeacon survives the page being torn down mid-flight.
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
          return;
        }
        void fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Analytics must never break the page.
      }
    };

    // Defer past first paint so the beacon never competes with hydration.
    const t = setTimeout(send, 1200);
    return () => clearTimeout(t);
  }, [pathname]);

  return null;
}
