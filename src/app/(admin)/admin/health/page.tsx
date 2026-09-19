"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Eye,
  Loader2,
  Rss,
  Timer,
  XCircle,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import {
  AdminBadge,
  AdminEmpty,
  AdminNotice,
  AdminPage,
  AdminPanel,
  AdminStat,
  AdminStatGrid,
  adminBtnGhost,
} from "@/components/admin/AdminUI";
import type {
  PipelineCheck,
  PipelineHealthReport,
  PipelineState,
} from "@/lib/pipeline-health";
import { BrainDiagnosticsPanel } from "@/components/admin/BrainDiagnosticsPanel";

/**
 * Pipeline health console.
 *
 * Every outage this platform has had was discovered by a human noticing a number
 * looked wrong — a story that would not count, a feed that stopped importing. The
 * Integrations console could not help, because "configured and reachable" is not
 * the same measurement as "doing its job": a cron can be linked, the queue can be
 * green, and nothing can have been delivered for four days.
 *
 * This page measures the second thing. It answers, per pipeline, *when it last
 * worked* and *what is waiting* — and it says "unmeasured" out loud rather than
 * rendering blindness as a zero.
 */

const STATE_META: Record<
  PipelineState,
  {
    label: string;
    tone: "positive" | "warning" | "danger" | "info";
    icon: typeof CheckCircle2;
    text: string;
    dot: string;
  }
> = {
  ok: { label: "Healthy", tone: "positive", icon: CheckCircle2, text: "text-positive-strong", dot: "bg-emerald-400" },
  warn: { label: "Degraded", tone: "warning", icon: AlertTriangle, text: "text-warning-strong", dot: "bg-amber-400" },
  critical: { label: "Stalled", tone: "danger", icon: XCircle, text: "text-danger-strong", dot: "bg-red-400" },
  unknown: { label: "Unmeasured", tone: "info", icon: CircleDashed, text: "text-info-strong", dot: "bg-sky-400" },
};

const CHECK_ICON = { "view-sync": Eye, "rss-intake": Rss, scheduler: Timer } as const;

function StateBadge({ state }: { state: PipelineState }) {
  const meta = STATE_META[state];
  return (
    <AdminBadge tone={meta.tone}>
      <meta.icon className="h-3 w-3" />
      {meta.label}
    </AdminBadge>
  );
}

