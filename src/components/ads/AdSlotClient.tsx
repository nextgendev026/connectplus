"use client";

import { useEffect, useRef, useState } from "react";
import { shouldReserveSlotHeight, slotMinHeight } from "@/lib/ad-selection";
import type { AdResolution } from "@/lib/ads";
import AdUnit from "./AdUnit";

/**
 * A placement for pages that are client components.
 *
 * `/radio` is the reason this exists: it is an interactive desk, so it is a
 * client component, and a client component cannot render the async server
 * component `AdSlot`. Everything inside is the same — the same resolver, the
 * same selection, the same viewability — the only difference is that the
 * eligible pool is fetched instead of arriving as a prop.
 *
 * Two details keep that fetch from costing anything:
 *
 *   1. IT IS LAZY. Nothing is requested until the slot is within 300px of the
 *      viewport, so a placement far down a long page never fetches for a reader
 *      who never scrolls to it.
 *   2. IT HOLDS ITS SPACE WHILE IT LOADS. The box reserves the slot's height
 *      first, so a late-arriving creative cannot shove the content below it down
 *      the page. The reservation is dropped when the answer is "nothing to
 *      show", because an empty box that keeps its height is just a gap.
 */
export default function AdSlotClient({
  slot,
  className,
  label = "Sponsored",
  categories,
}: {
  slot: string;
  className?: string;
  label?: string | null;
  categories?: string[];
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** `undefined` = not asked yet, `null` = asked and nothing to show. */
  const [resolution, setResolution] = useState<AdResolution | null | undefined>(undefined);
  // Without an observer there is nothing to wait for, so the request goes out
  // immediately — decided at init rather than by a state update in an effect.
  const [nearViewport, setNearViewport] = useState(
    () => typeof window !== "undefined" && typeof IntersectionObserver === "undefined"
  );

  const categoryKey = (categories ?? []).join(",");

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [slot, categoryKey]);

  useEffect(() => {
    if (!nearViewport) return;
    const controller = new AbortController();
    const query = categoryKey ? `&categories=${encodeURIComponent(categoryKey)}` : "";
    fetch(`/api/ads/slots?slot=${encodeURIComponent(slot)}${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setResolution((data?.resolution as AdResolution | null) ?? null))
      .catch(() => {
        // An aborted or failed fetch leaves the slot empty rather than stuck
        // holding space forever.
        if (!controller.signal.aborted) setResolution(null);
      });
    return () => controller.abort();
  }, [nearViewport, slot, categoryKey]);

  return (
    <div
      ref={boxRef}
      data-ad-slot-wrapper={slot}
      /**
       * Height is held only until the resolver answers.
       *
       * This tested `resolution ? undefined : slotMinHeight(slot)`, which is the
       * same branch for `undefined` (not asked yet) and `null` (asked, and there
       * is nothing to show) — so a slot with no campaign held its full height
       * for the life of the page. That is the empty frame readers report seeing
       * instead of an ad, and it contradicted this component's own note below.
       * The anchor case is worse still: it is fixed to the viewport, so it can
       * never shift content and had no stability to buy.
       */
      style={{
        minHeight: shouldReserveSlotHeight(resolution !== undefined, slot)
          ? slotMinHeight(slot)
          : undefined,
      }}
    >
      {resolution ? (
        <AdUnit slot={slot} resolution={resolution} className={className} label={label} />
      ) : null}
    </div>
  );
}
