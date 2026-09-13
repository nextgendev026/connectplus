"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2, CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

interface DrainFeedRow {
  id: string;
  feedId: string | null;
  feedName: string;
  status: string;
  newArticles: number;
  items: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

interface DrainRun {
  id: string;
  stage: string;
  total: number;
  processed: number;
  newArticles: number;
  errors: number;
  cancelled: boolean;
  startedAt: string;
  finishedAt: string | null;
  feeds: DrainFeedRow[];
}

const HEALTHY = new Set(["OK", "NOT_MODIFIED", "EMPTY"]);

function stageStyle(stage: string): string {
  if (stage === "done") return "bg-emerald-500/15 text-emerald-400";
  if (stage === "cancelled") return "bg-amber-500/15 text-amber-400";
  if (stage === "running") return "bg-brand-500/15 text-brand-300";
  return "bg-surface-800 text-surface-400";
}

/**
 * Durable drain history. Redis progress is ephemeral; these rows are not, so
 * after a failed or cancelled drain the console can still show exactly which
 * feeds were reached and what went wrong.
 */
export default function DrainHistoryPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [runs, setRuns] = useState<DrainRun[] | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/rss/drain/history?limit=5", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { runs?: DrainRun[] };
      setRuns(data.runs ?? []);
      setOpenRun((prev) => prev ?? data.runs?.[0]?.id ?? null);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/refresh
    void load();
  }, [load, refreshKey]);

  if (runs === null) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-surface-800 bg-surface-900/50 py-8">
        <Loader2 className="h-4 w-4 animate-spin text-surface-500" />
      </div>
    );
  }
  if (runs.length === 0) return null;

  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-50">
        <History className="h-4 w-4 text-orange-400" />
        Drain history
      </h2>
      <p className="mt-1 text-[11px] text-surface-500">
        Every whole-registry drain, with the per-feed outcome — survives restarts and Redis expiry.
      </p>

      <div className="mt-4 space-y-2">
        {runs.map((run) => {
          const open = openRun === run.id;
          const failedFeeds = run.feeds.filter((f) => !HEALTHY.has(f.status));
          return (
            <div key={run.id} className="overflow-hidden rounded-lg border border-surface-800/70 bg-surface-950/40">
              <button
                onClick={() => setOpenRun(open ? null : run.id)}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left transition hover:bg-surface-800/30"
                aria-expanded={open}
              >
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", stageStyle(run.stage))}>
                  {run.stage}
                </span>
                <span className="text-xs text-surface-300">
                  {run.processed}/{run.total || "?"} feeds
                </span>
                <span className="text-xs text-surface-500">
                  +{run.newArticles} imported
                  {run.errors > 0 ? ` · ${run.errors} errors` : ""}
                  {run.cancelled ? " · cancelled" : ""}
                </span>
                <span className="ml-auto text-[11px] text-surface-500">{timeAgo(run.startedAt)}</span>
                <ChevronDown className={cn("h-4 w-4 text-surface-500 transition", open && "rotate-180")} />
              </button>

              {open ? (
                <div className="border-t border-surface-800/60 px-3 py-2.5">
                  {run.feeds.length === 0 ? (
                    <p className="text-[11px] text-surface-500">No feeds were reached before this run ended.</p>
                  ) : (
                    <>
                      {failedFeeds.length > 0 ? (
                        <p className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> {failedFeeds.length} feed
                          {failedFeeds.length === 1 ? "" : "s"} need attention
                        </p>
                      ) : (
                        <p className="mb-2 flex items-center gap-1.5 text-[11px] text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> Every reached feed ingested cleanly
                        </p>
                      )}
                      <ul className="grid gap-1 sm:grid-cols-2">
                        {run.feeds.map((feed) => (
                          <li
                            key={feed.id}
                            className="flex items-start justify-between gap-2 rounded-md bg-surface-800/40 px-2.5 py-1.5 text-[11px]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-surface-200">{feed.feedName}</p>
                              {feed.error ? (
                                <p className="line-clamp-1 text-[10px] text-red-400" title={feed.error}>
                                  {feed.error}
                                </p>
                              ) : null}
                            </div>
                            <span
                              className={cn(
                                "shrink-0 font-medium tabular-nums",
                                HEALTHY.has(feed.status)
                                  ? feed.status === "EMPTY"
                                    ? "text-amber-400"
                                    : "text-emerald-400"
                                  : "text-orange-400"
                              )}
                            >
                              {feed.status}
                              {feed.newArticles > 0 ? ` +${feed.newArticles}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
