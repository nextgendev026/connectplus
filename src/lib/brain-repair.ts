import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import type { BrainDiagnosis } from "@/lib/app-brain";

/**
 * Self-healing, inside an envelope.
 *
 * The brain can already *detect* a stalled schedule, a cold edge snapshot and a
 * failed offload. This module is the step where it does something about them —
 * and the design is mostly about what it is *not* allowed to do.
 *
 * A system that repairs itself is a system that can break itself with no human
 * in the loop, so three rules are load-bearing:
 *
 *  1. **A repair is bound to a finding.** Nothing here runs on a schedule of its
 *     own; each repair names the diagnosis finding that authorises it. A clean
 *     report authorises nothing.
 *  2. **Every repair is idempotent and bounded.** Re-firing a job that has not
 *     run, re-warming a cache copy, folding deltas that are still pending — each
 *     is safe to run twice and cannot loop, because the work is capped and the
 *     entry point is a job the scheduler was already going to run.
 *  3. **`observe` is the default.** The mode reads off/watch/fix from a setting.
 *     `observe` records exactly what it *would* have done, which is how an
 *     operator can see the envelope before granting it — and it means deploying
 *     this code cannot surprise anyone by mutating production.
 *
 * Confirmation is deliberately deferred to the *next* diagnosis rather than
 * asserted here. A repair that reports its own success is a repair nobody checks;
 * the issue register closes the loop a night later, from fresh evidence.
 */

const log = createLogger("brain-repair");

export type RepairMode = "off" | "observe" | "enforce";

export const REPAIR_SOURCE = "brain-repair";
export const REPAIR_CATEGORY = "repair";

/**
 * The ceiling on work per run.
 *
 * Small on purpose. A diagnosis finding several faults at once is a bad night,
 * and the correct response to a bad night is a report a human reads — not the
 * brain firing every lever it has at three in the morning.
 */
export const MAX_REPAIRS_PER_RUN = 3;

export interface RepairResult {
  repairId: string;
  findingId: string;
  title: string;
  /** What happened, or what would have happened in `observe` mode. */
  outcome: "applied" | "observed" | "skipped" | "failed";
  detail: string;
}

export interface RepairOutcome extends RepairResult {
  at: string;
}

