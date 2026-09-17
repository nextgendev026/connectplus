"use client";

import { useEffect, useRef } from "react";

/**
 * The client half of ad measurement: when is an ad actually seen, and how does
 * that get reported without disturbing the page.
 *
 * The standard is the industry one — half the creative, on screen, for one
 * continuous second — because "rendered" and "seen" are different claims and
 * only the second one is worth billing. A creative that never scrolls into view
 * is never reported, and a reader who scrolls straight past it does not set the
 * timer off at all.
 */

/** IAB viewable standard: half the creative… */
const VISIBLE_RATIO = 0.5;
/** …for one continuous second. */
const VISIBLE_MS = 1000;

export interface AdMetric {
  kind: "impression" | "click";
  adId?: string;
  networkSlotId?: string;
}

/**
 * Report a metric without blocking anything.
 *
 * `sendBeacon` survives the page being closed or navigated away from, which is
 * exactly when a reader finishes with an ad, and it is what makes the report
 * reliable without holding the unload open. `fetch(keepalive)` is the fallback
 * for browsers without it. Either way the call cannot throw into the render.
 */
export function reportAdMetric(metric: AdMetric): void {
  const body = JSON.stringify(metric);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon("/api/ads/metrics", new Blob([body], { type: "application/json" }));
      if (sent) return;
    }
  } catch {
    // fall through to fetch
  }
  try {
    void fetch("/api/ads/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // A lost metric is worth less than a broken page.
  }
}

/**
 * Fire `onViewable` once, the first time the element is half-visible for a
 * second.
 *
 * The callback is held in a ref so a re-render cannot tear the observer down and
 * start the timer again — an ad that re-renders every second would otherwise
 * never reach one continuous second of visibility and would never be counted.
 */
export function useViewable(
  ref: React.RefObject<HTMLElement | null>,
  onViewable: () => void,
  enabled: boolean
): void {
  const callback = useRef(onViewable);
  useEffect(() => {
    callback.current = onViewable;
  }, [onViewable]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      callback.current();
    };

    if (typeof IntersectionObserver === "undefined") {
      // No observer to consult. Count it after the same dwell time rather than
      // losing every impression from an old browser.
      const t = setTimeout(fire, VISIBLE_MS);
      return () => clearTimeout(t);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const visible = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;
          if (visible && timer === null) {
            timer = setTimeout(fire, VISIBLE_MS);
          } else if (!visible && timer !== null) {
            // Scrolled away before the second was up: the dwell did not happen.
            clearTimeout(timer);
            timer = null;
          }
        }
      },
      { threshold: [0, VISIBLE_RATIO, 1] }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [ref, enabled]);
}
