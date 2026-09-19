import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { hiveBrain } from "@/lib/hive-brain";
import { neuralMind, type NeuralResponse } from "@/lib/neural-mind";
import { platformIntelligence } from "@/lib/platform-intelligence";
import { generateText, getAiConfig } from "@/lib/ai-provider";
import { activeCacheBackend, cacheBackendDetail } from "@/lib/redis";
import { getCronStatus } from "@/lib/cron-schedule";
import { getPipelineHealth } from "@/lib/pipeline-health";
import { checkFeedHealth } from "@/lib/feed-health";
import { convexAvailable, convexHealth, convexUrl } from "@/lib/convex";
import { runWritingChecks } from "@/lib/writing-checks";
import { polishText, generateHeadline, enhanceText } from "@/lib/neural-generate";
import { extractKeywords, summarizeText, stripHtml } from "@/lib/neural-text";
import { PERSISTENCE_THRESHOLD, syncIssues, type IssueSyncResult } from "@/lib/brain-issues";
import { runRepairs, type RepairRunResult } from "@/lib/brain-repair";
import { copilotSkillNotesFromStore } from "@/lib/copilot-skills";
import {
  applyPilotOps,
  defaultOpsFor,
  isPilotAction,
  parsePilotReply,
  pilotInstruction,
  PILOT_QUICK_ACTIONS,
  type PilotAction,
  type PilotOp,
  type PilotOpKind,
} from "@/lib/brain-pilot";

/**
 * The ConnectPlus Brain — one mind over three engines.
 *
 * The platform grew three intelligence layers, each built for its own job and
 * each answering only to itself:
 *
 *   • the **hive mind** (`hive-brain`) — what the platform has learned, stored
 *     as memories, reinforced and decayed over time;
 *   • the **neural mind** (`neural-mind`) — the reasoner: intent, analysis,
 *     research, conversation;
 *   • **platform intelligence** (`platform-intelligence`) — the senses: the
 *     business, the creators, the traffic, the region outside.
 *
 * That worked, and it also meant the seams showed. The studio's copilot read its
 * draft but not the hive's accumulated knowledge about the subject; a curation
 * request re-queried the database instead of asking the layer that already
 * caches the answer; and nothing in the build could say "these three engines are
 * *one* system, and here is its health". A mind that has to be asked the same
 * question in three dialects is three minds.
 *
 * This module is the single front door. It is a facade, deliberately: the
 * engines keep their own responsibilities and their own tests, and this composes
 * them. Two properties are load-bearing:
 *
 *   1. **Composition is additive.** `think()` is the neural mind's answer with
 *      the other two engines' context attached, not a replacement. Anything that
 *      worked before works identically.
 *   2. **Every probe degrades on its own.** `diagnose()` runs eight independent
 *      checks; one unreachable upstream must not cost the report the other
 *      seven, so each is caught and each reports its own failure as a finding.
 *
 * The brain is admin-scoped by construction: `diagnose()` and `report()` are
 * meant for SUPER_ADMIN surfaces, and `think()` accepts an `actorId` so every
 * mutating intent still lands on an audit row with a named human.
 */

/* ── The composition ──────────────────────────────────────────────────────── */

export type BrainMind = "hive" | "neural" | "platform";

export interface BrainSubsystem {
  id: string;
  /** Which mind it belongs to — the taxonomy the console renders. */
  mind: BrainMind;
  name: string;
  role: string;
  capabilities: string[];
}

/**
 * The whole mind, declared. This is the single place a capability is registered,
 * so the admin console, the diagnostics and the docs cannot disagree about what
 * the brain can do.
 */
export const BRAIN_SUBSYSTEMS: readonly BrainSubsystem[] = [
  {
    id: "hive-memory",
    mind: "hive",
    name: "Hive memory",
    role: "Long-term memory: every lesson the platform has stored, ranked by decayed confidence.",
    capabilities: ["recall", "ingest", "reinforce", "sweep", "train"],
  },
  {
    id: "hive-engagement",
    mind: "hive",
    name: "Hive engagement",
    role: "Reads what is actually being read, and recommends from it.",
    capabilities: ["computeEngagement", "recommend", "getVisitAnalytics"],
  },
  {
    id: "neural-reasoner",
    mind: "neural",
    name: "Neural reasoner",
    role: "Intent classification, content and user analysis, anomaly detection, conversation.",
    capabilities: ["processQuery", "classifyIntent", "detectAnomalies", "analyzeContent", "analyzeUsers"],
  },
  {
    id: "neural-research",
    mind: "neural",
    name: "Neural research",
    role: "Reads the open web and the RSS corpus, and answers from what it learned.",
    capabilities: ["learnFromUrl", "learnFromRssArticles", "researchTopic", "getExternalKnowledge"],
  },
  {
    id: "neural-authoring",
    mind: "neural",
    name: "Authoring engines",
    role: "Deterministic drafting, polishing, headlines, outlines, inline writing checks.",
    capabilities: ["composeDraft", "polishText", "generateHeadline", "buildOutline", "runWritingChecks"],
  },
  {
    id: "platform-senses",
    mind: "platform",
    name: "Platform senses",
    role: "Creators, traffic depth, the economy, and the region outside the app.",
    capabilities: ["getCreatorAnalytics", "getTrafficDepth", "getMonetization", "getExternalSignals"],
  },
  {
    id: "platform-actions",
    mind: "platform",
    name: "Platform actions",
    role: "The hands: scheduling, publishing, moderation, reply drafting, visual briefs.",
    capabilities: ["schedulePost", "publishPost", "flagComment", "draftReply", "generateVisualBrief"],
  },
] as const;

