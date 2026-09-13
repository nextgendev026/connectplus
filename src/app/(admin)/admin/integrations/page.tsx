"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock,
  ExternalLink,
  Gauge,
  Link2,
  Loader2,
  MinusCircle,
  Play,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  Integration,
  IntegrationCategory,
  IntegrationStatus,
  IntegrationsReport,
} from "@/lib/integrations";

const STATUS_META: Record<
  IntegrationStatus,
  { label: string; text: string; chip: string; dot: string; icon: typeof CheckCircle2 }
> = {
  operational: {
    label: "Operational",
    text: "text-positive-strong",
    chip: "bg-emerald-500/10 border-emerald-500/25",
    dot: "bg-emerald-400",
    icon: CheckCircle2,
  },
  degraded: {
    label: "Degraded",
    text: "text-warning-strong",
    chip: "bg-amber-500/10 border-amber-500/25",
    dot: "bg-amber-400",
    icon: AlertTriangle,
  },
  down: {
    label: "Down",
    text: "text-danger-strong",
    chip: "bg-red-500/10 border-red-500/25",
    dot: "bg-red-400",
    icon: XCircle,
  },
  unconfigured: {
    label: "Not configured",
    text: "text-surface-400",
    chip: "bg-surface-800/60 border-surface-700",
    dot: "bg-surface-500",
    icon: CircleDashed,
  },
};

const VERDICT_META: Record<Integration["verdict"], { label: string; className: string }> = {
  healthy: { label: "Healthy", className: "text-positive-strong" },
  attention: { label: "Needs attention", className: "text-warning-strong" },
  "action-required": { label: "Action required", className: "text-danger-strong" },
  optional: { label: "Optional", className: "text-surface-500" },
};

const CATEGORIES: IntegrationCategory[] = [
  "Edge & hosting",
  "Background jobs",
  "Data & cache",
  "Storage",
  "Payments",
  "Messaging",
  "AI",
  "Content",
  "Monitoring",
  "App",
];

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatCadence(cron: string): string {
  const map: Record<string, string> = {
    "*/5 * * * *": "every 5 minutes",
    "*/15 * * * *": "every 15 minutes",
    "0 * * * *": "hourly",
    "15 */6 * * *": "every 6 hours",
    "0 1 * * *": "daily · 01:00 UTC",
    "30 1 * * *": "daily · 01:30 UTC",
    "5 0 * * *": "daily · 00:05 UTC",
  };
  return map[cron] ?? cron;
}

