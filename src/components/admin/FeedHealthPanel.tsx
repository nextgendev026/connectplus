"use client";

import { Activity, AlertTriangle, CheckCircle2, Clock, Filter, Flag, Timer } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

export interface HealthFeed {
  id: string;
  name: string;
  isActive: boolean;
  pollInterval: number;
  lastPolled: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastItemCount: number | null;
  lastNewArticles: number | null;
  lastDurationMs: number | null;
  consecutiveFailures: number;
  lastFiltered: string | null;
  lastFlagged: number | null;
  lastCategories: string | null;
}

const HEALTHY_STATUSES = new Set(["OK", "NOT_MODIFIED", "EMPTY"]);

function parseCounts(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n)) out[k] = n;
      }
      return out;
    }
  } catch {
    /* tolerate legacy/partial JSON */
  }
  return {};
}

function humaniseReason(reason: string): string {
  return reason.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Wrapper so time-dependent labels go through one call site (the same way
 *  `timeAgo` does) instead of sprinkling `Date.now()` through render bodies. */
function nowMs(): number {
  return Date.now();
}

function nextDueLabel(feed: HealthFeed, now: number): { label: string; due: boolean } {
  if (!feed.isActive) return { label: "Paused", due: false };
  if (!feed.lastPolled) return { label: "Due now", due: true };
  // Mirrors DEFAULT_POLL_INTERVAL_SECONDS in lib/rss-poll (twice a day). The
  // literal is repeated rather than imported because this is a client component
  // and that module drags the RSS parser and Prisma into the browser bundle.
  const interval = feed.pollInterval > 0 ? feed.pollInterval : 43200;
  const dueAt = new Date(feed.lastPolled).getTime() + interval * 1000;
  const diff = dueAt - now;
  if (diff <= 0) return { label: "Due now", due: true };
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return { label: `in ${mins}m`, due: false };
  return { label: `in ${(mins / 60).toFixed(1)}h`, due: false };
}

function StatusPill({ feed }: { feed: HealthFeed }) {
  const status = feed.isActive ? feed.lastStatus ?? "PENDING" : "PAUSED";
  const ok = HEALTHY_STATUSES.has(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        !feed.isActive
          ? "bg-surface-800 text-surface-400"
          : ok
            ? status === "EMPTY"
              ? "bg-amber-500/15 text-amber-400"
              : "bg-emerald-500/15 text-emerald-400"
            : "bg-red-500/15 text-red-400"
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {status}
    </span>
  );
}

/**
 * Per-feed ingestion health.
 *
 * Answers the question the old console could not: WHY is this feed producing
 * nothing? It shows the last outcome, how many items the intake layer filtered
 * and for what reason, how many the moderation scanner flagged, when the feed
 * is next due, and how many consecutive attempts have failed.
 */
export default function FeedHealthPanel({ feeds }: { feeds: HealthFeed[] }) {
  const now = nowMs();
  const active = feeds.filter((f) => f.isActive);
  const failing = active.filter((f) => f.consecutiveFailures > 0 || !HEALTHY_STATUSES.has(f.lastStatus ?? "PENDING"));
  const due = active.filter((f) => nextDueLabel(f, now).due);
  const filteredTotal = active.reduce(
    (n, f) => n + Object.values(parseCounts(f.lastFiltered)).reduce((a, b) => a + b, 0),
    0
  );
  const flaggedTotal = active.reduce((n, f) => n + (f.lastFlagged ?? 0), 0);

  const rows = [...feeds].sort((a, b) => {
    const aBad = (a.consecutiveFailures > 0 ? 2 : 0) + (a.isActive ? 0 : 1);
    const bBad = (b.consecutiveFailures > 0 ? 2 : 0) + (b.isActive ? 0 : 1);
    return bBad - aBad || a.name.localeCompare(b.name);
  });

  if (feeds.length === 0) return null;

  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-50">
          <Activity className="h-4 w-4 text-orange-400" />
          Ingestion health
        </h2>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-surface-800 px-2.5 py-1 text-surface-300">{active.length} active</span>
          <span className={cn("rounded-full px-2.5 py-1", due.length > 0 ? "bg-amber-500/15 text-amber-400" : "bg-surface-800 text-surface-400")}>
            {due.length} due
          </span>
          <span className={cn("rounded-full px-2.5 py-1", failing.length > 0 ? "bg-red-500/15 text-red-400" : "bg-surface-800 text-surface-400")}>
            {failing.length} failing
          </span>
          <span className="rounded-full bg-surface-800 px-2.5 py-1 text-surface-400">{filteredTotal} filtered / cycle</span>
          <span className="rounded-full bg-surface-800 px-2.5 py-1 text-surface-400">{flaggedTotal} flagged</span>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((feed) => {
          const next = nextDueLabel(feed, now);
          const filtered = parseCounts(feed.lastFiltered);
          const categories = parseCounts(feed.lastCategories);
          return (
            <div
              key={feed.id}
              className="rounded-lg border border-surface-800/70 bg-surface-950/40 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-surface-100">{feed.name}</span>
                <StatusPill feed={feed} />
                {feed.consecutiveFailures > 0 ? (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                    {feed.consecutiveFailures} consecutive fail{feed.consecutiveFailures === 1 ? "" : "s"}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    next.due ? "bg-amber-500/15 text-amber-400" : "bg-surface-800 text-surface-400"
                  )}
                >
                  <Timer className="h-3 w-3" /> {next.label}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-surface-400">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {feed.lastPolled ? `polled ${timeAgo(feed.lastPolled)}` : "never polled"}
                  {feed.lastDurationMs != null ? ` · ${feed.lastDurationMs}ms` : ""}
                </span>
                <span>
                  {feed.lastItemCount ?? 0} in feed · {feed.lastNewArticles ?? 0} new
                </span>
                {feed.lastFlagged ? (
                  <span className="inline-flex items-center gap-1 text-amber-400">
                    <Flag className="h-3 w-3" /> {feed.lastFlagged} flagged for review
                  </span>
                ) : null}
              </div>

              {Object.keys(filtered).length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-surface-500">
                    <Filter className="h-3 w-3" /> Filtered
                  </span>
                  {Object.entries(filtered).map(([reason, count]) => (
                    <span
                      key={reason}
                      className="rounded-md bg-orange-400/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-300"
                      title={`${count} item${count === 1 ? "" : "s"} dropped: ${humaniseReason(reason)}`}
                    >
                      {humaniseReason(reason)}: {count}
                    </span>
                  ))}
                </div>
              ) : null}

              {Object.keys(categories).length > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-surface-500">
                  <span>Categorised:</span>
                  {Object.entries(categories).map(([slug, count]) => (
                    <span key={slug} className="rounded-md bg-surface-800 px-1.5 py-0.5 text-surface-300">
                      {slug}: {count}
                    </span>
                  ))}
                </div>
              ) : null}

              {feed.lastError ? (
                <p className="mt-2 line-clamp-2 rounded-md bg-red-500/5 px-2 py-1 text-[11px] text-red-400" title={feed.lastError}>
                  {feed.lastError}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-surface-500">
        &ldquo;Due&rdquo; respects each feed&rsquo;s poll interval. Filtered items are dropped by the intake
        layer before they can become stories; flagged items import but wait in the moderation queue.
      </p>
    </div>
  );
}
