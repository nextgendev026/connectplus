"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ThirdPartyAdsPanel from "@/components/admin/ThirdPartyAdsPanel";
import {
  Megaphone,
  Plus,
  Trash2,
  Eye,
  MousePointerClick,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Upload,
  X,
  ExternalLink,
  Pencil,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Ad {
  id: string;
  name: string;
  slot: string;
  format: string;
  imageUrl: string | null;
  html: string | null;
  targetUrl: string | null;
  sponsor: string | null;
  weight: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  impressions: number;
  clicks: number;
  createdAt: string;
}

interface Summary {
  total: number;
  active: number;
  impressions: number;
  clicks: number;
}

const SLOT_OPTIONS = [
  { value: "feed-inline", label: "Feed — between cards" },
  { value: "feed-sidebar", label: "Feed — sidebar" },
  { value: "article-top", label: "Article — above the fold" },
  { value: "article-inline", label: "Article — mid-content" },
  { value: "article-sidebar", label: "Article — sidebar" },
  { value: "radio-hero", label: "Radio — hero panel" },
];

const emptyForm = {
  name: "",
  slot: "feed-inline",
  format: "image",
  imageUrl: "",
  html: "",
  targetUrl: "",
  sponsor: "",
  weight: 1,
  startsAt: "",
  endsAt: "",
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function AdminAdsPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ads", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load ads");
      const data = await res.json();
      setAds(data.ads ?? []);
      setSummary(data.summary ?? null);
      setError(null);
    } catch {
      setError("Could not load campaigns. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ctr = useMemo(() => {
    if (!summary || summary.impressions === 0) return "0.0%";
    return `${((summary.clicks / summary.impressions) * 100).toFixed(1)}%`;
  }, [summary]);

  function resetForm() {
    setForm({ ...emptyForm });
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(ad: Ad) {
    setEditingId(ad.id);
    setForm({
      name: ad.name,
      slot: ad.slot,
      format: ad.format,
      imageUrl: ad.imageUrl ?? "",
      html: ad.html ?? "",
      targetUrl: ad.targetUrl ?? "",
      sponsor: ad.sponsor ?? "",
      weight: ad.weight,
      startsAt: ad.startsAt ? ad.startsAt.slice(0, 10) : "",
      endsAt: ad.endsAt ? ad.endsAt.slice(0, 10) : "",
    });
    setShowForm(true);
  }

  async function uploadCreative(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", "post");
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setForm((f) => ({ ...f, imageUrl: data.url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!form.name.trim()) {
      setError("Give the campaign a name.");
      return;
    }
    if (form.format === "image" && !form.imageUrl.trim()) {
      setError("Image campaigns need a creative.");
      return;
    }
    if (form.format === "html" && !form.html.trim()) {
      setError("HTML campaigns need embed markup.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        weight: Number(form.weight) || 1,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
      };
      const res = await fetch(editingId ? `/api/admin/ads/${editingId}` : "/api/admin/ads", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(ad: Ad) {
    setAds((prev) => prev.map((a) => (a.id === ad.id ? { ...a, isActive: !a.isActive } : a)));
    await fetch(`/api/admin/ads/${ad.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !ad.isActive }),
    }).catch(() => {});
    void load();
  }

  async function remove(ad: Ad) {
    if (!confirm(`Delete campaign “${ad.name}”? This cannot be undone.`)) return;
    setAds((prev) => prev.filter((a) => a.id !== ad.id));
    await fetch(`/api/admin/ads/${ad.id}`, { method: "DELETE" }).catch(() => {});
    void load();
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-surface-900 sm:text-2xl dark:text-surface-50">
            <Megaphone className="h-5 w-5 text-brand-500" />
            Monetization
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            Inject campaigns straight into ad slots across the app. No third-party scripts.
          </p>
        </div>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? "Cancel" : "New campaign"}
        </button>
      </header>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {summary ? (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Campaigns" value={fmt(summary.total)} sub={`${summary.active} live`} />
          <Stat label="Impressions" value={fmt(summary.impressions)} icon={<Eye className="h-4 w-4" />} />
          <Stat label="Clicks" value={fmt(summary.clicks)} icon={<MousePointerClick className="h-4 w-4" />} />
          <Stat label="CTR" value={ctr} icon={<Sparkles className="h-4 w-4" />} />
        </div>
      ) : null}

      {showForm ? (
        <section className="mt-5 rounded-2xl border border-surface-200/70 bg-surface-50 p-4 dark:bg-surface-900/40">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-100">
            {editingId ? "Edit campaign" : "New campaign"}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Campaign name">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Safaricom M-PESA launch"
                className={inputCls}
              />
            </Field>
            <Field label="Ad slot">
              <select
                value={form.slot}
                onChange={(e) => setForm({ ...form, slot: e.target.value })}
                className={inputCls}
              >
                {SLOT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Format">
              <div className="flex gap-2">
                {["image", "html"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setForm({ ...form, format: f })}
                    className={cn(
                      "flex-1 rounded-xl border px-3 py-2 text-sm font-medium capitalize transition",
                      form.format === f
                        ? "border-brand-500 bg-brand-500/10 text-brand-600"
                        : "border-surface-200 text-surface-600 hover:border-surface-300"
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Sponsor (optional)">
              <input
                value={form.sponsor}
                onChange={(e) => setForm({ ...form, sponsor: e.target.value })}
                placeholder="Safaricom"
                className={inputCls}
              />
            </Field>

            {form.format === "image" ? (
              <Field label="Creative image" className="sm:col-span-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={form.imageUrl}
                    onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                    placeholder="https://… or upload"
                    className={cn(inputCls, "flex-1")}
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadCreative(f);
                    }}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-surface-200 px-3 py-2.5 text-sm font-medium text-surface-700 transition hover:border-brand-500/50 disabled:opacity-60"
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? "Uploading" : "Upload"}
                  </button>
                </div>
                {form.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.imageUrl} alt="Creative preview" className="mt-2 max-h-40 rounded-xl border border-surface-200 object-contain" />
                ) : null}
              </Field>
            ) : (
              <Field label="Embed markup" className="sm:col-span-2">
                <textarea
                  value={form.html}
                  onChange={(e) => setForm({ ...form, html: e.target.value })}
                  rows={4}
                  placeholder="<a href=…><img src=… /></a>"
                  className={cn(inputCls, "font-mono text-xs")}
                />
              </Field>
            )}

            <Field label="Target URL">
              <input
                value={form.targetUrl}
                onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
                placeholder="https://advertiser.example"
                className={inputCls}
              />
            </Field>
            <Field label="Weight (higher = more often)">
              <input
                type="number"
                min={1}
                max={100}
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
            <Field label="Starts">
              <input
                type="date"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Ends">
              <input
                type="date"
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={resetForm}
              className="rounded-xl border border-surface-200 px-4 py-2.5 text-sm font-medium text-surface-600 transition hover:border-surface-300"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingId ? "Save changes" : "Launch campaign"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="mt-5 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-surface-200/70 py-10 text-sm text-surface-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading campaigns…
          </div>
        ) : ads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-surface-300 px-4 py-12 text-center">
            <Megaphone className="mx-auto h-8 w-8 text-surface-300" />
            <p className="mt-2 text-sm font-medium text-surface-600">No campaigns yet</p>
            <p className="text-xs text-surface-500">Create one to start monetising your slots.</p>
          </div>
        ) : (
          ads.map((ad) => (
            <article
              key={ad.id}
              className="flex flex-col gap-3 rounded-2xl border border-surface-200/70 bg-surface-50 p-3 sm:flex-row sm:items-start dark:bg-surface-900/40"
            >
              <div className="h-24 w-full shrink-0 overflow-hidden rounded-xl border border-surface-200 bg-surface-100 sm:w-40">
                {ad.format === "image" && ad.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ad.imageUrl} alt={ad.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] font-medium uppercase tracking-wide text-surface-400">
                    HTML embed
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-surface-900 dark:text-surface-50">{ad.name}</h3>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      ad.isActive ? "bg-emerald-500/15 text-emerald-600" : "bg-surface-300/40 text-surface-500"
                    )}
                  >
                    {ad.isActive ? "Live" : "Paused"}
                  </span>
                  <span className="rounded-full bg-surface-200/60 px-2 py-0.5 text-[10px] font-medium text-surface-600">
                    {SLOT_OPTIONS.find((s) => s.value === ad.slot)?.label ?? ad.slot}
                  </span>
                  <span className="text-[10px] font-medium text-surface-500">weight {ad.weight}</span>
                </div>

                {ad.sponsor ? <p className="mt-0.5 text-xs text-surface-500">Sponsored by {ad.sponsor}</p> : null}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-surface-500">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3.5 w-3.5" /> {fmt(ad.impressions)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MousePointerClick className="h-3.5 w-3.5" /> {fmt(ad.clicks)}
                  </span>
                  {ad.impressions > 0 ? (
                    <span className="font-medium text-surface-600">
                      {((ad.clicks / ad.impressions) * 100).toFixed(1)}% CTR
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => toggleActive(ad)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-600 transition hover:border-brand-500/50"
                  >
                    {ad.isActive ? <ToggleRight className="h-4 w-4 text-emerald-500" /> : <ToggleLeft className="h-4 w-4" />}
                    {ad.isActive ? "Pause" : "Activate"}
                  </button>
                  <button
                    onClick={() => startEdit(ad)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-600 transition hover:border-brand-500/50"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  {ad.targetUrl ? (
                    <a
                      href={ad.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-600 transition hover:border-brand-500/50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Destination
                    </a>
                  ) : null}
                  <button
                    onClick={() => remove(ad)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-500/10 dark:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      {/* Programmatic fallback: AdSense / Meta / MGID / custom tags per placement */}
      <ThirdPartyAdsPanel />
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-surface-200 bg-white px-3 py-2.5 text-sm text-surface-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:bg-surface-900 dark:text-surface-50";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-300">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-surface-200/70 bg-surface-50 p-3 dark:bg-surface-900/40">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-surface-500">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-lg font-bold text-surface-900 dark:text-surface-50">{value}</p>
      {sub ? <p className="text-[11px] text-surface-500">{sub}</p> : null}
    </div>
  );
}
