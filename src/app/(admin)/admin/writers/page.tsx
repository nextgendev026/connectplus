"use client";

import { useState, useEffect } from "react";
import {
  PenLine,
  BadgeCheck,
  X,
  Check,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Mail,
  FileText,
  Calendar,
  ShieldCheck,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";

type AppStatus = "PENDING" | "APPROVED" | "REJECTED";

interface WriterApplication {
  id: string;
  status: AppStatus;
  motivation: string;
  portfolio: string | null;
  reviewedNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    username: string;
    avatar: string | null;
    email: string;
    role: string;
    isVerified: boolean;
    emailVerified: string | null;
    _count: { posts: number };
  };
}

const statusConfig: Record<
  AppStatus,
  { label: string; className: string; dot: string }
> = {
  PENDING: {
    label: "Pending",
    className: "bg-amber-400/10 text-amber-400 border-amber-400/25",
    dot: "bg-amber-400",
  },
  APPROVED: {
    label: "Approved",
    className: "bg-emerald-400/10 text-emerald-400 border-emerald-400/25",
    dot: "bg-emerald-400",
  },
  REJECTED: {
    label: "Rejected",
    className: "bg-red-400/10 text-red-400 border-red-400/25",
    dot: "bg-red-400",
  },
};

const avatarColors = [
  "bg-brand-500/20 text-accent-strong",
  "bg-cyan-400/20 text-cyan-400",
  "bg-purple-400/20 text-purple-400",
  "bg-amber-400/20 text-amber-400",
];
const getAvatarColor = (index: number) => avatarColors[index % avatarColors.length];

