"use client";

import { useState, useEffect } from "react";
import { Search, Trash2, Database, Globe, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

interface Memory {
  id: string;
  source: string;
  category: string;
  content: string;
  tags: string;
  confidence: number;
  sourceUrl?: string;
  createdAt: string;
}

export default function NeuralKnowledgeBase() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(0);
  const limit = 10;

  const fetchMemories = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/admin/neural/memory?${params}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
        setTotal(data.total || 0);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMemories(); }, [page, sourceFilter, categoryFilter]);

  const handleSearch = () => { setPage(0); fetchMemories(); };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this memory entry?")) return;
    try {
      await fetch(`/api/admin/neural/memory/${id}`, { method: "DELETE", credentials: "include" });
      setMemories(prev => prev.filter(m => m.id !== id));
      setTotal(prev => prev - 1);
    } catch {}
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-brand-500" />
        <h3 className="text-sm font-semibold text-surface-50">Knowledge Base</h3>
        <span className="ml-auto rounded-full bg-surface-800 px-2 py-0.5 text-[10px] text-surface-400">{total} entries</span>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Search knowledge..."
            className="w-full rounded-lg bg-surface-800 border border-surface-700 pl-8 pr-3 py-1.5 text-xs text-surface-50 placeholder-surface-500 outline-none focus:border-brand-500/50"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={e => { setSourceFilter(e.target.value); setPage(0); }}
          className="rounded-lg bg-surface-800 border border-surface-700 px-2 py-1.5 text-xs text-surface-300 outline-none"
        >
          <option value="all">All Sources</option>
          <option value="internal">Internal</option>
          <option value="external">External</option>
        </select>
        <select
          value={categoryFilter}
          onChange={e => { setCategoryFilter(e.target.value); setPage(0); }}
          className="rounded-lg bg-surface-800 border border-surface-700 px-2 py-1.5 text-xs text-surface-300 outline-none"
        >
          <option value="all">All Types</option>
          <option value="trend">Trends</option>
          <option value="entity">Entities</option>
          <option value="external_knowledge">Knowledge</option>
        </select>
      </div>

      {loading && memories.length === 0 && (
        <div className="text-center py-4 text-xs text-surface-500">Loading...</div>
      )}

      <div className="space-y-2 max-h-[300px] overflow-y-auto">
        {memories.map(m => (
          <div key={m.id} className="group rounded-lg border border-surface-800 bg-surface-800/30 p-2.5 transition-all hover:border-surface-700">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {m.source === "external" ? <Globe className="h-3 w-3 text-green-400" /> : <Cpu className="h-3 w-3 text-blue-400" />}
                  <span className="rounded bg-surface-700 px-1.5 py-0.5 text-[9px] font-medium text-surface-300">{m.category}</span>
                  <span className="text-[9px] text-surface-500">confidence: {(m.confidence * 100).toFixed(0)}%</span>
                </div>
                <p className="mt-1 text-[11px] text-surface-400 line-clamp-2">{m.content}</p>
                <p className="mt-0.5 text-[9px] text-surface-600 truncate">{m.tags}</p>
              </div>
              <button
                onClick={() => handleDelete(m.id)}
                className="shrink-0 rounded p-1 text-surface-600 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="text-[11px] text-surface-400 hover:text-surface-50 disabled:opacity-30">← Prev</button>
          <span className="text-[10px] text-surface-500">Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="text-[11px] text-surface-400 hover:text-surface-50 disabled:opacity-30">Next →</button>
        </div>
      )}
    </div>
  );
}
