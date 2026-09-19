import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { appBrain, BRAIN_SUBSYSTEMS, type BrainMind } from "@/lib/app-brain";
import { gatherReadings, type BrainReading, type BrainReadings } from "@/lib/brain-readings";
import { gatherAwareness, type AwarenessDomain, type BrainAwareness } from "@/lib/brain-awareness";
import { classifyIntent, type Intent } from "@/lib/neural-intent";
import { generateText, getAiConfig } from "@/lib/ai-provider";
import {
  APPROVAL_TOOLS,
  isApprovalTool,
  pendingProposals,
  proposeAction,
  type ApprovalTool,
  type ProposalDTO,
} from "@/lib/brain-approvals";
import { openIssues, type BrainIssue } from "@/lib/brain-issues";
import { repairMode, type RepairMode } from "@/lib/brain-repair";

/**
 * The virtual admin assistant: the mind the admin console talks to.
 *
 * This is deliberately **not** the same surface as the studio copilot, and the
 * separation is the point. The copilot lives inside a draft and its whole job is
 * to make a sentence better — it reads one composer and proposes edits to it.
 * The admin assistant's job is the platform: intake, scheduling, calibration,
 * moderation, money, the mind's own autonomy. A copilot with a cron re-register
 * tool is a copilot that can change what the platform *does* between two
 * paragraphs, and a console assistant that can only write headlines is not an
 * assistant at all.
 *
 * So the two never share a facade:
 *
 *   • `neural-studio.ts` → `appBrain.think/pilot` → the composer. Content only.
 *   • this module → readings + awareness + collaboration → the whole platform,
 *     with every write filed for approval.
 *
 * Three properties hold it together:
 *
 *   1. **Reads are unrestricted, writes are proposed.** Every domain here is
 *      read in full; nothing mutates without an admin's name on the decision.
 *   2. **It is fluent with no provider configured.** The model is an
 *      enhancement, not the mechanism. `briefAnswer` composes the same facts
 *      into prose from the deterministic engines, so a platform with no API key
 *      still gets an assistant that can answer, tell you what is wrong, and say
 *      what it would do about it.
 *   3. **It says what it cannot see.** A reading that failed is reported as
 *      failed rather than quietly dropped, because an assistant that silently
 *      omits what it could not read is an assistant that lies by omission.
 */

const log = createLogger("admin-intelligence");

/* ── The app's working areas ─────────────────────────────────────────────── */

export interface AdminDomain {
  id: string;
  label: string;
  /** What this area of the platform is for. */
  purpose: string;
  /** Reading ids from `brain-readings` that cover it. */
  readingIds: string[];
  /** Awareness domain ids from `brain-awareness` that cover it. */
  awarenessIds: string[];
  /** Questions this domain answers, shown as prompts in the console. */
  examples: string[];
  /** Operations the mind may *request* in this domain. Empty means read-only. */
  tools: ApprovalTool[];
}

/**
 * Every area of the platform, declared once.
 *
 * The console, the prompt and the approval buttons all read from this list, so
 * they cannot disagree about what the assistant is responsible for — and adding
 * a domain is a one-line change that immediately becomes visible, askable and
 * actionable everywhere.
 */
export const ADMIN_DOMAINS: readonly AdminDomain[] = [
  {
    id: "content",
    label: "Content",
    purpose: "Stories, drafts, the publishing queue and what is scheduled to go out.",
    readingIds: ["content", "drafts", "scheduler"],
    awarenessIds: [],
    examples: ["What is sitting in drafts?", "What publishes today?", "How much did we publish this week?"],
    tools: ["publish_post", "schedule_post"],
  },
  {
    id: "audience",
    label: "Audience",
    purpose: "Who reads us, where they come from, and whether any of it is growing.",
    readingIds: ["audience", "engagement", "regions"],
    awarenessIds: ["audience"],
    examples: ["How is growth looking?", "Which region is strongest?", "Are people reading more than last week?"],
    tools: [],
  },
  {
    id: "community",
    label: "Community",
    purpose: "Comments, reports and the moderation queue.",
    readingIds: ["moderation-queue", "content"],
    awarenessIds: [],
    examples: ["How big is the moderation queue?", "Anything reported that needs me?", "What are people arguing about?"],
    tools: ["flag_comment", "remove_comment"],
  },
  {
    id: "sports",
    label: "Sports",
    purpose: "Fixtures, the prediction board, and how well the model is actually calibrated.",
    readingIds: ["pipelines"],
    awarenessIds: ["sports"],
    examples: [
      "How accurate is the sports model?",
      "How many lessons has it learned?",
      "What is hurting the predictions?",
    ],
    tools: ["run_sports_intelligence"],
  },
  {
    id: "economy",
    label: "Economy",
    purpose: "Tips, subscriptions and what creators are owed.",
    readingIds: ["economy"],
    awarenessIds: ["economy"],
    examples: ["What are we earning?", "Are there payouts waiting?", "How is the paid tier doing?"],
    tools: [],
  },
  {
    id: "intake",
    label: "Intake and syndication",
    purpose: "The RSS intake, which feeds are healthy, and what we publish out to other networks.",
    readingIds: ["own-feeds", "rss-feeds", "offload"],
    awarenessIds: [],
    examples: ["Which feeds are failing?", "When did intake last run?", "Is our own feed healthy?"],
    tools: ["run_rss_poll", "retry_view_fold"],
  },
  {
    id: "pipelines",
    label: "Pipelines",
    purpose: "The scheduled jobs, the view sync and everything that runs without a person watching.",
    readingIds: ["pipelines", "scheduler", "cache", "offload"],
    awarenessIds: ["pipelines"],
    examples: ["Is anything stalled?", "Which job missed its window?", "Is the view sync behind?"],
    tools: ["refire_stale_jobs", "rewarm_snapshots", "retry_view_fold", "run_brain_diagnosis"],
  },
  {
    id: "mind",
    label: "Mind",
    purpose: "The brain's own memory, learning, diagnosis and self-repair envelope.",
    readingIds: ["hive", "issues", "model"],
    awarenessIds: ["mind"],
    examples: [
      "What have you learned lately?",
      "What do you still not know?",
      "What does the last diagnosis say?",
    ],
    tools: ["run_hive_sweep", "run_brain_diagnosis", "set_repair_mode"],
  },
  {
    id: "operations",
    label: "Operations",
    purpose: "The platform as a whole: infrastructure, cost, and the state of the build itself.",
    readingIds: ["pipelines", "cache", "model", "issues"],
    awarenessIds: ["pipelines", "mind"],
    examples: ["How is the platform?", "What is broken right now?", "What should I fix first?"],
    tools: ["run_brain_diagnosis", "refire_stale_jobs", "rewarm_snapshots"],
  },
] as const;

