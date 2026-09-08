"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Database,
  RefreshCw,
  Radio,
  DollarSign,
  CloudSun,
  Timer,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ServiceCheck {
  id: string;
  name: string;
  description: string;
  status: "operational" | "degraded" | "down" | "unconfigured";
  latencyMs: number | null;
  detail: string;
  critical?: boolean;
}

interface StatusResponse {
  overall: "operational" | "degraded" | "down";
  checkedAt: string;
  services: ServiceCheck[];
}

const ICONS: Record<string, typeof Database> = {
  database: Database,
  redis: Zap,
  radio: Radio,
  forex: DollarSign,
  weather: CloudSun,
  inngest: Timer,
};

const STATUS_META = {
  operational: {
    label: "Operational",
    dot: "bg-emerald-500",
    text: "text-emerald-500",
    ring: "border-emerald-500/25 bg-emerald-500/5",
    icon: CheckCircle2,
  },
  degraded: {
    label: "Degraded",
    dot: "bg-amber-500",
    text: "text-amber-500",
    ring: "border-amber-500/25 bg-amber-500/5",
    icon: AlertTriangle,
  },
  down: {
    label: "Down",
    dot: "bg-red-500",
    text: "text-red-500",
    ring: "border-red-500/25 bg-red-500/5",
    icon: XCircle,
  },
  unconfigured: {
    label: "Not configured",
    dot: "bg-surface-500",
    text: "text-surface-400",
    ring: "border-surface-700/50 bg-surface-800/30",
    icon: MinusCircle,
  },
} as const;

const OVERALL_META = {
  operational: {
    label: "All systems operational",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
    icon: CheckCircle2,
  },
  degraded: {
    label: "Some systems degraded",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    icon: AlertTriangle,
  },
  down: {
    label: "Service disruption",
    className: "border-red-500/30 bg-red-500/10 text-red-500",
    icon: XCircle,
  },
} as const;

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/status", { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`Status check failed (${res.status})`);
      setData((await res.json()) as StatusResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the status service");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const overall = data ? OVERALL_META[data.overall] : null;

  return (
    <div className="min-h-screen bg-surface-950">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-12">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/15 border border-brand-500/25">
            <Activity className="h-5 w-5 text-accent-strong" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-50">System Status</h1>
            <p className="text-xs text-surface-400">
              Live health of connectPlus integrations
            </p>
          </div>
          <button
            onClick={() => load()}
            disabled={refreshing}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-surface-700 bg-surface-900/60 px-3 py-1.5 text-xs font-medium text-surface-300 hover:text-surface-50 hover:border-surface-600 transition-colors disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {refreshing ? "Checking" : "Refresh"}
          </button>
        </div>

        {/* Overall banner */}
        {overall && data && (
          <div
            className={cn(
              "mt-6 flex items-center gap-3 rounded-2xl border px-5 py-4",
              overall.className
            )}
          >
            <overall.icon className="h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{overall.label}</p>
              <p className="text-xs opacity-80">
                Checked {timeAgo(data.checkedAt)} · auto-refreshes every 30s
              </p>
            </div>
          </div>
        )}

        {error && !data && (
          <div className="mt-6 flex items-center gap-2 rounded-2xl border border-red-500/25 bg-red-500/10 px-5 py-4 text-sm text-red-400">
            <XCircle className="h-4 w-4 shrink-0" />
            {error}
            <button onClick={() => load(true)} className="ml-auto font-medium underline">
              Retry
            </button>
          </div>
        )}

        {/* Service cards */}
        <div className="mt-6 space-y-3">
          {loading && !data
            ? [...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="h-[76px] animate-pulse rounded-2xl border border-surface-800/60 bg-surface-900/40"
                />
              ))
            : data?.services.map((s) => {
                const meta = STATUS_META[s.status];
                const Icon = ICONS[s.id] ?? Activity;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-center gap-4 rounded-2xl border px-5 py-4 transition-colors",
                      meta.ring
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-surface-700/60 bg-surface-900/60">
                      <Icon className="h-4.5 w-4.5 h-[18px] w-[18px] text-surface-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold text-surface-50">{s.name}</h2>
                        {s.critical && (
                          <span className="rounded-full border border-surface-700 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-surface-500">
                            Core
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-surface-400">{s.detail}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", meta.text)}>
                        <span className={cn("h-2 w-2 rounded-full", meta.dot, s.status === "operational" && "animate-pulse")} />
                        {meta.label}
                      </span>
                      {s.latencyMs !== null && (
                        <p className="mt-0.5 text-[10px] tabular-nums text-surface-500">
                          {s.latencyMs < 1000 ? `${s.latencyMs}ms` : `${(s.latencyMs / 1000).toFixed(1)}s`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
        </div>

        <p className="mt-8 text-center text-xs text-surface-500">
          Radio probes sample a subset of the 35 stations · status results are cached for 15s
        </p>
      </div>
    </div>
  );
}