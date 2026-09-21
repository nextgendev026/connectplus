"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import ConnectPlusMark from "@/components/ui/ConnectPlusMark";

/** Gradient ring spinner — the shared loading mark across the app. */
export function Spinner({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const dims = size === "sm" ? "h-5 w-5" : size === "lg" ? "h-10 w-10" : "h-8 w-8";
  const ring = size === "sm" ? "border-2" : "border-[3px]";
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center",
        dims,
        className
      )}
      aria-label="Loading"
      role="status"
    >
      <span
        className={cn(
          "absolute inset-0 rounded-full border-t-brand-500 border-r-transparent border-b-brand-500/30 border-l-transparent",
          ring,
          "animate-spin"
        )}
      />
      <span
        className={cn(
          "absolute inset-[3px] rounded-full border-t-accent-coral border-r-transparent border-b-transparent border-l-transparent",
          ring,
          "animate-spin-reverse"
        )}
        style={{ animationDuration: "1.4s" }}
      />
    </span>
  );
}

/** Centered page loader with optional label — used by route loading.tsx files. */
export function PageLoader({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-5">
      <div className="relative">
        <div className="absolute -inset-3 rounded-full bg-brand-500/10 blur-xl" />
        <Spinner size="lg" />
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-sm font-medium text-surface-300">{label}</p>
        <div className="h-0.5 w-28 overflow-hidden rounded-full bg-surface-800">
          <div className="h-full w-1/2 animate-shimmer rounded-full bg-gradient-to-r from-transparent via-brand-400 to-transparent" />
        </div>
      </div>
    </div>
  );
}

/** Shimmer block used inside skeletons. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-surface-800/60",
        className
      )}
    >
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-surface-700/40 to-transparent" />
    </div>
  );
}

/** Feed card skeleton — mirrors the PostCard layout. */
export function FeedCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-surface-800/60 bg-surface-900/40">
      <Skeleton className="aspect-[16/10] w-full rounded-none" />
      <div className="space-y-3 p-5">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <div className="flex items-center justify-between border-t border-surface-800/60 pt-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  );
}

/** Grid of feed skeletons for initial feed load. */
export function FeedSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <FeedCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Branded boot screen shown by PublicLayout while client providers hydrate.
 * Pairs with RouteProgress for a single, cohesive loading language.
 *
 * Three-layer reveal: the mark scales in with a ring of light, the wordmark
 * fades up with a stagger, and the progress bar fills behind the brand glow.
 * The whole thing takes 1.6s — long enough to read, short enough to not feel
 * like a wait.
 */
export function LoadingScreen() {
  const [showLoading, setShowLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"enter" | "hold" | "exit">("enter");

  useEffect(() => {
    const start = performance.now();
    const DURATION = 1600;
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      setProgress(Math.round((1 - Math.pow(1 - t, 3)) * 100));
      if (t >= 0.15 && phase === "enter") setPhase("hold");
      if (t >= 0.85 && phase !== "exit") setPhase("exit");
      if (t < 1) raf = requestAnimationFrame(tick);
      else setShowLoading(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!showLoading) return null;

  return (
    <div className="fixed inset-0 z-[80] flex min-h-screen items-center justify-center bg-surface-950 transition-opacity duration-400" style={{ opacity: phase === "exit" ? 0 : 1 }}>
      {/* Warm savanna glow behind the boot screen */}
      <div className="pointer-events-none absolute inset-0 bg-brand-glow" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/8 blur-3xl" />
      <div className="pointer-events-none absolute left-1/3 top-1/3 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-amber/6 blur-2xl" />

      <div className="relative flex flex-col items-center gap-6">
        {/* Mark with ring of light */}
        <div className="relative h-24 w-24">
          {/* Outer glow pulse */}
          <div className="absolute -inset-4 rounded-full bg-gradient-to-br from-brand-500/20 via-accent-amber/15 to-accent-coral/20 blur-2xl animate-pulse" style={{ animationDuration: "2s" }} />
          {/* Spinning ring */}
          <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-brand-500 via-accent-amber to-accent-coral animate-spin" style={{ animationDuration: "1.2s" }} />
          {/* Inner dark circle */}
          <div className="absolute inset-[3px] rounded-full bg-surface-950 flex items-center justify-center shadow-inner">
            <ConnectPlusMark className="h-14 w-14" />
          </div>
        </div>

        {/* Wordmark with stagger */}
        <div className="flex flex-col items-center gap-1">
          <p className="text-center text-sm font-extrabold uppercase tracking-[0.2em] text-surface-50 animate-fade-in">
            connectplus
          </p>
          <p className="text-center text-[11px] tracking-wider text-surface-500 animate-fade-in" style={{ animationDelay: "200ms" }}>
            Voices of the Silicon Savanna
          </p>
        </div>

        {/* Progress bar with glow */}
        <div className="relative w-44">
          <div className="h-1 overflow-hidden rounded-full bg-surface-800/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 via-accent-amber to-accent-coral transition-[width] duration-100 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* Glow trailing the progress */}
          <div
            className="absolute top-0 h-1 w-8 rounded-full bg-brand-400/40 blur-sm transition-[left] duration-100 ease-out"
            style={{ left: `calc(${Math.min(progress, 95)}% - 1rem)` }}
          />
        </div>
      </div>
    </div>
  );
}