const DOMAIN_BY_ID = new Map(ADMIN_DOMAINS.map((d) => [d.id, d]));

/** Which domain an intent belongs to. Unmapped intents fall through to operations. */
const INTENT_DOMAIN: Partial<Record<Intent, string>> = {
  system_health: "operations",
  content_analysis: "content",
  user_analysis: "audience",
  growth_report: "audience",
  regional_analysis: "audience",
  moderation_report: "community",
  threat_scan: "operations",
  trend_query: "content",
  hive_report: "mind",
  knowledge_search: "mind",
  memory_manage: "mind",
  external_learn: "intake",
  web_research: "intake",
  recommendation: "content",
  run_sweep: "mind",
  creator_intelligence: "audience",
  monetization_report: "economy",
  traffic_depth: "audience",
  external_signals: "intake",
  curate_content: "content",
};

/* ── The boundary, declared ─────────────────────────────────────────────── */

/**
 * The operations tools: everything that changes the platform's own machinery.
 *
 * Kept as a named list rather than inferred from the domain catalogue so the
 * boundary can be asserted. Editorial tools act on a piece of content; these act
 * on what the platform *does*, which is why only the admin surface may request
 * them. A writer's assistant with `refire_stale_jobs` is a writer's assistant
 * that can restart the scheduler from a paragraph of prose.
 */
export const OPERATIONS_TOOLS: readonly ApprovalTool[] = [
  "run_hive_sweep",
  "run_rss_poll",
  "refire_stale_jobs",
  "rewarm_snapshots",
  "retry_view_fold",
  "run_sports_intelligence",
  "run_brain_diagnosis",
  "set_repair_mode",
] as const;

/** The editorial tools: everything that acts on a story or a comment. */
export const EDITORIAL_TOOLS: readonly ApprovalTool[] = [
  "publish_post",
  "schedule_post",
  "flag_comment",
  "remove_comment",
] as const;

/**
 * What each mind is allowed to reach.
 *
 * The separation the console is built on, written down in the code rather than
 * left as an understanding between two files. `tools` is the whole allowlist for
 * a surface: a tool outside it is not requestable from there, however the
 * request is phrased.
 */
export interface BrainSurface {
  id: "operations" | "copilot";
  label: string;
  /** Where it lives. */
  module: string;
  /** What it reads. */
  reads: string;
  /** What it may change, and how. */
  writes: string;
  /** The operations it may request. Empty means it can only propose edits. */
  tools: readonly ApprovalTool[];
}

export const BRAIN_SURFACES: readonly BrainSurface[] = [
  {
    id: "operations",
    label: "Operations mind (admin console)",
    module: "src/lib/admin-intelligence.ts",
    reads: "Every subsystem: content, audience, community, sports, economy, intake, pipelines, and its own memory.",
    writes: "Files an approval request. Never executes.",
    tools: [...OPERATIONS_TOOLS, ...EDITORIAL_TOOLS],
  },
  {
    id: "copilot",
    label: "Writing copilot (studio)",
    module: "src/lib/neural-studio.ts",
    reads: "One composer: the draft, title, excerpt, tags and the current selection.",
    writes: "Proposes edits to that draft, which the writer applies and can undo.",
    // Deliberately empty. The copilot's vocabulary is edit operations, not
    // platform operations, and it has no approval path at all.
    tools: [],
  },
] as const;

/** Is this tool requestable from a given surface? */
export function surfaceAllows(surfaceId: BrainSurface["id"], tool: string): boolean {
  const surface = BRAIN_SURFACES.find((s) => s.id === surfaceId);
  return Boolean(surface && (surface.tools as readonly string[]).includes(tool));
}

/* ── The mind's collaboration, as a live diagram ─────────────────────────── */

export interface SubsystemTrace {
  id: string;
  mind: BrainMind;
  name: string;
  role: string;
  capabilities: string[];
  state: "ok" | "warn" | "critical" | "unknown";
  /** The live line the console shows under the node. */
  evidence: string;
}

export interface CollaborationLink {
  from: string;
  to: string;
  /** What actually crosses this hand-off. */
  what: string;
}

