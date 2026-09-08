"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface RealtimeRefreshProps {
  /** Poll interval in ms (default 60s). */
  intervalMs?: number;
  /** Minimum time between actual router.refresh() calls (default 30s). */
  minRefreshGapMs?: number;
}

/**
 * Lightweight realtime refresh for server-rendered pages (trending,
 * categories, feeds). Polls the Redis-backed version counter at
 * /api/posts/check (zero Prisma egress), then calls router.refresh() to
 * re-render server components when new content is detected — so the page
 * always reflects live data without manual reloads.
 */
export function RealtimeRefresh({ intervalMs = 60_000, minRefreshGapMs = 30_000 }: RealtimeRefreshProps) {
  const router = useRouter();
  const lastVersion = useRef<number | null>(null);
  const lastRefresh = useRef(0);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/posts/check", {
          signal: AbortSignal.timeout(5000),
          headers: { "Cache-Control": "no-cache" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { version: number };
        const now = Date.now();
        if (
          lastVersion.current !== null &&
          data.version !== lastVersion.current &&
          now - lastRefresh.current >= minRefreshGapMs
        ) {
          lastRefresh.current = now;
          router.refresh();
        }
        lastVersion.current = data.version;
      } catch {
        // transient — skip
      }
    };

    check();
    const interval = setInterval(check, intervalMs);
    return () => clearInterval(interval);
  }, [router, intervalMs, minRefreshGapMs]);

  return null;
}