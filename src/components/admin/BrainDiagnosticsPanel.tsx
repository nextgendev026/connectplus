"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Info,
  Loader2,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import {
  AdminBadge,
  AdminEmpty,
  AdminNotice,
  AdminPanel,
  adminBtnGhost,
} from "@/components/admin/AdminUI";
import type { BrainDiagnosis, BrainStatus } from "@/lib/app-brain";

/**
 * The brain, looking at itself.
 *
 * Every incident this platform has had was found by a person noticing that a
 * number looked wrong — and the tooling that existed could only answer
 * "is it configured" and "did it run recently", neither of which is "is it
 * *working*". This panel is the missing question. It asks the mind to inspect
 * its own subsystems and the code behind them, and it lists what came back as
 * findings with a fix, not as a boolean.
 *
 * Two deliberate choices:
 *
 *  • **A check that cannot run is a finding.** Unmeasurable is reported as
 *    unmeasurable. The failure mode this exists to end is a check that silently
 *    stops running and is read as healthy.
 *  • **Running a diagnosis is an explicit button.** It can send email and write
 *    a hive memory, so it never happens as a side effect of opening a page.
 */
const SEVERITY = {
  critical: { tone: "danger", icon: XCircle, label: "Critical", text: "text-danger-strong" },
  warn: { tone: "warning", icon: AlertTriangle, label: "Warning", text: "text-warning-strong" },
  info: { tone: "info", icon: Info, label: "Note", text: "text-info-strong" },
} as const;

const OVERALL = {
  ok: { tone: "positive", icon: CheckCircle2, label: "All clear" },
  warn: { tone: "warning", icon: AlertTriangle, label: "Attention needed" },
  critical: { tone: "danger", icon: XCircle, label: "Faults found" },
} as const;

interface BrainPayload {
  status: BrainStatus;
  lastDiagnosis: BrainDiagnosis | null;
}

export function BrainDiagnosticsPanel() {
  const [payload, setPayload] = useState<BrainPayload | null>(null);
  const [diagnosis, setDiagnosis] = useState<BrainDiagnosis | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/brain", { credentials: "include", cache: "no-store" });
      if (res.status === 403) {
        setPayload(null);
        return;
      }
      if (!res.ok) throw new Error(`Could not read the brain (${res.status})`);
      const data = (await res.json()) as BrainPayload;
      setPayload(data);
      setDiagnosis(data.lastDiagnosis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the brain");
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- first fetch on mount; the state it sets is the payload itself */
  useEffect(() => {
    void load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const runDiagnosis = useCallback(async (live: boolean) => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ live, alert: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Diagnosis failed (${res.status})`);
      setDiagnosis(data.diagnosis as BrainDiagnosis);
      if (data.status) setPayload((prev) => (prev ? { ...prev, status: data.status } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Diagnosis failed");
    } finally {
      setRunning(false);
    }
  }, []);

  if (!payload && !error && !loading) return null;

  const overall = diagnosis ? OVERALL[diagnosis.overall] : null;

  return (
    <AdminPanel
      title="Brain diagnostics"
      description="The hive, the neural mind and the platform senses, checking themselves — including that their own engines still behave."
      icon={BrainCircuit}
      tone={diagnosis?.overall === "critical" ? "danger" : diagnosis?.overall === "warn" ? "warning" : "neutral"}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {diagnosis ? (
            <span className="text-[11px] text-surface-500">ran {timeAgo(diagnosis.generatedAt)}</span>
          ) : null}
          <button type="button" onClick={() => void runDiagnosis(false)} className={adminBtnGhost} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
            Run diagnosis
          </button>
          <button type="button" onClick={() => void runDiagnosis(true)} className={adminBtnGhost} disabled={running}>
            Run with feeds
          </button>
        </div>
      }
    >
      {error ? <AdminNotice>{error}</AdminNotice> : null}

      {loading && !payload ? (
        <AdminEmpty icon={Loader2} title="Reading the mind…" description="Counting memories and probing subsystems." />
      ) : null}

      {payload ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {overall ? (
              <AdminBadge tone={overall.tone}>
                <overall.icon className="h-3 w-3" />
                {overall.label}
              </AdminBadge>
            ) : (
              <AdminBadge tone="neutral">Not checked yet</AdminBadge>
            )}
            <span className="text-[11px] text-surface-500">
              {payload.status.memories.toLocaleString()} memories · cache {payload.status.cacheBackend} ·{" "}
              {payload.status.capabilities.length} capabilities
            </span>
          </div>

          {!diagnosis ? (
            <p className="mt-3 text-[13px] leading-relaxed text-surface-400">
              The brain has not examined itself since this build shipped. Run a diagnosis to find stalled jobs, a
              dead cache tier and anything the deterministic engines have stopped doing.
            </p>
          ) : null}

          {diagnosis && diagnosis.findings.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-[13px] font-medium text-positive-strong">
              <CheckCircle2 className="h-4 w-4" />
              All {diagnosis.checks} checks passed — {diagnosis.healthy.join(", ")}.
            </p>
          ) : null}

          {diagnosis && diagnosis.findings.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {diagnosis.findings.map((f) => {
                const meta = SEVERITY[f.severity];
                return (
                  <li key={f.id} className="rounded-xl border border-surface-800 bg-surface-900/50 p-3">
                    <div className="flex items-start gap-2">
                      <meta.icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.text)} />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-surface-100">
                          {f.title}
                          <AdminBadge tone={meta.tone}>{f.area}</AdminBadge>
                        </p>
                        <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-surface-400">
                          {f.detail}
                        </p>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-surface-300">
                          <span className="font-semibold text-accent-strong">Fix: </span>
                          {f.fix}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] font-medium text-surface-400 hover:text-surface-200">
              What the brain is made of
            </summary>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {payload.status.subsystems.map((s) => (
                <li key={s.id} className="rounded-lg border border-surface-800 bg-surface-900/40 p-2.5">
                  <p className="flex items-center gap-2 text-[12px] font-semibold text-surface-200">
                    {s.name}
                    <AdminBadge tone="brand">{s.mind}</AdminBadge>
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-surface-400">{s.role}</p>
                  <p className="mt-1.5 font-mono text-[10px] text-surface-500">{s.capabilities.join(" · ")}</p>
                </li>
              ))}
            </ul>
          </details>

          {payload.status.recentMemories.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] font-medium text-surface-400 hover:text-surface-200">
                Recent memories
              </summary>
              <ul className="mt-2 space-y-1.5">
                {payload.status.recentMemories.map((m, i) => (
                  <li key={i} className="rounded-lg border border-surface-800 bg-surface-900/40 px-2.5 py-1.5">
                    <p className="text-[11px] text-surface-400">
                      <span className="font-mono text-[10px] uppercase text-surface-500">{m.source}</span> ·{" "}
                      {timeAgo(m.createdAt)}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-surface-300">{m.content}</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </AdminPanel>
  );
}
