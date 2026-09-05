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

type FilterTab = "all" | "pending" | "flagged" | "rejected" | "approved";

export default function ModerationQueue() {
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [selectedDetail, setSelectedDetail] = useState<ModerationItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchItems();
  }, []);

  async function fetchItems() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/moderation", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to fetch moderation queue (${res.status})`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : data.posts ?? []);
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
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "flagged", updatedAt: new Date().toISOString() }
            : item
        )
      );
      if (selectedDetail?.id === id) {
        setSelectedDetail((prev) =>
          prev ? { ...prev, status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "flagged" } : prev
        );
      }
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
    const matchesFilter = activeFilter === "all" || item.status === activeFilter;
    const matchesSearch =
      !searchQuery ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.author.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.author.username.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
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

  const filterCounts = {
    all: items.length,
    pending: items.filter((i) => i.status === "pending").length,
    flagged: items.filter((i) => i.status === "flagged").length,
    rejected: items.filter((i) => i.status === "rejected").length,
    approved: items.filter((i) => i.status === "approved").length,
  };

  const filterTabs: { label: string; value: FilterTab }[] = [
    { label: "All", value: "all" },
    { label: "Pending", value: "pending" },
    { label: "Flagged", value: "flagged" },
    { label: "Rejected", value: "rejected" },
    { label: "Approved", value: "approved" },
  ];

  const statusConfig: Record<string, { color: string; bg: string; border: string }> = {
    pending: { color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
    flagged: { color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/20" },
    rejected: { color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" },
    approved: { color: "text-brand-500", bg: "bg-brand-500/10", border: "border-brand-500/20" },
  };

  return (
    <div className="min-h-screen bg-surface-950 p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-400/10 border border-amber-400/20">
              <Shield className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-50">Moderation Queue</h1>
              <p className="text-sm text-surface-400">
                AI-assisted content review & community safety
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchItems}
              disabled={loading}
              className="rounded-lg bg-surface-900 border border-surface-800 p-2 text-surface-400 transition-colors hover:text-surface-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <span className="rounded-full bg-amber-400/10 border border-amber-400/20 px-3 py-1.5 text-xs font-medium text-amber-400">
              <BrainCircuit className="mr-1 inline-block h-3.5 w-3.5" />
              AI Moderation Active
            </span>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
            <span className="ml-3 text-sm text-surface-400">Loading moderation queue...</span>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12">
            <AlertTriangle className="mb-3 h-8 w-8 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={fetchItems}
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
              <div className="flex items-center gap-1 rounded-lg bg-surface-900 border border-surface-800 p-1">
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
                        "ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                        activeFilter === tab.value
                          ? "bg-brand-500/20 text-brand-500"
                          : "bg-surface-800 text-surface-500"
                      )}
                    >
                      {filterCounts[tab.value]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-500" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search content..."
                    className="h-8 w-56 rounded-lg bg-surface-900 border border-surface-800 pl-9 pr-3 text-xs text-surface-50 placeholder-surface-500 outline-none transition-colors focus:border-brand-500/50"
                  />
                </div>
              </div>
            </div>

            {/* Bulk Actions */}
            {selectedItems.size > 0 && (
              <div className="flex items-center gap-3 rounded-lg bg-brand-500/5 border border-brand-500/20 px-4 py-2.5">
                <span className="text-xs text-brand-500 font-medium">
                  {selectedItems.size} selected
                </span>
                <button
                  onClick={() => handleBulkAction("approve")}
                  className="rounded-md bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-500 transition-colors hover:bg-brand-500/20"
                >
                  Approve All
                </button>
                <button
                  onClick={() => handleBulkAction("reject")}
                  className="rounded-md bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
                >
                  Reject All
                </button>
                <button
                  onClick={() => setSelectedItems(new Set())}
                  className="ml-auto text-xs text-surface-500 hover:text-surface-300"
                >
                  Clear selection
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
              {/* Moderation List */}
              <div className="space-y-3">
                {/* Table Header */}
                <div className="grid grid-cols-[32px_1fr_140px_100px_80px_100px] gap-4 rounded-lg bg-surface-900 border border-surface-800 px-4 py-2.5 text-xs font-medium text-surface-500">
                  <div>
                    <input
                      type="checkbox"
                      checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 rounded border-surface-600 bg-surface-800 accent-brand-500"
                    />
                  </div>
                  <div>Content</div>
                  <div>Author</div>
                  <div>Status</div>
                  <div>Time</div>
                  <div>Actions</div>
                </div>

                {filteredItems.map((item) => {
                  const st = statusConfig[item.status] ?? statusConfig.pending!;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedDetail(item)}
                      className={cn(
                        "group grid grid-cols-[32px_1fr_140px_100px_80px_100px] gap-4 rounded-lg border px-4 py-3 transition-all duration-200 cursor-pointer",
                        selectedDetail?.id === item.id
                          ? "border-brand-500/30 bg-surface-900/80"
                          : "border-surface-800 bg-surface-900/50 hover:border-surface-700 hover:bg-surface-900/70",
                        item.status === "approved" && "opacity-60"
                      )}
                    >
                      <div className="flex items-start pt-0.5">
                        <input
                          type="checkbox"
                          checked={selectedItems.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 rounded border-surface-600 bg-surface-800 accent-brand-500"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-surface-50">
                            {item.title}
                          </p>
                          {item.status === "approved" && (
                            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-brand-500" />
                          )}
                          {item.status === "rejected" && (
                            <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[10px] text-surface-500">
                          {item.content?.slice(0, 80) ?? ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-700 text-[10px] font-bold text-surface-300">
                          {item.author.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-xs text-surface-300">
                            {item.author.name}
                          </p>
                          <p className="text-[10px] text-surface-600">
                            @{item.author.username}
                          </p>
                        </div>
                      </div>
                      <div>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
                            st.bg,
                            st.color,
                            st.border
                          )}
                        >
                          {item.status}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-surface-400">{timeAgo(item.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {item.status !== "approved" && item.status !== "rejected" && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAction(item.id, "approve");
                              }}
                              disabled={actionLoading === item.id}
                              className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-brand-500/10 hover:text-brand-500 disabled:opacity-50"
                              title="Approve"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAction(item.id, "reject");
                              }}
                              disabled={actionLoading === item.id}
                              className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                              title="Reject"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {filteredItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-surface-800 bg-surface-900/50 py-16">
                    <Filter className="mb-3 h-8 w-8 text-surface-600" />
                    <p className="text-sm text-surface-400">No items match your filters</p>
                  </div>
                )}
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
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
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
                        <span className="text-surface-700">|</span>
                        <span>@{selectedDetail.author.username}</span>
                        <span className="text-surface-700">|</span>
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
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500/10 border border-brand-500/20 px-4 py-2 text-xs font-medium text-brand-500 transition-colors hover:bg-brand-500/20 disabled:opacity-50"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                            Approve Content
                          </button>
                          <button
                            onClick={() => handleAction(selectedDetail.id, "flag")}
                            disabled={actionLoading === selectedDetail.id}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400/10 border border-amber-400/20 px-4 py-2 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-400/20 disabled:opacity-50"
                          >
                            <Flag className="h-3.5 w-3.5" />
                            Flag for Review
                          </button>
                          <button
                            onClick={() => handleAction(selectedDetail.id, "reject")}
                            disabled={actionLoading === selectedDetail.id}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
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
                        <CheckCircle className="mx-auto mb-2 h-8 w-8 text-brand-500" />
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
                    <Eye className="mx-auto mb-3 h-8 w-8 text-surface-600" />
                    <p className="text-sm text-surface-400">
                      Select an item to view details
                    </p>
                    <p className="text-xs text-surface-600 mt-1">
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
