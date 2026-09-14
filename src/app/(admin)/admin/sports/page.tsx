"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  Eye,
  MousePointerClick,
  Brain,
  Trophy,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
  Sparkles,
  Target,
  Megaphone,
  BarChart3,
  Gauge,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ModelRecordPanel from "@/components/admin/ModelRecordPanel";

interface Referral {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  urlTemplate: string;
  referralCode: string | null;
  bonus: string | null;
  description: string | null;
  logoUrl: string | null;
  placement: string;
  ctaText: string;
  weight: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
  createdAt: string;
}

interface Overview {
  generatedAt: string;
  stats: {
    matches: number;
    live: number;
    predictions: number;
    pending: number;
    settled: number;
    won: number;
    lost: number;
    accuracy: number | null;
    referralImpressions: number;
    referralClicks: number;
    activity: Record<string, number>;
  };
  trends: { competition: string; matches: number; live: number; avgGoals: number }[];
  provider: {
    id: string;
    label: string;
    configured: boolean;
    selected: boolean;
    keyless?: boolean;
    active?: boolean;
    contributed?: number;
    hint: string;
  }[];
  sources: { id: string; label: string; ok: boolean; matches: number; contributed: number; elapsedMs: number; error?: string }[];
  sportsDbKey: { using: string; fallback: boolean };
  /** What the model could actually see on today's board. Null if the read failed. */
  coverage: {
    from: string;
    to: string;
    matches: number;
    priced: number;
    partial: number;
    unpriced: number;
    nativeDeepData: number;
    unpricedCompetitions: { competition: string; matches: number }[];
  } | null;
  /** What the odds backfill and the deep-data resolver have done this process. */
  engine: { oddsBackfilled: number; deepDataResolved: number };
  notifications: { sent24h: number; reminders: number; lastSentAt: string | null };
  placements: string[];
  referrals: Referral[];
  predictions: {
    id: string;
    selection: string;
    confidence: number;
    status: string;
    valueEdge: number | null;
    /** The market the pick prices, and which model wrote it. */
    market: string;
    model: string;
    createdAt: string;
    match: { homeTeam: string; awayTeam: string; competition: string; status: string };
  }[];
  activity: { series: Record<string, number>; days: { date: string; impressions: number; clicks: number; views: number }[] };
}

/** Markets as the tips board labels them, so the console reads the same. */
const MARKET_LABELS: Record<string, string> = {
  "1X2": "Who wins",
  "over-under": "Total goals",
  btts: "Both to score",
  "correct-score": "Exact score",
};

const PLACEMENT_LABELS: Record<string, string> = {
  "sports-hero": "Sports — hero banner",
  "sports-inline": "Sports — inline between fixtures",
  "sports-sidebar": "Sports — sidebar rail",
  "sports-footer": "Sports — page footer",
};

