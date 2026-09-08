"use client";

import { useEffect, useState } from "react";
import {
  Newspaper,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  ArrowUpRight,
  Clock,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PostLite {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  coverImage?: string | null;
  createdAt: string;
  author?: { name?: string | null; username?: string | null } | null;
  category?: { name?: string; slug?: string } | null;
  _count?: { comments?: number; likes?: number };
}

interface ForexQuote {
  code: string;
  rate: number;
  changePct: number | null;
  direction: "up" | "down" | "flat";
}

interface ForexResponse {
  quotes: ForexQuote[];
  updatedAt: string;
  cached: boolean;
  source: string;
}

const FX_LABELS: Record<string, string> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "Pound",
  KES: "Kenyan Shilling",
  UGX: "Uganda Shilling",
  TZS: "Tanzanian Shilling",
  RWF: "Rwandan Franc",
  NGN: "Naira",
  ZAR: "Rand",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ForexPanel() {
  const [data, setData] = useState<ForexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/forex", { signal: AbortSignal.timeout(10_000) });
      if (res.ok) setData((await res.json()) as ForexResponse);
    } catch {
      // keep previous data on transient failure
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 5 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-xs text-surface-500">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Loading forex…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-surface-500">
        <span>Forex unavailable right now</span>
        <button onClick={() => load()} className="text-accent-strong hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const usd = data.quotes.find((q) => q.code === "USD");
  const majors = ["EUR", "GBP", "USD"];
  const eastAfrica = ["KES", "UGX", "TZS", "RWF", "NGN", "ZAR"];
  const picks = [
    ...majors.filter((c) => data.quotes.some((q) => q.code === c)),
    ...eastAfrica.filter((c) => data.quotes.some((q) => q.code === c)),
  ].slice(0, 8);

  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {picks.map((code) => {
          const q = data.quotes.find((x) => x.code === code)!;
          return (
            <div
              key={code}
              className="rounded-lg border border-surface-800/60 bg-surface-900/50 px-2.5 py-1.5"
              title={`${FX_LABELS[code] ?? code} per USD`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-surface-400">
                  {code}
                </span>
                {q.direction === "up" ? (
                  <TrendingUp className="h-3 w-3 text-emerald-500" />
                ) : q.direction === "down" ? (
                  <TrendingDown className="h-3 w-3 text-red-500" />
                ) : (
                  <Minus className="h-3 w-3 text-surface-500" />
                )}
              </div>
              <p className="text-sm font-semibold text-surface-50 tabular-nums">
                {code === "USD" ? "1.0000" : q.rate.toFixed(code === "UGX" || code === "TZS" || code === "RWF" ? 0 : 2)}
              </p>
              {q.changePct !== null && (
                <p
                  className={cn(
                    "text-[9px] font-medium tabular-nums",
                    q.direction === "up"
                      ? "text-emerald-500"
                      : q.direction === "down"
                        ? "text-red-500"
                        : "text-surface-500"
                  )}
                >
                  {q.changePct > 0 ? "+" : ""}
                  {q.changePct.toFixed(2)}%
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] text-surface-500">
        <span>
          Per 1 USD · {usd ? "base USD" : "USD base"} · {data.source}
        </span>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1 rounded-full border border-surface-800 px-2 py-0.5 text-[9px] font-medium text-surface-400 hover:text-surface-100 transition-colors"
        >
          <RefreshCw className={cn("h-2.5 w-2.5", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

function LatestPostsPanel() {
  const [posts, setPosts] = useState<PostLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/posts?limit=4", { signal: AbortSignal.timeout(10_000) });
        if (res.ok) {
          const body = (await res.json()) as { posts?: PostLite[] };
          setPosts((body.posts ?? []).slice(0, 4));
        }
      } catch {
        // keep empty
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-surface-500">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Loading latest stories…
      </div>
    );
  }

  if (posts.length === 0) {
    return <p className="text-xs text-surface-500">Fresh stories land here as they publish.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {posts.map((post) => (
        <li key={post.id}>
          <a
            href={`/story/${post.slug}`}
            className="group flex items-start gap-2.5 rounded-lg border border-transparent px-1.5 py-1.5 transition-colors hover:border-surface-800 hover:bg-surface-900/60"
          >
            {post.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.coverImage}
                alt=""
                loading="lazy"
                className="h-10 w-14 shrink-0 rounded-md object-cover"
              />
            ) : (
              <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-surface-800">
                <Newspaper className="h-4 w-4 text-surface-500" />
              </div>
            )}
            <div className="min-w-0">
              <p className="line-clamp-2 text-xs font-medium leading-snug text-surface-100 group-hover:text-accent-strong">
                {post.title}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[9px] text-surface-500">
                <span className="truncate">
                  {post.author?.name ?? post.author?.username ?? "ConnectPlus"}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-0.5">
                  <Clock className="h-2.5 w-2.5" />
                  {timeAgo(post.createdAt)}
                </span>
              </p>
            </div>
            <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-surface-600 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Real-time side panel for the radio hero: latest platform stories + live
 * forex / trading quotes. Shown under the featured station on desktop.
 */
export function RadioHeroInsights() {
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 border-t border-surface-800/50 pt-4 sm:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500/15">
            <Newspaper className="h-3.5 w-3.5 text-accent-strong" />
          </span>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-300">
            Latest Stories
          </h3>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-surface-800/70 px-1.5 py-0.5 text-[9px] font-medium text-surface-400">
            <Users className="h-2.5 w-2.5" /> Realtime
          </span>
        </div>
        <LatestPostsPanel />
      </div>
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500/15">
            <TrendingUp className="h-3.5 w-3.5 text-accent-strong" />
          </span>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-300">
            Forex &amp; Markets
          </h3>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">
            <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
        </div>
        <ForexPanel />
      </div>
    </div>
  );
}