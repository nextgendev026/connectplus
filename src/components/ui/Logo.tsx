"use client";

import Link from "next/link";
import { useTheme } from "@/components/providers/ThemeContext";
import { cn } from "@/lib/utils";

/**
 * The connectPlus logo, theme-aware with transparent background.
 *
 * The lockups are rendered on a fully transparent canvas — the circular emblem
 * plus the wordmark, with no rectangular plate behind them. The wordmark color
 * switches with the theme (dark text on light surfaces, cream text on dark
 * surfaces) so contrast is always correct.
 *
 * Rounded corners match the app's card language (`rounded-xl`) so the lockup
 * sits naturally beside the rounded nav buttons and search input.
 */

const LOCKUPS = {
  dark: "/brand/lockup-transparent-dark.png",   // cream wordmark — pops on dark surface
  light: "/brand/lockup-transparent-light.png",  // dark wordmark — pops on light surface
} as const;

export default function Logo({
  size = "md",
  showBadge = false,
}: {
  size?: "sm" | "md" | "lg";
  showBadge?: boolean;
}) {
  const { theme } = useTheme();

  const sizes = {
    sm: { img: "h-8 w-auto", badge: "ml-0.5" },
    md: { img: "h-10 w-auto", badge: "ml-0.5" },
    lg: { img: "h-14 w-auto", badge: "ml-1" },
  };

  const s = sizes[size];
  const src = LOCKUPS[theme] ?? LOCKUPS.dark;

  return (
    <Link href="/" className="group flex shrink-0 items-center gap-2" aria-label="connectPlus — home">
      {/* eslint-disable-next-line @next/next/no-img-element -- raster lockup on transparent canvas, pre-cached by the service worker */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        width={400}
        height={308}
        decoding="async"
        className={cn(
          "block object-contain rounded-xl transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-brand-500/20",
          s.img
        )}
      />
      {showBadge && (
        <span className={cn("rounded-md bg-gradient-to-r from-brand-500 to-accent-coral/80 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-glow", s.badge)}>
          BETA
        </span>
      )}
    </Link>
  );
}
