"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Globe,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
  Eye,
  MousePointerClick,
  Power,
} from "lucide-react";

interface Slot {
  id: string;
  name: string;
  slot: string;
  provider: string;
  scriptTag: string | null;
  adUnitId: string | null;
  sizes: string | null;
  isActive: boolean;
  weight: number;
  impressions: number;
  clicks: number;
}

const PROVIDER_LABEL: Record<string, string> = {
  adsense: "Google AdSense",
  facebook: "Meta Audience Network",
  mgid: "MGID",
  propeller: "PropellerAds",
  custom: "Custom HTML",
};

const EMPTY = {
  name: "",
  slot: "feed-inline",
  provider: "adsense",
  adUnitId: "",
  scriptTag: "",
  sizes: "[[300,250],[728,90]]",
  weight: 1,
  isActive: true,
};

/**
 * Third-party ad network management. Admins paste the network's ad tag once and
 * it renders in the chosen placement as a fallback whenever no in-house
 * campaign is live — the bridge between direct-sold ads and programmatic.
 */
export default function ThirdPartyAdsPanel() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [placements, setPlacements] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/adslots", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setSlots(data.slots ?? []);
      setPlacements(data.placements ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ad slots");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!form.name.trim() || !form.scriptTag.trim()) {
      setError("A name and the network ad tag are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/adslots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Could not save the ad slot");
      }
      setForm({ ...EMPTY });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the ad slot");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      await fetch(`/api/admin/adslots?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggle(s: Slot) {
    setSaving(true);
    try {
      await fetch("/api/admin/adslots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...s, isActive: !s.isActive }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  const ctr = (s: Slot) => (s.impressions > 0 ? ((s.clicks / s.impressions) * 100).toFixed(2) : "0.00");

  return (
    <section className="rounded-2xl border border-surface-200/70 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-cyan/10 border border-accent-cyan/20">
          <Globe className="h-5 w-5 text-accent-cyan" />
        </div>
        <div>
          <h2 className="text-base font-bold text-surface-900 dark:text-surface-50">
            Third-party networks
          </h2>
          <p className="text-xs text-surface-500 mt-0.5 leading-relaxed">
            Paste an AdSense, Meta, MGID or custom ad tag. It fills a placement whenever no
            in-house campaign is running.
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-red-400" />
          <p className="text-[11px] leading-relaxed text-red-500 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Existing slots */}
      <div className="mt-5 space-y-2.5">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-surface-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading network slots…
          </div>
        ) : slots.length === 0 ? (
          <p className="py-4 text-xs text-surface-500">
            No network slots configured. Add one below to start monetising inventory beyond
            direct campaigns.
          </p>
        ) : (
          slots.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-surface-200/70 p-3.5 dark:border-surface-800"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-surface-900 dark:text-surface-50">
                    {s.name}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase",
                      s.isActive
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-surface-300 bg-surface-100 text-surface-500 dark:border-surface-700 dark:bg-surface-800"
                    )}
                  >
                    {s.isActive ? "live" : "paused"}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-surface-500">
                  {PROVIDER_LABEL[s.provider] ?? s.provider} · {s.slot}
                  {s.adUnitId ? ` · ${s.adUnitId}` : ""}
                </p>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-surface-500">
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" />
                  {s.impressions.toLocaleString()}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MousePointerClick className="h-3.5 w-3.5" />
                  {s.clicks.toLocaleString()}
                </span>
                <span className="tabular-nums">{ctr(s)}% CTR</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void toggle(s)}
                  className="rounded-lg border border-surface-200 p-1.5 text-surface-500 transition hover:text-brand-500 disabled:opacity-50 dark:border-surface-700"
                  title={s.isActive ? "Pause slot" : "Activate slot"}
                >
                  <Power className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void remove(s.id)}
                  className="rounded-lg border border-surface-200 p-1.5 text-surface-500 transition hover:text-red-500 disabled:opacity-50 dark:border-surface-700"
                  title="Delete slot"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / update form */}
      <div className="mt-5 rounded-xl border border-surface-200/70 p-4 dark:border-surface-800">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500">
          Add a network slot
        </h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium text-surface-500">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="sidebar-banner"
              className="mt-1 w-full rounded-lg border border-surface-200 bg-transparent px-3 py-2 text-sm text-surface-900 outline-none focus:border-brand-500/50 dark:border-surface-700 dark:text-surface-50"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-surface-500">Placement</span>
            <select
              value={form.slot}
              onChange={(e) => setForm({ ...form, slot: e.target.value })}
              className="mt-1 w-full rounded-lg border border-surface-200 bg-transparent px-3 py-2 text-sm text-surface-900 outline-none focus:border-brand-500/50 dark:border-surface-700 dark:text-surface-50"
            >
              {(placements.length ? placements : [form.slot]).map((p) => (
                <option key={p} value={p} className="bg-surface-900">
                  {p}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-surface-500">Network</span>
            <select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value })}
              className="mt-1 w-full rounded-lg border border-surface-200 bg-transparent px-3 py-2 text-sm text-surface-900 outline-none focus:border-brand-500/50 dark:border-surface-700 dark:text-surface-50"
            >
              {Object.entries(PROVIDER_LABEL).map(([v, label]) => (
                <option key={v} value={v} className="bg-surface-900">
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-surface-500">
              Ad unit / publisher ID
            </span>
            <input
              value={form.adUnitId}
              onChange={(e) => setForm({ ...form, adUnitId: e.target.value })}
              placeholder="ca-pub-XXXXXXXXXXXXXXXX"
              className="mt-1 w-full rounded-lg border border-surface-200 bg-transparent px-3 py-2 text-sm text-surface-900 outline-none focus:border-brand-500/50 dark:border-surface-700 dark:text-surface-50"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-[11px] font-medium text-surface-500">
              Ad tag (script or ins HTML)
            </span>
            <textarea
              value={form.scriptTag}
              onChange={(e) => setForm({ ...form, scriptTag: e.target.value })}
              rows={4}
              placeholder={'<ins class="adsbygoogle" …></ins>\n<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>'}
              className="mt-1 w-full rounded-lg border border-surface-200 bg-transparent px-3 py-2 font-mono text-[11px] leading-relaxed text-surface-900 outline-none focus:border-brand-500/50 dark:border-surface-700 dark:text-surface-50"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Save slot
        </button>
      </div>
    </section>
  );
}
