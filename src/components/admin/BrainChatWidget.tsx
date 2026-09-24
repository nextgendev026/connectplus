"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Ban,
  BrainCircuit,
  Check,
  Copy,
  Database,
  GraduationCap,
  Link2,
  Loader2,
  MessageSquareText,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Stamp,
  Target,
  Trash2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { toReadingsSummary, type ReadingsSummary, type StoredReading } from "@/lib/chat-history";

/* ── Wire types ──────────────────────────────────────────────────────────── */

interface HiveData {
  online: boolean;
  total: number;
  sourceBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  topTopics: { topic: string; count: number }[];
  recentLearnings: { source: string; category: string; content: string; confidence: number }[];
}

interface ProposalCard {
  id: string;
  label: string;
  summary: string;
  risk: string;
  status: string;
  outcome?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  intent?: string;
  enginesUsed?: string[];
  hive?: HiveData;
  understanding?: string;
  readings?: ReadingsSummary | null;
  proposals?: ProposalCard[];
  /** Agent tool calls and their outcomes, in the order they ran. */
  tools?: AgentToolCard[];
  /** Match-model output, rendered as a card rather than as prose. */
  predictions?: PredictionCard[];
  /** High-risk calls waiting on this operator, and what they decided. */
  approvals?: ApprovalCard[];
  createdAt?: string;
  /** True while tokens are still arriving, so the caret renders and evidence does not. */
  streaming?: boolean;
}

/**
 * One agent tool call, as the console shows it.
 *
 * The risk tier is displayed next to the name because it changes what the operator
 * should do with the result: a `high` tool that ran unattended is a bug, while a
 * `medium` patch that reported `rolled_back` is the model working correctly.
 */
interface AgentToolCard {
  toolCallId: string;
  toolName: string;
  risk: string;
  status: "executing" | "success" | "failed" | "rolled_back" | "awaiting_approval";
  input?: unknown;
  output?: unknown;
  error?: string;
}

interface PredictionCard {
  fixture: string;
  league: string;
  expectedGoals: { home: number; away: number; total: number };
  markets: {
    oneX2: { home: number; draw: number; away: number };
    btts: { yes: number; no: number };
    overUnder: { over15: number; over25: number; over35: number };
  };
  topScorelines?: Array<{ score: string; probability: number }>;
  confidence: { score: number; band: string; separation?: number; explanation?: string };
  headlineCall?: { market: string; selection: string; confidence: number; decisive: boolean; reasons: string[] };
  dataQuality?: {
    homeFormMatches: number;
    awayFormMatches: number;
    leagueSettledMatches: number;
    leagueAccuracy: number | null;
  };
  parameters?: { rho: number; recencyWeight: number; goalExpectationFactor: number };
}

