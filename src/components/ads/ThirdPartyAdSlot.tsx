"use client";

import { useEffect, useRef } from "react";
import type { NetworkSlotConfig } from "@/lib/ads";

/**
 * Injects a configured third-party ad tag (AdSense, Meta, MGAN, custom HTML).
 *
 * What changed and why:
 *
 *   1. THE CONFIG ARRIVES AS A PROP. This used to `fetch("/api/ads/slots?slot=…")`
 *      from the browser once per placement — a round trip per slot, an empty box
 *      while it resolved, and a request the browser could abort mid-flight
 *      (observed in production as `net::ERR_ABORTED` on `feed-sidebar`). The
 *      server resolves the same config into the same page, so there is nothing
 *      left to fetch.
 *   2. IT DOES NOT TRACK ANYTHING. Counting belongs to the slot container, which
 *      is the element that can actually observe whether the creative was seen.
 *   3. IT IS CONSENT-GATED BY ITS PARENT. A network tag is a third-party script
 *      and is mounted only when the reader has allowed advertising cookies;
 *      first-party creatives do not need that permission and are not gated.
 */
export default function ThirdPartyAdSlot({
  config,
  slot,
  className,
}: {
  config: NetworkSlotConfig;
  slot: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !config.scriptTag) return;

    const wrapper = document.createElement("div");
    wrapper.className = "third-party-ad";
    // Deliberately NOT `data-ad-slot`: the placement box already carries that,
    // and a duplicate makes the slot ambiguous to anything selecting on it —
    // screenshots, audits, tests.
    wrapper.setAttribute("data-ad-network-slot", slot);
    wrapper.setAttribute("data-ad-provider", config.provider);
    if (config.adUnitId) wrapper.setAttribute("data-ad-unit", config.adUnitId);
    wrapper.innerHTML = config.scriptTag;
    el.appendChild(wrapper);

    // Scripts inserted through `innerHTML` are parsed but never executed, so each
    // one is rebuilt as a live element — otherwise a tag that only contains
    // inline script silently does nothing.
    for (const old of Array.from(wrapper.querySelectorAll("script"))) {
      const replacement = document.createElement("script");
      for (const attr of Array.from(old.attributes)) {
        replacement.setAttribute(attr.name, attr.value);
      }
      if (old.textContent) replacement.textContent = old.textContent;
      old.parentNode?.replaceChild(replacement, old);
    }

    return () => {
      el.innerHTML = "";
    };
  }, [config.scriptTag, config.adUnitId, config.provider, slot]);

  return (
    <div
      ref={containerRef}
      className={className}
      data-slot={slot}
      aria-label={`Advertisement served by ${config.provider}`}
    />
  );
}
