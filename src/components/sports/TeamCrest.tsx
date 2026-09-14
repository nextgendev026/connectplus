"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A team crest that never leaves a hole in the layout.
 *
 * Every provider we merge hands back a crest URL, and those URLs 404 or
 * hotlink-block often enough that a bare `<img>` flashes a broken icon on a
 * live scoreboard — the one place a broken image is worse than none. So the
 * image is always backed by an initials monogram in the same box, and
 * `referrerPolicy` keeps a host that checks the origin from rejecting us.
 *
 * The sizes are a scale rather than free-form classes because a crest is the
 * fastest thing a reader's eye lands on: a club has to be the same size in the
 * calendar, the board and the live strip, or the same fixture looks like three
 * different levels of importance. `md` is the default and matches the board.
 */
const SIZES = {
  /** Inside a dense strip row. */
  xs: "h-3.5 w-3.5 text-[6px]",
  /** A calendar grid row, where vertical space is at a premium. */
  sm: "h-4 w-4 text-[7px]",
  /** The board's team line. */
  md: "h-5 w-5 text-[9px] sm:h-6 sm:w-6 sm:text-[10px]",
  /** A calendar day list, where there is room to give a club some presence. */
  lg: "h-7 w-7 text-[10px]",
} as const;

export type CrestSize = keyof typeof SIZES;

export function TeamCrest({
  name,
  logo,
  size = "md",
  className,
}: {
  name: string;
  logo?: string | null;
  size?: CrestSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  if (!logo || failed) {
    return (
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-surface-800 font-bold text-surface-400",
          // The monogram needs a touch more weight than an image to hold the
          // same optical size, and never more than the box it sits in.
          SIZES[size],
          className
        )}
      >
        {initials || "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- crests are third-party CDN assets; the optimizer would add a hop and fail on hotlink-protected hosts
    <img
      src={logo}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("shrink-0 object-contain", SIZES[size], className)}
    />
  );
}

export default TeamCrest;
