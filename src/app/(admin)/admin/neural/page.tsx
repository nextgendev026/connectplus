"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  Brain,
  BrainCircuit,
  Database,
  HeartPulse,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Workflow,
  Wrench,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import {
  AdminBadge,
  AdminEmpty,
  AdminNotice,
  AdminPage,
  AdminPanel,
  AdminSegmented,
  AdminStat,
  AdminStatGrid,
  adminBtnGhost,
  adminBtnPrimary,
} from "@/components/admin/AdminUI";
import { OperationsChat, type ChatSeed } from "@/components/admin/OperationsChat";
import NeuralChat from "@/components/admin/NeuralChat";
import NeuralInsights from "@/components/admin/NeuralInsights";
import NeuralKnowledgeBase from "@/components/admin/NeuralKnowledgeBase";
import { AgentPipelinePanel } from "@/components/admin/AgentPipelinePanel";
import HivePanel from "@/components/admin/HivePanel";
import type { AdminDomain, CalibrationMove, MindCollaboration } from "@/lib/admin-intelligence";
import type { AwarenessDomain } from "@/lib/brain-awareness";
import type { BrainIssue } from "@/lib/brain-issues";
import type { ProposalDTO } from "@/lib/brain-approvals";

/**
 * The operations mind — the virtual admin assistant.
 *
 * This page used to be a content machine: a chat about writing, a knowledge
 * base, a hive panel. Useful, but it answered none of the questions an operator
 * actually opens a console with — is anything stalled, is the prediction model
 * any good, what should I fix first, what has the mind learned. Worse, it was
 * the *same* mind the studio copilot used, which meant the surface that edits a
 * draft and the surface that runs the platform were one surface.
 *
 * They are separate now, and this is the operations half:
 *
 *   • **Assistant** — a conversation over the whole platform. Reads everything;
 *     every change it wants is filed for approval, never executed.
 *   • **Collaboration** — the combined mind drawn live: each engine, what state
 *     it is in, and what each one hands to the next.
 *   • **Awareness** — how well calibrated the mind is per domain, and what it
 *     knows it does not know yet.
 *   • **Do next** — the calibration moves, urgency-ordered, each with the
 *     operation that addresses it.
 *   • **Approvals** — everything filed and not yet decided.
 *   • **Knowledge** — the original panels, kept: insights, the memory bank, the
 *     hive, and the direct chat that can teach a standing directive.
 *
 * The copilot does not appear here on purpose. It is content-only, scoped to the
 * composer, and its tools are edits to a draft — see the panel at the foot of
 * the collaboration tab for the boundary written out.
 */

type Tab = "assistant" | "pipeline" | "collaboration" | "awareness" | "next" | "approvals" | "knowledge";

interface Overview {
  readings: { taken: number; missing: number; state: string; items: { label: string; value: string; state: string }[] } | null;
  awareness: {
    summary: { calibrated: number; learning: number; unknown: number };
    domains: AwarenessDomain[];
  } | null;
  collaboration: MindCollaboration | null;
  issues: BrainIssue[];
  moves: CalibrationMove[];
  pending: ProposalDTO[];
  repairMode: string | null;
  domains: AdminDomain[];
  brain: {
    memories: number;
    capabilities: string[];
    counts: { users: number; posts: number; comments: number; views: number; pendingModeration: number } | null;
  } | null;
}

const AWARENESS_TONE: Record<string, "positive" | "warning" | "danger" | "info" | "neutral"> = {
  ok: "positive",
  warn: "warning",
  critical: "danger",
  unproven: "info",
  unknown: "neutral",
};

const STATE_TONE: Record<string, "positive" | "warning" | "danger" | "info" | "neutral"> = {
  ok: "positive",
  warn: "warning",
  critical: "danger",
  // Unmeasured, not broken. Rendering it as a warning is what made an engine
  // nobody had ever observed look like an engine that needed repairing.
  unproven: "info",
  unknown: "neutral",
};

const URGENCY_TONE: Record<string, "danger" | "warning" | "info"> = {
  high: "danger",
  medium: "warning",
  low: "info",
};

