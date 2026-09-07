"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Settings2,
  Search,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Check,
  AlertTriangle,
  Globe2,
  Rocket,
  Puzzle,
  KeyRound,
  Plug,
  RefreshCw,
  ShieldCheck,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingRow {
  key: string;
  value: string;
  group: string;
  label: string;
  hint?: string | null;
  type: string;
  isPublic: boolean;
  isSecret: boolean;
}

type GroupKey = "general" | "seo" | "integrations" | "plugins" | "api";

const GROUPS: { key: GroupKey; label: string; icon: typeof Globe2; blurb: string; gradient: string }[] = [
  {
    key: "general",
    label: "General",
    icon: Globe2,
    blurb: "Site identity, contact details and maintenance control.",
    gradient: "from-brand-500 to-accent-amber",
  },
  {
    key: "seo",
    label: "SEO & Sharing",
    icon: Rocket,
    blurb: "Default share image, Twitter card and indexing control.",
    gradient: "from-accent-cyan to-brand-500",
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: Plug,
    blurb: "Analytics, pixels and chat widgets injected site-wide.",
    gradient: "from-accent-violet to-accent-coral",
  },
  {
    key: "plugins",
    label: "Features & Plugins",
    icon: Puzzle,
    blurb: "Toggle platform modules — radio, brain chat, signups and more.",
    gradient: "from-emerald-500 to-accent-cyan",
  },
  {
    key: "api",
    label: "API Keys & Services",
    icon: KeyRound,
    blurb: "Third-party service keys and AI provider configuration.",
    gradient: "from-accent-coral to-accent-violet",
  },
];

