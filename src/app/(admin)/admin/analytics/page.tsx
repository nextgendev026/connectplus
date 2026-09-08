"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart,
} from "recharts";
import {
  TrendingUp,
  Eye,
  MessageSquare,
  Heart,
  FileText,
  Users,
  BarChart3,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalyticsData {
  summary: {
    totalPosts: number;
    totalViews: number;
    totalComments: number;
    totalLikes: number;
    avgViewsPerPost: number;
    lastWeekPosts: number;
    lastWeekViews: number;
    viewsTrend: number;
  };
  dailyData: {
    date: string;
    posts: number;
    views: number;
    comments: number;
    likes: number;
  }[];
  categories: { name: string; posts: number; views: number; comments: number }[];
  topPosts: {
    title: string;
    slug: string;
    views: number;
    comments: number;
    likes: number;
    author: string;
    category: string;
    publishedAt?: string;
  }[];
  authors: { name: string; posts: number; views: number; comments: number }[];
}

const PIE_COLORS = ["#ff6b00", "#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#ec4899", "#8b5cf6"];

function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  color,
}: {
  icon: typeof Eye;
  label: string;
  value: string | number;
  trend?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-800/50 dark:bg-surface-800/50 p-4">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold text-surface-50">{typeof value === "number" ? value.toLocaleString() : value}</p>
          <p className="text-xs text-surface-400">{label}</p>
        </div>
      </div>
      {trend && <p className="mt-2 text-xs text-emerald-400">{trend}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<"7d" | "30d">("30d");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }
    if (session?.user?.role !== "ADMIN" && session?.user?.role !== "SUPER_ADMIN") {
      return;
    }

    const fetchData = async () => {
      try {
        const res = await fetch("/api/admin/analytics");
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [session, status, router]);

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-950">
        <p className="text-surface-400">No analytics data available</p>
      </div>
    );
  }

  const displayData = timeRange === "7d" ? data.dailyData.slice(-7) : data.dailyData;

  return (
    <div className="min-h-screen bg-surface-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/15 border border-brand-500/25">
              <BarChart3 className="h-5 w-5 text-accent-strong" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-50">Analytics</h1>
              <p className="text-xs text-surface-400">Article performance and engagement</p>
            </div>
          </div>
          <div className="flex gap-2">
            {(["7d", "30d"] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-all border",
                  timeRange === range
                    ? "border-brand-500 bg-brand-500/10 text-accent-strong"
                    : "border-surface-700 bg-surface-900/50 text-surface-400 hover:text-surface-200"
                )}
              >
                {range === "7d" ? "7 Days" : "30 Days"}
              </button>
            ))}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="mb-8 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={FileText} label="Published Posts" value={data.summary.totalPosts} color="bg-brand-500" />
          <StatCard icon={Eye} label="Total Views" value={data.summary.totalViews} trend={`${data.summary.viewsTrend}% this week`} color="bg-cyan-500" />
          <StatCard icon={MessageSquare} label="Comments" value={data.summary.totalComments} color="bg-violet-500" />
          <StatCard icon={Heart} label="Likes" value={data.summary.totalLikes} color="bg-rose-500" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Views Over Time */}
          <div className="lg:col-span-2 rounded-2xl border border-surface-700/50 bg-surface-900/50 p-5">
            <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-accent-strong" />
              Views & Engagement
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayData}>                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--surface-700) / 0.5)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "rgb(var(--surface-400))", fontSize: 10 }}
                    tickFormatter={(v) => v.slice(5)}
                    stroke="rgb(var(--surface-700) / 0.5)"
                  />
                  <YAxis tick={{ fill: "rgb(var(--surface-400))", fontSize: 10 }} stroke="rgb(var(--surface-700) / 0.5)" />
                  <Tooltip
                    contentStyle={{
                      background: "rgb(var(--surface-800))",
                      border: "1px solid rgb(var(--surface-700))",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "rgb(var(--foreground))",
                    }}
                  />
                  <Area type="monotone" dataKey="views" stroke="#ff6b00" fill="rgba(255,107,0,0.15)" strokeWidth={2} />
                  <Area type="monotone" dataKey="comments" stroke="#a78bfa" fill="rgba(167,139,250,0.1)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="likes" stroke="#34d399" fill="rgba(52,211,153,0.1)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="rounded-2xl border border-surface-700/50 bg-surface-900/50 p-5">
            <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
              <Users className="h-4 w-4 text-accent-strong" />
              By Category
            </h3>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.categories}
                    dataKey="views"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={40}
                    paddingAngle={2}
                  >
                    {data.categories.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "rgb(var(--surface-800))",
                      border: "1px solid rgb(var(--surface-700))",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "rgb(var(--foreground))",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 mt-2">
              {data.categories.slice(0, 5).map((cat, i) => (
                <div key={cat.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-surface-300">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    {cat.name}
                  </span>
                  <span className="text-surface-400">{cat.views.toLocaleString()} views</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Posts + Author Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Top Posts */}
          <div className="rounded-2xl border border-surface-700/50 bg-surface-900/50 p-5">
            <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-accent-strong" />
              Top Performing Posts
            </h3>
            <div className="space-y-3">
              {data.topPosts.slice(0, 8).map((post, i) => (
                <div key={post.slug} className="flex items-start gap-3 rounded-lg bg-surface-800/40 px-3 py-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/15 text-[10px] font-bold text-accent-strong shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-surface-200">{post.title}</p>
                    <p className="text-[10px] text-surface-500 mt-0.5">
                      {post.author} · {post.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-surface-400 shrink-0">
                    <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{post.views}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{post.comments}</span>
                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{post.likes}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Author Performance */}
          <div className="rounded-2xl border border-surface-700/50 bg-surface-900/50 p-5">
            <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
              <Users className="h-4 w-4 text-accent-strong" />
              Author Performance
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.authors.slice(0, 6)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--surface-700)/0.5)" />
                  <XAxis type="number" tick={{ fill: "rgb(var(--surface-400))", fontSize: 10 }} stroke="rgb(var(--surface-700)/0.5)" />
                  <YAxis type="category" dataKey="name" tick={{ fill: "rgb(var(--surface-400))", fontSize: 10 }} width={80} stroke="rgb(var(--surface-700)/0.5)" />
                  <Tooltip
                    contentStyle={{
                      background: "rgb(var(--surface-800))",
                      border: "1px solid rgb(var(--surface-700))",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "rgb(var(--foreground))",
                    }}
                  />
                  <Bar dataKey="views" fill="#ff6b00" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="comments" fill="#a78bfa" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 justify-center">
              <span className="flex items-center gap-1.5 text-[10px] text-surface-400">
                <span className="h-2 w-2 rounded-full bg-brand-500" /> Views
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-surface-400">
                <span className="h-2 w-2 rounded-full bg-violet-500" /> Comments
              </span>
            </div>
          </div>
        </div>

        {/* Daily Posts Bar Chart */}
        <div className="rounded-2xl border border-surface-700/50 bg-surface-900/50 p-5 mb-8">
          <h3 className="text-sm font-semibold text-surface-300 mb-4 flex items-center gap-2">
            <FileText className="h-4 w-4 text-accent-strong" />
            Daily Publishing Volume
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={displayData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--surface-700)/0.5)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "rgb(var(--surface-400))", fontSize: 10 }}
                  tickFormatter={(v) => v.slice(5)}
                  stroke="rgb(var(--surface-700)/0.5)"
                />
                <YAxis tick={{ fill: "rgb(var(--surface-400))", fontSize: 10 }} stroke="rgb(var(--surface-700)/0.5)" />
                <Tooltip
                  contentStyle={{
                    background: "rgb(var(--surface-800))",
                    border: "1px solid rgb(var(--surface-700))",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "rgb(var(--foreground))",
                  }}
                />
                <Bar dataKey="posts" fill="#ff6b00" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
