"use client";

import { useEffect, useRef } from "react";
import { sendFeedback } from "@/lib/feedback";

/**
 * Learning-loop telemetry for feed surfaces (Phase 3).
 *
 * Logs, per feed card marked with `data-feed-post="<id>"`:
 *   - impression  (once per card, when scrolled into view)
 *   - click       (event delegation — works for cards appended later too)
 * and a single `time_spent` event for the page itself (seconds on view,
 * flushed on tab hide / unload / unmount). All events carry the active feed
 * A/B variant so the admin dashboard can compare experiment arms.
 */
export function FeedFeedbackTracker({
  variant,
}: {
  variant?: string | null;
}) {
  const startRef = useRef(Date.now());
  const seenRef = useRef(new Set<string>());
  const variantRef = useRef(variant);
  variantRef.current = variant;

  useEffect(() => {
    const logImpression = (el: Element) => {
      const id = el.getAttribute("data-feed-post");
      if (!id || seenRef.current.has(id)) return;
      seenRef.current.add(id);
      sendFeedback("impression", { postId: id, variant: variantRef.current });
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) logImpression(entry.target);
        }
      },
      { rootMargin: "300px" }
    );

    const observeAll = () => {
      document.querySelectorAll("[data-feed-post]").forEach((el) => io.observe(el));
    };
    observeAll();

    const mo = new MutationObserver(observeAll);
    mo.observe(document.body, { childList: true, subtree: true });

    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-feed-post]");
      const id = el?.getAttribute("data-feed-post");
      if (id) sendFeedback("click", { postId: id, variant: variantRef.current });
    };
    document.addEventListener("click", onClick);

    const flushTime = () => {
      const seconds = Math.round((Date.now() - startRef.current) / 1000);
      startRef.current = Date.now();
      if (seconds >= 3) {
        sendFeedback("time_spent", { value: seconds, variant: variantRef.current });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushTime();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushTime);

    return () => {
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushTime);
      flushTime();
    };
  }, []);

  return null;
}