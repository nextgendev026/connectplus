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
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart,
} from "recharts";
import { TrendingUp, Eye, MessageSquare, Heart, FileText, Users, BarChart3, Activity } from "lucide-react";
import {
  AdminPage,
  AdminPanel,
  AdminSegmented,
  AdminStat,
  AdminStatGrid,
} from "@/components/admin/AdminUI";

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

/**
 * Chart colours, read from the theme tokens rather than hardcoded hex.
 *
 * Recharts paints into SVG attributes, so a literal `#ff6b00` stays bright
 * orange on a light canvas — the same wash-out the rest of the app moved away
 * from. The tokens are RGB triplets, so `rgb(var(--token) / <alpha>)` gives a
 * series colour that deepens with the theme instead of fighting it.
 */
const BRAND = "rgb(var(--brand-500))";
const BRAND_FILL = "rgb(var(--brand-500) / 0.18)";
const VIOLET = "rgb(var(--accent-violet))";
const VIOLET_FILL = "rgb(var(--accent-violet) / 0.12)";
const CYAN = "rgb(var(--accent-cyan))";
const CYAN_FILL = "rgb(var(--accent-cyan) / 0.12)";

const PIE_COLORS = [
  BRAND,
  VIOLET,
  CYAN,
  "rgb(var(--accent-amber))",
  "rgb(var(--accent-coral))",
  "#34d399",
  "#ec4899",
  "#8b5cf6",
];

/** Grid, axes and tooltip chrome, in one place so the four charts agree. */
const GRID = "rgb(var(--surface-700) / 0.5)";
const AXIS_TICK = { fill: "rgb(var(--surface-400))", fontSize: 10 };
const TOOLTIP_STYLE = {
  background: "rgb(var(--surface-850))",
  border: "1px solid rgb(var(--surface-700))",
  borderRadius: "10px",
  fontSize: "12px",
  color: "rgb(var(--foreground))",
};

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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-500" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-surface-400">No analytics data available yet.</p>
      </div>
    );
  }

  const displayData = timeRange === "7d" ? data.dailyData.slice(-7) : data.dailyData;

  return (
    <AdminPage
      title="Analytics"
      description="How published work is performing across views, comments and likes."
      icon={BarChart3}
      wide
      actions={
        <AdminSegmented
          value={timeRange}
          onChange={setTimeRange}
          options={[
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
          ]}
        />
      }
    >
      <AdminStatGrid>
        <AdminStat icon={FileText} label="Published posts" value={data.summary.totalPosts.toLocaleString()} tone="brand" />
        <AdminStat
          icon={Eye}
          label="Total views"
          value={data.summary.totalViews.toLocaleString()}
          tone="info"
          sub={
            <span className={data.summary.viewsTrend >= 0 ? "text-positive-strong" : "text-danger-strong"}>
              {data.summary.viewsTrend >= 0 ? "+" : ""}
              {data.summary.viewsTrend}% vs last week
            </span>
          }
        />
        <AdminStat icon={MessageSquare} label="Comments" value={data.summary.totalComments.toLocaleString()} tone="warning" />
        <AdminStat icon={Heart} label="Likes" value={data.summary.totalLikes.toLocaleString()} tone="danger" />
      </AdminStatGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AdminPanel
          className="lg:col-span-2"
          title="Views & engagement"
          description={`Daily totals over the last ${timeRange === "7d" ? "7" : "30"} days`}
          icon={Activity}
          flush
          bodyClassName="p-3 sm:p-4"
        >
          <div className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={displayData}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={(v) => v.slice(5)} stroke={GRID} />
                <YAxis tick={AXIS_TICK} stroke={GRID} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="views" stroke={BRAND} fill={BRAND_FILL} strokeWidth={2} />
                <Area type="monotone" dataKey="comments" stroke={VIOLET} fill={VIOLET_FILL} strokeWidth={1.5} />
                <Area type="monotone" dataKey="likes" stroke={CYAN} fill={CYAN_FILL} strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
            {[
              { label: "Views", colour: BRAND },
              { label: "Comments", colour: VIOLET },
              { label: "Likes", colour: CYAN },
            ].map((series) => (
              <span key={series.label} className="flex items-center gap-1.5 text-[11px] text-surface-400">
                <span className="h-2 w-2 rounded-full" style={{ background: series.colour }} />
                {series.label}
              </span>
            ))}
          </div>
        </AdminPanel>

        <AdminPanel title="Views by category" icon={Users} flush bodyClassName="p-3 sm:p-4">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.categories}
                  dataKey="views"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={78}
                  innerRadius={44}
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.categories.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* A legend list rather than a chart label: it stays readable at 320px. */}
          <ul className="mt-2 space-y-1.5">
            {data.categories.slice(0, 5).map((cat, i) => (
              <li key={cat.name} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-2 text-surface-300">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="truncate">{cat.name}</span>
                </span>
                <span className="shrink-0 text-surface-400">{cat.views.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </AdminPanel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AdminPanel title="Top performing posts" icon={TrendingUp} flush>
          <ul className="divide-y divide-surface-800">
            {data.topPosts.slice(0, 8).map((post, i) => (
              <li key={post.slug} className="flex items-center gap-3 px-3.5 py-2.5 sm:px-4">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-brand-500/25 bg-brand-500/10 text-[10px] font-bold text-accent-strong">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-surface-100">{post.title}</p>
                  <p className="truncate text-[11px] text-surface-400">
                    {post.author} · {post.category}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5 text-[11px] text-surface-400">
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {post.views}
                  </span>
                  <span className="hidden items-center gap-1 sm:flex">
                    <MessageSquare className="h-3 w-3" />
                    {post.comments}
                  </span>
                  <span className="hidden items-center gap-1 sm:flex">
                    <Heart className="h-3 w-3" />
                    {post.likes}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </AdminPanel>

        <AdminPanel title="Author performance" icon={Users} flush bodyClassName="p-3 sm:p-4">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.authors.slice(0, 6)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis type="number" tick={AXIS_TICK} stroke={GRID} />
                <YAxis type="category" dataKey="name" tick={AXIS_TICK} width={80} stroke={GRID} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="views" fill={BRAND} radius={[0, 4, 4, 0]} />
                <Bar dataKey="comments" fill={VIOLET} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex items-center justify-center gap-4">
            <span className="flex items-center gap-1.5 text-[11px] text-surface-400">
              <span className="h-2 w-2 rounded-full" style={{ background: BRAND }} /> Views
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-surface-400">
              <span className="h-2 w-2 rounded-full" style={{ background: VIOLET }} /> Comments
            </span>
          </div>
        </AdminPanel>
      </div>

      <AdminPanel title="Daily publishing volume" icon={FileText} flush bodyClassName="p-3 sm:p-4">
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={displayData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={(v) => v.slice(5)} stroke={GRID} />
              <YAxis tick={AXIS_TICK} stroke={GRID} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="posts" fill={BRAND} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </AdminPanel>
    </AdminPage>
  );
}
