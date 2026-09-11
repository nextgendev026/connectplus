"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  KeyRound,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Sparkles,
  Save,
  RefreshCw,
  ChevronDown,
  Power,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProviderInfo {
  name: string;
  label: string;
  note: string;
  hasKey: boolean;
  keyHint: string | null;
  model: string;
  models: string[];
}

export default function AgentControlPanel({ canWrite = true }: { canWrite?: boolean }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [active, setActive] = useState<string>("builtin");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [drafts, setDrafts] = useState<Record<string, { apiKey: string; model: string }>>({});
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai/agents", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setProviders(data.providers ?? []);
      setActive(data.active ?? "builtin");
      setDrafts(
        Object.fromEntries(
          (data.providers ?? []).map((p: ProviderInfo) => [p.name, { apiKey: "", model: p.model }])
        )
      );
    } catch {
      setResults((r) => ({ ...r, _load: { ok: false, message: "Could not load agents." } }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(name: string, action: "test" | "save") {
    setBusy(`${name}:${action}`);
    const draft = drafts[name] ?? { apiKey: "", model: "" };
    try {
      const res = await fetch("/api/admin/ai/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, provider: name, apiKey: draft.apiKey, model: draft.model }),
      });
      const data = await res.json();
      if (action === "save") {
        if (!res.ok) throw new Error(data.error ?? "Save failed");
        setResults((r) => ({ ...r, [name]: { ok: true, message: "Saved — this agent is now active." } }));
        await load();
      } else {
        setResults((r) => ({
          ...r,
          [name]: {
            ok: Boolean(data.ok),
            message: data.ok
              ? `Live · ${data.latencyMs}ms${data.reply ? ` · "${data.reply}"` : ""}`
              : data.detail || "No response from provider",
          },
        }));
      }
    } catch (e) {
      setResults((r) => ({
        ...r,
        [name]: { ok: false, message: e instanceof Error ? e.message : "Request failed" },
      }));
    } finally {
      setBusy(null);
    }
  }

  /** Quick-switch: save the provider + current model as active in one click */
  async function switchTo(name: string) {
    setSwitching(true);
    const draft = drafts[name] ?? { apiKey: "", model: "" };
    try {
      const res = await fetch("/api/admin/ai/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", provider: name, apiKey: draft.apiKey, model: draft.model }),
      });
      if (res.ok) {
        setActive(name);
        setResults((r) => ({ ...r, [name]: { ok: true, message: "Switched — this is now the default AI." } }));
      }
    } catch { /* ignore */ }
    setSwitching(false);
  }

  return (
    <section
      id="agents"
      className="rounded-2xl border border-surface-200/70 bg-surface-50 p-4 sm:p-5 dark:border-surface-800 dark:bg-surface-900/40"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-surface-900 dark:text-surface-50">AI Agents</h2>
          <p className="text-xs text-surface-500">
            Inject provider keys, pick a model, and set the default AI that powers inline curation, the Brain Copilot and brain training.
          </p>
        </div>
        <span
          className={cn(
            "ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
            active === "builtin"
              ? "bg-surface-200/70 text-surface-600"
              : "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
          )}
        >
          <span className="flex items-center gap-1">
            {active !== "builtin" ? <Wifi className="h-3 w-3" /> : <Power className="h-3 w-3" />}
            default: {active}
          </span>
        </span>
        <button
          onClick={() => void load()}
          className="rounded-lg border border-surface-200 p-2 text-surface-500 transition hover:border-brand-500/50 dark:border-surface-700"
          aria-label="Refresh agents"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      {results._load ? (
        <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {results._load.message}
        </p>
      ) : null}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-surface-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Fetching available models…
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {providers.map((prov) => {
            const draft = drafts[prov.name] ?? { apiKey: "", model: prov.model };
            const result = results[prov.name];
            const isDefault = active === prov.name;
            return (
              <article
                key={prov.name}
                className={cn(
                  "rounded-xl border p-3 transition-all duration-200",
                  isDefault
                    ? "border-brand-500/50 bg-brand-500/5 ring-1 ring-brand-500/20"
                    : "border-surface-200/70 bg-white dark:border-surface-800 dark:bg-surface-900"
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-50">{prov.label}</h3>
                  {prov.hasKey ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <KeyRound className="h-3 w-3" /> {prov.keyHint}
                    </span>
                  ) : (
                    <span className="rounded-full bg-surface-200/70 px-2 py-0.5 text-[10px] font-semibold text-surface-500">
                      no key
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-surface-500">
                    {prov.models.length} model{prov.models.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-surface-500">{prov.note}</p>

                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-surface-600 dark:text-surface-300">
                      API key
                    </span>
                    <input
                      type="password"
                      autoComplete="off"
                      disabled={!canWrite}
                      value={draft.apiKey}
                      onChange={(e) => setDrafts((d) => ({ ...d, [prov.name]: { ...draft, apiKey: e.target.value } }))}
                      placeholder={prov.hasKey ? "Replace key…" : "sk-…"}
                      className="w-full rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs text-surface-900 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-surface-600 dark:text-surface-300">
                      Model ({prov.models.length} available)
                    </span>
                    <div className="relative">
                      <select
                        disabled={!canWrite}
                        value={draft.model}
                        onChange={(e) => setDrafts((d) => ({ ...d, [prov.name]: { ...draft, model: e.target.value } }))}
                        className="w-full appearance-none rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 pr-7 text-xs text-surface-900 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-50"
                      >
                        {prov.models.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-400" />
                    </div>
                  </label>
                </div>

                {result ? (
                  <p
                    className={cn(
                      "mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium",
                      result.ok ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-600"
                    )}
                  >
                    {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    <span className="min-w-0 truncate">{result.message}</span>
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-2">
                  {!isDefault && prov.hasKey ? (
                    <button
                      onClick={() => void switchTo(prov.name)}
                      disabled={busy !== null || !canWrite || switching}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-500 to-accent-coral px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:shadow-md disabled:opacity-50"
                    >
                      {switching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Set as Default
                    </button>
                  ) : isDefault ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-2.5 py-1 text-[10px] font-semibold text-brand-600 dark:text-brand-400">
                      <Sparkles className="h-3 w-3" /> Active Default
                    </span>
                  ) : null}
                  <button
                    onClick={() => void act(prov.name, "test")}
                    disabled={busy !== null || !canWrite}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-700 transition hover:border-brand-500/50 disabled:opacity-50 dark:border-surface-700 dark:text-surface-100"
                  >
                    {busy === `${prov.name}:test` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    Test
                  </button>
                  <button
                    onClick={() => void act(prov.name, "save")}
                    disabled={busy !== null || !canWrite}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-surface-900 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-surface-700 disabled:opacity-50 dark:bg-surface-700 dark:hover:bg-surface-600"
                  >
                    {busy === `${prov.name}:save` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-[11px] text-surface-400">
        Keys are stored in the settings store and never returned to the browser. Testing runs a
        one-token live request so you can verify a key before activating it. &quot;Set as Default&quot; switches the entire platform to use that provider.
      </p>
    </section>
  );
}