export interface MindCollaboration {
  generatedAt: string;
  subsystems: SubsystemTrace[];
  minds: { mind: BrainMind; label: string; subsystems: number; online: boolean }[];
  links: CollaborationLink[];
  /** How many subsystems are reporting a problem. */
  degraded: number;
}

/**
 * The hand-offs between engines.
 *
 * This is the part of "pipeline collaboration" that a health bar cannot show.
 * Each link is a real dependency: something the receiving engine cannot do well
 * without what it is handed. Declaring them explicitly is what makes the
 * console's diagram meaningful rather than decorative — and it makes a broken
 * seam (a full hive that no longer informs predictions) visible as a link.
 */
const COLLABORATION_LINKS: readonly CollaborationLink[] = [
  { from: "neural-research", to: "hive-memory", what: "what the open web and the intake taught it" },
  { from: "hive-memory", to: "neural-reasoner", what: "recalled lessons, ranked by decayed confidence" },
  { from: "hive-memory", to: "neural-authoring", what: "what has been read before, as a writing prior" },
  { from: "hive-engagement", to: "neural-reasoner", what: "what is actually being read, for analysis" },
  { from: "hive-engagement", to: "platform-senses", what: "engagement velocity, in the creator and traffic reports" },
  { from: "platform-senses", to: "neural-reasoner", what: "the business and audience facts an answer is grounded in" },
  { from: "neural-reasoner", to: "platform-actions", what: "intent and classification, deciding what is published and moderated" },
  { from: "neural-authoring", to: "platform-actions", what: "draft prose, headlines and structure, handed over to publish" },
  { from: "platform-actions", to: "hive-engagement", what: "published posts, which then accumulate reads" },
  { from: "platform-actions", to: "hive-memory", what: "the outcomes of what went out — the learning loop closes here" },
] as const;

const MIND_LABELS: Record<BrainMind, string> = {
  hive: "Hive — what the platform has learned",
  neural: "Neural — the reasoner and the writer",
  platform: "Platform — the senses",
};

/**
 * Awareness domains that say something about a subsystem's health.
 *
 * A reading tells you the number; awareness tells you whether the number is
 * *good*. The sports engine reporting "ok" while the model runs on two lessons
 * is the case this exists for — the node should not look calm.
 */
const SUBSYSTEM_AWARENESS: Record<string, string> = {
  "hive-memory": "mind",
  "neural-reasoner": "mind",
  "neural-research": "pipelines",
  "platform-senses": "audience",
  "platform-actions": "pipelines",
};

/** Reading ids that, when not green, mean the subsystem's seam is degraded. */
const SUBSYSTEM_READING: Record<string, string[]> = {
  "hive-memory": ["hive", "issues"],
  "hive-engagement": ["engagement"],
  "neural-reasoner": ["model"],
  "neural-research": ["rss-feeds", "own-feeds"],
  "neural-authoring": ["model", "drafts"],
  "platform-senses": ["audience", "regions", "economy"],
  "platform-actions": ["pipelines", "scheduler", "moderation-queue", "content", "offload"],
};

/**
 * Build the live collaboration trace.
 *
 * Subsystems come from `BRAIN_SUBSYSTEMS` rather than a second list here, so a
 * declared capability and a rendered node can never drift apart. A subsystem
 * whose readings could not be taken reports `unknown` — which is the honest
 * state, and reads differently from `ok` on purpose.
 */
export function collaboration(
  readings: BrainReadings | null,
  aware: BrainAwareness | null
): MindCollaboration {
  const byId = new Map((readings?.readings ?? []).map((r) => [r.id, r]));

  const subsystems: SubsystemTrace[] = BRAIN_SUBSYSTEMS.map((sub) => {
    const probes = (SUBSYSTEM_READING[sub.id] ?? []).map((id) => byId.get(id)).filter(Boolean) as BrainReading[];

    /* The starting state is the domain's calibration, not "ok": a subsystem
     * whose domain is unproven or degraded should not render a green node. */
    const awareId = SUBSYSTEM_AWARENESS[sub.id];
    const awareState = awareId ? aware?.domains.find((d) => d.id === awareId)?.state : undefined;
    const start: "ok" | "warn" | "critical" | "unknown" =
      awareState === "critical" ? "critical" : awareState === "warn" || awareState === "unproven" ? "warn" : "ok";

    const worst = probes.reduce<"ok" | "warn" | "critical" | "unknown">((acc, p) => {
      if (p.state === "critical") return "critical";
      if (p.state === "warn" && acc !== "critical") return "warn";
      if (p.state === "unknown" && acc === "ok") return "unknown";
      return acc;
    }, start);

    const awareDomain = awareId ? aware?.domains.find((d) => d.id === awareId) : undefined;
    const evidence = probes.length
      ? `${probes.map((p) => `${p.label}: ${p.value}`).join(" · ")}${awareDomain ? ` · calibration: ${awareDomain.headline}` : ""}`
      : readings
        ? "No dedicated probe — this subsystem is measured through the domain it feeds."
        : "Readings could not be taken.";

    return {
      id: sub.id,
      mind: sub.mind,
      name: sub.name,
      role: sub.role,
      capabilities: [...sub.capabilities],
      state: probes.length === 0 ? (readings ? "ok" : "unknown") : worst,
      evidence,
    };
  });

  const minds = (["hive", "neural", "platform"] as BrainMind[]).map((mind) => ({
    mind,
    label: MIND_LABELS[mind],
    subsystems: subsystems.filter((s) => s.mind === mind).length,
    online: readings !== null && (mind === "hive" ? readings.taken > 0 : true),
  }));

  return {
    generatedAt: new Date().toISOString(),
    subsystems,
    minds,
    links: [...COLLABORATION_LINKS],
    degraded: subsystems.filter((s) => s.state === "warn" || s.state === "critical" || s.state === "unknown").length,
  };
}