const INTEGRATION_CARDS = [
  {
    name: "Google Analytics 4",
    id: "ga4",
    hint: "Set provider to `ga4`, paste your G-XXXXXXX ID and flip analytics on.",
    field: "analyticsId",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  {
    name: "Plausible Analytics",
    id: "plausible",
    hint: "Lightweight, cookieless. Set provider to `plausible` with your site ID.",
    field: "analyticsId",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  {
    name: "Fathom Analytics",
    id: "fathom",
    hint: "Privacy-first. Set provider to `fathom` with your site key.",
    field: "analyticsId",
    color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  },
  {
    name: "Intercom / Crisp / Tawk",
    id: "chat",
    hint: "Paste the full embed snippet into “Chat widget snippet” and enable the widget.",
    field: "chatWidgetScript",
    color: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  },
  {
    name: "Meta / X pixel",
    id: "pixel",
    hint: "Paste the raw pixel <script> into “Custom head scripts”.",
    field: "headScripts",
    color: "bg-brand-500/10 text-brand-400 border-brand-500/20",
  },
  {
    name: "Hotjar / Clarity",
    id: "hotjar",
    hint: "Heatmaps & session replay — paste the snippet into “Custom head scripts”.",
    field: "headScripts",
    color: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  },
];

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SettingRow[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState<GroupKey | "all">("all");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [editingSecret, setEditingSecret] = useState<Set<string>>(new Set());

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/settings", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
      const data = await res.json();
      setSettings(data.settings);
      const map: Record<string, string> = {};
      for (const s of data.settings) map[s.key] = s.value;
      setValues(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: the sync setState is only an idempotent loading flag
    load();
  }, []);

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  const saveAll = async () => {
    setSaving(true);
    setError(null);
    try {
      // Never persist masked secret values: an untouched secret stays masked
      // (contains •) and must be skipped so the stored value is preserved.
      const updates: Record<string, string> = {};
      for (const s of settings ?? []) {
        const v = values[s.key] ?? "";
        if (s.isSecret && !editingSecret.has(s.key) && v.includes("•")) continue;
        updates[s.key] = v;
      }
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = await res.json();
      setSettings(data.settings);
      const map: Record<string, string> = {};
      for (const s of data.settings) map[s.key] = s.value;
      setValues(map);
      setEditingSecret(new Set());
      setRevealed(new Set());
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    if (!settings) return [];
    const q = query.trim().toLowerCase();
    return settings.filter((s) => {
      if (activeGroup !== "all" && s.group !== activeGroup) return false;
      if (!q) return true;
      return (
        s.label.toLowerCase().includes(q) ||
        s.key.toLowerCase().includes(q) ||
        (s.hint ?? "").toLowerCase().includes(q)
      );
    });
  }, [settings, query, activeGroup]);

  const grouped = useMemo(() => {
    const out: { group: GroupKey; rows: SettingRow[] }[] = [];
    for (const g of GROUPS) {
      const rows = filtered.filter((r) => r.group === g.key);
      if (rows.length > 0) out.push({ group: g.key, rows });
    }
    return out;
  }, [filtered]);

  const revealSecret = (key: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleEditingSecret = (key: string) => {
    setEditingSecret((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderField = (row: SettingRow) => {
    const isSecret = row.type === "secret";
    const isBool = row.type === "boolean";
    const isTextarea = row.type === "textarea";
    const current = values[row.key] ?? "";

    if (isBool) {
      const on = current === "true";
      return (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => setValue(row.key, on ? "false" : "true")}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full transition-all duration-300 border",
            on
              ? "bg-gradient-to-r from-brand-500 to-accent-coral border-brand-400/40 shadow-glow"
              : "bg-surface-800 border-surface-700"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5.5 w-5.5 rounded-full transition-all duration-300",
              on ? "left-[calc(100%-1.45rem)] bg-white shadow" : "left-0.5 bg-surface-500"
            )}
            style={{ height: "1.375rem", width: "1.375rem" }}
          />
        </button>
      );
    }

    if (isSecret) {
      const isEditing = editingSecret.has(row.key);
      const isVisible = revealed.has(row.key) || isEditing;
      return (
        <div className="flex items-center gap-1.5">
          <input
            type={isVisible ? "text" : "password"}
            value={isEditing ? current : row.value}
            readOnly={!isEditing}
            placeholder="••••••••"
            onChange={(e) => setValue(row.key, e.target.value)}
            className={cn(
              "w-full bg-surface-900/40 border border-surface-800/50 rounded-xl px-3 py-2 text-sm font-medium text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-brand-500/30 transition-colors font-mono",
              isEditing && "text-surface-50 border-brand-500/30"
            )}
          />
          <button
            onClick={() => toggleEditingSecret(row.key)}
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
              isEditing
                ? "bg-brand-500/10 border-brand-500/30 text-brand-400"
                : "border-surface-700 text-surface-400 hover:text-surface-50"
            )}
            title={isEditing ? "Lock value" : "Edit value"}
          >
            <PencilIcon />
          </button>
          {!isEditing && (
            <button
              onClick={() => revealSecret(row.key)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-surface-700 text-surface-400 hover:text-surface-50 transition-colors"
              title={isVisible ? "Hide value" : "Reveal value"}
            >
              {isVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      );
    }

    if (isTextarea) {
      return (
        <textarea
          value={current}
          onChange={(e) => setValue(row.key, e.target.value)}
          rows={row.key === "headScripts" || row.key === "chatWidgetScript" ? 4 : 3}
          className="w-full bg-surface-900/40 border border-surface-800/50 rounded-xl px-3 py-2 text-sm font-medium text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-brand-500/30 transition-colors resize-y"
        />
      );
    }

    return (
      <input
        type={row.type === "url" ? "url" : "text"}
        value={current}
        onChange={(e) => setValue(row.key, e.target.value)}
        className="w-full bg-surface-900/40 border border-surface-800/50 rounded-xl px-3 py-2 text-sm font-medium text-surface-100 placeholder:text-surface-500 focus:outline-none focus:border-brand-500/30 transition-colors"
      />
    );
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-coral/80 shadow-glow">
              <Settings2 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="type-display text-surface-50">Settings &amp; Integrations</h1>
              <p className="text-sm font-medium text-surface-400">
                Full control over the build — identity, SEO, integrations, plugins and API keys
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-xs font-medium text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-surface-900 border border-surface-800 px-3 py-2 text-xs font-semibold text-surface-200 transition-colors hover:bg-surface-800 hover:text-surface-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Reload
            </button>
            <button
              onClick={saveAll}
              disabled={!dirty || saving}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
                dirty && !saving
                  ? "btn-gradient text-white shadow-glow"
                  : "bg-surface-800 text-surface-400 cursor-not-allowed"
              )}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {dirty ? "Save changes" : "Saved"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading && !settings && (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="relative h-14 w-14">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-brand-500 via-accent-amber to-accent-coral animate-spin" style={{ animationDuration: "1.2s" }} />
              <div className="absolute inset-[3px] rounded-full bg-surface-950" />
            </div>
            <p className="mt-4 text-sm font-medium text-surface-400">Loading platform settings...</p>
          </div>
        )}

        {settings && (
          <>
            {/* Toolbar: search + group pills */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setActiveGroup("all")}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-medium transition-all border",
                    activeGroup === "all"
                      ? "bg-gradient-to-r from-brand-500 to-accent-coral text-white border-transparent shadow-glow"
                      : "border-surface-700/60 bg-surface-800/50 text-surface-400 hover:text-surface-50"
                  )}
                >
                  All
                </button>
                {GROUPS.map((g) => (
                  <button
                    key={g.key}
                    onClick={() => setActiveGroup(g.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all border",
                      activeGroup === g.key
                        ? "bg-gradient-to-r from-brand-500 to-accent-coral text-white border-transparent shadow-glow"
                        : "border-surface-700/60 bg-surface-800/50 text-surface-400 hover:text-surface-50"
                    )}
                  >
                    <g.icon className="h-3 w-3" />
                    {g.label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search settings..."
                  className="w-full sm:w-56 rounded-lg border border-surface-700/60 bg-surface-800/50 py-2 pl-9 pr-3 text-xs font-medium text-surface-100 placeholder:text-surface-500 focus:border-brand-500/40 focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Integration quick cards */}
            {activeGroup === "all" && !query && (
              <div className="rounded-2xl border border-surface-800 bg-surface-900/40 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-brand-400" />
                  <h2 className="text-sm font-semibold text-surface-50">One-click integration recipes</h2>
                  <span className="ml-1 rounded-full bg-surface-800 px-2 py-0.5 type-caption text-surface-400">
                    {INTEGRATION_CARDS.length} guides
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {INTEGRATION_CARDS.map((card) => (
                    <div
                      key={card.id}
                      className={cn(
                        "group rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover",
                        card.color
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">{card.name}</p>
                        <Plug className="h-4 w-4 opacity-60" />
                      </div>
                      <p className="mt-2 type-meta leading-relaxed opacity-80">{card.hint}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Grouped sections */}
            {grouped.length === 0 && (
              <div className="rounded-2xl border border-dashed border-surface-700 py-16 text-center">
                <Search className="mx-auto mb-3 h-8 w-8 text-surface-600" />
                <p className="text-sm text-surface-500">No settings match “{query}”.</p>
              </div>
            )}

            {grouped.map(({ group, rows }) => {
              const meta = GROUPS.find((g) => g.key === group)!;
              return (
                <section
                  key={group}
                  className="overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/40"
                >
                  <div className="flex items-center gap-3 border-b border-surface-800/70 bg-surface-900/60 px-5 py-4">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-white", meta.gradient)}>
                      <meta.icon className="h-4.5 w-4.5" style={{ height: "1.125rem", width: "1.125rem" }} />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-surface-50">{meta.label}</h2>
                      <p className="type-meta text-surface-500">{meta.blurb}</p>
                    </div>
                    <span className="ml-auto rounded-full bg-surface-800 px-2.5 py-1 type-caption text-surface-400">
                      {rows.length} setting{rows.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="divide-y divide-surface-800/60">
                    {rows.map((row) => (
                      <div key={row.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-surface-100">{row.label}</p>
                            <code className="rounded bg-surface-800/80 px-1.5 py-0.5 type-caption text-surface-500">{row.key}</code>
                            {row.isSecret && (
                              <span className="flex items-center gap-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 text-[9px] font-medium text-violet-400">
                                <ShieldCheck className="h-2.5 w-2.5" /> secret
                              </span>
                            )}
                          </div>
                          {row.hint && <p className="mt-1 type-meta leading-relaxed text-surface-500">{row.hint}</p>}
                        </div>
                        <div className="w-full shrink-0 sm:w-72">{renderField(row)}</div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

            {/* Save footer */}
            <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-2xl border border-surface-800 bg-surface-900/90 px-5 py-3 backdrop-blur-xl">
              <p className="mr-auto type-meta text-surface-500">
                {dirty ? "You have unsaved changes" : "All changes are live site-wide"}
              </p>
              <button
                onClick={saveAll}
                disabled={!dirty || saving}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all",
                  dirty && !saving
                    ? "btn-gradient text-white shadow-glow hover:scale-[1.02]"
                    : "bg-surface-800 text-surface-400 cursor-not-allowed"
                )}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : dirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                {saving ? "Saving..." : dirty ? "Save changes" : "All saved"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