export function capabilitiesOf(): string[] {
  return [...new Set(BRAIN_SUBSYSTEMS.flatMap((s) => s.capabilities))].sort();
}

/* ── One question, one answer ─────────────────────────────────────────────── */

export interface BrainAnswer extends NeuralResponse {
  /** Which of the three minds contributed — the trace the console shows. */
  minds: BrainMind[];
  /** A packed one-line summary of what the senses currently know. */
  context: string;
}

class AppBrain {
  private readonly log = createLogger("app-brain");

  /**
   * Ask the mind anything, the way the console and the copilot ask it.
   *
   * The neural mind owns the routing (and therefore the answer). What this adds
   * is the *trace*: which of the three minds contributed, plus a compact brief
   * of the platform's live state, so an admin asking "how are we doing" gets an
   * answer grounded in the same numbers the dashboards show rather than in the
   * model's impression of them.
   */
  async think(
    input: string,
    history: { role: string; content: string }[] = [],
    opts: { actorId?: string; withContext?: boolean } = {}
  ): Promise<BrainAnswer> {
    const wantsContext = opts.withContext !== false;
    const [response, brief] = await Promise.all([
      neuralMind.processQuery(input, history, { actorId: opts.actorId }),
      wantsContext ? platformIntelligence.getLiveBrief().catch(() => null) : Promise.resolve(null),
    ]);

    const minds = new Set<BrainMind>();
    if (response.enginesUsed.includes("hive")) minds.add("hive");
    minds.add("neural");
    if (brief) minds.add("platform");

    return {
      ...response,
      minds: [...minds],
      context: brief ? formatBrief(brief) : "",
    };
  }

  /**
   * The writer's pilot.
   *
   * Reads the composer, asks the model for a *structured* edit, and returns ops
   * plus a one-line reply. The contract is deliberately narrow — the pilot
   * advises and proposes edits; the writer's editor applies them — because an
   * assistant that can write anywhere is one that eventually writes over the
   * wrong paragraph.
   *
   * It never comes back empty-handed. When the provider is unconfigured, over
   * budget or simply returns prose, the deterministic engines take over so the
   * action still produces something the writer can use.
   */
  async pilot(request: PilotRequest): Promise<PilotResult> {
    const action: PilotAction = isPilotAction(request.action) ? request.action : "improve";
    const content = (request.content ?? "").slice(0, MAX_PILOT_DRAFT);
    const selection = (request.selection ?? "").slice(0, MAX_PILOT_SELECTION);
    const hasSelection = selection.trim().length > 0;
    const focus = hasSelection ? selection : content;
    const instruction = pilotInstruction(action, request.instruction);

    const ops = await this.pilotOps(action, instruction, focus, request, hasSelection);
    return {
      action,
      reply: this.pilotReply(action, ops, request),
      ops,
      degraded: ops.length === 0 && action === "ask",
    };
  }