/* ── Calibration: what the mind would do about what it noticed ───────────── */

export interface CalibrationMove {
  /** Stable id, so the console can key a dismissal off it. */
  id: string;
  domain: string;
  title: string;
  why: string;
  /** How bad it is to leave alone. */
  urgency: "low" | "medium" | "high";
  /** The operation that addresses it, if the mind can act at all. */
  tool: ApprovalTool | null;
  /** What the admin should do when the mind cannot act (a human step). */
  manual?: string;
}

/**
 * Turn awareness into moves.
 *
 * Awareness says "the sports model is running on 2 lessons". This says what
 * follows from that: a specific operation, in a specific domain, with a reason
 * an admin can disagree with. Moves are *offers* — nothing here runs anything,
 * and the ones with a `tool` are filed as proposals only when an admin asks.
 */
export function calibrationMoves(aware: BrainAwareness, issues: BrainIssue[] = []): CalibrationMove[] {
  const moves: CalibrationMove[] = [];
  const domainOf = (id: string) => aware.domains.find((d) => d.id === id);

  const sports = domainOf("sports");
  if (sports && sports.state === "unproven") {
    moves.push({
      id: "sports-thin-corpus",
      domain: "sports",
      title: "The prediction model has too few lessons to trust",
      why: sports.notes[0] ?? "The corpus is below the minimum the mind will act on.",
      urgency: "medium",
      tool: "run_sports_intelligence",
      manual: "A pass teaches it from every finished match it can observe — the cheapest way to widen the corpus.",
    });
  }
  if (sports && sports.state === "warn") {
    moves.push({
      id: "sports-below-chance",
      domain: "sports",
      title: "Sports accuracy is below chance",
      why: sports.notes[0] ?? "Graded picks are landing worse than a coin toss.",
      urgency: "high",
      tool: null,
      manual: "Nothing automated will fix this. Read the standing directives first — an operator leaning the model is the most common cause.",
    });
  }

  const mind = domainOf("mind");
  if (mind && mind.state !== "ok") {
    moves.push({
      id: "mind-stale",
      domain: "mind",
      title: "The mind's memory is going stale",
      why: mind.notes[0] ?? "Nothing new has been learned recently, so answers are reasoning on old facts.",
      urgency: "medium",
      tool: "run_hive_sweep",
    });
  }

  const pipelines = domainOf("pipelines");
  if (pipelines && pipelines.state !== "ok") {
    moves.push({
      id: "pipelines-degraded",
      domain: "pipelines",
      title: "A pipeline is behind",
      why: pipelines.notes[0] ?? pipelines.headline,
      urgency: pipelines.state === "critical" ? "high" : "medium",
      tool: "run_brain_diagnosis",
      manual: "Diagnose first — a re-fire is cheap but only helps if the window really was missed.",
    });
  }

  const economy = domainOf("economy");
  if (economy && economy.state !== "ok") {
    moves.push({
      id: "economy-attention",
      domain: "economy",
      title: "Something in the money needs a person",
      why: economy.notes[0] ?? economy.headline,
      urgency: "high",
      tool: null,
      manual: "Payouts and subscriptions are not something the mind may change. Handle this one directly.",
    });
  }

  const audience = domainOf("audience");
  if (audience && audience.state === "warn") {
    moves.push({
      id: "audience-flat",
      domain: "audience",
      title: "Growth is flat this week",
      why: audience.notes[0] ?? "No new people and no new stories.",
      urgency: "low",
      tool: null,
      manual: "Publishing cadence is the lever. Check whether intake is importing.",
    });
  }

  for (const issue of issues.filter((i) => i.severity === "critical").slice(0, 3)) {
    moves.push({
      id: `issue-${issue.id}`,
      domain: "mind",
      title: issue.title,
      why: issue.detail,
      urgency: "high",
      tool: "run_brain_diagnosis",
      manual: issue.fix,
    });
  }

  return moves;
}

/* ── The turn ────────────────────────────────────────────────────────────── */

export interface AdminTurnResult {
  text: string;
  intent: Intent;
  domain: AdminDomain;
  /** One line of what the mind took the request to be. */
  understanding: string;
  readings: { taken: number; missing: number; state: string; items: BrainReading[] } | null;
  awareness: BrainAwareness | null;
  collaboration: MindCollaboration | null;
  issues: BrainIssue[];
  moves: CalibrationMove[];
  pending: ProposalDTO[];
  /** True when no model answered and the deterministic brief composed the reply. */
  degraded: boolean;
  repairMode: RepairMode | null;
  /** A write request filed this turn. Nothing has happened yet. */
  proposal: ProposalDTO | null;
  /** Set when the admin asked for something the mind is not allowed to request. */
  refused: string | null;
}

const CHANGE_VERBS =
  /\b(run|rerun|re-run|trigger|fire|start|poll|sweep|teach|settle|refresh|repair|fix|diagnose|re-?register|re-?warm|fold|set|switch|enable|disable|publish|schedule|flag|delete|remove|approve)\b/i;

/** Is the admin asking for something to *happen*, rather than asking a question? */
export function isChangeRequest(input: string): boolean {
  return CHANGE_VERBS.test(input);
}

