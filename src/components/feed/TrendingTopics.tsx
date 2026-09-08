"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { TrendingUp, RefreshCw, Flame, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Topic {
  id: string;
  name: string;
  slug: string;
  postCount: number;
  totalViews: number;
  heat: number;
  thumbnail: string | null;
  topPostTitle: string | null;
  topPostSlug: string | null;
}

function formatViews(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

/**
 * Realtime trending topics — fetches /api/trending/topics, auto-refreshes
 * every 60s (lightweight, Prisma read only) and offers a manual refresh.
 * Renders rich thumbnails from the hottest post in each topic.
 */
export function TrendingTopics({ limit = 6 }: { limit?: number }) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      try {
        const res = await fetch(`/api/trending/topics?limit=${limit}`, {
          signal: AbortSignal.timeout(10_000),
          headers: { "Cache-Control": "no-cache" },
        });
        if (!res.ok) throw new Error("bad response");
        const data = (await res.json()) as { topics: Topic[]; generatedAt: string };
        if (mountedRef.current) {
          setTopics(data.topics ?? []);
          setLastUpdated(data.generatedAt ?? null);
          setError(false);
        }
      } catch {
        if (mountedRef.current) setError(true);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [limit]
  );

  useEffect(() => {
    mountedRef.current = true;
    load();
    const interval = setInterval(() => load(false), 60_000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  return (
    <div className="rounded-2xl bg-surface-900/60 border border-surface-800/50 p-5 hover:border-surface-700/50 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-surface-50">Trending Topics</h3>
        </div>
        <div className="flex items-center gap-1">
          {lastUpdated && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[9px] text-surface-500">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              live
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            aria-label="Refresh trending topics"
            title="Refresh now"
            className="rounded-lg p-1.5 text-surface-500 hover:text-brand-400 hover:bg-surface-800/60 transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {loading && topics.length === 0 ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-9 h-9 rounded-lg bg-surface-800/70" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-24 rounded bg-surface-800/70" />
                <div className="h-2 w-14 rounded bg-surface-800/50" />
              </div>
            </div>
          ))}
        </div>
      ) : error && topics.length === 0 ? (
        <p className="text-xs text-surface-500">Couldn&apos;t load topics.</p>
      ) : topics.length > 0 ? (
        <div className="space-y-2.5">
          {topics.map((topic, i) => (
            <Link
              key={topic.id}
              href={`/tag/${topic.slug}`}
              className="group flex items-center gap-3 rounded-xl p-1.5 -mx-1.5 hover:bg-surface-800/40 transition-colors"
            >
              <span className="text-[10px] font-bold text-surface-500 w-4 shrink-0 text-right tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              {topic.thumbnail ? (
                <div className="relative w-9 h-9 rounded-lg overflow-hidden shrink-0 ring-1 ring-surface-700/50">
                  <Image
                    src={topic.thumbnail}
                    alt=""
                    fill
                    sizes="36px"
                    className="object-cover transition-transform duration-500 group-hover:scale-110"
                    unoptimized={topic.thumbnail.startsWith("data:") || topic.thumbnail.includes("picsum")}
                  />
                </div>
              ) : (
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/30 to-accent-violet/20 shrink-0 flex items-center justify-center">
                  <Flame className="w-4 h-4 text-brand-400" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-surface-300 group-hover:text-brand-400 transition-colors truncate">
                  #{topic.name}
                </p>
                <p className="text-[10px] text-surface-500 truncate">
                  {topic.postCount} {topic.postCount === 1 ? "post" : "posts"} ·{" "}
                  {formatViews(topic.totalViews)} views
                </p>
              </div>
              {i < 3 && <Flame className="w-3.5 h-3.5 text-brand-500/80 shrink-0" />}
              <ArrowUpRight className="w-3 h-3 text-surface-600 group-hover:text-brand-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-xs text-surface-500">No trending topics yet.</p>
      )}
    </div>
  );
}