/** A labelled probability bar. Width is the probability, so the shape *is* the data. */
function ProbBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[86px] shrink-0 truncate text-[10px] text-surface-400">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-800">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.max(1, Math.min(100, value))}%` }} />
      </span>
      <span className="w-11 shrink-0 text-right font-mono text-[10px] text-surface-200">{value.toFixed(1)}%</span>
    </div>
  );
}

function PredictionCards({ predictions }: { predictions: PredictionCard[] }) {
  return (
    <div className="mt-2 space-y-2">
      {predictions.map((p, i) => (
        <div key={`${p.fixture}-${i}`} className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold text-surface-50">{p.fixture}</p>
              <p className="text-[10px] text-surface-400">
                {p.league} · Dixon–Coles · xG {p.expectedGoals.home}–{p.expectedGoals.away} ({p.expectedGoals.total} total)
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[15px] font-bold leading-none text-accent-strong">{p.confidence.score}</p>
              <p className="text-[9px] uppercase tracking-wide text-surface-500">{p.confidence.band} confidence</p>
            </div>
          </div>

          <div className="mt-2.5 space-y-1">
            <ProbBar label="Home" value={p.markets.oneX2.home} tone="bg-emerald-500/70" />
            <ProbBar label="Draw" value={p.markets.oneX2.draw} tone="bg-surface-500" />
            <ProbBar label="Away" value={p.markets.oneX2.away} tone="bg-sky-500/70" />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-surface-700/60 pt-2 text-[10px] text-surface-300">
            <span>BTTS yes <strong className="font-mono">{p.markets.btts.yes}%</strong></span>
            <span>Over 2.5 <strong className="font-mono">{p.markets.overUnder.over25}%</strong></span>
            <span>Over 1.5 <strong className="font-mono">{p.markets.overUnder.over15}%</strong></span>
            <span>Over 3.5 <strong className="font-mono">{p.markets.overUnder.over35}%</strong></span>
          </div>

          {p.topScorelines && p.topScorelines.length > 0 ? (
            <p className="mt-2 text-[10px] text-surface-400">
              Likely scores{" "}
              {p.topScorelines.slice(0, 3).map((s) => `${s.score} (${s.probability}%)`).join(" · ")}
            </p>
          ) : null}

          {p.headlineCall ? (
            <p className="mt-1.5 text-[10px] font-medium text-surface-200">
              Call: {p.headlineCall.selection} · {p.headlineCall.confidence}% ·{" "}
              {p.headlineCall.decisive ? "decisive" : "not decisive"}
            </p>
          ) : null}

          {p.dataQuality ? (
            <p className="mt-1 text-[9px] text-surface-500">
              Form sample {p.dataQuality.homeFormMatches}/{p.dataQuality.awayFormMatches} matches · league sample{" "}
              {p.dataQuality.leagueSettledMatches} settled
              {p.dataQuality.leagueAccuracy != null ? ` · ${p.dataQuality.leagueAccuracy}% graded accuracy` : ""}
            </p>
          ) : null}

          {p.parameters ? (
            <p className="mt-0.5 text-[9px] text-surface-500">
              rho {p.parameters.rho} · recency {p.parameters.recencyWeight} · goals ×{p.parameters.goalExpectationFactor}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * A high-risk tool call, gated behind a human decision.
 *
 * The token is the only thing that proves this approval, and it is bound to the
 * exact arguments shown here — so the button is a consent to *this* operation, not a
 * general yes. That is why the arguments are rendered rather than summarised: an
 * operator approving a migration they were not shown is not consenting to it.
 */
interface ApprovalCard {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  token: string;
  summary: string;
  danger: string;
  blastRadius?: string;
  expiresAt: string;
  state: "pending" | "running" | "approved" | "failed";
  message?: string;
}

function ApprovalCards({ approvals }: { approvals: ApprovalCard[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  /*
   * Decisions are held here rather than pushed back into the message.
   *
   * The message is the record of what the agent did; an approval is the operator's
   * action on it, and routing it through the same `onDecided` callback the
   * proposals use would have looked like it worked while doing nothing — the ids
   * never match, so the card would have sat on "pending" forever after a real
   * approval. Local state keeps the button's lifecycle with the button.
   */
  const [decisions, setDecisions] = useState<Record<string, { state: ApprovalCard["state"]; message?: string }>>({});

  const approve = async (card: ApprovalCard) => {
    setBusy(card.id);
    setDecisions((prev) => ({ ...prev, [card.id]: { state: "running" } }));
    try {
      const res = await fetch("/api/neural-chat/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tool: card.tool, args: card.args, token: card.token }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok?: boolean; reason?: string; message?: string; error?: string; result?: unknown }
        | null;

      if (!res.ok || !payload?.ok) {
        setDecisions((prev) => ({
          ...prev,
          [card.id]: {
            state: "failed",
            message: payload?.reason ?? payload?.message ?? payload?.error ?? `Refused (HTTP ${res.status}).`,
          },
        }));
      } else {
        setDecisions((prev) => ({ ...prev, [card.id]: { state: "approved" } }));
      }
    } catch (error) {
      setDecisions((prev) => ({
        ...prev,
        [card.id]: { state: "failed", message: error instanceof Error ? error.message : "The request failed." },
      }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {approvals.map((card) => {
        const decided = decisions[card.id];
        const state = decided?.state ?? card.state;
        const message = decided?.message ?? card.message;
        return (
        <div key={card.id} className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-2.5">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-violet-100">Approval required</p>
              <p className="mt-0.5 text-[11px] text-surface-200">{card.summary}</p>
              {card.danger ? <p className="mt-1 text-[10px] text-surface-400">{card.danger}</p> : null}
              {card.blastRadius ? (
                <p className="mt-0.5 text-[10px] italic text-surface-500">{card.blastRadius}</p>
              ) : null}
            </div>
            {state === "approved" ? (
              <span className="shrink-0 text-[10px] font-medium text-positive-strong">Executed</span>
            ) : null}
          </div>

          <pre className="mt-2 max-h-32 overflow-auto rounded-lg border border-violet-500/20 bg-black/30 p-2 font-mono text-[10px] text-surface-300">
            {JSON.stringify({ tool: card.tool, ...card.args }, null, 2)}
          </pre>

          {message ? (
            <p className={cn("mt-1.5 text-[10px]", state === "failed" ? "text-danger-strong" : "text-surface-300")}>
              {message}
            </p>
          ) : null}

          {state === "pending" || state === "running" ? (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void approve(card)}
                disabled={busy === card.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-positive-strong/50 bg-positive-strong/15 px-2.5 py-1 text-[11px] font-semibold text-positive-strong transition hover:bg-positive-strong/25 disabled:opacity-50"
              >
                {busy === card.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                Approve &amp; Execute
              </button>
              {card.expiresAt ? (
                <span className="text-[10px] text-surface-500">
                  Expires {new Date(card.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        );
      })}
    </div>
  );
}

function AgentToolCards({ tools }: { tools: AgentToolCard[] }) {
  const tones: Record<AgentToolCard["status"], string> = {
    executing: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    failed: "border-red-500/40 bg-red-500/10 text-danger-strong",
    rolled_back: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    awaiting_approval: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  };
  const labels: Record<AgentToolCard["status"], string> = {
    executing: "Executing",
    success: "Success",
    failed: "Failed",
    rolled_back: "Rolled back",
    awaiting_approval: "Awaiting approval",
  };

  return (
    <div className="mt-2 space-y-1.5">
      {tools.map((tool) => (
        <div key={tool.toolCallId} className="rounded-xl border border-surface-700 bg-surface-900/60 p-2.5">
          <div className="flex items-center gap-2">
            <Wrench className="h-3 w-3 shrink-0 text-surface-400" />
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-surface-200">{tool.toolName}</code>
            <span className="shrink-0 rounded-full border border-surface-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-surface-400">
              {tool.risk}
            </span>
            <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium", tones[tool.status])}>
              {tool.status === "executing" ? <Loader2 className="mr-1 inline h-2.5 w-2.5 animate-spin" /> : null}
              {labels[tool.status]}
            </span>
          </div>
          {tool.error ? (
            <p className="mt-1.5 whitespace-pre-wrap break-words rounded-lg border border-red-500/30 bg-red-500/5 p-2 font-mono text-[10px] text-danger-strong">
              {tool.error}
            </p>
          ) : null}
          {tool.status === "rolled_back" ? (
            <p className="mt-1 text-[10px] text-amber-300">
              Validation failed and the patch was reverted. Nothing was committed.
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

interface ConversationRow {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
  shared: boolean;
}

interface NeuralInsight {
  title: string;
  summary: string;
  severity: "info" | "warning" | "critical";
  action?: string;
}

interface DirectiveRecord {
  id: string;
  raw: string;
  note: string;
  active: boolean;
  createdAt: string;
  lean: number;
  goalsBias: number;
}

interface KnowledgeDigest {
  rows: number;
  hosts: number;
  lastLearnedAt: string | null;
  recent: { title: string; url: string | null }[];
}

type View = "list" | "chat";
type Tab = "chat" | "brains" | "directives" | "train";

const QUICK_QUERIES = [
  { label: "System health", query: "How is the platform health?" },
  { label: "Hive report", query: "Give me the hive mind report" },
  { label: "Recommend", query: "What should I read next?" },
  { label: "Teach brains", query: "Run a sweep and teach the brains from new posts" },
  { label: "Trends", query: "What's trending right now?" },
];

const DIRECTIVE_EXAMPLES = [
  "Favour home teams in La Liga",
  "Avoid high scoring in Serie A",
  "Stop backing draws in the Premier League",
  "Strongly favour Gor Mahia",
];

/* ── Small pieces ────────────────────────────────────────────────────────── */

function EngineBadges({ intent, enginesUsed: engines, hive }: { intent?: string; enginesUsed?: string[]; hive?: HiveData }) {
  if (!intent && !engines?.length && !hive) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {intent ? (
        <span className="rounded-full bg-surface-700/70 px-2 py-0.5 text-[9px] font-medium text-surface-300">
          {intent.replace(/_/g, " ")}
        </span>
      ) : null}
      {engines?.map((e) => (
        <span
          key={e}
          className={cn(
            "rounded-full px-2 py-0.5 text-[9px] font-medium",
            e === "hive"
              ? "bg-amber-500/15 text-warning-strong"
              : e === "directive"
                ? "bg-emerald-500/15 text-positive-strong"
                : "bg-brand-500/15 text-accent-strong"
          )}
        >
          {e === "hive" ? "🐝 " : e === "directive" ? "📌 " : ""}
          {e}
        </span>
      ))}
      {hive ? (
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-medium text-positive-strong">
          {hive.total.toLocaleString()} in memory
        </span>
      ) : null}
    </div>
  );
}

function ReadingEvidence({ readings }: { readings: ReadingsSummary }) {
  const tone: Record<StoredReading["state"], string> = {
    ok: "text-surface-300",
    warn: "text-warning-strong",
    critical: "text-danger-strong",
    unknown: "text-surface-500",
  };
  return (
    <details className="mt-2 rounded-xl border border-surface-700/60 bg-surface-950/40">
      <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[10px] font-medium text-surface-400 transition hover:text-surface-200">
        <span className="inline-flex items-center gap-1.5">
          <Search className="h-3 w-3" />
          Grounded in {readings.taken} reading{readings.taken === 1 ? "" : "s"}
          {readings.missing > 0 ? ` · ${readings.missing} unavailable` : ""}
        </span>
      </summary>
      {readings.items.length > 0 ? (
        <ul className="space-y-1 px-2.5 pb-2">
          {readings.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 text-[10px] leading-snug">
              <span className={cn("font-semibold", tone[item.state])}>{item.area}</span>
              <span className="text-right text-surface-300">{item.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2.5 pb-2 text-[10px] text-surface-500">
          The individual readings were not kept with this turn; only the count survives in history.
        </p>
      )}
    </details>
  );
}

function ProposalDecisions({
  proposals,
  onDecided,
}: {
  proposals: ProposalCard[];
  onDecided: (id: string, outcome: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/brain/approvals", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      const data = await res.json().catch(() => ({}));
      onDecided(id, data?.message ?? (res.ok ? "Done." : "The decision could not be applied."));
    } catch {
      onDecided(id, "The decision could not be sent.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {proposals.map((proposal) => (
        <div key={proposal.id} className="rounded-xl border border-warning/30 bg-warning/5 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Stamp className="h-3 w-3 text-warning-strong" />
            <span className="text-[11px] font-semibold text-surface-100">{proposal.label}</span>
            <span className="rounded-full bg-surface-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-surface-400">
              {proposal.risk} risk
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-surface-300">{proposal.summary}</p>
          {proposal.outcome ? (
            <p className="mt-1.5 text-[11px] text-surface-400">{proposal.outcome}</p>
          ) : (
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void decide(proposal.id, "approve")}
                className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {busy === proposal.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Approve &amp; run
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void decide(proposal.id, "reject")}
                className="rounded-lg border border-surface-700 px-2 py-1 text-[10px] font-semibold text-surface-300 transition hover:text-surface-100 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** One conversation in the history list. */
function ConversationListItem({
  row,
  onOpen,
  onDelete,
}: {
  row: ConversationRow;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-surface-800/60"
      >
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-brand-500/25 bg-brand-500/10 text-accent-strong">
          <BrainCircuit className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-surface-100">{row.title}</span>
            <span className="shrink-0 text-[10px] text-surface-500">{timeAgo(row.updatedAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {row.shared ? <Link2 className="h-2.5 w-2.5 shrink-0 text-positive-strong" /> : null}
            <span className="truncate text-[11px] text-surface-400">{row.preview || "No messages yet"}</span>
          </span>
          <span className="mt-1 inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-surface-500">
            {row.messageCount} message{row.messageCount === 1 ? "" : "s"}
          </span>
        </span>
      </button>

      {confirming ? (
        <span className="absolute bottom-1.5 right-2 flex items-center gap-1">
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-danger-strong"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-surface-700 px-2 py-0.5 text-[10px] text-surface-300"
          >
            Keep
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${row.title}`}
          className="absolute bottom-1.5 right-2 rounded-lg p-1.5 text-surface-500 opacity-0 transition hover:bg-surface-800 hover:text-danger-strong focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </li>
  );
}