interface Repair {
  id: string;
  findingId: string;
  title: string;
  /** Why this is safe to run unattended — printed in the log and the console. */
  why: string;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

/**
 * Read the envelope's mode.
 *
 * Anything unrecognised reads as `observe`. That direction matters: a typo in
 * the setting must not be the difference between watching and mutating.
 */
export async function repairMode(): Promise<RepairMode> {
  try {
    const settings = await getSettings(false);
    const raw = (settings.brainSelfHeal ?? "observe").trim().toLowerCase();
    return raw === "enforce" || raw === "off" ? raw : "observe";
  } catch {
    return "observe";
  }
}

/* ── The repair catalog ───────────────────────────────────────────────────── */

/**
 * Every repair, with the finding that authorises it.
 *
 * The `why` string is not decoration. It is the review artefact: when someone
 * asks "what is the brain allowed to do on its own", this list is the answer,
 * and each entry has to justify itself in a sentence.
 */
export function repairCatalog(): Repair[] {
  return [
    {
      id: "refire-stale-jobs",
      findingId: "scheduler-stale",
      title: "Re-fire the jobs that have missed their window",
      why:
        "Runs an existing job's own runner, which is the same code path its schedule would have taken and is idempotent — a second run of publishing, sweeping or folding converges. The scheduler's own safety net already does exactly this; the repair just stops waiting for it.",
      run: async () => {
        const { getCronStatus } = await import("@/lib/cron-schedule");
        const jobs = await getCronStatus();
        const stale = jobs.filter((job) => job.stale).slice(0, 2);
        if (stale.length === 0) return { ok: true, detail: "Nothing is stale any more — the window closed on its own." };

        const results: string[] = [];
        for (const job of stale) {
          try {
            await job.run();
            results.push(`${job.id}: ran`);
          } catch (error) {
            results.push(`${job.id}: failed (${error instanceof Error ? error.message : String(error)})`);
          }
        }
        return { ok: !results.some((r) => r.includes("failed")), detail: results.join("; ") };
      },
    },
    {
      id: "rewarm-edge-snapshots",
      findingId: "scheduler-stale",
      title: "Re-warm the edge snapshots",
      why:
        "A plain GET of the public route, so the worker's cache-first check finds a fresh copy and its next tick is a no-op instead of a rebuild. Read-only against our own origin; the worst case is one extra render.",
      run: async () => {
        const edge = await edgeBase();
        if (!edge) return { ok: false, detail: "No edge URL configured — nothing to warm." };
        const targets = ["/__livescore?sport=football", "/api/status"];
        const results: string[] = [];
        for (const path of targets) {
          try {
            const res = await fetch(`${edge}${path}`, { signal: AbortSignal.timeout(8_000) });
            results.push(`${path}: ${res.status}`);
          } catch (error) {
            results.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return { ok: true, detail: results.join("; ") };
      },
    },
    {
      id: "retry-view-fold",
      findingId: "pipeline",
      title: "Retry the view fold",
      why:
        "Folds the Convex deltas that are already pending into Postgres. It is the same operation the nightly sync runs, it is monotonic (counts only ever add), and the post ids it marks are only marked after the write succeeds.",
      run: async () => {
        const { foldConvexViews } = await import("@/lib/view-sync");
        const result = await foldConvexViews();
        if (result.unreachable) {
          // Not a failure of the repair: the offload is down, so there is
          // nothing to fold and the finding belongs to the Convex probe instead.
          return { ok: true, detail: "Convex is unreachable, so the deltas could not be read." };
        }
        const tail = [
          result.drained ? "backlog clear" : "backlog remains",
          result.orphaned > 0 ? `${result.orphaned} orphaned delta(s) dropped` : "",
        ].filter(Boolean);
        return {
          ok: true,
          detail: `folded ${result.views} views across ${result.posts} posts (${result.waiting} were waiting) — ${tail.join(", ")}`,
        };
      },
    },
  ];
}

/** The edge worker's base URL, whichever way the deployment supplies it. */
async function edgeBase(): Promise<string | null> {
  const env = (process.env.NEXT_PUBLIC_EDGE_URL ?? process.env.EDGE_URL ?? "").trim().replace(/\/+$/, "");
  if (env) return env;
  try {
    const settings = await getSettings(false);
    const configured = (settings.edgeUrl ?? "").trim().replace(/\/+$/, "");
    return configured || null;
  } catch {
    return null;
  }
}

/* ── Running them ─────────────────────────────────────────────────────────── */

export interface RepairRunResult {
  mode: RepairMode;
  repairs: RepairOutcome[];
  memoryId: string | null;
}

/**
 * Act on a diagnosis, within the envelope.
 *
 * Returns what it did whether or not it was allowed to do it: in `observe` mode
 * every entry is marked `observed` and the draft repair is *not* run, so an
 * operator sees the exact list — and can see that the envelope is doing its job.
 */
export async function runRepairs(diagnosis: BrainDiagnosis): Promise<RepairRunResult> {
  const mode = await repairMode();
  const findings = new Set(diagnosis.findings.map((f) => f.id));

  if (mode === "off") {
    return { mode, repairs: [], memoryId: null };
  }

  const authorised = repairCatalog().filter((repair) => findings.has(repair.findingId));
  const selected = authorised.slice(0, MAX_REPAIRS_PER_RUN);
  const skipped = authorised.slice(MAX_REPAIRS_PER_RUN);
  const at = new Date().toISOString();
  const outcomes: RepairOutcome[] = [];

  for (const repair of selected) {
    if (mode === "observe") {
      outcomes.push({
        repairId: repair.id,
        findingId: repair.findingId,
        title: repair.title,
        outcome: "observed",
        detail: `Would run: ${repair.why}`,
        at,
      });
      continue;
    }
    try {
      const result = await repair.run();
      outcomes.push({
        repairId: repair.id,
        findingId: repair.findingId,
        title: repair.title,
        outcome: result.ok ? "applied" : "failed",
        detail: result.detail,
        at,
      });
    } catch (error) {
      outcomes.push({
        repairId: repair.id,
        findingId: repair.findingId,
        title: repair.title,
        outcome: "failed",
        detail: error instanceof Error ? error.message : String(error),
        at,
      });
    }
  }

  for (const repair of skipped) {
    outcomes.push({
      repairId: repair.id,
      findingId: repair.findingId,
      title: repair.title,
      outcome: "skipped",
      detail: `Over the ${MAX_REPAIRS_PER_RUN}-repair ceiling for one run — it will be considered again tomorrow.`,
      at,
    });
  }

  if (outcomes.length > 0) {
    log.info("self-heal run", { mode, outcomes: outcomes.map((o) => `${o.repairId}:${o.outcome}`) });
  }

  const memoryId = await record(outcomes, diagnosis, mode);
  return { mode, repairs: outcomes, memoryId };
}

/** Keep the log in the hive, so the console and the mind read the same record. */
async function record(
  outcomes: RepairOutcome[],
  diagnosis: BrainDiagnosis,
  mode: RepairMode
): Promise<string | null> {
  if (outcomes.length === 0) return null;
  try {
    const applied = outcomes.filter((o) => o.outcome === "applied").length;
    const row = await prisma.neuralMemory.create({
      data: {
        source: REPAIR_SOURCE,
        category: REPAIR_CATEGORY,
        content: `Self-heal (${mode}): ${outcomes.length} considered, ${applied} applied — ${outcomes
          .map((o) => `${o.repairId}:${o.outcome}`)
          .join(", ")}`,
        tags: ["repair", mode, ...outcomes.map((o) => o.outcome)].join(","),
        confidence: applied > 0 ? 0.8 : 0.5,
        metadata: JSON.stringify({ mode, diagnosisAt: diagnosis.generatedAt, outcomes }).slice(0, 20_000),
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    log.warn("self-heal log could not be stored", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** The last self-heal run, for the console. */
export async function lastRepairRun(): Promise<RepairRunResult | null> {
  try {
    const row = await prisma.neuralMemory.findFirst({
      where: { source: REPAIR_SOURCE },
      orderBy: { createdAt: "desc" },
      select: { id: true, metadata: true },
    });
    if (!row?.metadata) return null;
    const parsed = JSON.parse(row.metadata) as { mode: RepairMode; outcomes: RepairOutcome[] };
    return { mode: parsed.mode, repairs: parsed.outcomes ?? [], memoryId: row.id };
  } catch {
    return null;
  }
}