export default function WriterApplicationsAdmin() {
  const [applications, setApplications] = useState<WriterApplication[]>([]);
  const [filter, setFilter] = useState<AppStatus | "all">("PENDING");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WriterApplication | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchApplications();
  }, []);

  async function fetchApplications() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/writer-applications", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch applications (${res.status})`);
      const data = await res.json();
      setApplications(Array.isArray(data.applications) ? data.applications : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }

  function openApp(app: WriterApplication) {
    setSelected(app);
    setNote("");
  }

  async function decide(action: "approve" | "reject") {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/writer-applications/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, note: action === "reject" ? note.trim() : "" }),
      });
      if (!res.ok) throw new Error("Update failed");
      await fetchApplications();
      setSelected(null);
    } catch {
      setError("Failed to update the application. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const filtered = applications.filter((a) => filter === "all" || a.status === filter);
  const counts = {
    all: applications.length,
    PENDING: applications.filter((a) => a.status === "PENDING").length,
    APPROVED: applications.filter((a) => a.status === "APPROVED").length,
    REJECTED: applications.filter((a) => a.status === "REJECTED").length,
  };

  const tabs: { key: AppStatus | "all"; label: string }[] = [
    { key: "PENDING", label: `Pending (${counts.PENDING})` },
    { key: "APPROVED", label: `Approved (${counts.APPROVED})` },
    { key: "REJECTED", label: `Rejected (${counts.REJECTED})` },
    { key: "all", label: `All (${counts.all})` },
  ];

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/25">
              <PenLine className="h-6 w-6 text-accent-strong" />
            </div>
            <div>
              <h1 className="type-display text-surface-50">Verified Writer Applications</h1>
              <p className="text-sm font-medium text-surface-300">
                Review requests — approving grants the verified badge &amp; direct publishing
              </p>
            </div>
          </div>
          <button
            onClick={fetchApplications}
            disabled={loading}
            className="rounded-lg bg-surface-900 border border-surface-800 p-2 text-surface-400 transition-colors hover:text-surface-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-accent-strong" />
            <span className="ml-3 text-sm font-medium text-surface-300">Loading applications...</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12">
            <AlertTriangle className="mb-3 h-8 w-8 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={fetchApplications}
              className="mt-4 rounded-lg bg-surface-800 border border-surface-700 px-4 py-2 text-xs text-surface-300 transition-colors hover:text-surface-50"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="flex flex-wrap gap-2">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setFilter(t.key)}
                  className={cn(
                    "rounded-lg px-4 py-2 text-xs font-medium transition-colors",
                    filter === t.key
                      ? "bg-brand-500 text-white"
                      : "bg-surface-900 border border-surface-800 text-surface-300 hover:text-surface-50"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="rounded-xl bg-surface-900/50 border border-surface-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-800">
                      <th className="px-5 py-3 text-left text-xs font-medium text-surface-400">Applicant</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-surface-400">Application</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-surface-400">Status</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-surface-400">Submitted</th>
                      <th className="px-5 py-3 text-right text-xs font-medium text-surface-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-800/50">
                    {filtered.map((app, i) => (
                      <tr
                        key={app.id}
                        className="group cursor-pointer transition-colors hover:bg-surface-800/30"
                        onClick={() => openApp(app)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                                getAvatarColor(i)
                              )}
                            >
                              {app.user.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-surface-50 flex items-center gap-1.5">
                                {app.user.name}
                                {app.user.isVerified && (
                                  <BadgeCheck className="h-3.5 w-3.5 text-accent-strong" />
                                )}
                              </p>
                              <p className="truncate text-xs text-surface-500">
                                @{app.user.username} · {app.user._count.posts} posts
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 max-w-[320px]">
                          <p className="truncate text-xs text-surface-400">{app.motivation}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 type-caption border",
                              statusConfig[app.status].className
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 rounded-full", statusConfig[app.status].dot)} />
                            {statusConfig[app.status].label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-xs font-medium text-surface-300">
                          {formatDate(app.createdAt)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openApp(app);
                            }}
                            className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-50"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16">
                  <PenLine className="mb-3 h-8 w-8 text-surface-600" />
                  <p className="text-sm font-medium text-surface-300">No applications here</p>
                </div>
              )}
            </div>
          </>
        )}

        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl bg-surface-900 border border-surface-800 shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-surface-800 px-6 py-4">
                <h2 className="type-h2 text-surface-50">Application Review</h2>
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-base font-bold text-accent-strong">
                    {selected.user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-bold text-surface-50 flex items-center gap-1.5">
                      {selected.user.name}
                      {selected.user.isVerified && (
                        <BadgeCheck className="h-4 w-4 text-accent-strong" />
                      )}
                    </p>
                    <p className="text-sm font-medium text-surface-400">@{selected.user.username}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-500">
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {selected.user.email}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck
                          className={cn(
                            "h-3 w-3",
                            selected.user.emailVerified ? "text-emerald-400" : "text-red-400"
                          )}
                        />
                        {selected.user.emailVerified ? "Email verified" : "Email unverified"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-surface-800/50 border border-surface-800 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <FileText className="h-3 w-3 text-surface-500" />
                      <span className="type-caption text-surface-500">Posts</span>
                    </div>
                    <p className="text-sm font-bold text-surface-50 tabular-nums">
                      {selected.user._count.posts}
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface-800/50 border border-surface-800 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Calendar className="h-3 w-3 text-surface-500" />
                      <span className="type-caption text-surface-500">Submitted</span>
                    </div>
                    <p className="text-sm font-bold text-surface-50">{formatDate(selected.createdAt)}</p>
                  </div>
                  <div className="rounded-lg bg-surface-800/50 border border-surface-800 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                      <span className="type-caption text-surface-500">Status</span>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 type-caption border",
                        statusConfig[selected.status].className
                      )}
                    >
                      {statusConfig[selected.status].label}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-surface-400 mb-1.5">Motivation</label>
                  <p className="whitespace-pre-wrap rounded-xl bg-surface-800/40 border border-surface-800 p-4 text-sm text-surface-200 leading-relaxed max-h-40 overflow-y-auto">
                    {selected.motivation}
                  </p>
                </div>

                {selected.portfolio && (
                  <div>
                    <label className="block text-xs font-medium text-surface-400 mb-1.5">Portfolio / Links</label>
                    <p className="whitespace-pre-wrap rounded-xl bg-surface-800/40 border border-surface-800 p-4 text-sm text-surface-200 leading-relaxed">
                      {selected.portfolio}
                    </p>
                  </div>
                )}

                {selected.status !== "PENDING" && selected.reviewedNote && (
                  <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                    <p className="type-caption text-amber-400 mb-1">
                      Admin note ({formatDate(selected.reviewedAt ?? "")})
                    </p>
                    <p className="text-sm text-surface-200">{selected.reviewedNote}</p>
                  </div>
                )}

                {selected.status === "PENDING" && (
                  <div>
                    <label className="block text-xs font-medium text-surface-400 mb-1.5">
                      Note to applicant (required when rejecting)
                    </label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="e.g. Share more of your writing so we can review your voice…"
                      className="w-full rounded-xl bg-surface-800/50 border border-surface-700/50 px-4 py-3 text-sm text-surface-50 placeholder:text-surface-600 outline-none transition-colors focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20"
                      rows={3}
                      maxLength={500}
                    />
                  </div>
                )}
              </div>

              {selected.status === "PENDING" && (
                <div className="flex items-center gap-2 border-t border-surface-800 px-6 py-4">
                  <button
                    disabled={busy}
                    onClick={() => decide("approve")}
                    className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-4 py-2 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Approve &amp; Grant Badge
                  </button>
                  <button
                    disabled={busy || note.trim().length === 0}
                    onClick={() => decide("reject")}
                    className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/25 px-4 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                    Reject
                  </button>
                  <button
                    onClick={() => setSelected(null)}
                    className="ml-auto rounded-lg bg-surface-800 border border-surface-700 px-4 py-2 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-700 hover:text-surface-50"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}