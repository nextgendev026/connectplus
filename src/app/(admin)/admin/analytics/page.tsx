"use client";

import { useState, useEffect } from "react";
import {
  Users,
  Eye,
  FileText,
  BarChart3,
  BrainCircuit,
  ArrowUpRight,
  ArrowDownRight,
  Globe,
  Zap,
  Download,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

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

const trafficData = [
  { day: "Mon", views: 12400, users: 3200 },
  { day: "Tue", views: 15800, users: 4100 },
  { day: "Wed", views: 14200, users: 3800 },
  { day: "Thu", views: 18600, users: 5200 },
  { day: "Fri", views: 21300, users: 6100 },
  { day: "Sat", views: 19800, users: 5600 },
  { day: "Sun", views: 16400, users: 4400 },
];

const userGrowthData = [
  { month: "Apr", newUsers: 1820, retained: 1640 },
  { month: "May", newUsers: 2140, retained: 1920 },
  { month: "Jun", newUsers: 2560, retained: 2310 },
  { month: "Jul", newUsers: 2890, retained: 2580 },
  { month: "Aug", newUsers: 3210, retained: 2940 },
  { month: "Sep", newUsers: 3680, retained: 3320 },
];

const PIE_COLORS = ["#22c55e", "#22d3ee", "#a78bfa", "#f59e0b", "#f43f5e", "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#8b5cf6"];

const predictiveModels = [
  {
    model: "User Growth Forecast",
    prediction: "22,400",
    confidence: 94,
    period: "Q4 2026",
    trend: "up" as const,
    change: "+38%",
  },
  {
    model: "Content Engagement",
    prediction: "8.7%",
    confidence: 87,
    period: "Next 30 days",
    trend: "up" as const,
    change: "+1.2%",
  },
  {
    model: "Churn Risk Assessment",
    prediction: "3.2%",
    confidence: 91,
    period: "Next 60 days",
    trend: "down" as const,
    change: "-0.8%",
  },
  {
    model: "Peak Traffic Window",
    prediction: "Fri 6-9PM",
    confidence: 89,
    period: "Weekly",
    trend: "stable" as const,
    change: "Stable",
  },
];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 shadow-xl">
        <p className="text-xs font-medium text-surface-50 mb-1">{label}</p>
        {payload.map((entry, i) => (
          <p key={i} className="text-xs text-surface-300">
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            {entry.name}: {entry.value.toLocaleString()}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function AnalyticsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  const regionData = stats
    ? Object.entries(stats.regionalBreakdown)
        .map(([name, data], i) => ({
          name,
          value: data.users,
          color: PIE_COLORS[i % PIE_COLORS.length],
        }))
        .sort((a, b) => b.value - a.value)
    : [];

  const overviewStats = stats
    ? [
        {
          label: "Page Views",
          value: formatNumber(stats.totalViews),
          change: `+${stats.postsThisWeek} posts this week`,
          up: true,
          icon: Eye,
          color: "text-brand-500",
          bg: "bg-brand-500/10",
        },
        {
          label: "Total Users",
          value: formatNumber(stats.totalUsers),
          change: `+${stats.usersThisWeek} this week`,
          up: true,
          icon: Users,
          color: "text-cyan-400",
          bg: "bg-cyan-400/10",
        },
        {
          label: "Total Posts",
          value: formatNumber(stats.totalPosts),
          change: `${stats.totalComments.toLocaleString()} comments`,
          up: true,
          icon: FileText,
          color: "text-purple-400",
          bg: "bg-purple-400/10",
        },
        {
          label: "Pending Review",
          value: formatNumber(stats.pendingModeration),
          change: "Needs attention",
          up: false,
          icon: AlertTriangle,
          color: "text-amber-400",
          bg: "bg-amber-400/10",
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-surface-950 p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-400/10 border border-cyan-400/20">
              <BarChart3 className="h-6 w-6 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-50">
                Analytics &amp; Trend Radar
              </h1>
              <p className="text-sm text-surface-400">
                Platform intelligence, growth metrics &amp; predictive models
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 rounded-lg bg-surface-900 border border-surface-800 px-3 py-2 text-xs text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-50">
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
            <button
              onClick={fetchStats}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-surface-900 border border-surface-800 px-3 py-2 text-xs text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
            <span className="ml-3 text-sm text-surface-400">Loading analytics...</span>
          </div>
        )}

        {/* Error */}
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

        {!loading && !error && stats && (
          <>
            {/* Overview Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {overviewStats.map((stat) => (
                <div
                  key={stat.label}
                  className="group relative overflow-hidden rounded-xl bg-surface-900/50 border border-surface-800 p-5 transition-all duration-300 hover:border-surface-700 hover:bg-surface-900/80"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-surface-400">{stat.label}</p>
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
                    {stat.up ? (
                      <ArrowUpRight className="h-3.5 w-3.5 text-brand-500" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5 text-brand-500" />
                    )}
                    <span className="text-brand-500 font-medium">
                      {stat.change}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Traffic & User Growth Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Traffic Area Chart */}
              <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="h-5 w-5 text-brand-500" />
                    <h2 className="text-base font-semibold text-surface-50">
                      Traffic Overview
                    </h2>
                  </div>
                  <span className="text-xs text-surface-500">Last 7 days</span>
                </div>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trafficData}>
                      <defs>
                        <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="usersGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={{ stroke: "#1e293b" }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="views"
                        stroke="#22c55e"
                        strokeWidth={2}
                        fill="url(#viewsGrad)"
                        name="Views"
                      />
                      <Area
                        type="monotone"
                        dataKey="users"
                        stroke="#22d3ee"
                        strokeWidth={2}
                        fill="url(#usersGrad)"
                        name="Users"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* User Growth Bar Chart */}
              <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-cyan-400" />
                    <h2 className="text-base font-semibold text-surface-50">
                      User Growth
                    </h2>
                  </div>
                  <span className="text-xs text-surface-500">Last 6 months</span>
                </div>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={userGrowthData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={{ stroke: "#1e293b" }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar
                        dataKey="newUsers"
                        fill="#22c55e"
                        radius={[4, 4, 0, 0]}
                        name="New Users"
                      />
                      <Bar
                        dataKey="retained"
                        fill="#22d3ee"
                        radius={[4, 4, 0, 0]}
                        name="Retained"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Regional Breakdown & Top Posts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Regional Pie Chart */}
              <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-6">
                <div className="mb-5 flex items-center gap-2">
                  <Globe className="h-5 w-5 text-purple-400" />
                  <h2 className="text-base font-semibold text-surface-50">
                    Regional Breakdown
                  </h2>
                </div>
                <div className="h-[240px] flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={regionData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={95}
                        paddingAngle={4}
                        dataKey="value"
                        stroke="none"
                      >
                        {regionData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload as (typeof regionData)[0];
                            return (
                              <div className="rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 shadow-xl">
                                <p className="text-xs font-medium text-surface-50">
                                  {data.name}
                                </p>
                                <p className="text-xs text-surface-300">
                                  {data.value.toLocaleString()} users
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 mt-2">
                  {regionData.map((region) => (
                    <div
                      key={region.name}
                      className="flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: region.color }}
                        />
                        <span className="text-surface-300">{region.name}</span>
                      </div>
                      <span className="font-medium text-surface-50 tabular-nums">
                        {region.value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Performing Content */}
              <div className="lg:col-span-2 rounded-xl bg-surface-900/50 border border-surface-800 p-6">
                <div className="mb-5 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-amber-400" />
                  <h2 className="text-base font-semibold text-surface-50">
                    Platform Content Summary
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-lg border border-surface-700 bg-surface-800/30 p-4">
                    <p className="text-xs text-surface-500">Total Posts</p>
                    <p className="mt-1 text-2xl font-bold text-surface-50">{formatNumber(stats.totalPosts)}</p>
                    <p className="mt-1 text-xs text-brand-500">+{stats.postsThisWeek} this week</p>
                  </div>
                  <div className="rounded-lg border border-surface-700 bg-surface-800/30 p-4">
                    <p className="text-xs text-surface-500">Total Comments</p>
                    <p className="mt-1 text-2xl font-bold text-surface-50">{formatNumber(stats.totalComments)}</p>
                    <p className="mt-1 text-xs text-surface-400">
                      {(stats.totalComments / Math.max(stats.totalPosts, 1)).toFixed(1)} per post avg
                    </p>
                  </div>
                  <div className="rounded-lg border border-surface-700 bg-surface-800/30 p-4">
                    <p className="text-xs text-surface-500">Active Regions</p>
                    <p className="mt-1 text-2xl font-bold text-surface-50">{Object.keys(stats.regionalBreakdown).length}</p>
                    <p className="mt-1 text-xs text-surface-400">Regional nodes</p>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-surface-700 bg-surface-800/30 p-4">
                  <p className="text-xs text-surface-500 mb-3">Top Regions by Users</p>
                  <div className="space-y-2">
                    {regionData.slice(0, 5).map((region) => {
                      const maxVal = regionData[0]?.value ?? 1;
                      return (
                        <div key={region.name} className="flex items-center gap-3">
                          <span className="w-28 text-xs text-surface-300 truncate">{region.name}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-surface-700 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${(region.value / maxVal) * 100}%`,
                                backgroundColor: region.color,
                              }}
                            />
                          </div>
                          <span className="text-xs font-medium text-surface-50 tabular-nums w-16 text-right">
                            {region.value.toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Predictive Models */}
            <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-6">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-5 w-5 text-brand-500" />
                  <h2 className="text-base font-semibold text-surface-50">
                    Predictive Trend Models
                  </h2>
                </div>
                <span className="rounded-full bg-brand-500/10 border border-brand-500/20 px-3 py-1 text-xs font-medium text-brand-500">
                  <Zap className="mr-1 inline-block h-3 w-3" />
                  Neural Engine Powered
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {predictiveModels.map((model) => (
                  <div
                    key={model.model}
                    className="rounded-lg border border-surface-700 bg-surface-800/30 p-4 transition-all duration-200 hover:border-surface-600 hover:bg-surface-800/60"
                  >
                    <p className="text-xs text-surface-500">{model.model}</p>
                    <p className="mt-2 text-2xl font-bold text-surface-50">
                      {model.prediction}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-surface-400">{model.period}</span>
                      <div className="flex items-center gap-1">
                        {model.trend === "up" && (
                          <ArrowUpRight className="h-3 w-3 text-brand-500" />
                        )}
                        {model.trend === "down" && (
                          <ArrowDownRight className="h-3 w-3 text-brand-500" />
                        )}
                        <span
                          className={cn(
                            "text-xs font-medium",
                            model.trend === "up" || model.trend === "down"
                              ? "text-brand-500"
                              : "text-surface-400"
                          )}
                        >
                          {model.change}
                        </span>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-surface-500">Confidence</span>
                        <span className="text-[10px] font-bold text-brand-500 tabular-nums">
                          {model.confidence}%
                        </span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-surface-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-brand-500 transition-all duration-500"
                          style={{ width: `${model.confidence}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
