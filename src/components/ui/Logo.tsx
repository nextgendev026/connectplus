"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import ConnectPlusMark from "@/components/ui/ConnectPlusMark";

export default function Logo({
  size = "md",
  showBadge = false,
}: {
  size?: "sm" | "md" | "lg";
  showBadge?: boolean;
}) {
  const sizes = {
    sm: { icon: "h-6 w-6", text: "text-sm" },
    md: { icon: "h-8 w-8", text: "text-lg" },
    lg: { icon: "h-10 w-10", text: "text-2xl" },
  };

  const s = sizes[size];

  return (
    <Link href="/" className="flex items-center gap-2 group">
      <div
        className={cn(
          "relative flex items-center justify-center transition-all duration-300 group-hover:scale-105",
          s.icon
        )}
      >
        <ConnectPlusMark className="h-full w-full" />
      </div>
      <div className="flex items-baseline">
        <span className={cn("font-extrabold text-surface-50 tracking-tight leading-none", s.text)}>
          connect
        </span>
        <span className={cn("font-extrabold tracking-tight leading-none text-gradient-brand", s.text)}>
          Plus
        </span>
        {showBadge && (
          <span className="ml-1.5 rounded-md bg-gradient-to-r from-brand-500 to-accent-coral/80 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-glow">
            BETA
          </span>
        )}
      </div>
    </Link>
  );
}