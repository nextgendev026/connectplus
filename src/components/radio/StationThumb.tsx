"use client";

import { useState } from "react";
import type { RadioStation } from "@/lib/radio-stations";
import { optimizedImageSrc } from "@/lib/image-src";
import { cn } from "@/lib/utils";

/**
 * Station thumbnail. Uses the station's real logo when `logoUrl` is set and
 * loads; otherwise renders a branded tile (gradient + call letters +
 * frequency) so every station still gets a distinct, logo-like thumbnail.
 *
 * ## Why a remote logo goes through `/api/optimize`
 *
 * A cross-origin `<img>` fails silently and for reasons that have nothing to do
 * with the station: the browser's opaque-response check blocks a response whose
 * body is not the image it claims (`net::ERR_BLOCKED_BY_ORB`), a host may refuse
 * a request with our `Referer`, and a checked-in URL may simply rot. The one
 * station on the dial that had a real logo — Capital FM — pointed at a Wikimedia
 * link that now answers `400 text/html`, so it was ORB-blocked and the card fell
 * back to its tile. Nothing surfaced that; the reader just saw a letter.
 *
 * Routing the URL through our own optimizer makes the browser fetch from our
 * origin, so ORB and referer blocks cannot apply, and a dead upstream becomes a
 * server-side miss this component can actually react to. The branded tile stays
 * as the last resort, so a cover is never a hole.
 *
 * Inline `data:` tiles (what the roster itself ships for stations with no real
 * logo) pass through untouched — there is nothing to proxy.
 */
export function StationThumb({
  station,
  size = "md",
  className,
}: {
  station: RadioStation;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  // `optimizedImageSrc` leaves `data:`/blob:/our-own routes alone and proxies
  // everything else, so this is safe for both kinds of stored logo.
  const logoSrc = station.logoUrl
    ? optimizedImageSrc(station.logoUrl, { preset: "thumbnail", width: 128 })
    : "";
  const showImg = Boolean(logoSrc) && !imgFailed;

  const sizes = {
    sm: "h-9 w-9 rounded-lg text-[11px]",
    md: "h-12 w-12 rounded-xl text-sm",
    lg: "h-16 w-16 rounded-2xl text-lg",
  } as const;

  const gradient = `linear-gradient(135deg, ${station.color} 0%, ${station.color}55 100%)`;

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden font-bold text-white shadow-inner ring-1 ring-white/10",
        sizes[size],
        className
      )}
      // A real logo gets a neutral plate rather than the station's gradient.
      // Broadcasters publish what they publish — several of these are 16-32px
      // favicons — and a small mark on a coloured background reads as a blurred
      // smear, while the same mark centred on a white plate reads as a badge.
      // The gradient stays for the branded tile, which is drawn to fill it.
      style={{ background: showImg ? "#ffffff" : gradient }}
      aria-label={`${station.name} thumbnail`}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote station logo, proxied through /api/optimize
        <img
          src={logoSrc}
          alt={`${station.name} logo`}
          className="h-full w-full object-contain p-[3px]"
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className="tracking-tight drop-shadow">{station.icon}</span>
      )}
      <span
        className={cn(
          "absolute bottom-0 right-0 flex items-center rounded-tl-md bg-black/55 px-1 font-mono font-semibold text-white backdrop-blur-sm",
          size === "sm" ? "text-[7px]" : size === "md" ? "text-[8px]" : "text-[10px]"
        )}
      >
        {station.frequency.replace(" FM", "").replace("Digital", "WEB")}
      </span>
    </div>
  );
}
