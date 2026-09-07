"use client";

import { useState, useEffect } from "react";
import {
  Users,
  FileText,
  Eye,
  Clock,
  Cpu,
  TrendingUp,
  Shield,
  Globe,
  Radio,
  BrainCircuit,
  ArrowUpRight,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface StatsData {
  totalUsers: number;
  totalPosts: number;
  totalComments: number;
  totalViews: number;
  pendingModeration: number;
  usersThisWeek: number;
  postsThisWeek: number;
  regionalBreakdown: Record<string, { users: number; posts: number }>;
}

const defaultNodes = [
  { city: "Nairobi", status: "active" as const },
  { city: "Kampala", status: "active" as const },
  { city: "Dar es Salaam", status: "active" as const },
  { city: "Kigali", status: "active" as const },
  { city: "Mombasa", status: "active" as const },
  { city: "Addis Ababa", status: "active" as const },
  { city: "Lagos", status: "syncing" as const },
  { city: "Accra", status: "idle" as const },
];

const trendingTopics = [
  { topic: "AfroTech Summit 2026", mentions: 1247, trend: "+34%" },
  { topic: "Nairobi Night Markets", mentions: 892, trend: "+21%" },
  { topic: "East African Fintech", mentions: 743, trend: "+18%" },
  { topic: "Kampala Food Scene", mentions: 681, trend: "+15%" },
  { topic: "Rwanda Smart City", mentions: 534, trend: "+12%" },
];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export default function AdminCommandCenter() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const update = () => {
      setCurrentTime(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/stats", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch stats (${res.status})`);
      const data = await res.json();
      setStats(data.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }

  const systemStats = stats
    ? [
        {
          label: "Total Users",
          value: formatNumber(stats.totalUsers),
          change: `+${stats.usersThisWeek} this week`,
          icon: Users,
          color: "text-accent-strong",
          bg: "bg-brand-500/10",
        },
        {
          label: "Active Posts",
          value: formatNumber(stats.totalPosts),
          change: `+${stats.postsThisWeek} this week`,
          icon: FileText,
          color: "text-info-strong",
          bg: "bg-cyan-400/10",
        },
        {
          label: "Pending Moderation",
          value: formatNumber(stats.pendingModeration),
          change: `${stats.totalComments.toLocaleString()} comments`,
          icon: Shield,
          color: "text-warning-strong",
          bg: "bg-amber-400/10",
        },
        {
          label: "Total Views",
          value: formatNumber(stats.totalViews),
          change: `Across ${Object.keys(stats.regionalBreakdown).length} nodes`,
          icon: Eye,
          color: "text-purple-400",
          bg: "bg-purple-400/10",
        },
      ]
    : [];

  const activeNodes = stats
    ? defaultNodes.map((n) => ({
        ...n,
        users: stats.regionalBreakdown[n.city]?.users ?? 0,
        posts: stats.regionalBreakdown[n.city]?.posts ?? 0,
      }))
    : defaultNodes.map((n) => ({ ...n, users: 0, posts: 0 }));

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1600px] space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/20">
              <Cpu className="h-6 w-6 text-accent-strong" />
            </div>
            <div>
              <h1 className="type-display text-surface-50">Command Center</h1>
              <p className="text-sm font-medium text-surface-400">
                Platform overview & neural diagnostics
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchStats}
              disabled={loading}
              className="rounded-lg bg-surface-900 border border-surface-800 p-2 text-surface-400 transition-colors hover:text-surface-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <span className="hidden sm:inline-flex rounded-full bg-gradient-to-r from-brand-500/15 to-accent-coral/10 border border-brand-500/20 px-3 py-1.5 text-xs font-medium text-accent-strong">
              <BrainCircuit className="mr-1 inline-block h-3.5 w-3.5" />
              Hive Mind Neural Engine
            </span>
            <div className="rounded-lg bg-surface-900 border border-surface-800 px-3 py-1.5 text-sm text-surface-300 tabular-nums">
              <Clock className="mr-1.5 inline-block h-3.5 w-3.5 text-surface-500" />
              {currentTime}
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-accent-strong" />
            <span className="ml-3 text-sm font-medium text-surface-400">Fetching platform telemetry...</span>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12">
            <AlertTriangle className="mb-3 h-8 w-8 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={fetchStats}
              className="mt-4 rounded-lg bg-surface-800 border border-surface-700 px-4 py-2 text-xs text-surface-300 transition-colors hover:text-surface-50"
            >
              Retry
            </button>
          </div>
        )}

        {/* Stats Content */}
        {!loading && !error && stats && (
          <>
            {/* System Status Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {systemStats.map((stat) => (
                <div
                  key={stat.label}
                  className={cn(
                    "group relative overflow-hidden rounded-xl bg-surface-900/50 border border-surface-800 p-5",
                    "transition-all duration-300 hover:border-surface-700 hover:bg-surface-900/80"
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-surface-400">{stat.label}</p>
                      <p className="mt-1 text-3xl font-bold text-surface-50">
                        {stat.value}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg",
                        stat.bg
                      )}
                    >
                      <stat.icon className={cn("h-5 w-5", stat.color)} />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-1 text-xs">
                    <ArrowUpRight className="h-3.5 w-3.5 text-accent-strong" />
                    <span className="text-accent-strong font-medium">{stat.change}</span>
                  </div>
                  <div
                    className={cn(
                      "absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-[0.03]",
                      stat.bg.replace("/10", "")
                    )}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Active Nodes */}
              <div className="lg:col-span-2 rounded-xl bg-surface-900/50 border border-surface-800 p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Radio className="h-5 w-5 text-accent-strong" />
                    <h2 className="type-h2 text-surface-50">
                      Active Nodes
                    </h2>
                  </div>
                  <span className="rounded-full bg-surface-800 px-2.5 py-1 text-xs text-surface-300">
                    {activeNodes.filter((n) => n.status === "active").length} of{" "}
                    {activeNodes.length} online
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {activeNodes.map((node) => (
                    <div
                      key={node.city}
                      className={cn(
                        "rounded-lg border p-3 transition-all duration-200",
                        node.status === "active"
                          ? "border-brand-500/20 bg-brand-500/5 hover:border-brand-500/40"
                          : node.status === "syncing"
                            ? "border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40"
                            : "border-surface-700 bg-surface-800/50 hover:border-surface-600"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-surface-400" />
                        <span className="text-xs font-medium text-surface-300">
                          {node.city}
                        </span>
                      </div>
                      <p className="mt-2 text-xl font-bold text-surface-50">
                        {node.users.toLocaleString()}
                      </p>
                      <p className="type-meta text-surface-400">
                        {node.posts.toLocaleString()} posts
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            node.status === "active"
                              ? "bg-brand-500"
                              : node.status === "syncing"
                                ? "bg-amber-400 animate-pulse"
                                : "bg-surface-500"
                          )}
                        />
                        <span className="type-meta capitalize text-surface-400">
                          {node.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trending Topics */}
              <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-6">
                <div className="mb-5 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-cyan-400" />
                  <h2 className="type-h2 text-surface-50">
                    Regional Trends
                  </h2>
                </div>
                <div className="space-y-3">
                  {trendingTopics.map((topic, i) => (
                    <div
                      key={topic.topic}
                      className="group flex items-center justify-between rounded-lg border border-surface-800 bg-surface-800/30 p-3 transition-all duration-200 hover:border-surface-700 hover:bg-surface-800/60"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-700 type-caption font-bold text-surface-300">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-surface-50">
                            {topic.topic}
                          </p>
                          <p className="text-xs font-medium text-surface-400">
                            {topic.mentions.toLocaleString()} mentions
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full bg-brand-500/10 px-2 py-0.5 type-caption text-accent-strong">
                        {topic.trend}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Neural Mind Quick Access */}
            <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10">
                    <BrainCircuit className="h-5 w-5 text-accent-strong" />
                  </div>
                  <div>
                    <h2 className="type-h2 text-surface-50">
                      Neural Mind
                    </h2>
                    <p className="text-xs text-surface-500">
                      Full dual-intelligence system with streaming chat, external learning, and knowledge base
                    </p>
                  </div>
                </div>
                <Link
                  href="/admin/neural"
                  className="flex items-center gap-2 rounded-lg bg-brand-500/10 border border-brand-500/20 px-4 py-2.5 text-sm font-medium text-brand-400 transition-all hover:bg-brand-500/20 hover:border-brand-500/30"
                >
                  Open Neural Mind
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