const emptyForm = {
  name: "",
  urlTemplate: "",
  referralCode: "",
  region: "",
  bonus: "",
  description: "",
  logoUrl: "",
  placement: "sports-sidebar",
  ctaText: "Join & claim",
  weight: 1,
  isActive: true,
  startsAt: "",
  endsAt: "",
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function AdminSportsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<"partners" | "record">("partners");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sports", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load the sports console");
      setData((await res.json()) as Overview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch of the console overview
    void load();
  }, [load]);

  async function runAction(action: string, referral?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, referral }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function resetForm() {
    setForm({ ...emptyForm });
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(r: Referral) {
    setEditingId(r.id);
    setForm({
      name: r.name,
      urlTemplate: r.urlTemplate,
      referralCode: r.referralCode ?? "",
      region: r.region ?? "",
      bonus: r.bonus ?? "",
      description: r.description ?? "",
      logoUrl: r.logoUrl ?? "",
      placement: r.placement,
      ctaText: r.ctaText,
      weight: r.weight,
      isActive: r.isActive,
      startsAt: r.startsAt ? r.startsAt.slice(0, 10) : "",
      endsAt: r.endsAt ? r.endsAt.slice(0, 10) : "",
    });
    setShowForm(true);
  }

  async function save() {
    if (!form.name.trim()) return setError("Give the partner a name.");
    if (!/^https?:\/\//i.test(form.urlTemplate.trim())) {
      return setError("Destination must start with http(s):// (use {code} for the referral code).");
    }
    const ok = await runAction(editingId ? "update-referral" : "create-referral", {
      ...form,
      id: editingId ?? undefined,
      weight: Number(form.weight) || 1,
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
    });
    if (ok) resetForm();
  }

  const ctr = useMemo(() => {
    const { referralImpressions, referralClicks } = data?.stats ?? {
      referralImpressions: 0,
      referralClicks: 0,
    };
    return referralImpressions > 0 ? `${((referralClicks / referralImpressions) * 100).toFixed(2)}%` : "0.0%";
  }, [data]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl text-surface-50">
            <Trophy className="h-5 w-5 text-brand-500" />
            Sports & Betting Intel
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            Inject referral partners, run the analyser, and audit what the model is actually worth.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => runAction("sync")}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition hover:border-brand-500/50 disabled:opacity-60 border-surface-700 text-surface-200"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            Run analyser
          </button>
          <button
            onClick={() => (showForm ? resetForm() : setShowForm(true))}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600",
              tab === "record" && "hidden"
            )}
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? "Cancel" : "New partner"}
          </button>
        </div>
      </header>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex w-full max-w-md items-center rounded-xl border p-1 border-surface-700">
        <AdminTab
          active={tab === "partners"}
          onClick={() => setTab("partners")}
          icon={<Megaphone className="h-4 w-4" />}
          label="Partners & activity"
        />
        <AdminTab
          active={tab === "record"}
          onClick={() => setTab("record")}
          icon={<BarChart3 className="h-4 w-4" />}
          label="Model record"
        />
      </div>

      {tab === "record" ? (
        <div className="mt-5">
          <ModelRecordPanel />
        </div>
      ) : loading ? (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-surface-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading console…
        </div>
      ) : data ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Matches" value={fmt(data.stats.matches)} />
            <Stat label="Live" value={fmt(data.stats.live)} icon={<Activity className="h-4 w-4 text-red-500" />} />
            <Stat label="Predictions" value={fmt(data.stats.predictions)} icon={<Target className="h-4 w-4" />} />
            <Stat
              label="Accuracy"
              value={data.stats.accuracy != null ? `${data.stats.accuracy}%` : "—"}
              sub={`${data.stats.won}/${data.stats.settled} settled`}
            />
            <Stat label="Impressions" value={fmt(data.stats.referralImpressions)} icon={<Eye className="h-4 w-4" />} />
            <Stat label="Clicks" value={fmt(data.stats.referralClicks)} sub={`CTR ${ctr}`} icon={<MousePointerClick className="h-4 w-4" />} />
          </div>

          {/*
            What the model could actually see.

            `Matches` and `Predictions` both count up happily while every pick on
            the board is made without a price to compare against, or while the
            match centre has no commentary because the fixture could not be found
            on the feed that carries it. Neither gap shows up in an aggregate, so
            it is measured directly — and the competitions listed underneath are
            the actionable half: those are the leagues no keyless source prices,
            where a pick is a prior and not an opinion about the market.
          */}
          {data.coverage ? (
            <section className="mt-5 rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
                  <Gauge className="h-4 w-4 text-brand-500" /> Market &amp; deep-data coverage
                </h2>
                <span className="text-[11px] text-surface-500">
                  Today&apos;s board — what the model could see
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Priced 1X2"
                  value={fmt(data.coverage.priced)}
                  sub={`of ${fmt(data.coverage.matches)} fixtures`}
                />
                <Stat label="Partly priced" value={fmt(data.coverage.partial)} />
                <Stat
                  label="No price at all"
                  value={fmt(data.coverage.unpriced)}
                  sub="picks here are priors"
                />
                <Stat
                  label="Deep data native"
                  value={fmt(data.coverage.nativeDeepData)}
                  sub="others resolved by lookup"
                />
              </div>

              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-surface-500">
                <div className="flex items-center gap-1.5">
                  <dt>Prices backfilled this process</dt>
                  <dd className="font-semibold text-surface-200">
                    {fmt(data.engine.oddsBackfilled)}
                  </dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt>Fixtures matched to a live feed this process</dt>
                  <dd className="font-semibold text-surface-200">
                    {fmt(data.engine.deepDataResolved)}
                  </dd>
                </div>
              </dl>

              {data.coverage.unpricedCompetitions.length > 0 ? (
                <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                  <p className="text-[11px] font-semibold text-amber-300">
                    Competitions no free feed prices
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {data.coverage.unpricedCompetitions.map((c) => (
                      <li
                        key={c.competition}
                        className="rounded-full px-2 py-0.5 text-[10px] bg-surface-800 text-surface-300"
                      >
                        {c.competition} · {c.matches}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* Provider / configuration */}
          <section className="mt-5 rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-surface-100">Data sources</h2>
              <span className="text-[11px] text-surface-500">
                Merged on every request — one throttled feed never empties the board
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.provider.map((p) => {
                const report = data.sources.find((s) => s.id === p.id);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "rounded-xl border p-3 text-xs",
                      p.selected
                        ? "border-brand-500/50 bg-brand-500/5"
                        : "border-surface-800"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-semibold text-surface-100">{p.label}</span>
                      <span className="flex gap-1">
                        {p.keyless ? (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-surface-800 text-surface-300">
                            NO KEY
                          </span>
                        ) : null}
                        {p.selected ? (
                          <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-bold text-brand-600">IN USE</span>
                        ) : null}
                      </span>
                    </div>
                    <p className="mt-1 text-surface-500">{p.hint}</p>
                    {report ? (
                      <p className="mt-1.5 text-[11px] text-surface-500">
                        {report.ok ? (
                          <span className="font-medium text-emerald-400">
                            {report.matches} fetched · {report.contributed} on the board
                          </span>
                        ) : (
                          <span className="font-medium text-amber-400">
                            unreachable{report.error ? ` — ${report.error.slice(0, 48)}` : ""}
                          </span>
                        )}
                        {report.elapsedMs > 0 ? ` · ${report.elapsedMs}ms` : ""}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {data.sportsDbKey.fallback ? (
              <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400">
                TheSportsDB rejected the configured key, so the public key is in use — coverage is limited until
                a valid SPORTSDB_API_KEY is set.
              </p>
            ) : null}
          </section>

          {/* Favourite alerts */}
          <section className="mt-5 rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
              <Sparkles className="h-4 w-4 text-brand-500" /> Favourite alerts
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Stat label="Sent (24h)" value={fmt(data.notifications.sent24h)} />
              <Stat label="Favourited fixtures" value={fmt(data.notifications.reminders)} />
              <Stat
                label="Last sent"
                value={data.notifications.lastSentAt ? new Date(data.notifications.lastSentAt).toLocaleTimeString() : "—"}
              />
            </div>
            <p className="mt-2 text-[11px] text-surface-500">
              Kick-off, live, full-time and settled-pick alerts are fanned out every five minutes. Each
              (reader, fixture, event) is sent once — the log is the guarantee.
            </p>
          </section>

          {/* Referral form */}
          {showForm ? (
            <section className="mt-5 rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
              <h2 className="text-sm font-semibold text-surface-100">
                {editingId ? "Edit partner" : "New betting partner"}
              </h2>
              <p className="mt-1 text-xs text-surface-500">
                Use <code className="rounded px-1 bg-surface-800">{"{code}"}</code> in the destination
                and the code is woven in server-side at click time — it never appears in page source.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Partner name">
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Betika" className={inputCls} />
                </Field>
                <Field label="Referral code">
                  <input value={form.referralCode} onChange={(e) => setForm({ ...form, referralCode: e.target.value })} placeholder="CONNECTPLUS" className={inputCls} />
                </Field>
                <Field label="Destination URL template" className="sm:col-span-2">
                  <input
                    value={form.urlTemplate}
                    onChange={(e) => setForm({ ...form, urlTemplate: e.target.value })}
                    placeholder="https://partner.example/signup?ref={code}&utm_source=connectplus"
                    className={inputCls}
                  />
                </Field>
                <Field label="Placement">
                  <select value={form.placement} onChange={(e) => setForm({ ...form, placement: e.target.value })} className={inputCls}>
                    {Object.entries(PLACEMENT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Region tag">
                  <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="KE" className={inputCls} />
                </Field>
                <Field label="Bonus / offer">
                  <input value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value })} placeholder="100% first-deposit match" className={inputCls} />
                </Field>
                <Field label="CTA text">
                  <input value={form.ctaText} onChange={(e) => setForm({ ...form, ctaText: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Logo URL">
                  <input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…/logo.png" className={inputCls} />
                </Field>
                <Field label="Weight (higher shows first)">
                  <input type="number" min={1} max={100} value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} className={inputCls} />
                </Field>
                <Field label="Starts">
                  <input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Ends">
                  <input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={cn(inputCls, "resize-y")} />
                </Field>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={resetForm} className="rounded-xl border px-4 py-2.5 text-sm font-medium border-surface-700 text-surface-300">
                  Cancel
                </button>
                <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {editingId ? "Save changes" : "Add partner"}
                </button>
              </div>
            </section>
          ) : null}

          {/* Activity chart */}
          <section className="mt-5 rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
              <Activity className="h-4 w-4 text-brand-500" /> Hub activity (14 days)
            </h2>
            <div className="mt-3 flex h-28 items-end gap-1">
              {data.activity.days.map((d) => {
                const total = d.impressions + d.clicks + d.views;
                const max = Math.max(...data.activity.days.map((x) => x.impressions + x.clicks + x.views), 1);
                return (
                  <div key={d.date} className="group flex flex-1 flex-col items-center justify-end gap-0.5" title={`${d.date}: ${d.impressions} impressions, ${d.clicks} clicks, ${d.views} views`}>
                    <div className="w-full rounded-t bg-brand-500/70" style={{ height: `${Math.max(2, (total / max) * 100)}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-surface-500">
              {Object.entries(data.activity.series).map(([type, count]) => (
                <span key={type}>
                  <span className="font-semibold text-surface-200">{count}</span> {type.replace(/_/g, " ")}
                </span>
              ))}
              {Object.keys(data.activity.series).length === 0 ? <span>No activity recorded yet.</span> : null}
            </div>
          </section>

          {/* Partners */}
          <section className="mt-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-surface-100">
              <Megaphone className="h-4 w-4 text-brand-500" /> Referral partners
            </h2>
            {data.referrals.length === 0 ? (
              <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-surface-500 border-surface-700">
                No partners yet. Add one and it appears on the livescore page instantly.
              </div>
            ) : (
              <div className="space-y-3">
                {data.referrals.map((r) => (
                  <article key={r.id} className="flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center border-surface-800 bg-surface-900/40">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-surface-50">{r.name}</h3>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", r.isActive ? "bg-emerald-500/15 text-emerald-600" : "bg-surface-800/40 text-surface-500")}>
                          {r.isActive ? "Live" : "Paused"}
                        </span>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-surface-800 text-surface-300">
                          {PLACEMENT_LABELS[r.placement] ?? r.placement}
                        </span>
                        {r.referralCode ? (
                          <span className="rounded-full bg-brand-500/10 px-2 py-0.5 font-mono text-[10px] text-brand-600">{r.referralCode}</span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-surface-500">{r.urlTemplate}</p>
                      <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-surface-500">
                        <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> {fmt(r.impressions)}</span>
                        <span className="inline-flex items-center gap-1"><MousePointerClick className="h-3.5 w-3.5" /> {fmt(r.clicks)}</span>
                        {r.impressions > 0 ? <span className="font-medium text-surface-300">{((r.clicks / r.impressions) * 100).toFixed(2)}% CTR</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => runAction("toggle-referral", { id: r.id })} disabled={busy} className={btnCls}>
                        {r.isActive ? <ToggleRight className="h-4 w-4 text-emerald-500" /> : <ToggleLeft className="h-4 w-4" />}
                        {r.isActive ? "Pause" : "Activate"}
                      </button>
                      <button onClick={() => startEdit(r)} className={btnCls}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <Link href="/sports" target="_blank" className={btnCls}>
                        <ExternalLink className="h-3.5 w-3.5" /> View
                      </Link>
                      <button
                        onClick={() => {
                          if (confirm(`Delete partner “${r.name}”?`)) void runAction("delete-referral", { id: r.id });
                        }}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs font-medium transition hover:bg-red-500/10 text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {/* Trends */}
            <section className="rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
                <Sparkles className="h-4 w-4 text-brand-500" /> Learned competition trends
              </h2>
              <div className="mt-3 space-y-2">
                {data.trends.length === 0 ? (
                  <p className="text-xs text-surface-500">No learned trends yet — run the analyser after a live matchday.</p>
                ) : (
                  data.trends.map((t) => (
                    <div key={t.competition} className="flex items-center justify-between text-xs">
                      <span className="truncate text-surface-200">{t.competition}</span>
                      <span className="shrink-0 text-surface-500">
                        {t.matches} matches · {t.live} live · {t.avgGoals} goals/game
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Recent predictions */}
            <section className="rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
                <Target className="h-4 w-4 text-brand-500" /> Recent picks
              </h2>
              <div className="mt-3 space-y-2">
                {data.predictions.length === 0 ? (
                  <p className="text-xs text-surface-500">No picks generated yet.</p>
                ) : (
                  data.predictions.slice(0, 8).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="truncate text-surface-200">
                          {p.match.homeTeam} vs {p.match.awayTeam}
                        </p>
                        <p className="flex items-center gap-1.5 truncate text-surface-500">
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface-800 text-surface-300">
                            {MARKET_LABELS[p.market] ?? p.market}
                          </span>
                          <span className="truncate">{p.selection}</span>
                        </p>
                        {/*
                          Whether this pick had a price to argue against. A pick
                          with no `valueEdge` was made with its back to the
                          market — which is a different claim from "we checked
                          the price and it was fair", and the difference belongs
                          on the row rather than in an operator's head.
                        */}
                        <p className="mt-0.5 text-[10px] text-surface-500">
                          {p.valueEdge == null ? (
                            <span className="text-amber-400">no price to compare</span>
                          ) : (
                            <span>
                              {p.valueEdge > 0 ? "+" : ""}
                              {p.valueEdge.toFixed(1)} pts vs the market
                            </span>
                          )}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          p.status === "WON"
                            ? "bg-emerald-500/15 text-emerald-600"
                            : p.status === "LOST"
                              ? "bg-red-500/15 text-red-500"
                              : "bg-surface-800 text-surface-300"
                        )}
                      >
                        {p.status === "PENDING" ? `${Math.round(p.confidence * 100)}%` : p.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <p className="mt-6 text-xs text-surface-500">
            Need creatives in the sports slots? Manage them in{" "}
            <Link href="/admin/ads" className="text-brand-500 hover:underline">Monetization → campaigns</Link>{" "}
            (slots: sports-hero, sports-inline, sports-sidebar).
          </p>
        </>
      ) : null}
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 bg-surface-900 text-surface-50 border-surface-700";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:border-brand-500/50 border-surface-700 text-surface-300";

function AdminTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition",
        active
          ? "bg-brand-500 text-white shadow-sm"
          : "text-surface-500 hover:text-surface-100"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-medium text-surface-300">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-3 border-surface-800 bg-surface-900/40">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-surface-500">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-lg font-bold text-surface-50">{value}</p>
      {sub ? <p className="text-[11px] text-surface-500">{sub}</p> : null}
    </div>
  );
}
