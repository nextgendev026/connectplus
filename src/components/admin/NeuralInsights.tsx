"use client";

import { useState, useEffect } from "react";
import { RefreshCw, AlertTriangle, Info, AlertOctagon, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface Insight {
  title: string;
  summary: string;
  severity: "info" | "warning" | "critical";
  action?: string;
}

interface NeuralInsightsProps {
  onRefresh?: () => void;
}

export default function NeuralInsights({ onRefresh }: NeuralInsightsProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInsights = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/neural/insights", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setInsights(data.insights || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
    const interval = setInterval(fetchInsights, 60000);
    return () => clearInterval(interval);
  }, []);

  const severityConfig = {
    info: { icon: Info, color: "text-cyan-400", bg: "bg-cyan-400/10", border: "border-cyan-400/20" },
    warning: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
    critical: { icon: AlertOctagon, color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/20" },
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-brand-500" />
          <h3 className="text-sm font-semibold text-surface-50">Live Insights</h3>
        </div>
        <button onClick={() => { fetchInsights(); onRefresh?.(); }} disabled={loading} className="text-surface-500 hover:text-surface-300 transition-colors">
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {loading && insights.length === 0 && (
        <div className="text-center py-4 text-xs text-surface-500">Loading insights...</div>
      )}

      {insights.map((insight, i) => {
        const config = severityConfig[insight.severity];
        const Icon = config.icon;
        return (
          <div key={i} className={cn("rounded-lg border p-3 transition-all duration-200", config.border, config.bg)}>
            <div className="flex items-start gap-2">
              <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", config.color)} />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-surface-50">{insight.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-surface-400">{insight.summary}</p>
                {insight.action && (
                  <p className="mt-1 text-[10px] text-brand-400">→ {insight.action}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {!loading && insights.length === 0 && (
        <p className="text-center text-xs text-surface-500 py-4">No insights available yet</p>
      )}
    </div>
  );
}
