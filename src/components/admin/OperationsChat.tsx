"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { AdminBadge, adminBtnGhost, adminBtnPrimary, adminInput } from "@/components/admin/AdminUI";
import { AssistantText } from "@/components/admin/AssistantText";
import type { AdminDomain } from "@/lib/admin-intelligence";
import type { ProposalDTO } from "@/lib/brain-approvals";

/**
 * The operations assistant's conversation.
 *
 * This is the admin console's mind, and it is a different thing from the
 * copilot in the studio: it reads the whole platform, it answers about the
 * platform, and every change it wants to make appears here as an approve/reject
 * card rather than happening. The card is the point — an assistant that can say
 * "I published it" is one whose claims you have to verify; an assistant that can
 * only say "I filed this" is one whose claims are the record.
 *
 * Two things are shown under every reply, and both are deliberate:
 *
 *   • **What it read** — the live readings the answer was grounded in, with the
 *     ones that could not be taken listed as failures. An answer whose evidence
 *     is hidden is an answer that has to be taken on faith.
 *   • **What it understood** — the domain it routed the question to, so a
 *     misread request is visible immediately instead of producing a confident
 *     answer to a question nobody asked.
 */

interface TurnMeta {
  intent: string;
  domainLabel: string;
  understanding: string;
  degraded: boolean;
  evidence: { label: string; value: string; state: string; detail?: string }[];
  taken: number;
  missing: number;
  refused: string | null;
  proposal: ProposalDTO | null;
}

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  meta?: TurnMeta;
  proposals: ProposalDTO[];
}

/**
 * A question sent from elsewhere in the console.
 *
 * The calibration panel and the domain prompts both lead here rather than
 * filing a proposal themselves: one path files requests, one component renders
 * them, and the admin always sees the request worded the way the mind files it.
 * The nonce is what makes clicking the same suggestion twice actually send it
 * twice.
 */
export interface ChatSeed {
  prompt: string;
  nonce: number;
}