/**
 * Which operation a sentence is asking for.
 *
 * Explicit tool names win; otherwise the domain's own default operation is
 * used. Deliberately simple and inspectable: an assistant whose routing cannot
 * be read off its own catalogue is one whose behaviour cannot be predicted, and
 * the console prints this decision next to the answer.
 */
export function resolveTool(input: string, domain: AdminDomain): ApprovalTool | null {
  const lower = input.toLowerCase();
  const mentioned = (Object.keys(APPROVAL_TOOLS) as ApprovalTool[]).find((tool) => lower.includes(tool));
  if (mentioned) return mentioned;

  const desired = domain.tools.find((tool) => {
    if (tool === "run_hive_sweep") return /\b(sweep|learn|memory|refresh)\b/.test(lower);
    if (tool === "run_rss_poll") return /\b(poll|intake|feed|import|syndicat)/.test(lower);
    if (tool === "refire_stale_jobs") return /\b(job|stale|missed|window|re-?fire)\b/.test(lower);
    if (tool === "rewarm_snapshots") return /\b(warm|cache|snapshot|edge)\b/.test(lower);
    if (tool === "retry_view_fold") return /\b(view|fold|count)\b/.test(lower);
    if (tool === "run_sports_intelligence") return /\b(prediction|sport|model|fixture|match|teach|analytic)/.test(lower);
    if (tool === "run_brain_diagnosis") return /\b(diagnos\w*|health|check|self-?test)\b/.test(lower);
    if (tool === "set_repair_mode") return /\b(self-?heal|repair mode|envelope|autonom)/.test(lower);
    if (tool === "publish_post") return /\b(publish|go live)\b/.test(lower);
    if (tool === "schedule_post") return /\bschedule\b/.test(lower);
    if (tool === "flag_comment") return /\bflag\b/.test(lower);
    if (tool === "remove_comment") return /\b(delete|remove)\b.*\bcomment\b/.test(lower);
    return false;
  });

  return desired ?? null;
}

const REDACTED_ARG_HINTS: Record<string, string> = {
  postId: "the post id (from Content → the story)",
  commentId: "the comment id (from the moderation queue)",
  reason: "the reason, which goes on the moderation ledger",
  when: "when to publish, e.g. \"tomorrow 09:00\"",
  mode: "one of off, observe or enforce",
  feedId: "the feed id, or leave it out to poll everything due",
};

/** Extract whatever arguments the sentence actually names. */
export function extractArgs(input: string, tool: ApprovalTool): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const cuid = input.match(/\b(c[a-z0-9]{20,})\b/);
  if (cuid) {
    if (tool === "flag_comment" || tool === "remove_comment") args.commentId = cuid[1];
    else args.postId = cuid[1];
  }
  const mode = input.toLowerCase().match(/\b(off|observe|enforce)\b/);
  if (mode && tool === "set_repair_mode") args.mode = mode[1];
  const when = input.match(/\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)[^.,;]*\d{1,2}[:.]?\d{0,2}\s*(am|pm)?/i);
  if (when && tool === "schedule_post") args.when = when[0].trim();
  return args;
}

/**
 * Ask the operation assistant.
 *
 * One front door for the console. Reads everything, answers fluently, and turns
 * a change request into a filed proposal — never into an action.
 */
