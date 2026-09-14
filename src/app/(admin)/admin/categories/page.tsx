"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderTree, Plus, Trash2, Loader2, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AdminBadge,
  AdminEmpty,
  AdminNotice,
  AdminPage,
  AdminPanel,
  adminBtnPrimary,
  adminInput,
} from "@/components/admin/AdminUI";

interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/content?limit=1", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setCategories(data.categories ?? []);
      setError(null);
    } catch {
      setError("Could not load categories.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create category");
      setName("");
      setIcon("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create category");
    } finally {
      setSaving(false);
    }
  }

  async function remove(category: Category) {
    if (!confirm(`Delete “${category.name}”? Posts keep their content but lose this category.`)) return;
    setCategories((prev) => prev.filter((c) => c.id !== category.id));
    await fetch(`/api/admin/content?id=${encodeURIComponent(category.id)}`, { method: "DELETE" }).catch(() => {});
    void load();
  }

  return (
    <AdminPage
      title="Categories"
      description="The editorial taxonomy behind the feed, trending topics and fetched stories."
      icon={FolderTree}
    >
      {error ? <AdminNotice>{error}</AdminNotice> : null}

      <AdminPanel
        title="New category"
        description="Shown to readers as a feed section."
        icon={Plus}
      >
        {/* Stacked on a phone, one row from `sm` up: three controls side by side
            is a 320px-wide squeeze that clipped the placeholder text. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Category name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
              placeholder="Category name, e.g. Fintech"
              className={adminInput}
            />
          </label>
          <label className="sm:w-44">
            <span className="sr-only">Icon</span>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="Icon (emoji, optional)"
              className={adminInput}
            />
          </label>
          <button
            onClick={() => void create()}
            disabled={saving || !name.trim()}
            className={cn(adminBtnPrimary, "sm:w-auto")}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create
          </button>
        </div>
      </AdminPanel>

      <AdminPanel flush>
        <div className="flex items-center justify-between border-b border-surface-800 px-3.5 py-2.5 sm:px-4">
          <h2 className="text-sm font-semibold text-surface-100">All categories</h2>
          <AdminBadge tone="neutral">{categories.length} live</AdminBadge>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-surface-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : categories.length === 0 ? (
          <AdminEmpty
            icon={FolderTree}
            title="No categories yet"
            description="Create one above and it appears in the reader-facing feed immediately."
          />
        ) : (
          <ul className="divide-y divide-surface-800">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3.5 py-3 sm:px-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-surface-800 bg-surface-800/60 text-sm">
                    {c.icon || <Hash className="h-4 w-4 text-surface-400" />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-surface-50">{c.name}</p>
                    <p className="truncate text-[11px] text-surface-400">/category/{c.slug}</p>
                  </div>
                </div>
                <button
                  onClick={() => void remove(c)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs font-semibold text-danger-strong transition hover:bg-red-500/20"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>
    </AdminPage>
  );
}
