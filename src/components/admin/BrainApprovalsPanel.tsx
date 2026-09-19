"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Clock, Loader2, RefreshCw, ShieldCheck, Stamp, X } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { AdminBadge, AdminEmpty, AdminNotice, AdminPanel, adminBtnGhost } from "@/components/admin/AdminUI";
import type { ProposalDTO } from "@/lib/brain-approvals";

/**
 * The approvals queue.
 *
 * The brain reads the whole platform freely, and this is the price of that
 * freedom: everything it wants to *change* lands here first. The distinction the
 * panel is built to make obvious is that nothing in the top list has happened
 * yet — the summary under each request is generated from the validated
 * arguments, not from the model's own description, so what an approver reads is
 * what will run.
 *
 * A rejected or expired request is not deleted: the history is the record of
 * what the brain asked for and what a human said, which is the only way to spot a
 * mind repeatedly requesting something it should not.
 */
const RISK_TONE: Record<string, "danger" | "warning" | "info"> = {
  high: "danger",
  medium: "warning",
  low: "info",
};

const STATUS_TONE: Record<string, "positive" | "danger" | "neutral" | "warning"> = {
  APPROVED: "positive",
  REJECTED: "neutral",
  FAILED: "danger",
  EXPIRED: "warning",
  PENDING: "warning",
};

export function BrainApprovalsPanel() {
  const [pending, setPending] = useState<ProposalDTO[]>([]);
  const [recent, setRecent] = useState<ProposalDTO[]>([]);
  const [ttlHours, setTtlHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  /** Which card is collecting a rejection reason. */
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brain/approvals", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPending(data.pending ?? []);
      setRecent(data.recent ?? []);
      setTtlHours(data.ttlHours ?? 24);
    } catch {
      setNotice({ kind: "error", text: "Could not read the approval queue." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount; the sync setState inside is the idempotent loading flag.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of a fetched queue
    void load();
  }, [load]);

  const decide = async (id: string, decision: "approve" | "reject", reason?: string) => {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/brain/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, note: reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.pending) setPending(data.pending);
      if (data?.recent) setRecent(data.recent);
      setNotice({ kind: data?.ok ? "ok" : "error", text: data?.message ?? "Done." });
      setRejecting(null);
      setNote("");
    } catch {
      setNotice({ kind: "error", text: "The decision could not be sent." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminPanel
      title="Approvals"
      description={`Writes the brain has requested. Nothing here has happened yet — you are the gate, and a request expires after ${ttlHours}h.`}
      action={
        <div className="flex items-center gap-2">
          {pending.length > 0 && <AdminBadge tone="warning">{pending.length} waiting</AdminBadge>}
          <button type="button" onClick={() => void load()} className={cn(adminBtnGhost, "gap-1.5")}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      }
    >
      {notice && (
        <div className="mb-4">
          <AdminNotice tone={notice.kind === "ok" ? "positive" : "danger"}>{notice.text}</AdminNotice>
        </div>
      )}

      {pending.length === 0 && !loading ? (
        <AdminEmpty
          icon={ShieldCheck}
          title="Nothing waiting"
          description="The brain has not asked to change anything. When it does — publishing, scheduling, or a moderation action — the request appears here with exactly what it would do."
        />
      ) : (
        <ul className="space-y-3">
          {pending.map((proposal) => (
            <li
              key={proposal.id}
              className={cn(
                "rounded-xl border p-4",
                proposal.expired ? "border-surface-800/60 bg-surface-900/20 opacity-70" : "border-surface-800 bg-surface-900/40"
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stamp className="h-4 w-4 text-brand-400" />
                    <span className="text-sm font-semibold text-surface-50">{proposal.label}</span>
                    <AdminBadge tone={RISK_TONE[proposal.risk] ?? "info"}>{proposal.risk} risk</AdminBadge>
                    <span className="text-[11px] text-surface-500">via {proposal.source}</span>
                  </div>
                  {/* The action, derived from the arguments — this is what runs. */}
                  <p className="mt-2 text-xs leading-relaxed text-surface-200">{proposal.summary}</p>
                  {proposal.rationale && proposal.rationale !== proposal.summary && (
                    <p className="mt-1.5 text-[11px] italic leading-relaxed text-surface-500">
                      The brain&apos;s own words: “{proposal.rationale.slice(0, 240)}”
                    </p>
                  )}
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-surface-500">
                    <Clock className="h-3 w-3" />
                    requested {timeAgo(proposal.createdAt)}
                    {proposal.expired && " · expired, will not run"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={busy !== null || proposal.expired}
                    onClick={() => void decide(proposal.id, "approve")}
                    className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {busy === proposal.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Approve & run
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null || proposal.expired}
                    onClick={() => {
                      setRejecting(rejecting === proposal.id ? null : proposal.id);
                      setNote("");
                    }}
                    className={cn(adminBtnGhost, "gap-1.5 disabled:opacity-50")}
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </button>
                </div>
              </div>

              {rejecting === proposal.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-surface-800 pt-3">
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Why not? (optional — recorded on the decision)"
                    className="min-w-0 flex-1 rounded-lg border border-surface-700 bg-surface-900 px-3 py-1.5 text-xs text-surface-100 placeholder:text-surface-600 focus:border-brand-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void decide(proposal.id, "reject", note)}
                    className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger-strong transition-colors hover:bg-danger/20 disabled:opacity-50"
                  >
                    Confirm rejection
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {recent.length > 0 && (
        <div className="mt-6 border-t border-surface-800 pt-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-surface-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Recent decisions
          </h3>
          <ul className="space-y-2">
            {recent.map((proposal) => (
              <li key={proposal.id} className="flex flex-wrap items-start gap-2 text-xs">
                <AdminBadge tone={STATUS_TONE[proposal.status] ?? "neutral"}>{proposal.status.toLowerCase()}</AdminBadge>
                <span className="text-surface-300">{proposal.label}</span>
                <span className="min-w-0 flex-1 truncate text-surface-500">{proposal.result ?? proposal.decidedNote ?? ""}</span>
                <span className="text-[11px] text-surface-500">{timeAgo(proposal.reviewedAt ?? proposal.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AdminPanel>
  );
}
