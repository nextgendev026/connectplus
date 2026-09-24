"use client";

/**
 * The intelligence pipeline, as the operator sees it.
 *
 * This panel exists because the pipeline's newest parts are all *invisible by
 * default*: a tool that refuses for want of an approval looks the same as a tool
 * that was never offered, a record intent that bypassed the model looks the same as
 * a model that declined, and a calibration that was capped at its bound looks the
 * same as one that converged. Every one of those distinctions changes what the
 * operator should do next, so this panel states them rather than leaving them to be
 * inferred from behaviour.
 *
 * Nothing here is a copy of the configuration. The tool registry, the allowlist and
 * the calibration values are all read back from the running system by the endpoint,
 * so the panel cannot describe a pipeline that no longer exists.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminBadge, AdminPanel, adminBtnGhost, adminBtnPrimary } from "@/components/admin/AdminUI";

interface ToolRow {
  name: string;
  tier: "low" | "medium" | "high";
  requiresApproval: boolean;
  blastRadius: string;
}

interface CalibrationRow {
  key: string;
  value: number;
  bounds: readonly [number, number];
  updatedAt: string | null;
  saturated: boolean;
}

interface PipelineStatus {
  runtime: { modelConfigured: boolean; model: string; autonomy: string; note: string };
  tools: ToolRow[];
  guardrails: {
    shell: string;
    commandAllowlist: string[];
    allowlistSize: number;
    approval: {
      scheme: string;
      ttlSeconds: number;
      secretConfigured: boolean;
      boundToArguments: boolean;
      note: string;
    };
    riskTiers: Record<string, string>;
  };
  routing: {
    classifierVersion: string;
    recordIntents: string[];
    mutatingIntents: string[];
    note: string;
  };
  repository:
    | { branch: string | null; dirty: string[]; lastCommit: string; clean: boolean }
    | { unavailable: true; reason: string };
  calibration: Record<string, CalibrationRow>;
  predictionLedger: Array<{ market: string; status: string; count: number }>;
}

const TIER_TONE: Record<ToolRow["tier"], "positive" | "warning" | "danger"> = {
  low: "positive",
  medium: "warning",
  high: "danger",
};

/** Markets the calibration endpoint accepts. */
const MARKETS = ["1X2", "over-under", "btts", "double-chance"] as const;