export function OperationsChat({
  domains,
  seed,
  onChanged,
}: {
  domains: AdminDomain[];
  seed?: ChatSeed | null;
  onChanged?: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setError(null);
      setInput("");

      const userTurn: Turn = { id: `u-${Date.now()}`, role: "user", text: message, proposals: [] };
      const history = turns
        .filter((t) => t.text.trim())
        .slice(-8)
        .map((t) => ({ role: t.role, content: t.text.slice(0, 2_000) }));

      setTurns((prev) => [...prev, userTurn]);
      setBusy(true);
      // Scroll the new question into view before the answer arrives, so the
      // pending state is visible rather than appearing off-screen.
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));

      try {
        const res = await fetch("/api/admin/brain/operate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, history }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

        setTurns((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: typeof data.text === "string" ? data.text : "I could not compose an answer.",
            meta: {
              intent: data.intent ?? "unknown",
              domainLabel: data.domain?.label ?? "Operations",
              understanding: data.understanding ?? "",
              degraded: Boolean(data.degraded),
              evidence: (data.readings?.items ?? []).map(
                (r: { label: string; value: string; state: string; detail?: string }) => ({
                  label: r.label,
                  value: r.value,
                  state: r.state,
                  detail: r.detail,
                })
              ),
              taken: data.readings?.taken ?? 0,
              missing: data.readings?.missing ?? 0,
              refused: data.refused ?? null,
              proposal: data.proposal ?? null,
            },
            proposals: [
              ...(data.proposal ? [data.proposal as ProposalDTO] : []),
              ...((data.pending ?? []) as ProposalDTO[]),
            ],
          },
        ]);
        if (data.proposal) onChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "The mind did not answer.");
      } finally {
        setBusy(false);
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
      }
    },
    [busy, turns, onChanged]
  );

  /* A suggestion from another panel, sent once. */
  useEffect(() => {
    if (!seed?.prompt) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a suggestion from another panel sends exactly one turn
    void send(seed.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the suggestion's nonce: including `send` would re-send on every turn it appends
  }, [seed?.nonce]);

  const decide = useCallback(
    async (id: string, decision: "approve" | "reject") => {
      setDeciding(id);
      setError(null);
      try {
        const res = await fetch("/api/admin/brain/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, decision }),
        });
        const data = await res.json().catch(() => ({}));
        const message =
          typeof data?.message === "string"
            ? data.message
            : decision === "approve"
              ? "Approved."
              : "Rejected.";
        setTurns((prev) => [
          ...prev,
          {
            id: `d-${Date.now()}`,
            role: "assistant",
            text: `**${decision === "approve" ? "Approved" : "Rejected"}.** ${message}`,
            proposals: (data?.pending ?? []) as ProposalDTO[],
          },
        ]);
        onChanged?.();
      } catch {
        setError("Could not record that decision.");
      } finally {
        setDeciding(null);
      }
    },
    [onChanged]
  );

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5 sm:p-4">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-brand-500/25 bg-brand-500/10 text-accent-strong">
              <BrainCircuit className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-surface-100">Ask the operations mind</p>
              <p className="mx-auto mt-1 max-w-md text-[13px] text-surface-400">
                It reads the whole platform — content, audience, sports calibration, pipelines, money, its own memory. It
                can change things too, but only by filing a request you approve.
              </p>
            </div>
          </div>
        ) : null}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <div key={turn.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-xl rounded-br-sm bg-brand-500 px-3.5 py-2.5 text-[13px] font-medium leading-relaxed text-white">
                {turn.text}
              </p>
            </div>
          ) : (
            <div key={turn.id} className="flex justify-start">
              <div className="w-full max-w-[92%] space-y-2">
                {turn.meta ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AdminBadge tone="brand">{turn.meta.domainLabel}</AdminBadge>
                    <AdminBadge tone="neutral">{turn.meta.intent.replace(/_/g, " ")}</AdminBadge>
                    {turn.meta.degraded ? (
                      <AdminBadge tone="warning" className="gap-1">
                        <Sparkles className="h-3 w-3" /> deterministic
                      </AdminBadge>
                    ) : (
                      <AdminBadge tone="positive" className="gap-1">
                        <Sparkles className="h-3 w-3" /> reasoning
                      </AdminBadge>
                    )}
                    {turn.meta.proposal ? (
                      <AdminBadge tone="warning" className="gap-1">
                        <ShieldCheck className="h-3 w-3" /> awaiting approval
                      </AdminBadge>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-xl rounded-bl-sm border border-surface-800 bg-surface-900/70 px-3.5 py-3 text-[13px] leading-relaxed text-surface-200">
                  <AssistantText text={turn.text} className="space-y-1.5" />
                </div>

                {turn.meta?.refused ? (
                  <p className="text-[11px] text-surface-500">Refused: {turn.meta.refused}</p>
                ) : null}

                {turn.meta && turn.meta.evidence.length > 0 ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setOpenEvidence((prev) => ({ ...prev, [turn.id]: !prev[turn.id] }))}
                      aria-expanded={Boolean(openEvidence[turn.id])}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-surface-400 transition hover:text-surface-200"
                    >
                      {openEvidence[turn.id] ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      <FileSearch className="h-3 w-3" />
                      Grounded in {turn.meta.taken} reading{turn.meta.taken === 1 ? "" : "s"}
                      {turn.meta.missing > 0 ? `, ${turn.meta.missing} could not be read` : ""}
                    </button>
                    {openEvidence[turn.id] ? (
                      <ul className="mt-2 space-y-1 rounded-xl border border-surface-800 bg-surface-900/50 p-2.5">
                        {turn.meta.evidence.map((item, i) => (
                          <li key={`${turn.id}-ev-${i}`} className="flex items-start justify-between gap-3 text-[11px]">
                            <span className="text-surface-400">{item.label}</span>
                            <span
                              className={cn(
                                "text-right font-medium",
                                item.state === "ok"
                                  ? "text-surface-200"
                                  : item.state === "unknown"
                                    ? "text-surface-500"
                                    : "text-warning-strong"
                              )}
                            >
                              {item.value}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {turn.proposals.length > 0
                  ? turn.proposals.map((proposal) => (
                      <div
                        key={proposal.id}
                        className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <AdminBadge
                            tone={proposal.risk === "high" ? "danger" : proposal.risk === "medium" ? "warning" : "info"}
                          >
                            {proposal.risk} risk
                          </AdminBadge>
                          <span className="text-[11px] font-semibold text-surface-300">{proposal.label}</span>
                          <span className="text-[11px] text-surface-500">filed {timeAgo(proposal.createdAt)}</span>
                        </div>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-surface-200">{proposal.summary}</p>
                        <p className="mt-1 text-[11px] text-surface-500">
                          Nothing has happened yet. Approving runs it once, under your name.
                        </p>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={deciding === proposal.id || proposal.status !== "PENDING"}
                            onClick={() => void decide(proposal.id, "approve")}
                            className={cn(adminBtnPrimary, "px-3 py-1.5 text-xs")}
                          >
                            {deciding === proposal.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ThumbsUp className="h-3.5 w-3.5" />
                            )}
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={deciding === proposal.id || proposal.status !== "PENDING"}
                            onClick={() => void decide(proposal.id, "reject")}
                            className={cn(adminBtnGhost, "px-3 py-1.5 text-xs")}
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                            Reject
                          </button>
                          {proposal.status !== "PENDING" ? (
                            <AdminBadge tone="neutral">{proposal.status.toLowerCase()}</AdminBadge>
                          ) : null}
                        </div>
                      </div>
                    ))
                  : null}
              </div>
            </div>
          )
        )}

        {busy ? (
          <div className="flex items-center gap-2 text-[13px] text-surface-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading the platform…
          </div>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-danger-strong">
            {error}
          </p>
        ) : null}
      </div>

      {domains.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-surface-800 px-3.5 py-2 sm:px-4">
          {domains.slice(0, 6).map((domain) => (
            <button
              key={domain.id}
              type="button"
              onClick={() => void send(domain.examples[0] ?? `Tell me about ${domain.label}`)}
              disabled={busy}
              className="rounded-full border border-surface-700 bg-surface-900 px-2.5 py-1 text-[11px] font-medium text-surface-300 transition hover:border-brand-500/40 hover:text-surface-50 disabled:opacity-50"
            >
              {domain.label}
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-center gap-2 border-t border-surface-800 p-3 sm:p-3.5"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the platform, or ask for a change…"
          className={cn(adminInput, "py-2")}
          aria-label="Ask the operations mind"
        />
        <button type="submit" disabled={busy || !input.trim()} className={cn(adminBtnPrimary, "shrink-0 px-3")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </div>
  );
}
