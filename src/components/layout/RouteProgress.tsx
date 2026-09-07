"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Cohesive top progress bar for client-side route transitions.
 * Starts on navigation, animates to ~90%, then completes on settle.
 */
export default function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the previously seen route to detect changes.
  const currentRoute = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");
  const prevRouteRef = useRef(currentRoute);

  useEffect(() => {
    const prev = prevRouteRef.current;
    prevRouteRef.current = currentRoute;
    if (prev === currentRoute) return;

    // New navigation started
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
    doneRef.current = false;
    setVisible(true);
    setProgress(8);

    const tick = () => {
      setProgress((p) => {
        if (doneRef.current) return p;
        // Ease toward 90% while the page loads
        const next = p + (90 - p) * 0.08;
        return next >= 90 ? 90 : next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    // Complete once the new route has had a beat to render
    timerRef.current = setTimeout(() => {
      doneRef.current = true;
      setProgress(100);
      setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 300);
    }, 450);
  }, [currentRoute]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden" aria-hidden>
      <div className="h-full w-full bg-surface-950/40" />
      <div
        className="absolute inset-y-0 left-0 rounded-r-full bg-gradient-to-r from-brand-500 via-accent-amber to-accent-coral shadow-glow transition-[width] duration-200 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}