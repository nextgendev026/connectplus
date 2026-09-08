"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { redisIncr } from "@/lib/redis";

interface FeedLiveRefreshProps {
  /** Minimum interval between full refreshes (default 5 min — not 2 min). */
  intervalMs?: number;
}

/**
 * Egress-optimized live refresh.
 *
 * Instead of calling router.refresh() (full SSR + Prisma) every 2 minutes,
 * we poll a lightweight /api/posts/check endpoint every 60s that only
 * compares a Redis version counter. The full SSR refresh only fires when
 * new content is detected, and at most every `intervalMs`.
 */
export function FeedLiveRefresh({ intervalMs = 300_000 }: FeedLiveRefreshProps) {
  const router = useRouter();
  const lastRefresh = useRef(0);
  const lastVersion = useRef<number | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/posts/check", {
          method: "GET",
          signal: AbortSignal.timeout(5000),
          // Bypass SW cache so we always get a fresh version check
          headers: { "Cache-Control": "no-cache" },
        });
        if (!res.ok) return;
        const data = await res.json() as { version: number };
        const now = Date.now();

        if (
          lastVersion.current !== null &&
          data.version !== lastVersion.current &&
          now - lastRefresh.current > intervalMs
        ) {
          lastRefresh.current = now;
          router.refresh();
        }
        lastVersion.current = data.version;
      } catch {
        // Transient — skip this cycle
      }
    };

    // Check every 60s (lightweight Redis ping, no Prisma)
    const interval = setInterval(check, 60_000);
    check(); // initial check

    return () => clearInterval(interval);
  }, [router, intervalMs]);

  return null;
}