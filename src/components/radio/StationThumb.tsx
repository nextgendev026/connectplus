"use client";

import { useState } from "react";
import type { RadioStation } from "@/lib/radio-stations";
import { cn } from "@/lib/utils";

/**
 * Station thumbnail. Uses the station's real logo when `logoUrl` is set and
 * loads; otherwise renders a branded tile (gradient + call letters +
 * frequency) so every station still gets a distinct, logo-like thumbnail.
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
  const showImg = station.logoUrl && !imgFailed;

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
      style={{ background: gradient }}
      aria-label={`${station.name} thumbnail`}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote station logo
        <img
          src={station.logoUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
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