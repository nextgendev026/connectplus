"use client";

import { cn } from "@/lib/utils";

/**
 * The connectPlus mark — the savanna-sunset emblem on a transparent background.
 *
 * This is the circular emblem (sunset disc with lion, acacia, and birds) that
 * works on both light and dark surfaces because the disc's own colors span the
 * full range. The transparent background means it sits naturally on any surface
 * without a contrasting plate.
 *
 * For surfaces that need the full lockup (emblem + wordmark), see Logo.
 */

export default function ConnectPlusMark({
  className,
  label = "connectPlus",
}: {
  className?: string;
  /** Accessible name. Pass "" when the mark sits beside the visible wordmark. */
  label?: string;
}) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- 67kB transparent emblem
       drawn at 32-44px, pre-cached by the service worker. The image optimizer
       cannot improve a raster that is already at its display size. */
    <img
      src="/brand/mark-transparent.png"
      alt={label}
      aria-hidden={label ? undefined : true}
      width={256}
      height={256}
      decoding="async"
      className={cn("block h-full w-full object-contain", className)}
    />
  );
}
