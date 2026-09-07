"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface FeedLiveRefreshProps {
  intervalMs?: number;
}

export function FeedLiveRefresh({ intervalMs = 60000 }: FeedLiveRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => router.refresh();

    const interval = setInterval(refresh, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    const onFocus = () => refresh();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, intervalMs]);

  return null;
}