  /** Ask the model for ops; fall back to the deterministic engines. */
  private async pilotOps(
    action: PilotAction,
    instruction: string,
    focus: string,
    request: PilotRequest,
    hasSelection: boolean
  ): Promise<PilotOp[]> {
    const config = await getAiConfig().catch(() => null);
    if (config && config.provider !== "builtin" && config.apiKey && focus.trim().length > 0) {
      // What the writers of this publication have actually accepted, distilled
      // from their own keep/discard decisions. It is guidance, not a rulebook:
      // the notes are only emitted for actions with a real sample behind them,
      // so a brand-new deployment gets no notes at all rather than invented ones.
      const skillNotes = await copilotSkillNotesFromStore().catch(() => []);

      const user = [
        `Instruction: ${instruction}`,
        request.title ? `Headline: ${request.title}` : "",
        request.category ? `Category: ${request.category}` : "",
        request.tags?.length ? `Existing tags: ${request.tags.join(", ")}` : "",
        skillNotes.length
          ? `What this publication's writers usually accept:\n${skillNotes.map((n) => `- ${n}`).join("\n")}`
          : "",
        hasSelection ? `Passage:\n${focus}` : `Draft:\n${focus.slice(0, 12_000)}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const raw = await generateText({
        system: PILOT_SYSTEM_PROMPT,
        user,
        maxTokens: 900,
      }).catch(() => null);

      if (raw) {
        const parsed = parsePilotReply(raw, action);
        const ops = parsed.ops.length > 0 ? parsed.ops : defaultOpsFor(action, raw, hasSelection);
        if (ops.length > 0) return ops;
      }
    }
    return this.pilotFallback(action, focus, hasSelection);
  }

  /**
   * The provider-free half.
   *
   * `fix` and `improve` have honest deterministic answers already — the same
   * engines behind the inline writing checks — so the pilot degrades to a
   * *worse* assistant, never to a broken one. Headline/excerpt/tag actions
   * reuse the deterministic generators, which is also why their output is
   * stable across deployments.
   */
  private pilotFallback(action: PilotAction, focus: string, hasSelection: boolean): PilotOp[] {
    const trimmed = focus.trim();
    if (!trimmed) return [];

    if (action === "fix" || action === "improve") {
      const check = runWritingChecks(trimmed);
      const fixable = check.suggestions.filter((s) => s.replacement !== null);
      if (fixable.length > 0) {
        // Apply mechanically and return one surgical op per fix so the writer
        // can see (and undo) exactly what changed.
        return fixable.slice(0, 6).map((s) => ({
          kind: "fix" satisfies PilotOpKind,
          find: s.original,
          text: s.replacement ?? "",
        }));
      }
      if (action === "improve") {
        const polished = polishText(trimmed).rewritten;
        if (polished && polished !== trimmed) {
          return [hasSelection ? { kind: "replace-selection", text: polished } : { kind: "replace-draft", text: polished }];
        }
      }
      return [];
    }

    if (action === "headline") {
      const result = generateHeadline(trimmed.split(/\n/)[0]?.slice(0, 60) ?? "Untitled", trimmed);
      return [{ kind: "set-title", text: result.primary }];
    }
    if (action === "excerpt") {
      const summary = summarizeText(stripHtml(trimmed), 2).slice(0, 280);
      return summary ? [{ kind: "set-excerpt", text: summary }] : [];
    }
    if (action === "tags") {
      const tags = extractKeywords(trimmed, 6)
        .map((k) => k.keyword)
        .join(", ");
      return tags ? [{ kind: "add-tags", text: tags }] : [];
    }
    // shorten / expand / tone / ask genuinely need a model; saying so is more
    // useful than inventing a rewrite.
    return [];
  }

  private pilotReply(action: PilotAction, ops: PilotOp[], request: PilotRequest): string {
    if (ops.length > 0) {
      const label = PILOT_QUICK_ACTIONS.find((a) => a.id === action)?.label ?? action;
      return `${label}: ${describeOps(ops, request)}`;
    }
    if (action === "ask" && request.instruction?.trim()) {
      return "The writing model is not configured, so I can only offer the built-in checks right now. Open Admin → AI to connect one.";
    }
    if (!(request.content ?? "").trim() && !(request.selection ?? "").trim()) {
      return "Write a few sentences first and I'll have something to work with.";
    }
    return "Nothing worth changing in that passage — it already reads clean.";
  }

  /* ── Health of the mind ─────────────────────────────────────────────────── */

  /**
   * What the mind knows, right now. Cheap enough for a dashboard poll: it reads
   * the hive's own counters and the cache tier, and does not run the model.
   */
  async status(): Promise<BrainStatus> {
    const [hive, stats] = await Promise.all([
      hiveBrain.status().catch(() => null),
      neuralMind.getPlatformStats().catch(() => null),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      memories: hive?.total ?? 0,
      bySource: hive?.sourceBreakdown ?? {},
      byCategory: hive?.categoryBreakdown ?? {},
      recentMemories: (hive?.recentLearnings ?? []).slice(0, 6).map((m) => ({
        source: m.source,
        category: m.category,
        content: m.content.slice(0, 200),
        createdAt: new Date(m.learnedAt).toISOString(),
      })),
      counts: stats
        ? {
            users: stats.totalUsers,
            posts: stats.totalPosts,
            comments: stats.totalComments,
            views: stats.totalViews,
            pendingModeration: stats.pendingModeration,
          }
        : null,
      cacheBackend: activeCacheBackend(),
      cacheDetail: cacheBackendDetail(),
      subsystems: BRAIN_SUBSYSTEMS.map((s) => ({
        id: s.id,
        mind: s.mind,
        name: s.name,
        role: s.role,
        capabilities: s.capabilities,
      })),
      capabilities: capabilitiesOf(),
    };
  }

  /**
   * Turn the mind on itself.
   *
   * Eight independent probes, each reporting *what it measured* rather than a
   * boolean, because "the scheduler is unhealthy" is a ticket and "`feed-health`
   * last ran 14 hours ago against an expected 60 minutes" is a fix. A check that
   * cannot run is itself a finding — silence is the failure mode this whole
   * module exists to end.
   *
   * The self-test is the part that catches *code* faults rather than
   * infrastructure ones: it drives the deterministic engines over a fixed
   * fixture and asserts the outputs are still well-formed. A regex that starts
   * swallowing whole sentences, or a headline generator returning an empty
   * string, fails here — on a schedule, in the console — instead of surfacing as
   * a writer complaining that "the AI is being weird".
   */
  async diagnose(opts: { live?: boolean } = {}): Promise<BrainDiagnosis> {
    const findings: BrainDiagnostic[] = [];
    const healthy: string[] = [];

    /* 1. Database — everything else depends on it. */
    {
      const started = Date.now();
      try {
        await prisma.$queryRaw`SELECT 1`;
        healthy.push("database");
        this.log.info("diagnose: database ok", { ms: Date.now() - started });
      } catch (error) {
        findings.push({
          id: "database",
          area: "Data",
          severity: "critical",
          title: "The database is unreachable",
          detail: error instanceof Error ? error.message : String(error),
          fix: "Check DATABASE_URL / the pooler. Every other subsystem degrades with this one.",
        });
      }
    }

    /* 2. Cache tier — its absence is survivable but it is why renders are slow. */
    {
      const backend = activeCacheBackend();
      if (backend === "none") {
        findings.push({
          id: "cache-tier",
          area: "Performance",
          severity: "warn",
          title: "No cache tier is configured",
          detail: cacheBackendDetail(),
          fix: "Set KV_REST_API_URL + KV_REST_API_TOKEN (Upstash / Vercel KV) or REDIS_URL. Every render currently re-reads Postgres.",
        });
      } else {
        healthy.push("cache-tier");
      }
    }

    /* 3. Scheduler — a job that stopped running is invisible without this. */
    try {
      const jobs = await getCronStatus();
      const stale = jobs.filter((j) => j.stale);
      const failing = jobs.filter((j) => j.lastRun && !j.ok);
      if (stale.length > 0) {
        findings.push({
          id: "scheduler-stale",
          area: "Scheduler",
          severity: stale.some((j) => j.essential) ? "critical" : "warn",
          title: `${stale.length} scheduled job${stale.length === 1 ? "" : "s"} have not run on time`,
          detail: stale
            .slice(0, 8)
            .map((j) => `${j.id}: last ran ${j.ageMinutes === null ? "never" : `${j.ageMinutes}m ago`} (expected every ${j.everyMinutes}m)`)
            .join("; "),
          fix: "Check the Inngest dashboard and the Cloudflare edge cron, then run the safety net from Admin → Health.",
        });
      } else {
        healthy.push("scheduler");
      }
      if (failing.length > 0) {
        findings.push({
          id: "scheduler-failing",
          area: "Scheduler",
          severity: "warn",
          title: `${failing.length} job${failing.length === 1 ? "" : "s"} ran and reported failure`,
          detail: failing.map((j) => `${j.id} (${j.ageMinutes ?? "?"}m ago)`).join("; "),
          fix: "Read the job's own last error in Admin → Health before assuming the schedule is the problem.",
        });
      }
    } catch (error) {
      findings.push({
        id: "scheduler",
        area: "Scheduler",
        severity: "warn",
        title: "The scheduler could not be inspected",
        detail: error instanceof Error ? error.message : String(error),
        fix: "The heartbeat ledger is unreadable — check Redis and the database.",
      });
    }

    /* 4. Pipeline health — view-sync fold and RSS intake. */
    try {
      const pipeline = await getPipelineHealth();
      const bad = pipeline.checks.filter((c) => c.state === "critical" || c.state === "warn");
      if (bad.length > 0) {
        findings.push({
          id: "pipeline",
          area: "Pipelines",
          severity: bad.some((c) => c.state === "critical") ? "critical" : "warn",
          title: `${bad.length} pipeline${bad.length === 1 ? "" : "s"} degraded`,
          detail: bad.map((c) => `${c.label}: ${c.state} — ${c.detail}`).join("; "),
          fix: "Open Admin → Health for the per-pipeline evidence, then the pipeline's own console.",
        });
      } else {
        healthy.push("pipeline");
      }
    } catch (error) {
      findings.push({
        id: "pipeline",
        area: "Pipelines",
        severity: "warn",
        title: "Pipeline health could not be measured",
        detail: error instanceof Error ? error.message : String(error),
        fix: "This is usually the database — resolve that finding first.",
      });
    }

    /* 5. Convex offload — configured is not the same as working. */
    try {
      const configured = await convexAvailable();
      const health = convexHealth();
      if (!configured) {
        findings.push({
          id: "convex",
          area: "Offload",
          severity: "info",
          title: "Convex offload is not configured",
          detail: "Article views and ad metrics are stored in Postgres only.",
          fix: "Set NEXT_PUBLIC_CONVEX_URL to move the highest-volume writes off Supabase.",
        });
      } else if (health.state === "failing") {
        findings.push({
          id: "convex",
          area: "Offload",
          severity: "warn",
          title: "Convex is configured but failing",
          detail: `${await convexUrl()} — ${health.error ?? "unknown error"}`,
          fix: "Check the deployment is up and the functions are deployed (`npx convex deploy`).",
        });
      } else {
        healthy.push("convex");
      }
    } catch (error) {
      findings.push({
        id: "convex",
        area: "Offload",
        severity: "warn",
        title: "Convex state could not be read",
        detail: error instanceof Error ? error.message : String(error),
        fix: "Check the setting and the deployment URL.",
      });
    }

    /* 6. Hive — a memory that stopped accumulating is a mind that stopped learning. */
    try {
      const hive = await hiveBrain.status();
      const newest = hive.recentLearnings?.[0]?.learnedAt
        ? new Date(hive.recentLearnings[0].learnedAt).getTime()
        : null;
      const ageHours = newest ? Math.round((Date.now() - newest) / 3_600_000) : null;
      if (hive.total === 0) {
        findings.push({
          id: "hive",
          area: "Mind",
          severity: "warn",
          title: "The hive holds no memories",
          detail: "Nothing has been learned, so every answer is reasoning without context.",
          fix: "Run the hive sweep and the RSS learn job from Admin → Neural.",
        });
      } else if (ageHours !== null && ageHours > 72) {
        findings.push({
          id: "hive",
          area: "Mind",
          severity: "warn",
          title: "The hive has not learned anything recently",
          detail: `${hive.total} memories, newest is ${ageHours}h old.`,
          fix: "The hourly sweep or the RSS learn job has stopped writing — check the scheduler finding above.",
        });
      } else {
        healthy.push("hive");
      }
    } catch (error) {
      findings.push({
        id: "hive",
        area: "Mind",
        severity: "warn",
        title: "The hive could not be read",
        detail: error instanceof Error ? error.message : String(error),
        fix: "Usually the database. Confirm the NeuralMemory table exists and is migrated.",
      });
    }

    /* 7. Self-test — the pure engines, exercised for real. */
    {
      const selfTest = runBrainSelfTest();
      if (selfTest.ok) {
        healthy.push("self-test");
      } else {
        findings.push({
          id: "self-test",
          area: "Mind",
          severity: "critical",
          title: `The brain failed its own ${selfTest.failures.length}-part self-test`,
          detail: selfTest.failures.map((f) => `${f.name}: ${f.detail}`).join("; "),
          fix: "A deterministic engine changed behaviour. Run `npm test` — the rules are covered in tests/unit/writing-checks.test.ts and neural-generate.",
        });
      }
    }

    /* 8. Published feeds — the contract with machines nobody hears from. */
    if (opts.live) {
      try {
        const feeds = await checkFeedHealth({ sample: 3 });
        const bad = feeds.checks.filter((c) => c.state !== "ok");
        if (bad.length > 0) {
          findings.push({
            id: "feeds",
            area: "Syndication",
            severity: feedSeverity(feeds.overall),
            title: `${bad.length} of our own feed${bad.length === 1 ? "" : "s"} ${bad.length === 1 ? "is" : "are"} not healthy`,
            detail: bad.map((c) => `${c.label}: ${c.state} — ${c.detail}`).join("; "),
            fix: "Partners stop carrying stories silently. Fix before the next crawl.",
          });
        } else {
          healthy.push("feeds");
        }
      } catch (error) {
        findings.push({
          id: "feeds",
          area: "Syndication",
          severity: "info",
          title: "Our feeds could not be reached for checking",
          detail: error instanceof Error ? error.message : String(error),
          fix: "This is normal in a local or offline environment.",
        });
      }
    }

    const overall: BrainDiagnosis["overall"] = findings.some((f) => f.severity === "critical")
      ? "critical"
      : findings.some((f) => f.severity === "warn")
        ? "warn"
        : "ok";

    return {
      generatedAt: new Date().toISOString(),
      overall,
      checks: healthy.length + findings.filter((f) => f.severity !== "info").length,
      healthy,
      findings,
    };
  }

  /**
   * Store a diagnosis as a hive memory.
   *
   * Two jobs at once: the admin console can render the last report without
   * re-running the probes, and the *mind* now remembers what was wrong and when.
   * That is what lets a later question — "have we seen this before?" — be
   * answered from memory rather than from a dashboard nobody is looking at.
   * Promotion to a conversation is deliberately not automatic; a diagnosis is
   * evidence, not a lesson, until a human agrees with it.
   */
  async report(diagnosis: BrainDiagnosis, opts: { alert?: boolean } = {}): Promise<BrainReportResult> {
    // Read the previous runs *before* this one is stored, so the register can
    // ask "has this been true for a while?" rather than "is it true now?".
    const history = await this.recentDiagnoses(PERSISTENCE_WINDOW).catch(() => [] as BrainDiagnosis[]);

    let memoryId: string | null = null;
    try {
      const row = await prisma.neuralMemory.create({
        data: {
          source: DIAGNOSIS_SOURCE,
          category: DIAGNOSIS_CATEGORY,
          content: summarizeDiagnosis(diagnosis),
          tags: [...diagnosis.findings.map((f) => f.id), diagnosis.overall].join(","),
          confidence: diagnosis.overall === "ok" ? 0.9 : 0.6,
          metadata: JSON.stringify(diagnosis).slice(0, 20_000),
        },
        select: { id: true },
      });
      memoryId = row.id;
    } catch (error) {
      this.log.warn("diagnosis could not be stored", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const toAlert = opts.alert !== false ? diagnosis.findings.filter((f) => f.severity === "critical") : [];
    let alerted = 0;
    if (toAlert.length > 0) {
      alerted = await this.sendAlert(diagnosis, toAlert);
    }

    /*
     * File what has actually persisted, then act on it inside the envelope.
     *
     * Both are best-effort and independently caught: a register that cannot be
     * written must not lose the diagnosis, and a repair that throws must not
     * lose the issue.
     */
    let issues: IssueSyncResult = { opened: [], updated: [], resolved: [] };
    try {
      issues = await syncIssues(diagnosis, history);
    } catch (error) {
      this.log.warn("issue register could not be reconciled", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let repairs: RepairRunResult | null = null;
    try {
      repairs = await runRepairs(diagnosis);
    } catch (error) {
      this.log.warn("self-heal could not run", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    /*
     * A newly filed issue is the one event worth an email of its own. It means a
     * fault has now been true for three consecutive examinations — which is a
     * different claim from "something looked wrong tonight", and the claim the
     * register exists to make.
     */
    if (opts.alert !== false && issues.opened.length > 0) {
      alerted += await this.sendAlert(
        diagnosis,
        issues.opened.map((issue) => ({
          id: `issue:${issue.findingId}`,
          area: issue.area,
          severity: issue.severity,
          title: `Filed: ${issue.title}`,
          detail: `Seen in ${issue.occurrences} consecutive diagnoses. Suspect ${issue.subsystem}. ${issue.detail}`,
          fix: issue.externalUrl ? `${issue.fix} — tracked at ${issue.externalUrl}` : issue.fix,
        }))
      );
    }

    return { diagnosis, memoryId, alerted, issues, repairs };
  }

  /** The previous diagnoses, newest first — the register's memory of the past. */
  private async recentDiagnoses(limit: number): Promise<BrainDiagnosis[]> {
    const rows = await prisma.neuralMemory.findMany({
      where: { source: DIAGNOSIS_SOURCE },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { metadata: true },
    });
    const out: BrainDiagnosis[] = [];
    for (const row of rows) {
      if (!row.metadata) continue;
      try {
        const parsed = JSON.parse(row.metadata) as BrainDiagnosis;
        if (Array.isArray(parsed?.findings)) out.push(parsed);
      } catch {
        // A malformed record is skipped rather than aborting the reconciliation:
        // one bad row must not stop the register working from the rest.
      }
    }
    return out;
  }

  /** Email + webhook, using the same routing the status watchdog uses. */
  private async sendAlert(diagnosis: BrainDiagnosis, findings: BrainDiagnostic[]): Promise<number> {
    try {
      const { alertRecipients, alertWebhookUrl } = await import("@/lib/status-alerts");
      const { redisGetRaw, redisSetEx } = await import("@/lib/redis");

      // Dedupe per finding id, so an hourly diagnosis of the same broken thing
      // does not become an hourly email.
      const sendable: BrainDiagnostic[] = [];
      for (const f of findings) {
        const key = `brain:alert:${f.id}`;
        const last = await redisGetRaw(key).catch(() => null);
        if (last) continue;
        await redisSetEx(key, 6 * 60 * 60, new Date().toISOString());
        sendable.push(f);
      }
      if (sendable.length === 0) return 0;

      const subject = `[connectPlus] brain diagnosis: ${sendable.length} critical issue${sendable.length === 1 ? "" : "s"}`;
      const lines = sendable.map((f) => `• ${f.title}\n  ${f.detail}\n  Fix: ${f.fix}`);
      const body = `connectPlus brain diagnosis (${diagnosis.generatedAt})\n\n${lines.join("\n\n")}\n\n— the ConnectPlus Brain`;

      const recipients = await alertRecipients();
      if (recipients.length > 0) {
        const { sendEmail } = await import("@/lib/mailer");
        await Promise.allSettled(recipients.map((to) => sendEmail({ to, subject, text: body })));
      }

      const webhook = await alertWebhookUrl();
      if (webhook) {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${subject}\n${lines.join("\n")}`,
            content: `${subject}\n${lines.join("\n")}`,
            findings: sendable.map((f) => ({ id: f.id, area: f.area, severity: f.severity, title: f.title })),
          }),
          signal: AbortSignal.timeout(8000),
        }).catch(() => {});
      }
      return sendable.length;
    } catch (error) {
      this.log.warn("brain alert could not be sent", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /** The last stored diagnosis, or null when the brain has never looked at itself. */
  async lastDiagnosis(): Promise<BrainDiagnosis | null> {
    try {
      const row = await prisma.neuralMemory.findFirst({
        where: { source: DIAGNOSIS_SOURCE },
        orderBy: { createdAt: "desc" },
        select: { metadata: true, createdAt: true },
      });
      if (!row?.metadata) return null;
      return JSON.parse(row.metadata) as BrainDiagnosis;
    } catch {
      return null;
    }
  }
}

/* ── Self-test ────────────────────────────────────────────────────────────── */

export interface SelfTestFailure {
  name: string;
  detail: string;
}

/**
 * Exercise the deterministic engines and assert the *shape* of what comes back.
 *
 * This is a bug detector, not a unit test: it runs in production, on a schedule,
 * against the code that is actually deployed. It does not try to assert exact
 * strings — that is the test suite's job, and pinning them here would make every
 * good copy edit look like an outage. It asserts the properties an editor
 * depends on: that text comes back, that it is not obviously mangled, and that
 * the checkers still produce sane scores.
 */
export function runBrainSelfTest(): { ok: boolean; failures: SelfTestFailure[] } {
  const failures: SelfTestFailure[] = [];
  const FIXTURE =
    "The the quick brown fox jumped over the lazy dog . This is a very really important point that is also quite unqiue and it matters a great deal to the readers of this publication.";

  const push = (name: string, detail: string) => failures.push({ name, detail });

  // 1. The inline checker still finds the faults that are in the fixture.
  const check = runWritingChecks(FIXTURE);
  if (check.suggestions.length === 0) {
    push("writing-checks", "found no issues in a fixture that contains several");
  }
  if (!Number.isFinite(check.score) || check.score < 0 || check.score > 100) {
    push("writing-checks-score", `score out of range: ${check.score}`);
  }
  for (const s of check.suggestions) {
    if (s.start < 0 || s.end > FIXTURE.length || s.start >= s.end) {
      push("writing-checks-range", `suggestion ${s.rule} addresses ${s.start}-${s.end} of ${FIXTURE.length}`);
      break;
    }
  }

  // 2. The polisher still returns prose, and does not silently swallow the text.
  const polished = polishText(FIXTURE);
  if (!polished.rewritten.trim()) push("polish", "returned an empty draft");
  else if (polished.rewritten.length < FIXTURE.length * 0.5) {
    push("polish", `returned ${polished.rewritten.length} chars from ${FIXTURE.length} — the text was lost`);
  }

  // 3. Headline generation still produces a headline.
  const headline = generateHeadline("A test headline", FIXTURE);
  if (!headline.primary.trim()) push("headline", "returned an empty headline");

  // 4. The readability pass still measures the text.
  const analysis = enhanceText(FIXTURE);
  const words = analysis.readability.words;
  if (!Number.isFinite(words) || words <= 0) push("analysis", `word count came back as ${words}`);
  if (analysis.readability.sentences <= 0) push("analysis-sentences", "found no sentences in a two-sentence fixture");

  return { ok: failures.length === 0, failures };
}

/* ── Types ────────────────────────────────────────────────────────────────── */

export const DIAGNOSIS_SOURCE = "brain-diagnosis";
export const DIAGNOSIS_CATEGORY = "system";

export interface BrainStatus {
  generatedAt: string;
  memories: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
  recentMemories: { source: string; category: string; content: string; createdAt: string }[];
  counts: { users: number; posts: number; comments: number; views: number; pendingModeration: number } | null;
  cacheBackend: string;
  cacheDetail: string;
  subsystems: { id: string; mind: BrainMind; name: string; role: string; capabilities: string[] }[];
  capabilities: string[];
}

export interface BrainDiagnostic {
  id: string;
  area: string;
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  fix: string;
}

export interface BrainDiagnosis {
  generatedAt: string;
  overall: "ok" | "warn" | "critical";
  checks: number;
  healthy: string[];
  findings: BrainDiagnostic[];
}

export interface BrainReportResult {
  diagnosis: BrainDiagnosis;
  memoryId: string | null;
  alerted: number;
  /** What the persistent-finding register changed this run. */
  issues: IssueSyncResult;
  /** What the self-heal envelope considered, and what it was allowed to do. */
  repairs: RepairRunResult | null;
}

/**
 * How far back the register looks for the same finding.
 *
 * One short of the persistence threshold: with `PERSISTENCE_THRESHOLD` at 3, two
 * previous runs are enough to establish that a finding has been true three times
 * running, and reading further back would only cost queries.
 */
const PERSISTENCE_WINDOW = PERSISTENCE_THRESHOLD - 1;

export interface PilotRequest {
  action: string;
  /** The composer, as the writer left it. */
  content?: string;
  title?: string;
  excerpt?: string;
  tags?: string[];
  category?: string;
  /** The selection, when there is one. */
  selection?: string;
  /** Free-text instruction for `ask`. */
  instruction?: string;
}

export interface PilotResult {
  action: PilotAction;
  reply: string;
  ops: PilotOp[];
  degraded: boolean;
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const MAX_PILOT_DRAFT = 40_000;
const MAX_PILOT_SELECTION = 8_000;

/**
 * The pilot's contract with the model.
 *
 * JSON-only, and the enumerated `kind` values are the whole point: a model free
 * to choose its own response shape is a model whose output the client has to
 * guess at, and guessing at instructions that edit someone's article is how an
 * assistant becomes a liability.
 */
export const PILOT_SYSTEM_PROMPT = [
  "You are the ConnectPlus Brain Pilot, a precise writing assistant inside a publish-or-not editor.",
  "You edit text; you never explain at length and you never invent facts, statistics, quotes or sources.",
  "Preserve every fact, name, number and link you are given unless the instruction says otherwise.",
  "",
  "Reply with ONE JSON object and nothing else:",
  '{"reply":"<one short sentence, max 15 words, for the writer>","ops":[{"kind":"replace-selection","text":"..."}]}',
  "",
  "Allowed op kinds:",
  '  replace-selection — replace the passage the writer selected.',
  '  replace-draft — replace the entire draft. Use only when the instruction is about the whole piece.',
  '  insert-at-cursor — insert text at the caret.',
  '  append — add text to the end of the draft.',
  '  set-title — set the headline. `text` is the headline.',
  '  set-excerpt — set the summary. `text` is the summary (max 280 chars).',
  '  add-tags — `text` is a comma-separated list of lowercase tags.',
  '  fix — surgical correction: `find` is the exact substring to replace, `text` is the replacement.',
  "",
  "Rules:",
  "- Return at most 3 ops. Prefer one.",
  "- When the writer selected a passage, a rewrite is a single replace-selection op containing the full rewritten passage.",
  "- For grammar or spelling work, prefer several `fix` ops over one replace-selection: they are reversible individually.",
  "- If nothing should change, reply with an empty ops array and explain why in `reply`.",
].join("\n");

/** A short human description of what a set of ops will do. */
function describeOps(ops: PilotOp[], request: PilotRequest): string {
  const labels: Record<PilotOpKind, string> = {
    "replace-selection": "rewriting the selection",
    "insert-at-cursor": "inserting at the cursor",
    "replace-draft": "rewriting the draft",
    append: "adding a closing passage",
    "set-title": "proposing a headline",
    "set-excerpt": "writing the excerpt",
    "add-tags": "tagging the piece",
    fix: `applying ${ops.filter((o) => o.kind === "fix").length} correction${ops.filter((o) => o.kind === "fix").length === 1 ? "" : "s"}`,
  };
  const kinds = [...new Set(ops.map((o) => labels[o.kind]))];
  if (request.title && ops.some((o) => o.kind === "set-title")) return kinds.join(" · ");
  return kinds.join(" · ");
}

function feedSeverity(state: "ok" | "warn" | "critical"): BrainDiagnostic["severity"] {
  return state === "critical" ? "critical" : "warn";
}

/** One paragraph the hive can hold and a human can read. */
function summarizeDiagnosis(diagnosis: BrainDiagnosis): string {
  if (diagnosis.findings.length === 0) {
    return `Brain self-diagnosis: all ${diagnosis.healthy.length} checks healthy (${diagnosis.generatedAt}).`;
  }
  const lines = diagnosis.findings.map((f) => `[${f.severity}] ${f.title} — ${f.detail}`);
  return `Brain self-diagnosis (${diagnosis.overall}) at ${diagnosis.generatedAt}: ${lines.join(" | ")}`.slice(0, 4_000);
}

/** Pack the live brief into one line the model can consume cheaply. */
function formatBrief(brief: Awaited<ReturnType<typeof platformIntelligence.getLiveBrief>>): string {
  const parts: string[] = [];
  if (brief.creators) parts.push(`${brief.creators.total} creators (${brief.creators.active} active)`);
  if (brief.traffic) parts.push(`${brief.traffic.views} views, ${brief.traffic.uniqueVisitors} uniques, ${brief.traffic.bounceRate}% bounce`);
  if (brief.economy) parts.push(`MRR ${brief.economy.mrr}`);
  if (brief.trends?.length) parts.push(`trending: ${brief.trends.slice(0, 3).map((t) => t.topic).join(", ")}`);
  return parts.join(" · ");
}

/** Exported for the API route: apply ops on the server when a caller needs to. */
export { applyPilotOps };

export const appBrain = new AppBrain();
