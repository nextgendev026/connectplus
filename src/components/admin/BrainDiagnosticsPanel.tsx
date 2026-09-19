"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  Bug,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Shield,
  Stethoscope,
  Wrench,
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
import type { BrainIssue } from "@/lib/brain-issues";
import type { RepairMode, RepairOutcome } from "@/lib/brain-repair";

/**
 * The brain, looking at itself — and reporting what it did about it.
 *
 * Every incident this platform has had was found by a person noticing a number
 * looked wrong, and the tooling that existed could only answer "is it
 * configured" and "did it run recently", neither of which is "is it *working*".
 * This panel is the missing question, in three layers:
 *
 *   1. **What the probes found** — findings with a fix, not a boolean. A check
 *      that could not run is reported as unmeasurable rather than healthy.
 *   2. **What has persisted** — the issue register. A finding is only filed once
 *      it has survived three consecutive examinations, so the list is standing
 *      faults rather than the last bad night, and the brain closes an issue
 *      itself when a run stops finding it. That closure is the half most alerting
 *      omits, and the reason a stale red dashboard gets ignored.
 *   3. **What it was allowed to do** — the envelope. `observe` records the repair
 *      it would have run; `enforce` lets it run. The mode is visible here rather
 *      than buried in settings because it is the one control that decides whether
 *      this page's subject is advice or action.
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

const REPAIR_TONE: Record<RepairOutcome["outcome"], "positive" | "warning" | "neutral" | "danger"> = {
  applied: "positive",
  observed: "warning",
  skipped: "neutral",
  failed: "danger",
};

interface EnvelopeState {
  mode: RepairMode;
  catalog: { id: string; findingId: string; title: string; why: string }[];
  maxPerRun: number;
}

interface BrainPayload {
  status: BrainStatus;
  lastDiagnosis: BrainDiagnosis | null;
  issues: { open: BrainIssue[]; resolved: BrainIssue[] };
  repairs: { mode: RepairMode; repairs: RepairOutcome[]; memoryId: string | null } | null;
  envelope: EnvelopeState;
}

export function BrainDiagnosticsPanel() {
  const [payload, setPayload] = useState<BrainPayload | null>(null);
  const [diagnosis, setDiagnosis] = useState<BrainDiagnosis | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busyIssue, setBusyIssue] = useState<string | null>(null);
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

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/admin/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      return data as Partial<BrainPayload> & { diagnosis?: BrainDiagnosis };
    },
    []
  );

  const runDiagnosis = useCallback(
    async (live: boolean) => {
      setRunning(true);
      setError(null);
      try {
        const data = await post({ action: "diagnose", live, alert: true });
        if (data.diagnosis) setDiagnosis(data.diagnosis);
        setPayload((prev) =>
          prev ? { ...prev, status: data.status ?? prev.status, issues: data.issues ?? prev.issues } : prev
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Diagnosis failed");
      } finally {
        setRunning(false);
      }
    },
    [post]
  );

  const closeIssueById = useCallback(
    async (id: string) => {
      setBusyIssue(id);
      setError(null);
      try {
        const data = await post({ action: "close-issue", id });
        if (data.issues) setPayload((prev) => (prev ? { ...prev, issues: data.issues! } : prev));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not close the issue");
      } finally {
        setBusyIssue(null);
      }
    },
    [post]
  );

  const setMode = useCallback(
    async (mode: RepairMode) => {
      setError(null);
      try {
        await post({ action: "set-mode", mode });
        setPayload((prev) =>
          prev ? { ...prev, envelope: { ...prev.envelope, mode } } : prev
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not change the envelope");
      }
    },
    [post]
  );

  if (!payload && !error && !loading) return null;

  const overall = diagnosis ? OVERALL[diagnosis.overall] : null;
  const openIssues = payload?.issues.open ?? [];
  const resolvedIssues = payload?.issues.resolved ?? [];
  const repairs = payload?.repairs;
  const envelope = payload?.envelope;

  return (
    <AdminPanel
      title="Brain diagnostics"
      description="The hive, the neural mind and the platform senses, checking themselves — and the register of what has stayed broken."
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
            {openIssues.length > 0 ? (
              <AdminBadge tone="warning">
                <Bug className="h-3 w-3" />
                {openIssues.length} open issue{openIssues.length === 1 ? "" : "s"}
              </AdminBadge>
            ) : null}
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

          {/* ── The issue register ─────────────────────────────────────────── */}
          <section className="mt-4 rounded-xl border border-surface-800 bg-surface-950/40 p-3">
            <h3 className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-surface-300">
              <Bug className="h-3.5 w-3.5 text-warning-strong" />
              Tracked issues
              <span className="font-normal normal-case tracking-normal text-surface-500">
                filed after three consecutive diagnoses; closed by the brain when a run stops finding them
              </span>
            </h3>

            {openIssues.length === 0 ? (
              <p className="mt-2 text-[12px] text-surface-500">
                Nothing is standing. A finding has to survive three consecutive diagnoses before it is filed here.
              </p>
            ) : (
              <ul className="mt-2.5 space-y-2">
                {openIssues.map((issue) => (
                  <li key={issue.id} className="rounded-lg border border-surface-800 bg-surface-900/50 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <AdminBadge tone={SEVERITY[issue.severity].tone}>
                        {SEVERITY[issue.severity].label}
                      </AdminBadge>
                      <span className="text-[13px] font-semibold text-surface-100">{issue.title}</span>
                      <span className="text-[11px] text-surface-500">
                        seen {issue.occurrences}× · first {timeAgo(issue.firstSeenAt)} · last {timeAgo(issue.lastSeenAt)}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        {issue.externalUrl ? (
                          <a
                            href={issue.externalUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-strong hover:underline"
                          >
                            {issue.externalProvider ?? "tracker"}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void closeIssueById(issue.id)}
                          disabled={busyIssue === issue.id}
                          className="rounded-lg border border-surface-700 px-2 py-1 text-[11px] font-medium text-surface-400 transition hover:text-surface-100 disabled:opacity-40"
                        >
                          {busyIssue === issue.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Mark resolved"}
                        </button>
                      </div>
                    </div>
                    <p className="mt-1.5 break-words font-mono text-[11px] leading-relaxed text-surface-400">
                      {issue.detail}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-surface-400">
                      <span className="font-semibold text-surface-300">Suspect: </span>
                      <span className="font-mono">{issue.subsystem}</span>
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-surface-300">
                      <span className="font-semibold text-accent-strong">Fix: </span>
                      {issue.fix}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {resolvedIssues.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] font-medium text-surface-400 hover:text-surface-200">
                  Recently closed ({resolvedIssues.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {resolvedIssues.map((issue) => (
                    <li key={issue.id} className="flex flex-wrap items-center gap-2 text-[11px] text-surface-500">
                      <CheckCircle2 className="h-3 w-3 text-positive-strong" />
                      <span className="text-surface-400">{issue.title}</span>
                      <span>· resolved {issue.resolvedAt ? timeAgo(issue.resolvedAt) : "—"}</span>
                      {issue.externalUrl ? (
                        <a
                          href={issue.externalUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-accent-strong hover:underline"
                        >
                          tracker
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          {/* ── The self-heal envelope ─────────────────────────────────────── */}
          {envelope ? (
            <section className="mt-4 rounded-xl border border-surface-800 bg-surface-950/40 p-3">
              <h3 className="flex flex-wrap items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-surface-300">
                <Shield className="h-3.5 w-3.5 text-accent-strong" />
                Self-healing envelope
                <span className="font-normal normal-case tracking-normal text-surface-500">
                  at most {envelope.maxPerRun} repairs per diagnosis, all logged
                </span>
              </h3>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {(["off", "observe", "enforce"] as RepairMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => void setMode(mode)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition",
                      envelope.mode === mode
                        ? mode === "enforce"
                          ? "border-warning-strong/40 bg-warning-strong/10 text-warning-strong"
                          : "border-brand-500/40 bg-brand-500/10 text-accent-strong"
                        : "border-surface-700 text-surface-400 hover:text-surface-100"
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-surface-400">
                {envelope.mode === "off"
                  ? "Off: the brain reports findings and does nothing about them."
                  : envelope.mode === "observe"
                    ? "Observe: each eligible repair is recorded with what it would have done, and nothing is run. This is the default."
                    : "Enforce: eligible repairs are run and logged with their outcome. Confirmation comes from the next diagnosis, not from the repair."}
              </p>

              {repairs && repairs.repairs.length > 0 ? (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">
                    Last run ({repairs.mode})
                  </p>
                  <ul className="mt-1.5 space-y-1.5">
                    {repairs.repairs.map((r) => (
                      <li key={`${r.repairId}-${r.at}`} className="rounded-lg border border-surface-800 bg-surface-900/50 p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Wrench className="h-3 w-3 text-surface-400" />
                          <span className="text-[12px] font-medium text-surface-200">{r.title}</span>
                          <AdminBadge tone={REPAIR_TONE[r.outcome]}>{r.outcome}</AdminBadge>
                          <span className="text-[10px] text-surface-500">{timeAgo(r.at)}</span>
                        </div>
                        <p className="mt-1 break-words text-[11px] leading-relaxed text-surface-400">{r.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] font-medium text-surface-400 hover:text-surface-200">
                  What the brain is permitted to do
                </summary>
                <ul className="mt-2 space-y-2">
                  {envelope.catalog.map((r) => (
                    <li key={r.id} className="rounded-lg border border-surface-800 bg-surface-900/40 p-2.5">
                      <p className="text-[12px] font-semibold text-surface-200">{r.title}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-surface-500">
                        authorises on: {r.findingId}
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-surface-400">{r.why}</p>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
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