export default function OperationsMindPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("assistant");
  const [seed, setSeed] = useState<ChatSeed | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/brain/operate", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch {
      setError("Could not read the mind's status. The console is still usable — ask it something directly.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount; the setState inside is the loading flag itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of a fetched overview
    void load();
  }, [load]);

  const ask = useCallback((prompt: string) => {
    setSeed({ prompt, nonce: Date.now() });
    setTab("assistant");
  }, []);

  const collab = data?.collaboration ?? null;
  const domains = data?.domains ?? [];
  const moves = data?.moves ?? [];
  const pending = data?.pending ?? [];

  return (
    <AdminPage
      wide
      title="Operations Mind"
      description="The platform's admin assistant — reads everything, changes nothing without your approval."
      icon={BrainCircuit}
      actions={
        <>
          <AdminBadge tone={data?.repairMode === "enforce" ? "warning" : "neutral"}>
            self-heal: {data?.repairMode ?? "unknown"}
          </AdminBadge>
          <AdminBadge tone={pending.length > 0 ? "warning" : "positive"}>
            {pending.length} awaiting approval
          </AdminBadge>
          <button type="button" onClick={() => void load()} disabled={loading} className={cn(adminBtnGhost, "px-3 py-2")}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </>
      }
    >
      {error ? <AdminNotice tone="warning">{error}</AdminNotice> : null}

      <AdminStatGrid>
        <AdminStat
          icon={Database}
          label="Memories"
          value={(data?.brain?.memories ?? 0).toLocaleString()}
          sub="lessons the hive holds"
          tone="brand"
        />
        <AdminStat
          icon={ShieldCheck}
          label="Awaiting approval"
          value={pending.length}
          sub={pending.length === 0 ? "nothing pending" : "writes the mind wants to make"}
          tone={pending.length > 0 ? "warning" : "positive"}
        />
        <AdminStat
          icon={HeartPulse}
          label="Open issues"
          value={data?.issues.length ?? 0}
          sub="findings that persisted three runs"
          tone={(data?.issues.length ?? 0) > 0 ? "warning" : "positive"}
        />
        <AdminStat
          icon={Layers}
          label="Engines degraded"
          value={collab?.degraded ?? 0}
          sub={
            collab
              ? `${collab.subsystems.length} subsystems, ${collab.unproven} unmeasured`
              : "reading…"
          }
          tone={(collab?.degraded ?? 0) > 0 ? "warning" : "positive"}
        />
      </AdminStatGrid>

      <AdminSegmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "assistant", label: "Assistant" },
          { value: "pipeline", label: "Pipeline" },
          { value: "collaboration", label: "Collaboration" },
          { value: "awareness", label: "Awareness" },
          { value: "next", label: `Do next${moves.length ? ` (${moves.length})` : ""}` },
          { value: "approvals", label: `Approvals${pending.length ? ` (${pending.length})` : ""}` },
          { value: "knowledge", label: "Knowledge" },
        ]}
      />

      {/*
       * The pipeline tab sits next to the assistant rather than under it, because the
       * two answer different questions: the assistant says what the platform is doing,
       * and this says what the intelligence is *allowed* to do and what it has been
       * tuned to. An operator debugging a refusal needs the second one first.
       */}
      {tab === "pipeline" ? <AgentPipelinePanel /> : null}

      {tab === "assistant" ? (
        <AdminPanel
          title="Operations assistant"
          description="Ask about any part of the platform — or ask for a change and it will file one for you."
          icon={Sparkles}
          flush
          className="min-h-[560px]"
        >
          <div className="h-[560px]">
            <OperationsChat domains={domains} seed={seed} onChanged={() => void load()} />
          </div>
        </AdminPanel>
      ) : null}

      {tab === "collaboration" ? (
        <div className="space-y-4">
          <AdminPanel
            title="The combined mind"
            description="Three engines, declared once and reporting live — hive (what we learned), neural (the reasoner and the writer), platform (the senses)."
            icon={Layers}
          >
            {collab ? (
              <div className="space-y-3">
                <div className="grid gap-3 lg:grid-cols-3">
                  {collab.minds.map((mind) => (
                    <div key={mind.mind} className="rounded-xl border border-surface-800 bg-surface-900/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{mind.mind}</p>
                        <AdminBadge tone={mind.online ? "positive" : "neutral"}>
                          {mind.subsystems} engine{mind.subsystems === 1 ? "" : "s"}
                        </AdminBadge>
                      </div>
                      <p className="mt-1 text-[12px] leading-snug text-surface-400">{mind.label}</p>
                      <ul className="mt-3 space-y-2">
                        {collab.subsystems
                          .filter((s) => s.mind === mind.mind)
                          .map((sub) => (
                            <li key={sub.id} className="rounded-lg border border-surface-800 bg-surface-900/60 p-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[13px] font-semibold text-surface-100">{sub.name}</p>
                                <AdminBadge tone={STATE_TONE[sub.state] ?? "neutral"}>{sub.state}</AdminBadge>
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-surface-400">{sub.role}</p>
                              <p className="mt-1.5 text-[11px] leading-relaxed text-surface-500">{sub.evidence}</p>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {sub.capabilities.slice(0, 6).map((capability) => (
                                  <span
                                    key={capability}
                                    className="rounded border border-surface-700 bg-surface-800/70 px-1.5 py-0.5 font-mono text-[10px] text-surface-400"
                                  >
                                    {capability}
                                  </span>
                                ))}
                              </div>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <AdminEmpty
                icon={Layers}
                title="The collaboration trace is not available"
                description="The console could not read the platform's state. Refresh, or ask the assistant what it can see."
              />
            )}
          </AdminPanel>

          {collab ? (
            <AdminPanel
              title="What each engine hands to the next"
              description="The real dependencies. A seam that stops carrying its payload is a broken mind, even when every engine reports healthy."
              icon={Workflow}
            >
              <ul className="grid gap-2 sm:grid-cols-2">
                {collab.links.map((link) => (
                  <li
                    key={`${link.from}-${link.to}`}
                    className="flex items-start gap-2 rounded-xl border border-surface-800 bg-surface-900/40 p-2.5"
                  >
                    <span className="font-mono text-[11px] text-accent-strong">{link.from}</span>
                    <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-surface-500" />
                    <span className="font-mono text-[11px] text-surface-300">{link.to}</span>
                    <span className="ml-1 text-[11px] leading-snug text-surface-500">{link.what}</span>
                  </li>
                ))}
              </ul>
            </AdminPanel>
          ) : null}

          <AdminPanel
            title="Two minds, two jobs"
            description="Why the studio copilot is not on this page."
            icon={Brain}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-brand-500/25 bg-brand-500/5 p-3">
                <p className="text-sm font-semibold text-surface-100">This surface — the operations mind</p>
                <p className="mt-1 text-[12px] leading-relaxed text-surface-400">
                  Reads the whole platform: intake, scheduling, calibration, moderation, money, pipelines and its own
                  memory. Can request operations on all of them. Lives in the console, answers to an admin, and every
                  write it proposes arrives as an approval card with your name attached.
                </p>
              </div>
              <div className="rounded-xl border border-surface-800 bg-surface-900/40 p-3">
                <p className="text-sm font-semibold text-surface-100">The studio — the writing copilot</p>
                <p className="mt-1 text-[12px] leading-relaxed text-surface-400">
                  Reads one composer: the draft, its title, excerpt and tags. Its whole vocabulary is edits to that
                  draft, and it cannot reach the platform&apos;s machinery — no sweeps, no schedules, no self-repair. It
                  has no tools and no approvals, because a writer&apos;s assistant that can change what the platform
                  does is a writer&apos;s assistant with too much reach.
                </p>
              </div>
            </div>
          </AdminPanel>
        </div>
      ) : null}

      {tab === "awareness" ? (
        <div className="space-y-4">
          {data?.awareness ? (
            <AdminPanel
              title="How well calibrated the mind is"
              description="One row per domain, with the evidence behind it. A domain with thin evidence says so rather than looking accurate."
              icon={Activity}
              action={
                <>
                  <AdminBadge tone="positive">{data.awareness.summary.calibrated} calibrated</AdminBadge>
                  <AdminBadge tone="info">{data.awareness.summary.learning} learning</AdminBadge>
                  {data.awareness.summary.unknown > 0 ? (
                    <AdminBadge tone="neutral">{data.awareness.summary.unknown} unmeasurable</AdminBadge>
                  ) : null}
                </>
              }
            >
              <ul className="space-y-3">
                {data.awareness.domains.map((domain) => (
                  <li key={domain.id} className="rounded-xl border border-surface-800 bg-surface-900/40 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-surface-100">{domain.label}</p>
                        <p className="mt-0.5 text-[12px] leading-snug text-surface-300">{domain.headline}</p>
                      </div>
                      <AdminBadge tone={AWARENESS_TONE[domain.state] ?? "neutral"}>{domain.state}</AdminBadge>
                    </div>

                    {domain.facts.length > 0 ? (
                      <dl className="mt-2.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {domain.facts.map((fact) => (
                          <div key={fact.label} className="flex items-baseline justify-between gap-3 rounded-lg bg-surface-900/70 px-2 py-1.5">
                            <dt className="text-[11px] text-surface-500">{fact.label}</dt>
                            <dd className="text-right text-[11px] font-medium text-surface-200">{fact.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}

                    {domain.notes.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {domain.notes.map((note, i) => (
                          <li key={`${domain.id}-note-${i}`} className="text-[12px] leading-relaxed text-surface-400">
                            {note}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {domain.state !== "ok" ? (
                      <button
                        type="button"
                        onClick={() => ask(`What is wrong with ${domain.label.toLowerCase()}, and what can you do about it?`)}
                        className="mt-2 text-[11px] font-semibold text-accent-strong transition hover:underline"
                      >
                        Ask the mind about this →
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </AdminPanel>
          ) : (
            <AdminPanel title="Awareness" icon={Activity}>
              <AdminEmpty
                icon={Activity}
                title="The mind could not measure itself"
                description="No domain reported. That usually means the database or the cache is unreachable — check Health."
              />
            </AdminPanel>
          )}

          {data?.issues && data.issues.length > 0 ? (
            <AdminPanel
              title="Tracked issues"
              description="Diagnosis findings that stayed true for three consecutive runs."
              icon={HeartPulse}
            >
              <ul className="space-y-2">
                {data.issues.map((issue) => (
                  <li key={issue.id} className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <AdminBadge tone={issue.severity === "critical" ? "danger" : "warning"}>{issue.severity}</AdminBadge>
                      <span className="text-[13px] font-semibold text-surface-100">{issue.title}</span>
                      <span className="text-[11px] text-surface-500">
                        seen {issue.occurrences}× · since {timeAgo(issue.firstSeenAt)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-surface-400">{issue.detail}</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-surface-300">
                      <span className="font-semibold">Fix:</span> {issue.fix}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-surface-500">subsystem: {issue.subsystem}</p>
                  </li>
                ))}
              </ul>
            </AdminPanel>
          ) : null}
        </div>
      ) : null}

      {tab === "next" ? (
        <AdminPanel
          title="What to do next"
          description="Derived from how well calibrated each domain is, most urgent first. Nothing here has run."
          icon={Wrench}
        >
          {moves.length === 0 ? (
            <AdminEmpty
              icon={ShieldCheck}
              title="Nothing needs your attention"
              description="Every domain the mind can measure is either calibrated or still learning, and nothing it tracks is open."
            />
          ) : (
            <ul className="space-y-2.5">
              {moves.map((move) => (
                <li key={move.id} className="rounded-xl border border-surface-800 bg-surface-900/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone={URGENCY_TONE[move.urgency] ?? "neutral"}>{move.urgency}</AdminBadge>
                    <span className="text-[13px] font-semibold text-surface-100">{move.title}</span>
                    <span className="text-[11px] text-surface-500">{move.domain}</span>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-surface-400">{move.why}</p>
                  {move.manual ? (
                    <p className="mt-1 text-[12px] leading-relaxed text-surface-300">{move.manual}</p>
                  ) : null}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {move.tool ? (
                      <>
                        <button
                          type="button"
                          onClick={() => ask(`Run ${move.tool} — ${move.title}`)}
                          className={cn(adminBtnPrimary, "px-3 py-1.5 text-xs")}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Ask the mind to file it
                        </button>
                        <code className="rounded border border-surface-700 bg-surface-800 px-1.5 py-0.5 font-mono text-[11px] text-accent-strong">
                          {move.tool}
                        </code>
                      </>
                    ) : (
                      <span className="text-[11px] font-medium text-surface-500">A person has to handle this one.</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </AdminPanel>
      ) : null}

      {tab === "approvals" ? (
        <AdminPanel
          title="Awaiting your approval"
          description="Everything the mind has asked to change. Each summary is generated from the arguments that will actually run."
          icon={ShieldCheck}
          flush
        >
          {pending.length === 0 ? (
            <AdminEmpty
              icon={ShieldCheck}
              title="Nothing is waiting"
              description="When the mind wants to change something it files it here first. Ask it for a change on the Assistant tab to see one."
            />
          ) : (
            <ul className="divide-y divide-surface-800">
              {pending.map((proposal) => (
                <li key={proposal.id} className="p-3.5 sm:p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge
                      tone={proposal.risk === "high" ? "danger" : proposal.risk === "medium" ? "warning" : "info"}
                    >
                      {proposal.risk} risk
                    </AdminBadge>
                    <span className="text-[13px] font-semibold text-surface-100">{proposal.label}</span>
                    <span className="text-[11px] text-surface-500">filed {timeAgo(proposal.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-surface-200">{proposal.summary}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-surface-500">
                    {proposal.rationale}
                  </p>
                  <button
                    type="button"
                    onClick={() => ask(`Approve or reject the pending request: ${proposal.summary}`)}
                    className="mt-2 text-[11px] font-semibold text-accent-strong transition hover:underline"
                  >
                    Decide it with the assistant →
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AdminPanel>
      ) : null}

      {tab === "knowledge" ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <AdminPanel title="Insights" description="What the reasoner has noticed lately." icon={Activity}>
              <NeuralInsights />
            </AdminPanel>
            <AdminPanel title="Memory bank" description="Every lesson stored, searchable." icon={Database}>
              <NeuralKnowledgeBase />
            </AdminPanel>
          </div>
          <AdminPanel title="Hive" description="What the platform has learned, by source and topic." icon={Brain}>
            <HivePanel />
          </AdminPanel>
          <AdminPanel
            title="Direct chat — teaching and directives"
            description="The older chat surface. Use it to teach the mind a standing instruction, which every sports prediction then consults."
            icon={BrainCircuit}
            flush
          >
            <div className="h-[520px]">
              <NeuralChat conversationId={null} onConversationCreated={() => {}} />
            </div>
          </AdminPanel>
        </div>
      ) : null}
    </AdminPage>
  );
}