export function AgentPipelinePanel() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState<string>(MARKETS[0]);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationResult, setCalibrationResult] = useState<unknown>(null);
  const [showAllowlist, setShowAllowlist] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/neural/agent", { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Could not read the pipeline (HTTP ${res.status}).`);
        return;
      }
      setStatus((await res.json()) as PipelineStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the pipeline.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred by a task rather than called inline: `load` sets its loading flag
    // synchronously, and doing that inside the effect body is what React reports as
    // a cascading render. The timer also gives the effect a cleanup, so a panel
    // unmounted mid-fetch does not resolve into a dead component.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const calibrate = async () => {
    setCalibrating(true);
    setCalibrationResult(null);
    try {
      const res = await fetch("/api/admin/neural/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "calibrate", market }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { result?: unknown; error?: string; reason?: string }
        | null;
      setCalibrationResult(
        res.ok ? payload?.result : { refused: true, message: payload?.reason ?? payload?.error },
      );
      if (res.ok) await load();
    } catch (err) {
      setCalibrationResult({ refused: true, message: err instanceof Error ? err.message : "The request failed." });
    } finally {
      setCalibrating(false);
    }
  };

  if (loading && !status) {
    return (
      <AdminPanel title="Intelligence pipeline" icon={Wrench} flush>
        <div className="flex items-center gap-2 p-6 text-[12px] text-surface-400">
          <RefreshCw className="h-4 w-4 animate-spin" /> Reading the pipeline…
        </div>
      </AdminPanel>
    );
  }

  if (error && !status) {
    return (
      <AdminPanel title="Intelligence pipeline" icon={Wrench} flush>
        <p role="alert" className="border-b border-red-500/20 bg-red-500/10 p-4 text-[12px] text-danger-strong">
          {error}
        </p>
      </AdminPanel>
    );
  }

  if (!status) return null;

  const ledgerByMarket = status.predictionLedger.reduce<Record<string, Record<string, number>>>((acc, row) => {
    acc[row.market] = acc[row.market] ?? {};
    acc[row.market]![row.status] = row.count;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <AdminPanel
        title="Runtime"
        description="What is armed right now, and what that means for a request this console makes."
        icon={Wrench}
      >
        <div className="flex flex-wrap items-center gap-2">
          <AdminBadge tone={status.runtime.modelConfigured ? "positive" : "warning"}>
            {status.runtime.modelConfigured ? "Model armed" : "No model"}
          </AdminBadge>
          <AdminBadge tone="info">{status.runtime.model}</AdminBadge>
          <AdminBadge tone="info">autonomy: {status.runtime.autonomy}</AdminBadge>
          <button type="button" onClick={() => void load()} className={cn(adminBtnGhost, "ml-auto")}>
            <RefreshCw className={cn("mr-1.5 inline h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </button>
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-surface-400">{status.runtime.note}</p>
      </AdminPanel>

      <AdminPanel
        title="Tool registry"
        description="Read back from the same registry the loop dispatches through. Risk tier decides what runs unattended."
        icon={Wrench}
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-surface-800 text-[10px] uppercase tracking-wide text-surface-500">
                <th className="px-3.5 py-2 font-semibold">Tool</th>
                <th className="px-3.5 py-2 font-semibold">Tier</th>
                <th className="px-3.5 py-2 font-semibold">Approval</th>
                <th className="px-3.5 py-2 font-semibold">Blast radius</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {status.tools.map((tool) => (
                <tr key={tool.name}>
                  <td className="px-3.5 py-2.5 font-mono text-[11px] text-surface-100">{tool.name}</td>
                  <td className="px-3.5 py-2.5">
                    <AdminBadge tone={TIER_TONE[tool.tier]}>{tool.tier}</AdminBadge>
                  </td>
                  <td className="px-3.5 py-2.5 text-surface-300">
                    {tool.requiresApproval ? (
                      <span className="inline-flex items-center gap-1 text-violet-300">
                        <ShieldCheck className="h-3 w-3" /> Super Admin
                      </span>
                    ) : (
                      <span className="text-surface-500">—</span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-[11px] leading-relaxed text-surface-400">{tool.blastRadius}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Guardrails"
        description="The limits the agent runs inside. These are enforcement, not documentation."
        icon={ShieldCheck}
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-3">
            <p className="text-[11px] font-semibold text-surface-200">Shell</p>
            <p className="mt-1 text-[11px] leading-relaxed text-surface-400">{status.guardrails.shell}</p>
          </div>

          <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-surface-200">
                Command allowlist · {status.guardrails.allowlistSize} entries
              </p>
              <button type="button" onClick={() => setShowAllowlist((v) => !v)} className={adminBtnGhost}>
                {showAllowlist ? "Hide" : "Show"}
              </button>
            </div>
            {showAllowlist ? (
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {status.guardrails.commandAllowlist.map((command) => (
                  <li key={command} className="rounded-lg border border-surface-800 bg-black/25 px-2 py-1 font-mono text-[10px] text-surface-300">
                    {command}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-surface-500">
                Anything not on this list is refused outright — the agent is told to adapt, not to retry.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold text-violet-100">Approval gate</p>
              <AdminBadge tone={status.guardrails.approval.secretConfigured ? "positive" : "danger"}>
                {status.guardrails.approval.secretConfigured ? "signing key present" : "no signing key"}
              </AdminBadge>
              <AdminBadge tone="info">ttl {status.guardrails.approval.ttlSeconds}s</AdminBadge>
              {status.guardrails.approval.boundToArguments ? (
                <AdminBadge tone="info">bound to arguments</AdminBadge>
              ) : null}
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-surface-400">{status.guardrails.approval.scheme}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-surface-400">{status.guardrails.approval.note}</p>
            {!status.guardrails.approval.secretConfigured ? (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-danger-strong">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Without a signing key no approval can be issued, so every high-risk tool refuses. That is the safe
                direction — but it is a capability the console cannot exercise until it is set.
              </p>
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(status.guardrails.riskTiers).map(([tier, text]) => (
              <div key={tier} className="rounded-xl border border-surface-800 bg-surface-900/50 p-3">
                <AdminBadge tone={TIER_TONE[tier as ToolRow["tier"]]}>{tier}</AdminBadge>
                <p className="mt-1.5 text-[11px] leading-relaxed text-surface-400">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Intent routing"
        description="Which questions are answered from the platform's own records, and which may reach the model."
        icon={Wrench}
      >
        <p className="text-[11px] leading-relaxed text-surface-400">{status.routing.note}</p>
        <p className="mt-2 font-mono text-[10px] text-surface-500">classifier {status.routing.classifierVersion}</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
            <p className="text-[11px] font-semibold text-emerald-200">
              Grounded · never sent to the model ({status.routing.recordIntents.length})
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {status.routing.recordIntents.map((intent) => (
                <li key={intent} className="rounded-full border border-surface-700 bg-surface-900/60 px-2 py-0.5 font-mono text-[10px] text-surface-300">
                  {intent}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
            <p className="text-[11px] font-semibold text-amber-200">
              Mutating · may file a change ({status.routing.mutatingIntents.length})
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {status.routing.mutatingIntents.map((intent) => (
                <li key={intent} className="rounded-full border border-surface-700 bg-surface-900/60 px-2 py-0.5 font-mono text-[10px] text-surface-300">
                  {intent}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </AdminPanel>

      <AdminPanel
        title="Prediction calibration"
        description="The two parameters every simulation is built from. Corrections are derived from settled results, and hard-bounded."
        icon={Wrench}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.values(status.calibration).map((row) => {
            const span = row.bounds[1] - row.bounds[0];
            const pct = span > 0 ? ((row.value - row.bounds[0]) / span) * 100 : 50;
            return (
              <div key={row.key} className="rounded-xl border border-surface-800 bg-surface-900/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[10px] text-surface-400">{row.key}</p>
                  {row.saturated ? <AdminBadge tone="warning">at bound</AdminBadge> : null}
                </div>
                <p className="mt-1 text-[18px] font-bold leading-none text-surface-50">{row.value}</p>
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-800">
                  <span
                    className="block h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
                  />
                </span>
                <p className="mt-1 text-[10px] text-surface-500">
                  range {row.bounds[0]}–{row.bounds[1]}
                  {row.updatedAt ? ` · updated ${new Date(row.updatedAt).toLocaleString()}` : " · never calibrated"}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-surface-400" htmlFor="calibration-market">
            Market
          </label>
          <select
            id="calibration-market"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            className="rounded-lg border border-surface-700 bg-surface-900 px-2.5 py-1.5 text-[12px] text-surface-100 outline-none focus:border-brand-500/50"
          >
            {MARKETS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void calibrate()} disabled={calibrating} className={adminBtnPrimary}>
            {calibrating ? "Calibrating…" : "Run calibration"}
          </button>
          <span className="text-[10px] text-surface-500">
            Super Admin only. Refuses when the settled sample is too small — that refusal is the correct answer.
          </span>
        </div>

        {calibrationResult ? (
          <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-surface-700 bg-black/30 p-3 font-mono text-[10px] leading-relaxed text-surface-300">
            {JSON.stringify(calibrationResult, null, 2)}
          </pre>
        ) : null}

        {Object.keys(ledgerByMarket).length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-1.5 text-[11px] font-semibold text-surface-200">Settled prediction ledger</p>
            <table className="w-full min-w-[420px] text-left text-[11px]">
              <thead>
                <tr className="border-b border-surface-800 text-[10px] uppercase tracking-wide text-surface-500">
                  <th className="py-1.5 font-semibold">Market</th>
                  <th className="py-1.5 font-semibold">Won</th>
                  <th className="py-1.5 font-semibold">Lost</th>
                  <th className="py-1.5 font-semibold">Pending</th>
                  <th className="py-1.5 font-semibold">Void</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800">
                {Object.entries(ledgerByMarket).map(([m, byStatus]) => (
                  <tr key={m}>
                    <td className="py-1.5 font-mono text-surface-200">{m}</td>
                    <td className="py-1.5 text-positive-strong">{byStatus.WON ?? 0}</td>
                    <td className="py-1.5 text-danger-strong">{byStatus.LOST ?? 0}</td>
                    <td className="py-1.5 text-surface-400">{byStatus.PENDING ?? 0}</td>
                    <td className="py-1.5 text-surface-500">{byStatus.VOID ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-surface-500">
            No predictions have been filed yet, so there is nothing to calibrate against.
          </p>
        )}
      </AdminPanel>

      <AdminPanel
        title="Repository"
        description="Where the agent's patches would land, and whether the tree is safe to stage on."
        icon={Wrench}
      >
        {"unavailable" in status.repository ? (
          <p className="text-[12px] text-surface-400">{status.repository.reason}</p>
        ) : (
          <div className="space-y-2 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              <AdminBadge tone="info">branch {status.repository.branch ?? "detached"}</AdminBadge>
              <AdminBadge tone={status.repository.clean ? "positive" : "warning"}>
                {status.repository.clean ? "clean" : `${status.repository.dirty.length} modified`}
              </AdminBadge>
            </div>
            <p className="font-mono text-[11px] text-surface-400">{status.repository.lastCommit}</p>
            {!status.repository.clean ? (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                The agent will refuse to stage a patch while the tree is dirty. It will not switch branches over work
                that is not its own.
              </p>
            ) : null}
            {status.repository.dirty.length > 0 ? (
              <ul className="grid gap-1 sm:grid-cols-2">
                {status.repository.dirty.slice(0, 8).map((path) => (
                  <li key={path} className="truncate rounded-lg border border-surface-800 bg-black/25 px-2 py-1 font-mono text-[10px] text-surface-400">
                    {path}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </AdminPanel>
    </div>
  );
}

export default AgentPipelinePanel;