/* ── The widget ──────────────────────────────────────────────────────────── */

export default function BrainChatWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [view, setView] = useState<View>("list");

  /* Conversation state */
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  /** The live share token, when this thread has one. Null means private. */
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  /** Why the saved-chat list is empty or stale. Null when it loaded cleanly. */
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [rowSearch, setRowSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);

  /* Turns */
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Panels */
  const [hive, setHive] = useState<HiveData | null>(null);
  const [insights, setInsights] = useState<NeuralInsight[]>([]);
  const [learning, setLearning] = useState<string | null>(null);
  const [directives, setDirectives] = useState<DirectiveRecord[]>([]);
  const [directiveDraft, setDirectiveDraft] = useState("");
  const [directiveError, setDirectiveError] = useState<string | null>(null);
  const [savingDirective, setSavingDirective] = useState(false);
  const [knowledge, setKnowledge] = useState<KnowledgeDigest | null>(null);
  const [teachDraft, setTeachDraft] = useState("");
  const [teachSources, setTeachSources] = useState(3);
  const [teachSports, setTeachSports] = useState(false);
  const [teaching, setTeaching] = useState(false);
  const [teachMsg, setTeachMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Load the saved-chat list.
   *
   * This used to ignore the status entirely and write `data.conversations ?? []`
   * into state, so a refused or failed request rendered the same thing as an
   * empty history: "No conversations yet". The operator who reported their saved
   * chats could not be fetched had nothing on screen and nothing in the console
   * to say why, and there was no way to tell a permissions problem from a
   * genuinely empty list without opening devtools.
   *
   * Two rules now. A non-2xx response reports itself, with the server's own
   * wording — the route returns a specific message for a 403 and for a 500, and
   * repeating it here is what makes the failure actionable. And a failed fetch
   * leaves the rows already on screen alone rather than replacing them, because
   * a transient blip should not look like the history being deleted.
   */
  const loadConversations = useCallback(async (search = "") => {
    setLoadingRows(true);
    try {
      const query = search ? `&search=${encodeURIComponent(search)}` : "";
      const res = await fetch(`/api/admin/neural/conversations?limit=40${query}`, { credentials: "include" });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        setHistoryError(
          detail?.error
            ? `Your saved chats could not be loaded (${res.status}): ${detail.error}`
            : `Your saved chats could not be loaded (HTTP ${res.status}).`
        );
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { conversations?: ConversationRow[] };
      setRows(data.conversations ?? []);
      setHistoryError(null);
    } catch {
      // Offline, blocked, or the request never completed. Distinguished from a
      // refusal because the reader's next move is different.
      setHistoryError("Your saved chats could not be loaded — the request did not complete.");
    } finally {
      setLoadingRows(false);
    }
  }, []);

  const loadBrains = useCallback(async () => {
    const [hiveRes, insightRes] = await Promise.all([
      fetch("/api/admin/neural/hive", { credentials: "include" }),
      fetch("/api/admin/neural/insights", { credentials: "include" }),
    ]);
    if (hiveRes.ok) setHive((await hiveRes.json()).status);
    if (insightRes.ok) setInsights((await insightRes.json()).insights ?? []);
  }, []);

  const loadDirectives = useCallback(async () => {
    const res = await fetch("/api/admin/neural/directives", { credentials: "include" });
    if (res.ok) setDirectives((await res.json()).directives ?? []);
  }, []);

  const loadKnowledge = useCallback(async () => {
    const res = await fetch("/api/admin/neural/knowledge", { credentials: "include" });
    const d = (await res.json().catch(() => null)) as { digest?: KnowledgeDigest } | null;
    if (d?.digest) setKnowledge(d.digest);
  }, []);

  /**
   * Open the widget on whichever view has something to show.
   *
   * The list is loaded when it is about to be seen rather than on every render;
   * an admin console can have this mounted all day across every page.
   */
  const openWidget = useCallback(() => {
    setOpen(true);
    if (tab === "chat") void loadConversations(rowSearch);
    if (tab === "brains") void loadBrains();
    if (tab === "train") void loadKnowledge();
    if (tab === "directives") void loadDirectives();
  }, [tab, rowSearch, loadConversations, loadBrains, loadKnowledge, loadDirectives]);

  useEffect(() => {
    if (!open || tab !== "chat" || view !== "list") return;
    const t = setTimeout(() => void loadConversations(rowSearch), 0);
    return () => clearTimeout(t);
  }, [open, tab, view, rowSearch, loadConversations]);

  useEffect(() => {
    if (!open) return;
    if (tab === "brains") {
      const t = setTimeout(() => void loadBrains(), 0);
      return () => clearTimeout(t);
    }
    if (tab === "train") {
      const t = setTimeout(() => void loadKnowledge(), 0);
      return () => clearTimeout(t);
    }
    if (tab === "directives") {
      const t = setTimeout(() => void loadDirectives(), 0);
      return () => clearTimeout(t);
    }
  }, [open, tab, loadBrains, loadKnowledge, loadDirectives]);

  // Follow the conversation as it grows, including while it streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streamingText, open, view, isProcessing]);

  const openConversation = useCallback(async (id: string) => {
    setOpeningId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/neural/conversations/${id}`, { credentials: "include" });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          detail?.error
            ? `That conversation could not be opened (${res.status}): ${detail.error}`
            : `That conversation could not be opened (HTTP ${res.status}).`
        );
      }
      const data = await res.json();
      const conversation = data.conversation as {
        id: string;
        title: string;
        shared: boolean;
        shareToken: string | null;
        messages: {
          id: string;
          role: string;
          content: string;
          intent: string | null;
          enginesUsed: string[];
          createdAt: string;
          meta: Record<string, unknown> | null;
        }[];
      };

      setConversationId(conversation.id);
      setConversationTitle(conversation.title);
      setShareToken(conversation.shareToken ?? null);
      setMessages(
        conversation.messages.map((m) => {
          // Not a cast. A saved turn's readings are whatever shape was written
          // when it was answered, and trusting that shape is what crashed the
          // page when the stored copy turned out to be thinner than the streamed
          // one (see `toReadingsSummary`).
          const readings = toReadingsSummary(m.meta?.readings);
          return {
            id: m.id,
            role: m.role === "user" ? "user" : "assistant",
            text: m.content,
            intent: m.intent ?? undefined,
            enginesUsed: m.enginesUsed,
            understanding: typeof m.meta?.understanding === "string" ? m.meta.understanding : undefined,
            readings,
            createdAt: m.createdAt,
          };
        })
      );
      setView("chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That conversation could not be opened.");
    } finally {
      setOpeningId(null);
    }
  }, []);

  const startNewChat = useCallback(() => {
    setConversationId(null);
    setConversationTitle(null);
    setShareToken(null);
    setMessages([]);
    setStreamingText("");
    setInput("");
    setError(null);
    setView("chat");
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  /**
   * Send a turn, and keep the thread.
   *
   * The id returned on the first reply is what makes the next message part of
   * the same conversation. Without it every turn started a new one — the mind
   * saw each question with no memory of the one before, which is what "it lost
   * the plot mid-conversation" actually was.
   */
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isProcessing) return;

      setError(null);
      setInput("");
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: trimmed }]);
      setStreamingText("");
      setIsProcessing(true);

      // Captured before the await so the reply is attributed to the thread this
      // turn was sent in, even if the operator switches threads mid-stream.
      const forConversation = conversationId;

      try {
        const res = await fetch("/api/admin/neural/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ message: trimmed, conversationId: forConversation }),
        });
        if (!res.ok) throw new Error(`The mind did not answer (HTTP ${res.status}).`);

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let meta: Partial<ChatMessage> = {};
        let text = "";

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line) as Record<string, unknown>;
            } catch {
              continue;
            }

            if (event.type === "metadata") {
              if (typeof event.conversationId === "string" && !forConversation) {
                setConversationId(event.conversationId);
              }
              meta = {
                intent: typeof event.intent === "string" ? event.intent : undefined,
                enginesUsed: Array.isArray(event.enginesUsed) ? (event.enginesUsed as string[]) : undefined,
                understanding: typeof event.understanding === "string" ? event.understanding : undefined,
                readings: toReadingsSummary(event.readings),
              };
            } else if (event.type === "chunk" && typeof event.content === "string") {
              // Held in its own state rather than appended to the message array:
              // re-rendering every bubble on every token is what made a long
              // answer feel like it was stuttering.
              text += event.content;
              setStreamingText(text);
            } else if (event.type === "proposals" && Array.isArray(event.proposals)) {
              meta = { ...meta, proposals: event.proposals as ProposalCard[] };
            } else if (event.type === "hive" && event.status) {
              const status = event.status as HiveData;
              meta = { ...meta, hive: status };
              setHive(status);
            } else if (event.type === "tool_call") {
              meta = {
                ...meta,
                tools: [
                  ...(meta.tools ?? []),
                  {
                    toolCallId: String(event.toolCallId ?? ""),
                    toolName: String(event.toolName ?? "tool"),
                    risk: String(event.risk ?? "unknown"),
                    status: "executing",
                    input: event.input,
                  },
                ],
              };
            } else if (event.type === "tool_result") {
              const output = event.output as Record<string, unknown> | undefined;
              // The status is read off the result rather than assumed from a 200:
              // a patch that rolled back, and a model that refused a plan, both
              // arrive as successful calls that achieved nothing.
              const status: AgentToolCard["status"] =
                output?.needsApproval === true
                  ? "awaiting_approval"
                  : output?.status === "rolled_back"
                    ? "rolled_back"
                    : output?.ok === false || output?.error
                      ? "failed"
                      : "success";

              meta = {
                ...meta,
                tools: (meta.tools ?? []).map((t) =>
                  t.toolCallId === String(event.toolCallId ?? "")
                    ? { ...t, status, output: event.output, risk: String(event.risk ?? t.risk) }
                    : t,
                ),
              };

              // A simulation is promoted out of the tool payload into its own card,
              // because the numbers are the answer and a reader should not have to
              // expand a JSON blob to see a probability.
              if (String(event.toolName) === "simulateMatchFixture" && output && "markets" in output) {
                meta = { ...meta, predictions: [...(meta.predictions ?? []), output as unknown as PredictionCard] };
              }
            } else if (event.type === "tool_error") {
              meta = {
                ...meta,
                tools: (meta.tools ?? []).map((t) =>
                  t.toolCallId === String(event.toolCallId ?? "")
                    ? { ...t, status: "failed" as const, error: String(event.message ?? "Tool failed") }
                    : t,
                ),
              };
            } else if (event.type === "prediction" && event.prediction) {
              // The loop promotes a simulation to a typed event, so the card does not
              // depend on the shape of a tool's return value.
              meta = {
                ...meta,
                predictions: [...(meta.predictions ?? []), event.prediction as PredictionCard],
              };
            } else if (event.type === "approval_request") {
              meta = {
                ...meta,
                approvals: [
                  ...(meta.approvals ?? []),
                  {
                    id: String(event.argsHash ?? `ap-${Date.now()}`),
                    tool: String(event.tool ?? ""),
                    args: (event.args as Record<string, unknown>) ?? {},
                    token: String(event.token ?? ""),
                    summary: String(event.summary ?? "Approve this operation"),
                    danger: String(event.danger ?? ""),
                    blastRadius: typeof event.blastRadius === "string" ? event.blastRadius : undefined,
                    expiresAt: String(event.expiresAt ?? ""),
                    state: "pending" as const,
                  },
                ],
              };
            } else if (event.type === "approval_unavailable") {
              setError(
                typeof event.message === "string"
                  ? `A high-risk operation needed approval, but one could not be issued: ${event.message}`
                  : "A high-risk operation needed approval, but one could not be issued."
              );
            } else if (event.type === "directive") {
              meta = { ...meta, enginesUsed: ["directive"] };
              void loadDirectives();
            } else if (event.type === "error") {
              setError(typeof event.message === "string" ? event.message : "Neural processing failed.");
            }
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: text || "I could not compose an answer.",
            ...meta,
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The mind did not answer.");
      } finally {
        setStreamingText("");
        setIsProcessing(false);
        // The list is stale the moment anything is said; refresh lazily so the
        // history view is correct without refetching on every token.
        if (view === "list") void loadConversations(rowSearch);
      }
    },
    [conversationId, isProcessing, loadDirectives, loadConversations, rowSearch, view]
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      // Optimistic: the row is one list entry and the action is recoverable by
      // not caring about it, so a stalled request should not freeze the list.
      setRows((prev) => prev.filter((r) => r.id !== id));
      if (id === conversationId) {
        setConversationId(null);
        setMessages([]);
        setView("list");
      }
      await fetch(`/api/admin/neural/conversations/${id}`, { method: "DELETE", credentials: "include" }).catch(() => null);
      void loadConversations(rowSearch);
    },
    [conversationId, loadConversations, rowSearch]
  );

  const toggleShare = useCallback(async () => {
    if (!conversationId) return;
    setSharing(true);
    setError(null);
    try {
      const alreadyShared = shareToken !== null;
      const res = await fetch(`/api/admin/neural/conversations/${conversationId}/share`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable: !alreadyShared }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Could not change sharing.");
      if (data.shared && typeof data.token === "string") {
        setShareToken(data.token);
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${data.path ?? `/share/chat/${data.token}`}`);
          setCopied(true);
          setTimeout(() => setCopied(false), 2_500);
        } catch {
          // Clipboard permission is not a precondition: the link is shown either
          // way, so a refusal costs a manual copy rather than the feature.
        }
      } else {
        setShareToken(null);
      }
      void loadConversations(rowSearch);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change sharing.");
    } finally {
      setSharing(false);
    }
  }, [conversationId, shareToken, loadConversations, rowSearch]);

  const uploadMaterial = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setUploadNote(null);
      try {
        const form = new FormData();
        for (const file of Array.from(files)) form.append("files", file);
        const res = await fetch("/api/admin/neural/ingest", { method: "POST", body: form, credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "The upload was refused.");
        setUploadNote(typeof data.note === "string" ? data.note : "Filed.");
        setMessages((prev) => [
          ...prev,
          {
            id: `f-${Date.now()}`,
            role: "assistant",
            text: `📎 ${typeof data.note === "string" ? data.note : "Material filed."}${
              Array.isArray(data.results)
                ? `\n${(data.results as { filename: string; ok: boolean; reason?: string; duplicate?: boolean }[])
                    .map(
                      (r) =>
                        `• ${r.filename} — ${r.ok ? (r.duplicate ? "already known" : "filed") : (r.reason ?? "refused")}`
                    )
                    .join("\n")}`
                : ""
            }`,
            enginesUsed: ["knowledge"],
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch (err) {
        setUploadNote(err instanceof Error ? err.message : "The upload was refused.");
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    []
  );

  const saveDirectiveInstruction = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || savingDirective) return;
      setSavingDirective(true);
      setDirectiveError(null);
      try {
        const res = await fetch("/api/admin/neural/directives", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ text: trimmed }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setDirectiveError(data.hint ?? data.error ?? `HTTP ${res.status}`);
          return;
        }
        setDirectiveDraft("");
        await loadDirectives();
      } catch {
        setDirectiveError("Could not reach the mind. Check the dev server.");
      } finally {
        setSavingDirective(false);
      }
    },
    [savingDirective, loadDirectives]
  );

  const toggleDirective = useCallback(
    async (id: string, active: boolean) => {
      setDirectives((prev) => (active ? prev : prev.filter((d) => d.id !== id)));
      const res = await fetch("/api/admin/neural/directives", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, active }),
      }).catch(() => null);
      if (!res?.ok) await loadDirectives();
    },
    [loadDirectives]
  );

  const teachFromWeb = useCallback(async () => {
    const query = teachDraft.trim();
    if (query.length < 3 || teaching) return;
    setTeaching(true);
    setTeachMsg(null);
    try {
      const res = await fetch("/api/admin/neural/knowledge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, sources: teachSources, tags: teachSports ? ["sports"] : [] }),
      });
      const d = (await res.json().catch(() => null)) as { note?: string; digest?: KnowledgeDigest; error?: string } | null;
      if (!res.ok) {
        setTeachMsg(d?.error ?? "Could not file that subject.");
        return;
      }
      if (d?.digest) setKnowledge(d.digest);
      setTeachMsg(d?.note ?? "Filed.");
      setTeachDraft("");
    } finally {
      setTeaching(false);
    }
  }, [teachDraft, teachSources, teachSports, teaching]);

  const runTraining = useCallback(
    async (kind: "train" | "sweep" | "learn") => {
      setLearning(kind);
      try {
        const endpoint =
          kind === "train" ? "/api/admin/neural/train" : kind === "sweep" ? "/api/admin/neural/hive" : "/api/admin/neural/learn";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const r = data.result ?? {};
        const verb = kind === "train" ? "Training" : kind === "sweep" ? "Sweep" : "Learning";
        const summary =
          kind === "sweep"
            ? `${r.postsScanned ?? r.posts_read ?? 0} posts & ${r.commentsScanned ?? r.comments_read ?? 0} comments scanned, ${r.memoriesCreated ?? 0} memories created (${r.totalMemories ?? 0} total)`
            : `${r.signalsCreated ?? 0} new signals, ${r.signalsUpdated ?? 0} updated, top lesson: ${r.lessons?.[0] ?? "—"}`;
        setMessages((prev) => [
          ...prev,
          { id: `t-${Date.now()}`, role: "assistant", text: `✅ ${verb} complete — ${summary}`, intent: "hive_report", enginesUsed: ["hive"] },
        ]);
      } catch {
        setError("Training call failed.");
      }
      await loadBrains();
      setLearning(null);
    },
    [loadBrains]
  );

  const severityColor: Record<NeuralInsight["severity"], string> = useMemo(
    () => ({
      info: "text-info-strong",
      warning: "text-warning-strong",
      critical: "text-danger-strong",
    }),
    []
  );

  if (!open) {
    return (
      <button
        onClick={openWidget}
        className="group fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-500/30 bg-surface-900/90 shadow-glow backdrop-blur-xl transition-all hover:scale-105"
        title="Ask the combined brains"
        aria-label="Open the operations assistant"
      >
        <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
        </span>
        <BrainCircuit className="h-6 w-6 text-brand-400" />
      </button>
    );
  }

  const activeShared = shareToken !== null;
  const shareUrl = shareToken ? `${typeof window === "undefined" ? "" : window.location.origin}/share/chat/${shareToken}` : null;

  return (
    <div
      className="fixed inset-x-2 bottom-2 z-[60] flex flex-col overflow-hidden rounded-2xl border border-surface-700 bg-surface-950/97 shadow-glow backdrop-blur-xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[min(94vw,26rem)]"
      style={{ height: "min(82vh, 640px)" }}
      role="dialog"
      aria-label="Operations assistant"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-surface-800 bg-surface-900/60 px-3 py-2.5">
        {tab === "chat" && view === "chat" ? (
          <button
            onClick={() => {
              setView("list");
              setConversationId(null);
              setMessages([]);
              setShareToken(null);
            }}
            aria-label="Back to chat history"
            className="rounded-lg p-1.5 text-surface-400 transition hover:bg-surface-800 hover:text-surface-50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-brand-500/25 bg-brand-500/10 text-accent-strong">
            <BrainCircuit className="h-4 w-4" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-surface-50">
            {view === "chat" && conversationTitle ? conversationTitle : "NeuroHive"}
          </p>
          <p className="flex items-center gap-1.5 text-[10px] text-surface-400">
            <span className={cn("h-1.5 w-1.5 rounded-full", isProcessing ? "animate-pulse bg-amber-500" : "bg-emerald-500")} />
            {view === "chat"
              ? isProcessing
                ? "Reading the platform…"
                : "Neural intent + hive memory"
              : "Neural intent + hive memory · history kept"}
          </p>
        </div>

        {view === "chat" ? (
          <>
            {conversationId ? (
              <button
                onClick={() => void toggleShare()}
                disabled={sharing}
                aria-label={activeShared ? "Stop sharing this conversation" : "Share this conversation"}
                className={cn(
                  "rounded-lg p-1.5 transition",
                  activeShared
                    ? "bg-emerald-500/15 text-positive-strong"
                    : "text-surface-400 hover:bg-surface-800 hover:text-surface-50"
                )}
              >
                {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              </button>
            ) : null}
            <button
              onClick={startNewChat}
              aria-label="Start a new conversation"
              className="rounded-lg p-1.5 text-surface-400 transition hover:bg-surface-800 hover:text-surface-50"
            >
              <Plus className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            onClick={openWidget}
            aria-label="Refresh"
            className="rounded-lg p-1.5 text-surface-400 transition hover:bg-surface-800 hover:text-surface-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}

        <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-surface-500 transition hover:bg-surface-800 hover:text-surface-50">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 gap-1 border-b border-surface-800 bg-surface-900/40 px-2 py-1.5">
        {(
          [
            { id: "chat", label: "Chat", icon: MessageSquareText },
            { id: "brains", label: "Brains", icon: Database },
            { id: "directives", label: "Rules", icon: Target },
            { id: "train", label: "Teach", icon: GraduationCap },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              if (id === "chat") setView("list");
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-all",
              tab === id ? "bg-surface-800 text-surface-50" : "text-surface-500 hover:text-surface-300"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-danger-strong">{error}</p>
      ) : null}

      {/* ── Chat ── */}
      {tab === "chat" && view === "list" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 space-y-2 border-b border-surface-800 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-500" />
                <input
                  value={rowSearch}
                  onChange={(e) => setRowSearch(e.target.value)}
                  placeholder="Search your conversations…"
                  aria-label="Search conversations"
                  className="w-full rounded-xl border border-surface-700 bg-surface-800 py-2 pl-8 pr-3 text-[12px] text-surface-50 placeholder-surface-500 outline-none focus:border-brand-500/50"
                />
              </div>
              <button
                onClick={startNewChat}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-2 text-[11px] font-semibold text-white transition hover:brightness-110"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </button>
            </div>
          </div>

          {historyError ? (
            <p
              role="alert"
              className="shrink-0 border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-danger-strong"
            >
              {historyError}
            </p>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            {historyError && rows.length === 0 ? null : loadingRows && rows.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-surface-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
              </div>
            ) : rows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-brand-500/25 bg-brand-500/10 text-accent-strong">
                  <MessageSquareText className="h-5 w-5" />
                </span>
                <p className="text-[13px] font-semibold text-surface-100">
                  {rowSearch ? "Nothing matched" : "No conversations yet"}
                </p>
                <p className="max-w-xs text-[11px] leading-relaxed text-surface-400">
                  {rowSearch
                    ? "Try a different word, or start a new conversation."
                    : "Ask the combined brains anything. Every thread is kept here, so you can pick one back up where you left it."}
                </p>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {rows.map((row) => (
                  <div key={row.id} className="relative">
                    {openingId === row.id ? (
                      <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-surface-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening…
                      </div>
                    ) : (
                      <ConversationListItem row={row} onOpen={() => void openConversation(row.id)} onDelete={() => void deleteConversation(row.id)} />
                    )}
                  </div>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : tab === "chat" ? (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.length === 0 && !isProcessing ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-brand-500/25 bg-brand-500/10 text-accent-strong">
                  <BrainCircuit className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-surface-100">Ask the combined brains</p>
                  <p className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-surface-400">
                    It reads the whole platform and answers from what it found. Attach a document and it becomes part of what the mind knows.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {QUICK_QUERIES.slice(0, 3).map((q) => (
                    <button
                      key={q.label}
                      onClick={() => void sendMessage(q.query)}
                      className="rounded-full border border-surface-700 bg-surface-900 px-2.5 py-1 text-[10px] font-medium text-surface-300 transition hover:border-brand-500/40 hover:text-surface-50"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onDecided={(id, outcome) =>
                  setMessages((prev) =>
                    prev.map((m) => (m.proposals ? { ...m, proposals: m.proposals.map((p) => (p.id === id ? { ...p, outcome } : p)) } : m))
                  )
                }
              />
            ))}

            {/* The in-flight reply lives outside the array so only this bubble repaints. */}
            {isProcessing ? (
              <div className="flex justify-start">
                <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-surface-700 bg-surface-900/80 px-3.5 py-2.5">
                  {streamingText ? (
                    <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-surface-100">
                      {streamingText}
                      <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-brand-400 align-middle" />
                    </p>
                  ) : (
                    <div className="flex items-center gap-1.5 py-0.5">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-400 [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-400 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-surface-400 [animation-delay:300ms]" />
                      <span className="ml-1 text-[10px] text-surface-500">reading the platform…</span>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {uploading ? (
              <div className="flex items-center gap-2 text-[11px] text-surface-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Filing your material into memory…
              </div>
            ) : null}

            <div ref={endRef} />
          </div>

          {activeShared ? (
            <div className="flex shrink-0 items-center gap-2 border-t border-surface-800 bg-emerald-500/5 px-3 py-2">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-positive-strong" />
              <input
                readOnly
                value={shareUrl ?? ""}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Share link"
                className="min-w-0 flex-1 truncate rounded-lg border border-surface-700 bg-surface-900 px-2 py-1 text-[10px] text-surface-300"
              />
              <span className="shrink-0 text-[10px] font-semibold text-positive-strong">{copied ? "Copied" : "Read-only"}</span>
            </div>
          ) : null}

          <div className="shrink-0 border-t border-surface-800 p-2.5">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_QUERIES.map((q) => (
                <button
                  key={q.label}
                  onClick={() => void sendMessage(q.query)}
                  disabled={isProcessing}
                  className="rounded-full border border-surface-700 bg-surface-900 px-2 py-0.5 text-[10px] text-surface-300 transition hover:border-brand-500/40 hover:text-surface-50 disabled:opacity-40"
                >
                  {q.label}
                </button>
              ))}
            </div>

            {uploadNote ? <p className="mb-1.5 text-[10px] text-surface-400">{uploadNote}</p> : null}

            <div className="flex items-end gap-1.5">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.log,.rst,text/*,application/json"
                onChange={(e) => void uploadMaterial(e.target.files)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || isProcessing}
                title="Attach research material for the mind to file"
                aria-label="Attach research material"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-surface-700 text-surface-400 transition hover:border-brand-500/40 hover:text-surface-50 disabled:opacity-40"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </button>

              <textarea
                ref={composerRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage(input);
                  }
                }}
                rows={1}
                placeholder="Ask about the platform, or attach a document…"
                disabled={isProcessing}
                className="max-h-24 min-h-[36px] flex-1 resize-none rounded-xl border border-surface-700 bg-surface-800 px-3 py-2 text-[12px] leading-relaxed text-surface-50 placeholder-surface-500 outline-none focus:border-brand-500/50 disabled:opacity-50"
              />

              <button
                onClick={() => void sendMessage(input)}
                disabled={!input.trim() || isProcessing}
                aria-label="Send"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500 text-white transition hover:brightness-110 disabled:bg-surface-800 disabled:text-surface-500"
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </>
      ) : tab === "brains" ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Knowledge", value: hive ? hive.total.toLocaleString() : "—" },
              { label: "Internal", value: hive ? (hive.sourceBreakdown.internal ?? 0).toLocaleString() : "—" },
              { label: "External", value: hive ? (hive.sourceBreakdown.external ?? 0).toLocaleString() : "—" },
              { label: "AI lessons", value: hive ? (hive.sourceBreakdown.ai ?? 0).toLocaleString() : "—" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-surface-800 bg-surface-900/50 px-3 py-2">
                <p className="text-lg font-bold text-surface-50">{stat.value}</p>
                <p className="text-[9px] uppercase tracking-wider text-surface-500">{stat.label}</p>
              </div>
            ))}
          </div>

          {hive && hive.topTopics.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[9px] font-medium uppercase tracking-wider text-surface-500">Hive signals</p>
              <div className="flex flex-wrap gap-1.5">
                {hive.topTopics.slice(0, 12).map((t) => (
                  <span key={t.topic} className="rounded-full border border-amber-500/25 bg-amber-500/15 px-2 py-0.5 text-[10px] text-warning-strong">
                    {t.topic} ×{t.count}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {insights.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[9px] font-medium uppercase tracking-wider text-surface-500">Neural insights</p>
              <ul className="space-y-1.5">
                {insights.map((ins, i) => (
                  <li key={i} className="rounded-xl border border-surface-800 bg-surface-900/50 px-3 py-2">
                    <p className={cn("text-[12px] font-semibold", severityColor[ins.severity])}>{ins.title}</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-surface-400">{ins.summary}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2">
            <button
              onClick={() => void runTraining("train")}
              disabled={learning !== null}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-500/20 bg-brand-500/10 px-3 py-2 text-[12px] font-medium text-brand-400 disabled:opacity-50"
            >
              {learning === "train" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Run AI training cycle
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void runTraining("sweep")}
                disabled={learning !== null}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-surface-700 bg-surface-800 px-3 py-2 text-[11px] text-surface-300 disabled:opacity-50"
              >
                {learning === "sweep" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Sweep posts
              </button>
              <button
                onClick={() => void runTraining("learn")}
                disabled={learning !== null}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-surface-700 bg-surface-800 px-3 py-2 text-[11px] text-surface-300 disabled:opacity-50"
              >
                {learning === "learn" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                Learn RSS
              </button>
            </div>
          </div>
        </div>
      ) : tab === "directives" ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-positive-strong">
              <Target className="h-3.5 w-3.5" /> Instruct the mind
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-surface-400">
              Standing instructions are stored as mind memories and read on every sports prediction. They steer the model by a
              bounded amount and are named in the published rationale, so a pick can always be explained.
            </p>
          </div>

          <div className="space-y-1.5">
            <textarea
              value={directiveDraft}
              onChange={(e) => {
                setDirectiveDraft(e.target.value);
                setDirectiveError(null);
              }}
              rows={2}
              placeholder="e.g. Favour home teams in La Liga"
              className="w-full resize-none rounded-xl border border-surface-700 bg-surface-800 px-3 py-2 text-[12px] text-surface-50 placeholder-surface-500 outline-none focus:border-brand-500/50"
            />
            <div className="flex flex-wrap gap-1.5">
              {DIRECTIVE_EXAMPLES.map((example) => (
                <button
                  key={example}
                  onClick={() => setDirectiveDraft(example)}
                  className="rounded-full border border-surface-700 bg-surface-900 px-2 py-0.5 text-[10px] text-surface-300 transition hover:border-brand-500/40 hover:text-surface-50"
                >
                  {example}
                </button>
              ))}
            </div>
            {directiveError ? <p className="text-[10px] leading-relaxed text-danger-strong">{directiveError}</p> : null}
            <button
              onClick={() => void saveDirectiveInstruction(directiveDraft)}
              disabled={!directiveDraft.trim() || savingDirective}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-3 py-2 text-[12px] font-semibold text-white disabled:bg-surface-800 disabled:text-surface-500"
            >
              {savingDirective ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
              Save standing instruction
            </button>
          </div>

          <div>
            <p className="mb-1.5 text-[9px] font-medium uppercase tracking-wider text-surface-500">Active rules ({directives.length})</p>
            {directives.length === 0 ? (
              <p className="text-[10px] leading-relaxed text-surface-500">
                None yet. The model is running on its own learned evidence and the market line.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {directives.map((d) => (
                  <li key={d.id} className="rounded-xl border border-surface-800 bg-surface-900/50 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-surface-100">{d.raw}</p>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-surface-500">{d.note}</p>
                      </div>
                      <button
                        onClick={() => void toggleDirective(d.id, false)}
                        title="Revoke this rule"
                        aria-label="Revoke this rule"
                        className="shrink-0 rounded-lg p-1.5 text-surface-500 transition hover:bg-surface-800 hover:text-danger-strong"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-3">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-100">
              <GraduationCap className="h-3.5 w-3.5 text-brand-400" /> Teach the mind from the web
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-surface-500">
              Give it a subject it has no way to know about — a league, a market, a competitor — and it will research the open
              web and keep what it reads.
            </p>

            <div className="mt-2.5 space-y-2">
              <input
                value={teachDraft}
                onChange={(e) => setTeachDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void teachFromWeb();
                }}
                placeholder="e.g. Kenyan Premier League 2026 season"
                className="w-full rounded-xl border border-surface-700 bg-surface-800 px-3 py-2 text-[12px] text-surface-50 placeholder-surface-500 outline-none focus:border-brand-500/50"
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-[10px] text-surface-400">
                  Sources
                  <select
                    value={teachSources}
                    onChange={(e) => setTeachSources(Number(e.target.value))}
                    className="rounded-md border border-surface-700 bg-surface-800 px-1.5 py-0.5 text-[11px] text-surface-200 outline-none"
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-surface-400">
                  <input
                    type="checkbox"
                    checked={teachSports}
                    onChange={(e) => setTeachSports(e.target.checked)}
                    className="h-3 w-3 accent-emerald-500"
                  />
                  Tag as sports
                </label>
              </div>
              {teachMsg ? <p className="text-[10px] leading-relaxed text-brand-600">{teachMsg}</p> : null}
              <button
                onClick={() => void teachFromWeb()}
                disabled={teachDraft.trim().length < 3 || teaching}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-3 py-2 text-[12px] font-semibold text-white disabled:bg-surface-800 disabled:text-surface-500"
              >
                {teaching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Research and file
              </button>
            </div>
          </div>

          {/* The same ingest the chat's paperclip uses, described where an operator
              goes looking for it. */}
          <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-3">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-100">
              <Paperclip className="h-3.5 w-3.5 text-brand-400" /> File your own research material
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-surface-500">
              A brief, a dataset description, a note that is not published anywhere — text files only (txt, md, csv, json,
              html), up to 2 MB each. It is filed as operator-sourced knowledge, which the mind trusts more than scraped text.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-brand-500/25 bg-brand-500/10 px-3 py-2 text-[12px] font-medium text-brand-400 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              Choose text files
            </button>
            {uploadNote ? <p className="mt-2 text-[10px] leading-relaxed text-surface-400">{uploadNote}</p> : null}
          </div>

          <div>
            <p className="mb-1.5 text-[9px] font-medium uppercase tracking-wider text-surface-500">
              Web knowledge held{knowledge ? ` — ${knowledge.rows} sources from ${knowledge.hosts} sites` : ""}
            </p>
            {!knowledge || knowledge.recent.length === 0 ? (
              <p className="text-[10px] leading-relaxed text-surface-500">Nothing filed from the web yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {knowledge.recent.map((item) => (
                  <li
                    key={`${item.url}-${item.title}`}
                    className="truncate rounded-xl border border-surface-800 bg-surface-900/50 px-3 py-1.5 text-[11px] text-surface-300"
                    title={item.url ?? item.title}
                  >
                    {item.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One turn, in the shape a messaging app uses for it. */  function MessageBubble({
  message,
  onDecided,
}: {
  message: ChatMessage;
  onDecided: (id: string, outcome: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const copy = () => {
    void navigator.clipboard
      .writeText(message.text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2_000);
      })
      .catch(() => {
        /* Clipboard refused; the text is selectable either way. */
      });
  };

  return (
    <div className={cn("group flex", isUser ? "justify-end" : "justify-start")}>
      <div className="w-fit max-w-[92%]">
        <div
          className={cn(
            "relative rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed",
            isUser
              ? "rounded-br-sm bg-brand-500/20 text-surface-50 ring-1 ring-brand-500/30"
              : "rounded-bl-sm border border-surface-700 bg-surface-900/80 text-surface-100"
          )}
        >
          <p className="whitespace-pre-wrap">{message.text}</p>

          {message.understanding && !isUser ? (
            <p className="mt-1.5 text-[10px] italic text-surface-400">{message.understanding}</p>
          ) : null}

          {message.readings && message.readings.items.length > 0 ? <ReadingEvidence readings={message.readings} /> : null}

          {message.proposals && message.proposals.length > 0 ? (
            <ProposalDecisions proposals={message.proposals} onDecided={onDecided} />
          ) : null}

          {message.approvals && message.approvals.length > 0 ? (
            <ApprovalCards approvals={message.approvals} />
          ) : null}

          {message.tools && message.tools.length > 0 ? <AgentToolCards tools={message.tools} /> : null}

          {message.predictions && message.predictions.length > 0 ? (
            <PredictionCards predictions={message.predictions} />
          ) : null}

          {!isUser ? <EngineBadges intent={message.intent} enginesUsed={message.enginesUsed} hive={message.hive} /> : null}

          <button
            type="button"
            onClick={copy}
            aria-label="Copy this message"
            className={cn(
              "absolute -top-2 rounded-lg border border-surface-700 bg-surface-900 p-1 text-surface-400 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100",
              isUser ? "-left-2" : "-right-2"
            )}
          >
            {copied ? <Check className="h-3 w-3 text-positive-strong" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>

        {message.createdAt ? (
          <p className={cn("mt-1 text-[9px] text-surface-500", isUser ? "text-right" : "text-left")}>
            {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
