"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export default function Logo({
  size = "md",
  showBadge = false,
}: {
  size?: "sm" | "md" | "lg";
  showBadge?: boolean;
}) {
  const sizes = {
    sm: { icon: "h-6 w-6", text: "text-sm", iconText: "h-3 w-3" },
    md: { icon: "h-8 w-8", text: "text-lg", iconText: "h-4 w-4" },
    lg: { icon: "h-10 w-10", text: "text-2xl", iconText: "h-5 w-5" },
  };

  const s = sizes[size];

  return (
    <Link href="/" className="flex items-center gap-2 group">
      <div
        className={cn(
          "relative flex items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 shadow-glow transition-all duration-300 group-hover:shadow-glow-lg group-hover:scale-105",
          s.icon
        )}
      >
        {/* Inner sparkle dot */}
        <div className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-accent-cyan opacity-80" />
        {/* Logo mark: connected nodes representing "connect" */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={s.iconText}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Three connected dots — the "connect" symbol */}
          <circle cx="5" cy="12" r="2.5" fill="white" stroke="none" opacity="0.9" />
          <circle cx="12" cy="5" r="2.5" fill="white" stroke="none" opacity="0.9" />
          <circle cx="19" cy="12" r="2.5" fill="white" stroke="none" opacity="0.9" />
          {/* Connecting lines */}
          <line x1="7.2" y1="11" x2="9.8" y2="6.5" stroke="white" strokeWidth="1.5" opacity="0.7" />
          <line x1="14.2" y1="6.5" x2="16.8" y2="11" stroke="white" strokeWidth="1.5" opacity="0.7" />
          {/* Plus sign — the "+" in connectPlus */}
          <line x1="10" y1="17" x2="14" y2="17" stroke="white" strokeWidth="2" opacity="0.95" />
          <line x1="12" y1="15" x2="12" y2="19" stroke="white" strokeWidth="2" opacity="0.95" />
        </svg>
      </div>
      <div className="flex items-baseline">
        <span className={cn("font-bold text-surface-950 dark:text-white tracking-tight", s.text)}>
          connect
        </span>
        <span className={cn("font-bold text-brand-500 tracking-tight", s.text)}>
          Plus
        </span>
        {showBadge && (
          <span className="ml-1.5 rounded-md bg-brand-500/10 px-1.5 py-0.5 text-[9px] font-bold text-brand-500 dark:text-brand-400 border border-brand-500/20">
            BETA
          </span>
        )}
      </div>
    </Link>
  );
}