export async function operate(
  input: string,
  history: { role: string; content: string }[] = [],
  opts: { actorId?: string; live?: boolean } = {}
): Promise<AdminTurnResult> {
  const classified = classifyIntent(input);
  const domain = DOMAIN_BY_ID.get(INTENT_DOMAIN[classified.intent] ?? "operations") ?? ADMIN_DOMAINS[0]!;
  const understanding = `Asking about ${domain.label.toLowerCase()} — ${domain.purpose}`;

  const [readings, awareness, issues, pending, mode] = await Promise.all([
    gatherReadings({ live: opts.live }).catch(() => null),
    gatherAwareness().catch(() => null),
    openIssues().catch(() => [] as BrainIssue[]),
    pendingProposals().catch(() => [] as ProposalDTO[]),
    repairMode().catch(() => null),
  ]);

  const collab = collaboration(readings, awareness);
  const moves = awareness ? calibrationMoves(awareness, issues) : [];

  /* ── A change request: file it, run nothing. ──────────────────────────── */
  if (isChangeRequest(input) && !/\?$/.test(input.trim())) {
    const tool = resolveTool(input, domain);
    if (tool) {
      const allowed = Object.values(ADMIN_DOMAINS).some((d) => d.tools.includes(tool));
      if (!allowed) {
        return base({
          text: `I can run that, but not from the ${domain.label.toLowerCase()} surface — it belongs to another part of the platform. Tell me which area you meant and I will file it there.`,
          refused: `"${tool}" is not a ${domain.label.toLowerCase()} operation.`,
        });
      }
      const spec = APPROVAL_TOOLS[tool];
      const args = extractArgs(input, tool);
      const missing = spec.required.filter((key) => !String(args[key] ?? "").trim());
      if (missing.length > 0) {
        return base({
          text: [
            `**${spec.label}** is a ${spec.risk}-risk change, so it needs an approval before anything happens — and I am missing ${missing.length === 1 ? "one thing" : `${missing.length} things`} before I can file it:`,
            "",
            ...missing.map((key) => `- **${key}** — ${REDACTED_ARG_HINTS[key] ?? "required"}`),
            "",
            "Give me those and I will queue it. Nothing has changed.",
          ].join("\n"),
          refused: "Arguments missing, so nothing was filed.",
        });
      }

      const filed = await proposeAction({
        tool,
        args,
        rationale: `Requested in the admin console: ${input.trim().slice(0, 400)}${awareness ? `\n\nAwareness at the time: ${awareness.domains.map((d) => `${d.label} — ${d.headline}`).join("; ")}` : ""}`,
        requestedBy: opts.actorId ?? null,
        source: "admin-console",
      });

      return base({
        text: [
          filed.ok
            ? `**Filed for approval.** ${filed.proposal?.summary ?? spec.label}`
            : `I could not file that: ${filed.message}`,
          "",
          `Risk: **${spec.risk}**. ${filed.ok ? `Approve or reject it on Health → Approvals; it expires in ${24}h.` : ""}`,
          "",
          whatThisTouches(tool),
          "",
          ...(filed.ok ? [`Nothing has changed yet. ${describeImpact(tool)}`] : []),
        ].join("\n"),
        proposal: filed.proposal ?? null,
      });
    }

    /* A change request in a read-only domain, or one too vague to route. */
    return base({
      text: [
        domain.tools.length === 0
          ? `**${domain.label}** is read-only for me — I can see everything in it, and I am not allowed to change any of it. ${domain.purpose}`
          : `I did not pick out a specific change there. In **${domain.label.toLowerCase()}** I can request: ${domain.tools.map((t) => `\`${t}\``).join(", ")}.`,
        "",
        "Say which one you want and I will file it for approval rather than act on it.",
      ].join("\n"),
      refused: domain.tools.length === 0 ? `${domain.label} is read-only.` : "No operation matched the request.",
    });
  }

  /* ── A question: answer it, over everything we just read. ─────────────── */
  const grounded = await groundedAnswer(input, history, {
    readings,
    awareness,
    collab,
    issues,
    moves,
    pending,
    mode,
    domain,
  }).catch((error) => {
    log.warn("grounded admin answer failed", { error: error instanceof Error ? error.message : String(error) });
    return null;
  });

  return base({
    text:
      grounded ??
      briefAnswer({ readings, awareness, collab, issues, moves, pending, mode, domain }),
    degraded: grounded === null,
  });

  /* Everything below shares one assembled result, so a reply can never be
   * missing the evidence it was written from. */
  function base(extra: Partial<AdminTurnResult>): AdminTurnResult {
    return {
      text: extra.text ?? "",
      intent: classified.intent,
      domain,
      understanding,
      readings: readings
        ? { taken: readings.taken, missing: readings.missing, state: readings.state, items: readings.readings }
        : null,
      awareness,
      collaboration: collab,
      issues,
      moves,
      pending,
      degraded: extra.degraded ?? false,
      repairMode: mode,
      proposal: extra.proposal ?? null,
      refused: extra.refused ?? null,
    };
  }
}

/* ── The deterministic assistant ─────────────────────────────────────────── */

const OPERATOR_SYSTEM = [
  "You are the operations mind of ConnectPlus — the virtual admin assistant, talking to a platform administrator.",
  "",
  "What you are given is live: readings taken from the running platform, an awareness report per domain, the state of each engine in the combined mind, the tracked issues, and the operations you are permitted to request. Treat all of it as the ground truth. You never have to guess a number, and you must not invent one — if a reading is missing, say what could not be read and answer around it.",
  "",
  "How to answer:",
  "1. Lead with the answer in one sentence. No preamble, no restating the question.",
  "2. Support it with the specific numbers you were given. Attribute them (\"the queue is 34 items\", not \"there may be some backlog\").",
  "3. Say what it means — the consequence for the platform, not a restatement of the number.",
  "4. If something is degraded, unproven or unreadable, say so plainly. An unproven model is not a failing one.",
  "5. If there is something you could do about it, name the operation and say it needs approval. Never claim to have done anything.",
  "",
  "You have read access to the whole platform. You have *no* write access: every change you want is a request an admin approves. Never say you did something, only that you filed it or that you can file it.",
  "Write in plain markdown, at most a few short paragraphs or one tight list. Be direct and concrete; this is an operator's console, not a report.",
].join("\n");

/**
 * Ask the model, with the whole platform attached.
 *
 * `null` means no model answered — not "the model said nothing". An empty
 * completion falls through to the deterministic brief rather than rendering a
 * blank console.
 */
async function groundedAnswer(
  input: string,
  history: { role: string; content: string }[],
  ctx: {
    readings: BrainReadings | null;
    awareness: BrainAwareness | null;
    collab: MindCollaboration;
    issues: BrainIssue[];
    moves: CalibrationMove[];
    pending: ProposalDTO[];
    mode: RepairMode | null;
    domain: AdminDomain;
  }
): Promise<string | null> {
  const config = await getAiConfig().catch(() => null);
  if (!config || config.provider === "builtin" || !config.apiKey) return null;

  const recent = history
    .slice(-6)
    .filter((m) => m.content?.trim())
    .map((m) => `${m.role === "user" ? "Admin" : "Mind"}: ${m.content.slice(0, 1_200)}`)
    .join("\n\n");

  const user = [
    ctx.readings?.text ?? "No live readings could be taken — say so and answer from what follows.",
    ctx.awareness ? `\nAWARENESS (how well calibrated the mind is per domain):\n${formatAwarenessText(ctx.awareness)}` : "",
    `\nTHE COMBINED MIND (${ctx.collab.subsystems.length} subsystems, ${ctx.collab.degraded} not green):\n${ctx.collab.subsystems
      .map((s) => `${s.name} [${s.mind}/${s.state}]: ${s.evidence}`)
      .join("\n")}`,
    ctx.issues.length
      ? `\nTRACKED ISSUES (findings that persisted three runs):\n${ctx.issues
          .slice(0, 6)
          .map((i) => `• [${i.severity}] ${i.title} — ${i.detail} → ${i.fix} (${i.subsystem})`)
          .join("\n")}`
      : "\nTRACKED ISSUES: none open.",
    ctx.moves.length
      ? `\nWHAT I COULD OFFER TO DO:\n${ctx.moves.map((m) => `• ${m.title} — ${m.why}${m.tool ? ` [operation: ${m.tool}, needs approval]` : " [needs a person]"}`).join("\n")}`
      : "",
    ctx.pending.length
      ? `\nAWAITING APPROVAL RIGHT NOW (${ctx.pending.length}):\n${ctx.pending.map((p) => `• ${p.summary} (${p.risk} risk)`).join("\n")}`
      : "\nNothing is awaiting approval.",
    ctx.mode ? `\nSELF-HEAL ENVELOPE: ${ctx.mode}` : "",
    recent ? `\nCONVERSATION SO FAR:\n${recent}` : "",
    `\nTHE ADMIN IS ASKING ABOUT: ${ctx.domain.label}\nREQUEST: ${input}`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = await generateText({ system: OPERATOR_SYSTEM, user, maxTokens: 1_300 }).catch(() => null);
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The assistant with no provider configured.
 *
 * This is not a placeholder. A platform with no API key still needs an admin
 * assistant, and everything it needs to answer is already in hand: the readings
 * are taken, the awareness is computed, the operations are declared. So this
 * composes them into prose that names the numbers, the state and the options —
 * the same facts the model would have been given, written out by rule instead
 * of by generation.
 */
export function briefAnswer(ctx: {
  readings: BrainReadings | null;
  awareness: BrainAwareness | null;
  collab: MindCollaboration;
  issues: BrainIssue[];
  moves: CalibrationMove[];
  pending: ProposalDTO[];
  mode: RepairMode | null;
  domain: AdminDomain;
}): string {
  const out: string[] = [];
  const aware = ctx.awareness?.domains.find((d) => ctx.domain.awarenessIds.includes(d.id));

  /* 1. Lead with the answer. */
  if (aware) {
    out.push(`**${aware.headline}.** ${aware.notes[0] ?? ""}`.trim());
  } else {
    const mine = relevantReadings(ctx.readings, ctx.domain);
    out.push(
      mine.length
        ? `**${ctx.domain.label}**, as of right now: ${mine
            .slice(0, 3)
            .map((r) => `${r.label.toLowerCase()} — ${r.value}`)
            .join("; ")}.`
        : `I could not read a live figure for ${ctx.domain.label.toLowerCase()} just now.`
    );
  }

  /* 2. The numbers that belong to the domain. */
  const mine = relevantReadings(ctx.readings, ctx.domain);
  if (mine.length > 0) {
    out.push(mine.slice(0, 6).map((r) => `- **${r.label}** — ${r.value}`).join("\n"));
  }

  /* 3. What is not right, in this domain and across the mind. */
  const attention: string[] = [];
  for (const r of mine.filter((r) => r.state !== "ok")) {
    attention.push(`${r.label}: ${r.detail ?? r.value}`);
  }
  for (const issue of ctx.issues) {
    if (ctx.issues.length > 0 && attention.length < 4) {
      attention.push(`${issue.title} — ${issue.fix}`);
    }
  }
  if (ctx.collab.degraded > 0 && ctx.domain.id === "operations") {
    attention.push(
      `${ctx.collab.degraded} of ${ctx.collab.subsystems.length} engines in the combined mind are not reporting clean.`
    );
  }
  if (attention.length > 0) {
    out.push(["**What needs attention.**", ...dedupe(attention).slice(0, 4).map((a) => `- ${a}`)].join("\n"));
  } else {
    out.push("**Nothing in this area is reporting a problem.**");
  }

  /* 4. What the mind could do about it — always as a request. */
  const domainMoves = ctx.moves.filter((m) => m.domain === ctx.domain.id);
  const actionable = domainMoves.filter((m) => m.tool);
  if (actionable.length > 0 || ctx.domain.tools.length > 0) {
    out.push(
      [
        "**What I can do — with your approval.**",
        ...(actionable.length > 0
          ? actionable.map((m) => `- ${m.title} → \`${m.tool}\` (${m.urgency} urgency)`)
          : ctx.domain.tools.map((t) => `- \`${t}\` — ${APPROVAL_TOOLS[t].label} (${APPROVAL_TOOLS[t].risk} risk)`)),
        "None of that runs on its own. Approve it on Health → Approvals, or ask me to file it.",
      ].join("\n")
    );
  } else {
    out.push(
      `**This area is read-only for me.** ${ctx.domain.purpose} I can only show you what I see.`
    );
  }

  /* 5. The state of the mind itself, honestly. */
  const mindBits: string[] = [];
  if (ctx.mode) mindBits.push(`self-heal is **${ctx.mode}**`);
  if (ctx.pending.length > 0) mindBits.push(`**${ctx.pending.length}** request(s) waiting on you`);
  else mindBits.push("nothing is waiting on you");
  if (ctx.readings && ctx.readings.missing > 0) {
    mindBits.push(`**${ctx.readings.missing}** reading(s) could not be taken`);
  }
  out.push(`_Mind state: ${mindBits.join(", ")}._`);
  out.push(
    "_Answered from live platform readings by the deterministic mind — no writing model is configured. Connect one in Admin → AI for a reasoning answer._"
  );

  return out.join("\n\n");
}

