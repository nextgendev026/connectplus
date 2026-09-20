"use client";

import { useState, useEffect } from "react";
import {
  Shield,
  CheckCircle,
  XCircle,
  AlertTriangle,
  BrainCircuit,
  Filter,
  Eye,
  Search,
  Flag,
  User,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

interface ModerationItem {
  id: string;
  title: string;
  content: string;
  status: "pending" | "flagged" | "rejected" | "approved";
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string;
    username: string;
    image?: string | null;
  };
}

type FilterTab = "review" | "pending" | "flagged" | "rejected" | "approved";

type FilterCounts = Record<FilterTab, number>;

const EMPTY_COUNTS: FilterCounts = { review: 0, pending: 0, flagged: 0, rejected: 0, approved: 0 };

export default function ModerationQueue() {
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [counts, setCounts] = useState<FilterCounts>(EMPTY_COUNTS);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Opens on the review queue (pending + flagged) rather than the whole table:
  // those are the only rows that need a decision.
  const [activeFilter, setActiveFilter] = useState<FilterTab>("review");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedDetail, setSelectedDetail] = useState<ModerationItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchItems(activeFilter);
  }, [activeFilter]);

  async function fetchItems(filter: FilterTab) {
    try {
      setLoading(true);
      setError(null);
      // The status is a server-side filter, so the payload is one page of one
      // bucket rather than every post in the platform.
      const res = await fetch(`/api/admin/moderation?status=${filter}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch moderation queue (${res.status})`);
      const data = await res.json();
      if (data.counts) {
        setCounts({
          review: data.counts.review ?? 0,
          pending: data.counts.pending ?? 0,
          flagged: data.counts.flagged ?? 0,
          rejected: data.counts.rejected ?? 0,
          approved: data.counts.approved ?? 0,
        });
      }
      setTruncated(Boolean(data.truncated));
      const posts = Array.isArray(data) ? data : data.posts ?? [];
      setItems(
        posts.map((p: {
          id: string;
          title: string;
          content: string;
          moderationStatus?: string;
          createdAt: string;
          updatedAt: string;
          author?: { id: string; name: string; username: string; avatar?: string | null };
        }): ModerationItem => ({
          id: p.id,
          title: p.title,
          content: p.content,
          status: (p.moderationStatus ?? "PENDING").toLowerCase() as ModerationItem["status"],
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          author: {
            id: p.author?.id ?? "",
            name: p.author?.name ?? "Unknown",
            username: p.author?.username ?? "unknown",
            image: p.author?.avatar ?? null,
          },
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load moderation queue");
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(id: string, action: "approve" | "flag" | "reject", reason?: string) {
    try {
      setActionLoading(id);
      const res = await fetch("/api/admin/moderation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ postId: id, action, reason }),
      });
      if (!res.ok) throw new Error("Action failed");
      // Refetch the active bucket instead of patching in place: a decided item
      // leaves the review queue, and the tab badges have changed. Patching only
      // the row would leave the console showing work that is already done.
      const decided = action === "approve" ? "approved" : action === "reject" ? "rejected" : "flagged";
      if (selectedDetail?.id === id) {
        setSelectedDetail((prev) => (prev ? { ...prev, status: decided } : prev));
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
      await fetchItems(activeFilter);
    } catch {
    } finally {
      setActionLoading(null);
    }
  }

  async function handleBulkAction(action: "approve" | "reject") {
    const ids = Array.from(selectedItems);
    for (const id of ids) {
      await handleAction(id, action);
    }
    setSelectedItems(new Set());
  }

  const filteredItems = items.filter((item) => {
    // Status is filtered server-side now; only the free-text search is local.
    return (
      !searchQuery ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.author.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.author.username.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const toggleSelect = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((i) => i.id)));
    }
  };

  const filterCounts = counts;

  const filterTabs: { label: string; value: FilterTab }[] = [
    { label: "Review", value: "review" },
    { label: "Pending", value: "pending" },
    { label: "Flagged", value: "flagged" },
    { label: "Rejected", value: "rejected" },
    { label: "Approved", value: "approved" },
  ];

  const statusConfig: Record<string, { color: string; bg: string; border: string }> = {
    pending: { color: "text-warning-strong", bg: "bg-amber-500/15", border: "border-amber-500/25" },
    flagged: { color: "text-danger-strong", bg: "bg-red-500/15", border: "border-red-500/25" },
    rejected: { color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" },
    approved: { color: "text-accent-strong", bg: "bg-brand-500/10", border: "border-brand-500/20" },
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-400/10 border border-amber-400/20">
              <Shield className="h-6 w-6 text-warning-strong" />
            </div>
            <div>
              <h1 className="type-display text-surface-50">Moderation Queue</h1>
              <p className="text-sm font-medium text-surface-300">
                AI-assisted content review & community safety
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchItems(activeFilter)}
              disabled={loading}
              className="rounded-lg bg-surface-900 border border-surface-800 p-2 text-surface-400 transition-colors hover:text-surface-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <span className="rounded-full bg-amber-400/10 border border-amber-400/20 px-3 py-1.5 text-xs font-medium text-warning-strong">
              <BrainCircuit className="mr-1 inline-block h-3.5 w-3.5" />
              AI Moderation Active
            </span>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-accent-strong" />
            <span className="ml-3 text-sm font-medium text-surface-300">Loading moderation queue...</span>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12">
            <AlertTriangle className="mb-3 h-8 w-8 text-danger-strong" />
            <p className="text-sm text-danger-strong">{error}</p>
            <button
              onClick={() => fetchItems(activeFilter)}
              className="mt-4 rounded-lg bg-surface-800 border border-surface-700 px-4 py-2 text-xs text-surface-300 transition-colors hover:text-surface-50"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Filter Tabs & Search */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex w-full flex-wrap items-center gap-1 rounded-lg bg-surface-900 border border-surface-800 p-1 sm:w-auto">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => setActiveFilter(tab.value)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200",
                      activeFilter === tab.value
                        ? "bg-surface-800 text-surface-50 shadow-sm"
                        : "text-surface-400 hover:text-surface-200"
                    )}
                  >
                    {tab.label}
                    <span
                      className={cn(
                        "ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 type-caption font-bold",
                        activeFilter === tab.value
                          ? "bg-brand-500/20 text-accent-strong"
                          : "bg-surface-800 text-surface-500"
                      )}
                    >
                      {filterCounts[tab.value]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex w-full items-center gap-3 sm:w-auto">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-500" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search content..."
                    className="h-9 w-full rounded-lg bg-surface-900 border border-surface-800 pl-9 pr-3 text-sm text-surface-50 placeholder-surface-500 outline-none transition-colors focus:border-brand-500/50 sm:h-8 sm:w-56 sm:text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Capped list notice — the console says what it is not showing. */}
            {truncated && (
              <div className="rounded-lg border border-surface-800 bg-surface-900/60 px-4 py-2.5 text-xs text-surface-400">
                Showing the first page of this bucket. Narrow the filter to see the rest — the
                counts above are the full totals.
              </div>
            )}

            {/* Bulk Actions */}
            {selectedItems.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-brand-500/5 border border-brand-500/20 px-4 py-2.5">
                <span className="text-xs text-accent-strong font-medium">
                  {selectedItems.size} selected
                </span>
                <button
                  onClick={() => handleBulkAction("approve")}
                  className="rounded-md bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-accent-strong transition-colors hover:bg-brand-500/20"
                >
                  Approve All
                </button>
                <button
                  onClick={() => handleBulkAction("reject")}
                  className="rounded-md bg-red-500/10 px-3 py-1.5 text-xs font-medium text-danger-strong transition-colors hover:bg-red-500/20"
                >
                  Reject All
                </button>
                <button
                  onClick={() => setSelectedItems(new Set())}
                  className="ml-auto text-xs font-medium text-surface-400 hover:text-surface-200"
                >
                  Clear selection
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
              {/* Moderation List */}
              <div className="space-y-3">
                {/* Select-all, reachable on a phone.
                 *
                 * The only place to select everything was the table header, and
                 * that is hidden below `lg` (it is an 880px row). Bulk moderation
                 * therefore existed on desktop only. This keeps the ability where
                 * the reader can reach it. */}
                <div className="flex items-center gap-2 px-2 lg:hidden">
                  <input
                    type="checkbox"
                    checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-surface-700 bg-surface-800 accent-brand-500"
                    aria-label="Select all items in this view"
                  />
                  <span className="text-xs text-surface-400">
                    {selectedItems.size > 0 ? `${selectedItems.size} selected` : "Select all"}
                  </span>
                </div>

                {/* Table Header — desktop only.
                 *
                 * It used to render at every width inside an `overflow-x-auto`,
                 * so a phone had to pan an 880px row sideways to reach the
                 * Approve and Reject buttons in the last column. Panning to act
                 * on a moderation queue is not a workable layout; the list below
                 * becomes cards at this width instead. */}
                <div className="hidden overflow-x-auto rounded-lg lg:block">
                <div className="grid min-w-[880px] grid-cols-[32px_1fr_140px_100px_80px_100px] gap-4 rounded-lg bg-surface-900 border border-surface-800 px-4 py-2.5 text-xs font-medium text-surface-400">
                  <div>
                    <input
                      type="checkbox"
                      checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 rounded border-surface-700 bg-surface-800 accent-brand-500"
                    />
                  </div>
                  <div>Content</div>
                  <div>Author</div>
                  <div>Status</div>
                  <div>Time</div>
                  <div>Actions</div>
                </div>
                </div>

                <div className="max-h-[540px] space-y-3 overflow-y-auto overscroll-contain pr-1 scroll-smooth">
                {filteredItems.map((item) => {
                  const st = statusConfig[item.status] ?? statusConfig.pending!;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedDetail(item)}
                      className={cn(
                        "group cursor-pointer rounded-lg border px-4 py-3 transition-all duration-200",
                        // Stacked card on a phone, the dense row from `lg` up. The
                        // two layouts share one DOM tree so there is no second
                        // copy of the moderation logic to keep in step.
                        "lg:grid lg:min-w-[880px] lg:grid-cols-[32px_1fr_140px_100px_80px_100px] lg:items-center lg:gap-4",
                        selectedDetail?.id === item.id
                          ? "border-brand-500/30 bg-surface-900/80"
                          : "border-surface-800 bg-surface-900/50 hover:border-surface-700 hover:bg-surface-900/70",
                        item.status === "approved" && "opacity-60"
                      )}
                    >
                      <div className="hidden lg:flex lg:items-start lg:pt-0.5">
                        <input
                          type="checkbox"
                          checked={selectedItems.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 rounded border-surface-700 bg-surface-800 accent-brand-500 lg:h-3.5 lg:w-3.5"
                          aria-label={`Select ${item.title}`}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-start gap-2.5">
                          {/* The checkbox rides with the title on a phone rather
                              than owning a row of its own. */}
                          <input
                            type="checkbox"
                            checked={selectedItems.has(item.id)}
                            onChange={() => toggleSelect(item.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-surface-700 bg-surface-800 accent-brand-500 lg:hidden"
                            aria-label={`Select ${item.title}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium text-surface-50">
                                {item.title}
                              </p>
                              {item.status === "approved" && (
                                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-accent-strong" />
                              )}
                              {item.status === "rejected" && (
                                <XCircle className="h-3.5 w-3.5 shrink-0 text-danger-strong" />
                              )}
                            </div>
                            <p className="mt-0.5 truncate type-caption text-surface-500">
                              {item.content?.slice(0, 80) ?? ""}
                            </p>
                          </div>
                        </div>
                      </div>
                      {/* Author, status and time share one wrapped row on a phone
                          and dissolve into their own grid columns on desktop —
                          `lg:contents` is what lets one tree be both. */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 lg:contents">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-700 type-caption font-bold text-surface-200">
                            {item.author.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-surface-200">
                              {item.author.name}
                            </p>
                            <p className="type-caption text-surface-400">
                              @{item.author.username}
                            </p>
                          </div>
                        </div>
                        <div>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 type-caption border",
                              st.bg,
                              st.color,
                              st.border
                            )}
                          >
                            {item.status}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-surface-300">{timeAgo(item.createdAt)}</p>
                        </div>
                      </div>
                      {/* Labelled, full-width buttons on a phone — an icon-only
                          control is not reliably tappable at this size, and the
                          decision being made here is not one to guess at. */}
                      <div className="mt-3 flex items-center gap-2 border-t border-surface-800/70 pt-3 lg:mt-0 lg:gap-1 lg:border-0 lg:pt-0">
                        {item.status !== "approved" && item.status !== "rejected" && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAction(item.id, "approve");
                              }}
                              disabled={actionLoading === item.id}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-brand-500/20 bg-brand-500/10 px-3 py-2 type-meta font-medium text-accent-strong transition-colors hover:bg-brand-500/20 disabled:opacity-50 lg:flex-none lg:border-0 lg:bg-transparent lg:p-1.5 lg:text-surface-500 lg:hover:bg-brand-500/10 lg:hover:text-accent-strong"
                              title="Approve"
                            >
                              <CheckCircle className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
                              <span className="lg:hidden">Approve</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAction(item.id, "reject");
                              }}
                              disabled={actionLoading === item.id}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 type-meta font-medium text-danger-strong transition-colors hover:bg-red-500/20 disabled:opacity-50 lg:flex-none lg:border-0 lg:bg-transparent lg:p-1.5 lg:text-surface-500 lg:hover:bg-red-500/10 lg:hover:text-danger-strong"
                              title="Reject"
                            >
                              <XCircle className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
                              <span className="lg:hidden">Reject</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {filteredItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-surface-800 bg-surface-900/50 py-16">
                    <Filter className="mb-3 h-8 w-8 text-surface-400" />
                    <p className="text-sm font-medium text-surface-300">No items match your filters</p>
                  </div>
                )}
                </div>
              </div>

              {/* Detail Sidebar */}
              <div className="space-y-4">
                {selectedDetail ? (
                  <>
                    {/* Post Detail */}
                    <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-5">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-surface-500 font-mono">
                          {selectedDetail.id}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 type-caption border",
                            (statusConfig[selectedDetail.status] ?? statusConfig.pending!).bg,
                            (statusConfig[selectedDetail.status] ?? statusConfig.pending!).color,
                            (statusConfig[selectedDetail.status] ?? statusConfig.pending!).border
                          )}
                        >
                          {selectedDetail.status}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-surface-50 mb-2">
                        {selectedDetail.title}
                      </h3>
                      <p className="text-xs text-surface-400 leading-relaxed mb-3">
                        {selectedDetail.content}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-surface-500">
                        <User className="h-3 w-3" />
                        <span>{selectedDetail.author.name}</span>
                        <span className="text-surface-300">|</span>
                        <span>@{selectedDetail.author.username}</span>
                        <span className="text-surface-300">|</span>
                        <span>{timeAgo(selectedDetail.createdAt)}</span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    {(selectedDetail.status === "pending" ||
                      selectedDetail.status === "flagged") && (
                      <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-4">
                        <p className="text-xs font-medium text-surface-400 mb-3">
                          Actions
                        </p>
                        <div className="space-y-2">
                          <button
                            onClick={() => handleAction(selectedDetail.id, "approve")}
                            disabled={actionLoading === selectedDetail.id}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500/10 border border-brand-500/20 px-4 py-2 text-xs font-medium text-accent-strong transition-colors hover:bg-brand-500/20 disabled:opacity-50"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                            Approve Content
                          </button>
                          <button
                            onClick={() => handleAction(selectedDetail.id, "flag")}
                            disabled={actionLoading === selectedDetail.id}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400/10 border border-amber-400/20 px-4 py-2 text-xs font-medium text-warning-strong transition-colors hover:bg-amber-400/20 disabled:opacity-50"
                          >
                            <Flag className="h-3.5 w-3.5" />
                            Flag for Review
                          </button>
                          <button
                            onClick={() => handleAction(selectedDetail.id, "reject")}
                            disabled={actionLoading === selectedDetail.id}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-xs font-medium text-danger-strong transition-colors hover:bg-red-500/20 disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Reject Content
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedDetail.status === "approved" ||
                    selectedDetail.status === "rejected" ? (
                      <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-5 text-center">
                        <CheckCircle className="mx-auto mb-2 h-8 w-8 text-accent-strong" />
                        <p className="text-sm font-medium text-surface-50">
                          Already Reviewed
                        </p>
                        <p className="text-xs text-surface-500 mt-1">
                          Status: {selectedDetail.status}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-xl bg-surface-900/50 border border-surface-800 p-8 text-center">
                    <Eye className="mx-auto mb-3 h-8 w-8 text-surface-400" />
                    <p className="text-sm font-medium text-surface-400">
                      Select an item to view details
                    </p>
                    <p className="text-xs text-surface-400 mt-1">
                      Click any row to see details
                    </p>
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