function EvidenceRow({ items }: { items: PipelineCheck["evidence"] }) {
  if (items.length === 0) return null;
  return (
    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="flex items-baseline gap-1.5">
          <dt className="uppercase tracking-wide text-surface-500">{item.label}</dt>
          <dd
            className={cn(
              "font-medium",
              item.state === "critical"
                ? "text-danger-strong"
                : item.state === "warn"
                  ? "text-warning-strong"
                  : item.state === "ok"
                    ? "text-positive-strong"
                    : "text-surface-300"
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CheckPanel({ check }: { check: PipelineCheck }) {
  const meta = STATE_META[check.state];
  const Icon = CHECK_ICON[check.id];
  return (
    <AdminPanel
      title={check.label}
      icon={Icon}
      tone={check.state === "critical" ? "danger" : check.state === "warn" ? "warning" : "neutral"}
      action={<StateBadge state={check.state} />}
    >
      <p className={cn("text-sm font-semibold", meta.text)}>{check.headline}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-surface-400">{check.detail}</p>
      <EvidenceRow items={check.evidence} />
      {check.lastSuccessAt ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-surface-500">
          <Clock className="h-3 w-3" />
          Last confirmed success {timeAgo(check.lastSuccessAt)}
        </p>
      ) : null}
    </AdminPanel>
  );
}

export default function AdminHealthPage() {
  const [report, setReport] = useState<PipelineHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/health", { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load pipeline health (${res.status})`);
      setReport((await res.json()) as PipelineHealthReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pipeline health");
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- first fetch on mount; the state it sets is the report itself */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /*
   * The whole point of this view is catching a pipeline that stopped *while
   * nobody was looking*, so it refreshes itself: a console that only tells the
   * truth at the moment it was opened would have missed every incident so far.
   */
  useEffect(() => {
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const checks = report?.checks ?? [];
  const viewSync = report?.viewSync;
  const rss = report?.rss;
  const staleJobs = (report?.scheduler.jobs ?? []).filter((job) => job.stale);
  const essentialJobs = (report?.scheduler.jobs ?? []).filter((job) => job.essential);

  return (
    <AdminPage
      title="Pipeline Health"
      description="When each background pipeline last did its job — age and result, not just reachability."
      icon={Activity}
      wide
      actions={
        <>
          {report ? (
            <span className="text-[11px] text-surface-500">checked {timeAgo(report.generatedAt)} · refreshes every 30s</span>
          ) : null}
          <button type="button" onClick={() => void load()} className={adminBtnGhost} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            Refresh
          </button>
        </>
      }
    >
      {error ? <AdminNotice>{error}</AdminNotice> : null}

      {loading && !report ? (
        <AdminPanel>
          <AdminEmpty icon={Loader2} title="Reading the pipelines…" description="Checking view folds, feed polls and job heartbeats." />
        </AdminPanel>
      ) : null}

      <BrainDiagnosticsPanel />

      {report ? (
        <>
          <AdminStatGrid>
            <AdminStat
              icon={STATE_META[report.overall].icon}
              label="Overall"
              value={STATE_META[report.overall].label}
              tone={STATE_META[report.overall].tone}
              sub={`${checks.filter((c) => c.state === "ok").length}/${checks.length} pipelines healthy`}
            />
            <AdminStat
              icon={Eye}
              label="Views waiting"
              value={viewSync ? (viewSync.capped ? `${viewSync.pendingViews}+` : viewSync.pendingViews.toLocaleString()) : "—"}
              tone={viewSync?.pendingViews ? "brand" : "neutral"}
              sub={
                viewSync?.configured
                  ? `${viewSync.pendingPosts} post${viewSync.pendingPosts === 1 ? "" : "s"} · folded ${viewSync.lastFoldAt ? timeAgo(viewSync.lastFoldAt) : "never"}`
                  : "Convex offload disabled"
              }
            />
            <AdminStat
              icon={Rss}
              label="Last clean poll"
              value={rss?.lastSuccessAt ? timeAgo(rss.lastSuccessAt) : "never"}
              tone={rss && rss.failingFeeds > 0 ? "warning" : "neutral"}
              sub={
                rss
                  ? `${rss.successfulFeeds}/${rss.activeFeeds} feeds clean · ${rss.failingFeeds} failing`
                  : "feed snapshot unavailable"
              }
            />
            <AdminStat
              icon={Timer}
              label="Job heartbeats"
              value={staleJobs.length === 0 ? "current" : `${staleJobs.length} stale`}
              tone={staleJobs.some((j) => j.essential) ? "danger" : staleJobs.length > 0 ? "warning" : "positive"}
              sub={`${essentialJobs.length} essential · ledger ${report.scheduler.ledger}`}
            />
          </AdminStatGrid>

          {checks.map((check) => (
            <CheckPanel key={check.id} check={check} />
          ))}

          <AdminPanel
            title="Scheduled jobs"
            description="Heartbeat age per job — the only evidence that a schedule is actually being delivered."
            icon={Timer}
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="border-b border-surface-800 text-[10px] uppercase tracking-wide text-surface-500">
                  <tr>
                    <th className="px-3.5 py-2 font-semibold">Job</th>
                    <th className="px-3.5 py-2 font-semibold">Cadence</th>
                    <th className="px-3.5 py-2 font-semibold">Last beat</th>
                    <th className="px-3.5 py-2 font-semibold">Last result</th>
                    <th className="px-3.5 py-2 font-semibold">State</th>
                  </tr>
                </thead>
                <tbody>
                  {report.scheduler.jobs.map((job) => (
                    <tr key={job.id} className="border-b border-surface-800/60 last:border-0">
                      <td className="px-3.5 py-2">
                        <span className="font-medium text-surface-100">{job.name}</span>
                        {job.essential ? (
                          <span className="ml-2 rounded bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent-strong">
                            essential
                          </span>
                        ) : null}
                        <span className="block font-mono text-[10px] text-surface-500">{job.cron}</span>
                      </td>
                      <td className="px-3.5 py-2 text-surface-400">
                        {job.expectedMinutes < 60 ? `${job.expectedMinutes}m` : `${Math.round(job.expectedMinutes / 60)}h`}
                      </td>
                      <td className="px-3.5 py-2 text-surface-300">
                        {job.lastRun ? timeAgo(job.lastRun) : <span className="text-warning-strong">never</span>}
                      </td>
                      <td className="px-3.5 py-2">
                        {job.ok ? (
                          <span className="text-positive-strong">ok</span>
                        ) : (
                          <span className="text-danger-strong">last run failed</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2">
                        <span className={cn("inline-flex items-center gap-1.5", STATE_META[job.stale ? (job.essential ? "critical" : "warn") : "ok"].text)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", STATE_META[job.stale ? (job.essential ? "critical" : "warn") : "ok"].dot)} />
                          {job.stale ? (job.essential ? "stalled" : "behind") : "current"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AdminPanel>

          <AdminPanel
            title="Raw readings"
            description="The numbers behind the verdicts above, for pasting into a report."
            icon={CircleDashed}
          >
            <dl className="grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Convex deployment", report.viewSync.configured ? `configured (${report.viewSync.urlSource})` : "not configured"],
                ["Convex state", report.viewSync.state],
                ["Last Convex error", report.viewSync.error ?? "none recorded"],
                ["Pending deltas", `${report.viewSync.pendingPosts} posts · ${report.viewSync.pendingViews} views${report.viewSync.capped ? " (capped)" : ""}`],
                ["Last view fold", report.viewSync.lastFoldAt ? `${timeAgo(report.viewSync.lastFoldAt)} — ${report.viewSync.lastFoldOk ? "ok" : "failed"}` : "never"],
                ["Fold detail", report.viewSync.lastFoldDetail ?? "no record"],
                ["Active feeds", String(report.rss.activeFeeds)],
                ["Clean last cycle", String(report.rss.successfulFeeds)],
                ["Failing feeds", String(report.rss.failingFeeds)],
                ["Never polled", String(report.rss.neverPolled)],
                ["Last clean poll", report.rss.lastSuccessAt ? timeAgo(report.rss.lastSuccessAt) : "never"],
                ["Last article imported", report.rss.lastImportedAt ? timeAgo(report.rss.lastImportedAt) : "never"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 border-b border-surface-800/60 pb-1.5">
                  <dt className="text-surface-500">{label}</dt>
                  <dd className="truncate text-right font-medium text-surface-200" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </AdminPanel>
        </>
      ) : null}
    </AdminPage>
  );
}