/** The readings that belong to a domain, in the domain's own order. */
function relevantReadings(readings: BrainReadings | null, domain: AdminDomain): BrainReading[] {
  if (!readings) return [];
  const byId = new Map(readings.readings.map((r) => [r.id, r]));
  const ordered = domain.readingIds.map((id) => byId.get(id)).filter(Boolean) as BrainReading[];
  if (ordered.length > 0) return ordered;
  /* No declared ids matched: fall back to the reading's area name, so a probe
   * added later still shows up somewhere instead of vanishing from the console. */
  return readings.readings.filter((r) => r.area.toLowerCase().includes(domain.label.split(" ")[0]!.toLowerCase()));
}

function formatAwarenessText(aware: BrainAwareness): string {
  return aware.domains
    .map((d: AwarenessDomain) => `${d.label} [${d.state}]: ${d.headline}${d.notes.length ? ` — ${d.notes.join(" ")}` : ""}`)
    .join("\n");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** What an operation touches, for the approver's benefit. */
function whatThisTouches(tool: ApprovalTool): string {
  switch (tool) {
    case "run_hive_sweep":
      return "_Reads your stories and comments and writes lessons into the mind's memory. Adds no content, changes no story._";
    case "run_rss_poll":
      return "_Fetches the feeds that are due and imports new stories as drafts through the normal intake path._";
    case "refire_stale_jobs":
      return "_Re-runs jobs that have already missed their window, through the same runners their schedule would have used._";
    case "rewarm_snapshots":
      return "_Fetches your own public routes so the edge cache is warm. Read-only against your origin._";
    case "retry_view_fold":
      return "_Adds the view counts already pending into the database. Counts only ever go up._";
    case "run_sports_intelligence":
      return "_Teaches the prediction model from finished matches and writes fresh picks to the board._";
    case "run_brain_diagnosis":
      return "_Runs the self-test and files anything found. Changes no platform data._";
    case "set_repair_mode":
      return "_Changes whether the mind may repair things on its own. `enforce` lets it act unattended; `observe` only logs._";
    case "publish_post":
      return "_Publishes the story to the public site immediately._";
    case "schedule_post":
      return "_Queues the story to publish itself at the given time._";
    case "flag_comment":
      return "_Adds a row to the moderation ledger. The comment stays visible._";
    case "remove_comment":
      return "_Deletes the comment and its replies. Irreversible._";
    default:
      return "";
  }
}

function describeImpact(tool: ApprovalTool): string {
  const spec = APPROVAL_TOOLS[tool];
  return spec.risk === "high"
    ? "This one is hard to undo, so read the summary before you approve it."
    : "It is safe to run twice — the second run converges rather than repeating.";
}

/* ── The console's read-only dashboard, in one call ──────────────────────── */

export interface AdminOverview {
  generatedAt: string;
  readings: { taken: number; missing: number; state: string; items: BrainReading[] } | null;
  awareness: BrainAwareness | null;
  collaboration: MindCollaboration;
  issues: BrainIssue[];
  moves: CalibrationMove[];
  pending: ProposalDTO[];
  repairMode: RepairMode | null;
  domains: AdminDomain[];
  /** The same status the brain reports, for the console header. */
  brain: Awaited<ReturnType<typeof appBrain.status>> | null;
}

/**
 * Everything the console dashboard renders, in one round trip.
 *
 * Composed here rather than fetched piecemeal by the client so the page cannot
 * render a half-updated picture — a collaboration diagram from one moment and
 * an awareness report from another is a diagram that lies.
 */
export async function overview(): Promise<AdminOverview> {
  const [readings, awareness, issues, pending, mode, brain] = await Promise.all([
    gatherReadings().catch(() => null),
    gatherAwareness().catch(() => null),
    openIssues().catch(() => [] as BrainIssue[]),
    pendingProposals().catch(() => [] as ProposalDTO[]),
    repairMode().catch(() => null),
    appBrain.status().catch(() => null),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    readings: readings
      ? { taken: readings.taken, missing: readings.missing, state: readings.state, items: readings.readings }
      : null,
    awareness,
    collaboration: collaboration(readings, awareness),
    issues,
    moves: awareness ? calibrationMoves(awareness, issues) : [],
    pending,
    repairMode: mode,
    domains: [...ADMIN_DOMAINS],
    brain,
  };
}

/** The console's "what should I do first" list, urgency-ordered. */
export function priorityOrder(moves: CalibrationMove[]): CalibrationMove[] {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return [...moves].sort((a, b) => rank[a.urgency] - rank[b.urgency]);
}

/** Is this tool one the admin assistant may request at all? */
export function isAdminOperation(tool: string): tool is ApprovalTool {
  return isApprovalTool(tool) && Object.values(ADMIN_DOMAINS).some((d) => d.tools.includes(tool));
}

/** Read the platform's own record of what the mind has been told to lean. */
export async function recentDirectives(limit = 5) {
  const rows = await prisma.neuralMemory
    .findMany({ where: { source: "mind-directive" }, orderBy: { createdAt: "desc" }, take: limit })
    .catch(() => []);
  return rows.map((r) => ({ id: r.id, content: r.content, createdAt: r.createdAt.toISOString() }));
}
