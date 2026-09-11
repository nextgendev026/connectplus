"use client";

import { useEffect, useRef } from "react";

interface ThirdPartyAdSlotProps {
  slot: string;
  className?: string;
}

/**
 * Renders a third-party ad slot (Google AdSense, Facebook Audience Network,
 * MGID, Propeller, or custom HTML). The slot config is fetched server-side
 * and injected via the HTML attribute; this component only manages script
 * lifecycle and view tracking.
 */
export default function ThirdPartyAdSlot({ slot, className }: ThirdPartyAdSlotProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Fetch the slot configuration from the server
    const abort = new AbortController();
    fetch(`/api/ads/slots?slot=${encodeURIComponent(slot)}`, { signal: abort.signal })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.slot?.scriptTag || !el) return;

        // Inject the ad script/tag
        const wrapper = document.createElement("div");
        wrapper.className = "third-party-ad";
        wrapper.setAttribute("data-ad-slot", slot);
        wrapper.setAttribute("data-ad-provider", data.slot.provider);
        wrapper.innerHTML = data.slot.scriptTag;
        el.appendChild(wrapper);

        // Track impression
        fetch("/api/ads/slots/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slotId: data.slot.id, type: "impression" }),
        }).catch(() => {});

        // Handle script execution for inline scripts
        const scripts = wrapper.querySelectorAll("script");
        scripts.forEach((oldScript) => {
          const newScript = document.createElement("script");
          Array.from(oldScript.attributes).forEach((attr) => newScript.setAttribute(attr.name, attr.value));
          if (oldScript.textContent) newScript.textContent = oldScript.textContent;
          oldScript.parentNode?.replaceChild(newScript, oldScript);
        });
      })
      .catch(() => {});

    return () => {
      abort.abort();
      if (el) el.innerHTML = "";
    };
  }, [slot]);

  return (
    <div
      ref={containerRef}
      className={`ad-slot-third-party ${className ?? ""}`}
      data-slot={slot}
      style={{ minHeight: "1px" }}
    />
  );
}
