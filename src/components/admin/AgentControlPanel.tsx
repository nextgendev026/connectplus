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
              ? `Live · ${data.latencyMs}ms${data.reply ? ` · “${data.reply}”` : ""}`
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
            Inject provider keys and pick the model that powers inline curation, the Brain Copilot and brain training.
          </p>
        </div>
        <span
          className={cn(
            "ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
            active === "builtin"
              ? "bg-surface-200/70 text-surface-600"
              : "bg-emerald-500/15 text-emerald-600"
          )}
        >
          active: {active}
        </span>
        <button
          onClick={() => void load()}
          className="rounded-lg border border-surface-200 p-2 text-surface-500 transition hover:border-brand-500/50"
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
          <Loader2 className="h-4 w-4 animate-spin" /> Loading providers…
        </div>
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {providers.map((p) => {
            const draft = drafts[p.name] ?? { apiKey: "", model: p.model };
            const result = results[p.name];
            return (
              <article
                key={p.name}
                className={cn(
                  "rounded-xl border p-3",
                  active === p.name
                    ? "border-brand-500/50 bg-brand-500/5"
                    : "border-surface-200/70 bg-white dark:border-surface-800 dark:bg-surface-900"
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-50">{p.label}</h3>
                  {p.hasKey ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                      <KeyRound className="h-3 w-3" /> {p.keyHint}
                    </span>
                  ) : (
                    <span className="rounded-full bg-surface-200/70 px-2 py-0.5 text-[10px] font-semibold text-surface-500">
                      no key
                    </span>
                  )}
                  {active === p.name ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand-600">
                      <Sparkles className="h-3 w-3" /> in use
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] text-surface-500">{p.note}</p>

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
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.name]: { ...draft, apiKey: e.target.value } }))}
                      placeholder={p.hasKey ? "Replace key…" : "sk-…"}
                      className="w-full rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs text-surface-900 outline-none transition focus:border-brand-500 dark:bg-surface-900 dark:text-surface-50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-surface-600 dark:text-surface-300">
                      Model
                    </span>
                    <input
                      list={`models-${p.name}`}
                      disabled={!canWrite}
                      value={draft.model}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.name]: { ...draft, model: e.target.value } }))}
                      className="w-full rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs text-surface-900 outline-none transition focus:border-brand-500 dark:bg-surface-900 dark:text-surface-50"
                    />
                    <datalist id={`models-${p.name}`}>
                      {p.models.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </label>
                </div>

                {result ? (
                  <p
                    className={cn(
                      "mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium",
                      result.ok ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-600"
                    )}
                  >
                    {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    <span className="min-w-0 truncate">{result.message}</span>
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => void act(p.name, "test")}
                    disabled={busy !== null || !canWrite}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-700 transition hover:border-brand-500/50 disabled:opacity-50 dark:text-surface-100"
                  >
                    {busy === `${p.name}:test` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    Test
                  </button>
                  <button
                    onClick={() => void act(p.name, "save")}
                    disabled={busy !== null || !canWrite}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
                  >
                    {busy === `${p.name}:save` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Use this agent
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-[11px] text-surface-400">
        Keys are stored encrypted in the settings store and never returned to the browser. Testing runs a
        one-token live request so you can verify a key before activating it.
      </p>
    </section>
  );
}