export default function AdminIntegrationsPage() {
  const [report, setReport] = useState<IntegrationsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<IntegrationCategory | "all">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/integrations", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load integrations (${res.status})`);
      setReport((await res.json()) as IntegrationsReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runJob(jobId: string, name: string) {
    try {
      setRunning(jobId);
      setJobMessage(null);
      const res = await fetch("/api/admin/integrations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-job", jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Run failed (${res.status})`);
      setJobMessage(`${name} finished in ${(data.elapsedMs / 1000).toFixed(1)}s`);
      await load();
    } catch (err) {
      setJobMessage(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(null);
    }
  }

  const filtered = useMemo(() => {
    if (!report) return [];
    const q = query.trim().toLowerCase();
    return report.integrations.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.detail.toLowerCase().includes(q) ||
        i.fields.some((f) => f.env?.toLowerCase().includes(q) || f.label.toLowerCase().includes(q))
      );
    });
  }, [report, query, category]);

  const grouped = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      category: cat,
      items: filtered.filter((i) => i.category === cat),
    })).filter((g) => g.items.length > 0);
  }, [filtered]);

  const summary = report?.summary;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      {/* Header */}
      <section className="surface-card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-surface-800/60 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/12 text-accent-strong">
              <Plug className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-surface-50">Integration console</h2>
              <p className="mt-0.5 max-w-2xl text-sm text-surface-400">
                Live health, credentials and wiring for every platform connection — edge, jobs, data,
                payments, mail, storage and AI.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {report && (
              <span className="hidden text-[11px] text-surface-500 sm:inline">
                Updated {relativeTime(report.generatedAt)}
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl border border-surface-700 px-3 py-2 text-xs font-semibold text-surface-200 transition-colors hover:border-brand-500/40 hover:text-surface-50 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Re-probe
            </button>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 divide-surface-800/60 sm:grid-cols-4 sm:divide-x">
            {[
              { label: "Operational", value: summary.operational, tone: "text-positive-strong" },
              { label: "Degraded", value: summary.degraded, tone: "text-warning-strong" },
              { label: "Down", value: summary.down, tone: "text-danger-strong" },
              { label: "Not configured", value: summary.unconfigured, tone: "text-surface-300" },
            ].map((s) => (
              <div key={s.label} className="p-4">
                <p className="type-eyebrow text-surface-500">{s.label}</p>
                <p className={cn("mt-1 text-2xl font-bold tabular-nums", s.tone)}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Filters */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search integrations, env vars or status…"
            className="w-full rounded-xl border border-surface-700 bg-surface-900/60 py-2.5 pl-9 pr-3 text-sm text-surface-100 placeholder:text-surface-500 focus:border-brand-500/50 focus:outline-none"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1 sm:pb-0">
          {(["all", ...CATEGORIES] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat as IntegrationCategory | "all")}
              className={cn(
                "shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                category === cat
                  ? "border-brand-500/40 bg-brand-500/12 text-accent-strong"
                  : "border-surface-800 text-surface-400 hover:text-surface-100"
              )}
            >
              {cat === "all" ? "All" : cat}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-danger-strong">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="surface-card h-40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Integration cards */}
      {grouped.map((group) => (
        <section key={group.category} className="space-y-3">
          <div className="flex items-center gap-3">
            <h3 className="type-eyebrow text-surface-500">{group.category}</h3>
            <span className="h-px flex-1 bg-surface-800" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.items.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                expanded={Boolean(expanded[integration.id])}
                onToggle={() =>
                  setExpanded((prev) => ({ ...prev, [integration.id]: !prev[integration.id] }))
                }
              />
            ))}
          </div>
        </section>
      ))}

      {report && grouped.length === 0 && (
        <div className="surface-card p-8 text-center text-sm text-surface-400">
          No integration matches “{query}”.
        </div>
      )}

      {/* Scheduled jobs */}
      {report && report.crons.length > 0 && (
        <section className="surface-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-surface-800/60 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-cyan/12 text-info-strong">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-surface-50">Scheduled jobs</h3>
                <p className="mt-0.5 text-sm text-surface-400">
                  Inngest owns every cadence. Vercel&apos;s single daily cron only covers essential jobs
                  whose heartbeat has gone stale.
                </p>
              </div>
            </div>
            {jobMessage && (
              <span className="rounded-lg border border-surface-700 bg-surface-800/50 px-3 py-1.5 text-[11px] text-surface-300">
                {jobMessage}
              </span>
            )}
          </div>

          <div className="divide-y divide-surface-800/60">
            {report.crons.map((job) => (
              <div
                key={job.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-surface-50">{job.name}</span>
                    {job.essential && (
                      <span className="rounded border border-brand-500/30 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-strong">
                        essential
                      </span>
                    )}
                    <span
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        job.stale
                          ? "border-amber-500/25 bg-amber-500/10 text-warning-strong"
                          : "border-emerald-500/25 bg-emerald-500/10 text-positive-strong"
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", job.stale ? "bg-amber-400" : "bg-emerald-400")} />
                      {job.stale ? "past due" : "on schedule"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-surface-400">{job.description}</p>
                  <p className="mt-1 font-mono text-[11px] text-surface-500">
                    {job.cron} · {formatCadence(job.cron)} · last run {relativeTime(job.lastRun)}
                    {job.ageMinutes !== null && job.ageMinutes >= 0 ? ` (${job.ageMinutes}m)` : ""}
                  </p>
                </div>
                <button
                  onClick={() => runJob(job.id, job.name)}
                  disabled={running !== null}
                  className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-surface-700 px-3 py-2 text-xs font-semibold text-surface-200 transition-colors hover:border-brand-500/40 hover:text-surface-50 disabled:opacity-50"
                >
                  {running === job.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Run now
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function IntegrationCard({
  integration,
  expanded,
  onToggle,
}: {
  integration: Integration;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = STATUS_META[integration.status];
  const verdict = VERDICT_META[integration.verdict];
  const StatusIcon = meta.icon;
  const missingRequired = integration.fields.filter((f) => f.required && !f.present);

  return (
    <article className="surface-card flex flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-surface-50">{integration.name}</h4>
          <p className={cn("mt-0.5 text-[11px] font-medium", verdict.className)}>{verdict.label}</p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            meta.chip,
            meta.text
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {meta.label}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-surface-400">{integration.detail}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-surface-500">
        {integration.latencyMs !== null && (
          <span className="flex items-center gap-1">
            <Gauge className="h-3 w-3" />
            {integration.latencyMs}ms
          </span>
        )}
        <span className="flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          {integration.fields.filter((f) => f.present).length}/{integration.fields.length} credentials
        </span>
        {missingRequired.length > 0 && (
          <span className="flex items-center gap-1 text-danger-strong">
            <MinusCircle className="h-3 w-3" />
            {missingRequired.length} required missing
          </span>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-surface-500">{integration.description}</p>

      <div className="mt-auto pt-3">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 rounded-lg border border-surface-800 px-2.5 py-1.5 text-[11px] font-semibold text-surface-300 transition-colors hover:border-surface-700 hover:text-surface-50"
            aria-expanded={expanded}
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
            {expanded ? "Hide details" : "Credentials & wiring"}
          </button>
          {integration.links[0] && (
            <a
              href={integration.links[0].href}
              target={integration.links[0].href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] font-medium text-info-strong hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {integration.links[0].label}
            </a>
          )}
        </div>

        {expanded && (
          <div className="mt-3 space-y-3 border-t border-surface-800/60 pt-3">
            {integration.fields.length > 0 ? (
              <ul className="space-y-1.5">
                {integration.fields.map((f) => (
                  <li key={`${f.label}-${f.env ?? ""}`} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-surface-200">{f.label}</p>
                      {f.env && <p className="font-mono text-[10px] text-surface-500">{f.env}</p>}
                      {f.hint && <p className="mt-0.5 text-[10px] text-surface-500">{f.hint}</p>}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]",
                        f.present
                          ? "border-emerald-500/25 bg-emerald-500/10 text-positive-strong"
                          : f.required
                            ? "border-red-500/25 bg-red-500/10 text-danger-strong"
                            : "border-surface-700 text-surface-500"
                      )}
                    >
                      {f.present ? (f.value || "set") : f.required ? "missing" : "unset"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-surface-500">No credentials required for this integration.</p>
            )}

            {integration.links.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {integration.links.slice(1).map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    target={l.href.startsWith("http") ? "_blank" : undefined}
                    rel="noreferrer"
                    className="flex items-center gap-1 rounded-lg border border-surface-800 px-2 py-1 text-[10px] text-surface-300 hover:border-brand-500/40 hover:text-surface-50"
                  >
                    <Link2 className="h-3 w-3" />
                    {l.label}
                  </a>
                ))}
              </div>
            )}

            {integration.notes && (
              <p className="rounded-lg border border-surface-800 bg-surface-800/40 p-2 text-[10px] leading-relaxed text-surface-400">
                {integration.notes}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
