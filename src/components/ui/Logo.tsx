"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import ConnectPlusMark from "@/components/ui/ConnectPlusMark";

/**
 * The wordmark, set in the app's type.
 *
 * The supplied lockups stack this under the emblem, so using the whole lockup in
 * a 32px header would render "CONNECTPLUS" about five pixels tall. The header is
 * the same logo, arranged horizontally: the official emblem plus the wordmark in
 * the artwork's own treatment — uppercase, extra-bold, tight tracking, and in
 * the ink the artwork uses (near-black on light, cream on dark). The palette
 * tokens flip with the theme, so this matches the artwork in both modes without
 * a `dark:` variant, and without the gradient the artwork does not have.
 */
export default function Logo({
  size = "md",
  showBadge = false,
}: {
  size?: "sm" | "md" | "lg";
  showBadge?: boolean;
}) {
  const sizes = {
    sm: { icon: "h-6 w-6", text: "text-[13px]" },
    md: { icon: "h-8 w-8", text: "text-base" },
    lg: { icon: "h-10 w-10", text: "text-xl" },
  };

  const s = sizes[size];

  return (
    <Link href="/" className="group flex shrink-0 items-center gap-2" aria-label="connectPlus — home">
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center transition-transform duration-300 group-hover:scale-105",
          s.icon
        )}
      >
        {/* Decorative: the wordmark beside it already names the link. */}
        <ConnectPlusMark label="" />
      </span>
      <span
        className={cn(
          "font-extrabold uppercase leading-none tracking-tight text-surface-50",
          s.text
        )}
      >
        connectplus
      </span>
      {showBadge && (
        <span className="ml-0.5 rounded-md bg-gradient-to-r from-brand-500 to-accent-coral/80 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-glow">
          BETA
        </span>
      )}
    </Link>
  );
}
