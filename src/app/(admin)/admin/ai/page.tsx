"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BrainCircuit,
  Database,
  ShieldAlert,
  RefreshCw,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Cpu,
  FlaskConical,
  Layers,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PipelineOverview {
  pipeline: {
    semantic: { indexedPosts: number; publishedPosts: number; coverage: number; model: string };
    moderation: { pending: number; rejected: number; flagged: number; duplicates: number };
    learning: {
      feedbackEvents: number;
      userPreferences: number;
      engagement: Record<string, number>;
      experiments: {
        feedRank: {
          variants: string[];
          events: { variant: string; type: string; count: number }[];
        };
      };
    };
    generation: { usesCustomModel: number };
  };
  flaggedPosts: {
    id: string;
    title: string;
    moderationStatus: string;
    aiScore: number | null;
    aiFlags: string | null;
    status: string;
    slug: string;
  }[];
  recentFeedback: { id: string; type: string; value: number | null; userId: string | null; createdAt: string }[];
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = "text-accent-strong",
}: {
  icon: typeof Database;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-surface-300">{label}</p>
          <p className="mt-1 text-3xl font-bold text-surface-50">{value}</p>
          {sub && <p className="mt-1 text-xs text-surface-500">{sub}</p>}
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg bg-surface-800", color)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function AiPipelinesPage() {
  const [data, setData] = useState<PipelineOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ name: string; built: number }[] | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/ai/pipeline", { credentials: "include" });
      if (res.status === 401) {
        setError("Authentication required");
        setRole(null);
        return;
      }
      if (res.status === 403) {
        setError("Admin access required");
        setRole("USER");
        return;
      }
      if (!res.ok) throw new Error(`Failed to load pipeline (${res.status})`);
      const json = await res.json();
      setData(json);
      setRole(json.role ?? "ADMIN");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: the sync setState is only an idempotent loading flag
    fetchOverview();
  }, [fetchOverview]);

  const runPipelines = useCallback(async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/admin/ai/pipeline", {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 403) {
        setError("Superadmin access required — only the superadmin can run all pipelines.");
        return;
      }
      if (!res.ok) throw new Error(`Pipeline run failed (${res.status})`);
      const json = await res.json();
      setRunResult(json.steps ?? []);
      await fetchOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline run failed");
    } finally {
      setRunning(false);
    }
  }, [fetchOverview]);

  const exp = data?.pipeline.learning.experiments.feedRank;
  const expSummary = new Map<string, { impressions: number; clicks: number; ctr: number }>();
  for (const e of exp?.events ?? []) {
    const row = expSummary.get(e.variant) ?? { impressions: 0, clicks: 0, ctr: 0 };
    if (e.type === "impression") row.impressions += e.count;
    if (e.type === "click") row.clicks += e.count;
    row.ctr = row.impressions > 0 ? Math.round((row.clicks / row.impressions) * 1000) / 10 : 0;
    expSummary.set(e.variant, row);
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/20">
              <Layers className="h-6 w-6 text-accent-strong" />
            </div>
            <div>
              <h1 className="type-display text-surface-50">AI Pipelines</h1>
              <p className="text-sm font-medium text-surface-300">
                Superadmin control over every neural pipeline — semantic index, moderation, learning loop, experiments
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchOverview}
              disabled={loading}
              className="rounded-lg bg-surface-900 border border-surface-800 p-2 text-surface-400 transition-colors hover:text-surface-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <button
              onClick={runPipelines}
              disabled={running || role !== "SUPER_ADMIN"}
              title={role !== "SUPER_ADMIN" ? "Only the superadmin can run all pipelines" : "Run every pipeline now"}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                running
                  ? "bg-surface-800 text-surface-400 cursor-not-allowed"
                  : role === "SUPER_ADMIN"
                    ? "bg-brand-500 text-white hover:bg-brand-600 shadow-glow"
                    : "bg-surface-800 text-surface-400 cursor-not-allowed"
              )}
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Running pipelines…" : "Run All Pipelines"}
            </button>
          </div>
        </div>

        {role === "ADMIN" && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            You have read-only access. Pipeline execution (Run All Pipelines) requires the SUPER_ADMIN role.
          </div>
        )}

        {runResult && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Pipeline run complete
            </p>
            <div className="flex flex-wrap gap-2">
              {runResult.map((s) => (
                <span key={s.name} className="rounded-full bg-surface-900/60 border border-emerald-500/25 px-3 py-1 text-xs font-semibold text-positive-strong">
                  {s.name}: {s.built}
                </span>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-danger-strong">
            <XCircle className="h-4 w-4 shrink-0" />
            {error}
            <button onClick={fetchOverview} className="ml-auto text-xs underline hover:text-red-300">
              Retry
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-accent-strong" />
            <span className="ml-3 text-sm font-medium text-surface-300">Loading pipeline telemetry…</span>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={Database}
                label="Semantic Index"
                value={`${data.pipeline.semantic.coverage}%`}
                sub={`${data.pipeline.semantic.indexedPosts} / ${data.pipeline.semantic.publishedPosts} posts · ${data.pipeline.semantic.model}`}
                color="text-info-strong"
              />
              <StatCard
                icon={ShieldAlert}
                label="Moderation Queue"
                value={data.pipeline.moderation.pending}
                sub={`${data.pipeline.moderation.flagged} flagged · ${data.pipeline.moderation.rejected} rejected · ${data.pipeline.moderation.duplicates} duplicates`}
                color="text-warning-strong"
              />
              <StatCard
                icon={BrainCircuit}
                label="Learning Loop"
                value={data.pipeline.learning.feedbackEvents}
                sub={`${data.pipeline.learning.userPreferences} learned preference profiles`}
                color="text-purple-400"
              />
              <StatCard
                icon={FlaskConical}
                label="Generation"
                value={data.pipeline.generation.usesCustomModel}
                sub="custom-model generations"
                color="text-positive-strong"
              />
            </div>

            {/* Experiment telemetry */}
            <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-6">
              <div className="mb-4 flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-accent-strong" />
                <h2 className="type-h2 text-surface-50">Feed Ranking Experiment</h2>
                <span className="ml-auto rounded-full bg-surface-800 px-2.5 py-1 text-xs font-semibold text-surface-300">A/B · feed-rank</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {exp?.variants.map((variant) => {
                  const row = expSummary.get(variant) ?? { impressions: 0, clicks: 0, ctr: 0 };
                  return (
                    <div key={variant} className="rounded-lg border border-surface-800 bg-surface-800/30 p-4">
                      <p className="text-xs font-medium text-surface-300 capitalize">{variant.replace("-", " ")}</p>
                      <div className="mt-2 flex items-end justify-between">
                        <div>
                          <p className="type-display text-surface-50">{row.impressions}</p>
                          <p className="type-caption text-surface-500">impressions</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-accent-strong">{row.ctr}%</p>
                          <p className="type-caption text-surface-500">{row.clicks} clicks</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 type-meta text-surface-600">
                CTR compares impressions → clicks per variant. A winner can be promoted by changing the weights in{" "}
                <code className="rounded bg-surface-800 px-1">src/lib/feed-ranker.ts</code>.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Flagged content */}
              <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-6">
                <div className="mb-4 flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-amber-400" />
                  <h2 className="type-h2 text-surface-50">Flagged Content</h2>
                </div>
                {data.flaggedPosts.length === 0 ? (
                  <p className="text-sm text-surface-500">No flagged posts. All clear.</p>
                ) : (
                  <div className="space-y-2">
                    {data.flaggedPosts.map((p) => (
                      <div key={p.id} className="rounded-lg border border-surface-800 bg-surface-800/30 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <Link href={`/article/${p.slug}`} className="min-w-0 truncate text-sm font-semibold text-surface-100 hover:text-brand-600 transition-colors">
                            {p.title}
                          </Link>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 type-caption font-bold",
                              p.moderationStatus === "REJECTED"
                                ? "bg-red-500/20 text-danger-strong"
                                : "bg-amber-500/20 text-warning-strong"
                            )}
                          >
                            {p.moderationStatus}
                          </span>
                        </div>
                        {p.aiFlags && (
                          <p className="mt-1.5 type-meta text-surface-500">
                            <Cpu className="mr-1 inline-block h-3 w-3" />
                            {p.aiFlags}
                            {p.aiScore != null && <span className="ml-2">score {p.aiScore}</span>}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent feedback */}
              <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-6">
                <div className="mb-4 flex items-center gap-2">
                  <BrainCircuit className="h-5 w-5 text-purple-400" />
                  <h2 className="type-h2 text-surface-50">Recent Learning Events</h2>
                </div>
                {data.recentFeedback.length === 0 ? (
                  <p className="text-sm text-surface-500">
                    No feedback yet — the learning loop starts collecting impressions and clicks as readers browse.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.recentFeedback.map((f) => (
                      <div key={f.id} className="flex items-center justify-between rounded-lg border border-surface-800 bg-surface-800/30 px-3 py-2">
                        <span className="rounded-full bg-brand-500/10 px-2 py-0.5 type-caption text-accent-strong capitalize">
                          {f.type}
                        </span>
                        <span className="type-meta text-surface-500">
                          {f.userId ? "signed-in" : "guest"} · {f.value != null ? `${f.value}` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}