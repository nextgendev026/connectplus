"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderTree, Plus, Trash2, Loader2, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-surface-900 sm:text-2xl dark:text-surface-50">
          <FolderTree className="h-5 w-5 text-brand-500" />
          Categories
        </h1>
        <p className="mt-1 text-sm text-surface-500">
          Editorial taxonomy for the feed, trending topics and fetched stories.
        </p>
      </header>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <section className="mt-5 rounded-2xl border border-surface-200/70 bg-surface-50 p-4 dark:bg-surface-900/40">
        <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100">New category</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            placeholder="Category name, e.g. Fintech"
            className={cn(inputCls, "flex-1")}
          />
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="Icon (emoji, optional)"
            className={cn(inputCls, "sm:w-40")}
          />
          <button
            onClick={() => void create()}
            disabled={saving || !name.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create
          </button>
        </div>
      </section>

      <div className="mt-4 overflow-hidden rounded-2xl border border-surface-200/70">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-surface-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : categories.length === 0 ? (
          <div className="py-10 text-center text-sm text-surface-500">No categories yet.</div>
        ) : (
          categories.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 border-b border-surface-200/60 px-3 py-3 last:border-b-0 dark:border-surface-800"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-sm dark:bg-surface-800">
                  {c.icon || <Hash className="h-3.5 w-3.5 text-surface-400" />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-surface-900 dark:text-surface-50">{c.name}</p>
                  <p className="truncate text-[11px] text-surface-500">/category/{c.slug}</p>
                </div>
              </div>
              <button
                onClick={() => void remove(c)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-500/10 dark:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-surface-200 bg-white px-3 py-2.5 text-sm text-surface-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:bg-surface-900 dark:text-surface-50";
