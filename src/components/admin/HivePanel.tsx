"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Zap, Brain, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface HiveStatus {
  online: boolean;
  total: number;
  sourceBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  topTopics: { topic: string; count: number }[];
  recentLearnings: {
    source: string;
    category: string;
    content: string;
    tags: string;
    confidence: number;
    learnedAt: string;
  }[];
}

export default function HivePanel() {
  const [status, setStatus] = useState<HiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/neural/hive", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data.status);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadStatus, 0);
    return () => clearTimeout(timer);
  }, [loadStatus]);

  const handleSweep = async () => {
    setSweeping(true);
    setSweepResult(null);
    try {
      const res = await fetch("/api/admin/neural/hive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSweepResult(
        `Scanned ${data.result.postsScanned} posts & ${data.result.commentsScanned} comments → ${data.result.postsLearned} posts + ${data.result.commentsLearned} comments learned (${data.result.memoriesCreated} new memories). Total memory: ${data.result.totalMemories}.`
      );
      await loadStatus();
    } catch {}
    setSweeping(false);
  };

  const sourceTotal = (key: string) => status?.sourceBreakdown[key] ?? 0;

  return (
    <div className="space-y-4">
      {/* Brain status header */}
      <div className="flex items-center justify-between rounded-xl border border-surface-800 bg-surface-900/50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20">
            <Brain className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-surface-50">Hive Brain</p>
            <p className="type-caption text-surface-500">Platform intelligence layer</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status?.online && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 type-caption text-positive-strong border border-emerald-500/25">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Learning Active
            </span>
          )}
          <button
            onClick={loadStatus}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-surface-700 bg-surface-800 text-surface-400 transition-colors hover:bg-surface-700 hover:text-surface-200"
            title="Refresh"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-surface-800 bg-surface-900/50 px-4 py-3">
          <p className="text-2xl font-bold text-surface-50">{status ? status.total.toLocaleString() : "—"}</p>
          <p className="type-caption text-surface-500">Knowledge entries</p>
        </div>
        <div className="rounded-xl border border-surface-800 bg-surface-900/50 px-4 py-3">
          <p className="text-2xl font-bold text-surface-50">{status ? sourceTotal("internal").toLocaleString() : "—"}</p>
          <p className="type-caption text-surface-500">Learned from platform</p>
        </div>
        <div className="rounded-xl border border-surface-800 bg-surface-900/50 px-4 py-3">
          <p className="text-2xl font-bold text-surface-50">{status ? sourceTotal("external").toLocaleString() : "—"}</p>
          <p className="type-caption text-surface-500">Learned from web</p>
        </div>
        <div className="rounded-xl border border-surface-800 bg-surface-900/50 px-4 py-3">
          <p className="text-2xl font-bold text-surface-50">{status?.topTopics.length ?? "—"}</p>
          <p className="type-caption text-surface-500">Active signals</p>
        </div>
      </div>

      {/* Learned topics */}
      {status && status.topTopics.length > 0 && (
        <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-4">
          <p className="mb-2 type-caption text-surface-500 uppercase tracking-wider">Learned Topics</p>
          <div className="flex flex-wrap gap-1.5">
            {status.topTopics.slice(0, 18).map(t => (
              <span key={t.topic} className="rounded-full bg-amber-500/15 border border-amber-500/25 px-2 py-0.5 type-caption text-warning-strong">
                {t.topic} <span className="text-amber-500/60">×{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent learnings */}
      {status && status.recentLearnings.length > 0 && (
        <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-4">
          <p className="mb-2 type-caption text-surface-500 uppercase tracking-wider">Recent Learnings</p>
          <ul className="space-y-2">
            {status.recentLearnings.map((l, i) => (
              <li key={i} className="text-xs text-surface-400 leading-relaxed">
                <span
                  className={cn(
                    "mr-1.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                    l.source === "internal" ? "bg-emerald-500/15 font-medium text-positive-strong" : "bg-cyan-500/15 font-medium text-info-strong"
                  )}
                >
                  {l.source}
                </span>
                <span className="text-surface-500">[{l.category}]</span> {l.content.slice(0, 110)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sweep */}
      <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-4 space-y-2">
        <button
          onClick={handleSweep}
          disabled={sweeping}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500/15 border border-amber-500/25 px-4 py-2 text-sm font-semibold text-warning-strong transition-colors hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sweeping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {sweeping ? "Learning from platform..." : "Run Learning Sweep"}
        </button>
        {sweepResult && (
          <p className="type-caption text-surface-500 leading-relaxed">{sweepResult}</p>
        )}
        <p className="text-[9px] text-surface-600 text-center">
          The hive brain auto-learns topics, entities and sentiment from every published post, comment and RSS import.
        </p>
      </div>
    </div>
  );
}