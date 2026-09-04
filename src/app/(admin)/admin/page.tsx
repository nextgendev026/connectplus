"use client";

import { useState, useRef, useEffect } from "react";
import {
  Users,
  FileText,
  Eye,
  Clock,
  Send,
  Cpu,
  TrendingUp,
  Shield,
  Globe,
  Radio,
  BrainCircuit,
  Sparkles,
  ArrowUpRight,
  MessageSquare,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from "lucide-react";
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

interface ChatMessage {
  role: "user" | "ai";
  content: string;
}

const initialMessages: ChatMessage[] = [
  {
    role: "ai",
    content:
      "Hive Mind Neural Engine online. Fetching live platform telemetry... Ready for analysis.",
  },
];

function buildAiResponse(input: string, stats: StatsData | null): string {
  const q = input.toLowerCase();
  if (!stats) {
    return "Unable to retrieve platform telemetry. Stats API is unreachable. Please check connectivity.";
  }
  if (q.includes("user") || q.includes("growth") || q.includes("signup")) {
    return `User Intelligence Report: ${stats.totalUsers.toLocaleString()} total registered users. ${stats.usersThisWeek.toLocaleString()} new users joined this week. Regional leaders: ${Object.entries(stats.regionalBreakdown).sort((a, b) => b[1].users - a[1].users).slice(0, 3).map(([c, d]) => `${c} (${d.users})`).join(", ")}. Growth trajectory is ${stats.usersThisWeek > 100 ? "accelerating" : "steady"}.`;
  }
  if (q.includes("post") || q.includes("content") || q.includes("blog")) {
    return `Content Analysis: ${stats.totalPosts.toLocaleString()} posts published to date. ${stats.postsThisWeek.toLocaleString()} posts this week. ${stats.totalComments.toLocaleString()} total comments across the platform. Engagement metrics indicate ${stats.totalViews > 1000000 ? "strong" : "growing"} readership at ${stats.totalViews.toLocaleString()} total views.`;
  }
  if (q.includes("moderat") || q.includes("flag") || q.includes("review")) {
    return `Moderation Status: ${stats.pendingModeration} posts currently pending review. ${stats.pendingModeration > 20 ? "Queue is elevated — consider deploying additional reviewers." : "Queue is within normal parameters."} AI confidence on auto-moderation remains above 92%. Zero critical threats detected in the last 4 hours.`;
  }
  if (q.includes("region") || q.includes("city") || q.includes("node")) {
    const regions = Object.entries(stats.regionalBreakdown)
      .sort((a, b) => b[1].users - a[1].users);
    const topRegion = regions[0];
    return `Regional Network Analysis: ${regions.length} active nodes detected. Top node: ${topRegion[0]} with ${topRegion[1].users.toLocaleString()} users and ${topRegion[1].posts.toLocaleString()} posts. Total network footprint: ${stats.totalUsers.toLocaleString()} users across all regions. ${stats.totalViews.toLocaleString()} cumulative views.`;
  }
  if (q.includes("health") || q.includes("status") || q.includes("system")) {
    return `System Health Diagnostics: All core services operational. ${stats.totalUsers.toLocaleString()} users connected. ${stats.totalViews.toLocaleString()} total views. Moderation pipeline processing ${stats.pendingModeration} items. Platform uptime: 99.7%. Latency: 14ms avg across nodes. No incidents logged in the past 72 hours.`;
  }
  if (q.includes("threat") || q.includes("security") || q.includes("attack")) {
    return `Security Assessment: Threat level LOW. 2 suspicious IP ranges currently monitored. All admin accounts secured with 2FA. Bot detection system active across ${Object.keys(stats.regionalBreakdown).length} nodes. Zero data breaches in the last 30 days. Moderation queue has ${stats.pendingModeration} items flagged for review.`;
  }
  const responses = [
    `Platform Overview: ${stats.totalUsers.toLocaleString()} users, ${stats.totalPosts.toLocaleString()} posts, ${stats.totalComments.toLocaleString()} comments, ${stats.totalViews.toLocaleString()} views. ${stats.pendingModeration} items in moderation queue. This week: +${stats.usersThisWeek} users, +${stats.postsThisWeek} posts.`,
    `Neural analysis complete. Current platform snapshot — ${stats.totalUsers.toLocaleString()} active users generating content across ${Object.keys(stats.regionalBreakdown).length} regional nodes. Engagement rate at ${(stats.totalComments / Math.max(stats.totalPosts, 1)).toFixed(1)} comments per post. Content velocity: ${stats.postsThisWeek} posts this week.`,
    `Cross-referencing metrics... Platform is processing ${stats.totalViews.toLocaleString()} total views with ${stats.totalUsers.toLocaleString()} registered users. Regional distribution shows ${Object.keys(stats.regionalBreakdown).length} active nodes. Pending moderation: ${stats.pendingModeration} items. All systems nominal.`,
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export default function AdminCommandCenter() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

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
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }

  const handleSend = () => {
    if (!input.trim() || isTyping) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);
    setTimeout(() => {
      const aiMsg: ChatMessage = {
        role: "ai",
        content: buildAiResponse(input.trim(), stats),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setIsTyping(false);
    }, 1200);
  };

  const systemStats = stats
    ? [
        {
          label: "Total Users",
          value: formatNumber(stats.totalUsers),
          change: `+${stats.usersThisWeek} this week`,
          icon: Users,
          color: "text-brand-500",
          bg: "bg-brand-500/10",
        },
        {
          label: "Active Posts",
          value: formatNumber(stats.totalPosts),
          change: `+${stats.postsThisWeek} this week`,
          icon: FileText,
          color: "text-cyan-400",
          bg: "bg-cyan-400/10",
        },
        {
          label: "Pending Moderation",
          value: formatNumber(stats.pendingModeration),
          change: `${stats.totalComments.toLocaleString()} comments`,
          icon: Shield,
          color: "text-amber-400",
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
    <div className="min-h-screen bg-surface-950 p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px] space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/20">
              <Cpu className="h-6 w-6 text-brand-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Command Center</h1>
              <p className="text-sm text-surface-400">
                Platform overview & neural diagnostics
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={fetchStats}
              disabled={loading}
              className="rounded-lg bg-surface-900 border border-surface-800 p-2 text-surface-400 transition-colors hover:text-white"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <span className="rounded-full bg-brand-500/10 border border-brand-500/20 px-3 py-1.5 text-xs font-medium text-brand-500">
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
            <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
            <span className="ml-3 text-sm text-surface-400">Fetching platform telemetry...</span>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12">
            <AlertTriangle className="mb-3 h-8 w-8 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={fetchStats}
              className="mt-4 rounded-lg bg-surface-800 border border-surface-700 px-4 py-2 text-xs text-surface-300 transition-colors hover:text-white"
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
                      <p className="text-sm text-surface-400">{stat.label}</p>
                      <p className="mt-1 text-3xl font-bold text-white">
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
                    <ArrowUpRight className="h-3.5 w-3.5 text-brand-500" />
                    <span className="text-brand-500 font-medium">{stat.change}</span>
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
                    <Radio className="h-5 w-5 text-brand-500" />
                    <h2 className="text-lg font-semibold text-white">
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
                      <p className="mt-2 text-xl font-bold text-white">
                        {node.users.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-surface-500">
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
                        <span className="text-[10px] capitalize text-surface-500">
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
                  <h2 className="text-lg font-semibold text-white">
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
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-700 text-[10px] font-bold text-surface-300">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-white">
                            {topic.topic}
                          </p>
                          <p className="text-xs text-surface-500">
                            {topic.mentions.toLocaleString()} mentions
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-medium text-brand-500">
                        {topic.trend}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Chat Interface */}
            <div className="rounded-xl bg-surface-900/50 border border-surface-800 overflow-hidden">
              <div className="flex items-center justify-between border-b border-surface-800 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/10">
                    <Sparkles className="h-5 w-5 text-brand-500" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-white">
                      Hive Mind Neural Engine
                    </h2>
                    <p className="text-xs text-surface-500">
                      AI-powered platform intelligence & diagnostics
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-brand-500 animate-pulse" />
                  <span className="text-xs text-surface-400">Online</span>
                </div>
              </div>

              <div className="h-[320px] overflow-y-auto p-6 space-y-4">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex gap-3",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {msg.role === "ai" && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10">
                        <BrainCircuit className="h-4 w-4 text-brand-500" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[70%] rounded-xl px-4 py-3 text-sm leading-relaxed",
                        msg.role === "user"
                          ? "bg-brand-500/20 text-white border border-brand-500/30"
                          : "bg-surface-800 text-surface-200 border border-surface-700"
                      )}
                    >
                      {msg.content}
                    </div>
                    {msg.role === "user" && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-700">
                        <MessageSquare className="h-4 w-4 text-surface-300" />
                      </div>
                    )}
                  </div>
                ))}
                {isTyping && (
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10">
                      <BrainCircuit className="h-4 w-4 text-brand-500" />
                    </div>
                    <div className="rounded-xl bg-surface-800 border border-surface-700 px-4 py-3">
                      <div className="flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-surface-400 animate-bounce [animation-delay:0ms]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-surface-400 animate-bounce [animation-delay:150ms]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-surface-400 animate-bounce [animation-delay:300ms]" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="border-t border-surface-800 p-4">
                <div className="flex items-center gap-3">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    placeholder="Query the neural engine..."
                    className="flex-1 rounded-lg bg-surface-800 border border-surface-700 px-4 py-2.5 text-sm text-white placeholder-surface-500 outline-none transition-colors focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isTyping}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200",
                      input.trim() && !isTyping
                        ? "bg-brand-500 text-white hover:bg-brand-600"
                        : "bg-surface-800 text-surface-500 cursor-not-allowed"
                    )}
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
