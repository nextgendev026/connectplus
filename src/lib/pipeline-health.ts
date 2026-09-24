import { prisma } from "./prisma";
import { createLogger } from "./logger";
import { CRON_JOBS, getSchedulerStatus } from "./cron-schedule";
import {
  heartbeatAgeMinutes,
  heartbeatLedger,
  readHeartbeat,
  type HeartbeatLedger,
  type JobHeartbeat,
} from "./job-heartbeat";
import { VIEW_SYNC_HEARTBEAT } from "./view-sync";
import { convexAvailable, convexHealth, convexPendingSummary, convexUrlSource } from "./convex";

const log = createLogger("pipeline-health");

/**
 * Pipeline health.
 *
 * Every failure this platform has actually suffered was a SILENT one: view
 * totals that stopped folding, a cron that stopped firing, a feed poll that
 * returned "0 new articles" while the upstream was 403ing. Each was invisible
 * until someone noticed a number was wrong — because nothing anywhere answered
 * the only question that matters: *when did this pipeline last do its job?*
 *
 * The Integrations console answers "is this configured and reachable". That is
 * not the same measurement. A queue can be configured, reachable, and have
 * delivered nothing for four days.
 *
 * So this module measures AGE OF EVIDENCE, per pipeline:
 *
 *   • view-sync — how many view deltas are waiting in Convex, and when they were
 *     last folded into Postgres.
 *   • rss-intake — when a feed last completed a poll successfully, and when that
 *     poll last produced an article.
 *   • scheduler — the age of each cron job's heartbeat, which is the only
 *     evidence that a schedule is actually being delivered.
 *
 * Two rules keep it honest:
 *
 *   1. **Blindness is reported as blindness.** "No backlog" and "could not read
 *      the backlog" are different facts, and a dashboard that renders both as
 *      zero is worse than no dashboard. Absent evidence yields `unknown`, never
 *      `ok`.
 *   2. **A backlog is not a fault.** Views accumulate in Convex all day by
 *      design; the fault is the fold being *late*. So the age of the fold — not
 *      the size of the queue — decides severity.
 *
 * The classification is pure and lives below the gathering, so the thresholds
 * are unit-tested without a database, a Redis, or a Convex deployment.
 */

export type PipelineState = "ok" | "warn" | "critical" | "unknown";

export interface PipelineEvidence {
  label: string;
  value: string;
  state?: PipelineState;
}

export interface PipelineCheck {
  id: "view-sync" | "rss-intake" | "scheduler";
  label: string;
  state: PipelineState;
  /** One line an operator can act on. */
  headline: string;
  /** The supporting sentence: counts, cadence, error text. */
  detail: string;
  /** When this pipeline last demonstrably succeeded. */
  lastSuccessAt: string | null;
  ageMinutes: number | null;
  expectedMinutes: number | null;
  evidence: PipelineEvidence[];
}

/* ── Severity ──────────────────────────────────────────────────────────── */

const SEVERITY: Record<PipelineState, number> = { ok: 0, unknown: 1, warn: 2, critical: 3 };

/** How far past its own slot a pass may drift before it counts as late. */
const LATE_FACTOR = 1.25;
/** …and before the schedule is treated as dead. */
const STALE_FACTOR = 2;

/**
 * Worst state wins. `unknown` outranks `ok` on purpose — a blind check is not a
 * passing check, and this is the whole reason the platform's silent failures
 * went unnoticed.
 */
export function worseState(a: PipelineState, b: PipelineState): PipelineState {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export function overallPipelineState(checks: readonly PipelineCheck[]): PipelineState {
  if (checks.length === 0) return "unknown";
  return checks.reduce<PipelineState>((acc, check) => worseState(acc, check.state), "ok");
}

/* ── Formatting helpers ────────────────────────────────────────────────── */

/** `14h` / `3d 4h` / `42m` — the console reads ages, not timestamps. */
export function humanAge(minutes: number | null): string {
  if (minutes === null) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

/**
 * A cadence reads in hours, not in the unit an age reads in: saying the fold
 * "runs every 1d" is technically true and useless, because the question an
 * operator is asking is "how many hours late is this?".
 */
export function cadenceLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 2880) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/* ── View sync ─────────────────────────────────────────────────────────── */

export interface ViewSyncSignals {
  /** False when no Convex deployment is configured at all. */
  configured: boolean;
  /** Reachability of the offload, as last observed by the caller. */
  reachable: "unknown" | "ok" | "failing";
  error: string | null;
  /** Deltas waiting in Convex. `null` = the query itself could not answer. */
  pending: { posts: number; views: number; capped: boolean } | null;
  lastFold: JobHeartbeat | null;
  /** Expected spacing of the nightly fold, from the job registry. */
  expectedMinutes: number;
}

export function classifyViewSync(input: ViewSyncSignals): PipelineCheck {
  const base = {
    id: "view-sync" as const,
    label: "View sync",
    expectedMinutes: input.expectedMinutes,
  };

  if (!input.configured) {
    return {
      ...base,
      state: "ok",
      headline: "Offload disabled",
      detail:
        "No Convex deployment is configured, so every view is written straight to Postgres. There is no backlog to fold.",
      lastSuccessAt: null,
      ageMinutes: null,
      evidence: [{ label: "Backend", value: "Postgres only" }],
    };
  }

  if (input.reachable === "failing") {
    return {
      ...base,
      state: "critical",
      headline: "Convex unreachable",
      detail: `${input.error ?? "The last Convex call failed."} Views recorded while the offload is down fall back to Postgres, but the backlog cannot be measured until it answers.`,
      lastSuccessAt: input.lastFold?.ok ? input.lastFold.at : null,
      ageMinutes: heartbeatAgeMinutes(input.lastFold),
      evidence: [
        { label: "Last error", value: input.error ?? "unknown", state: "critical" },
        { label: "Last fold", value: heartbeatAgeMinutes(input.lastFold) === null ? "never" : humanAge(heartbeatAgeMinutes(input.lastFold)) },
      ],
    };
  }

  const age = heartbeatAgeMinutes(input.lastFold);
  const foldFailed = input.lastFold !== null && !input.lastFold.ok;

  if (input.pending === null) {
    return {
      ...base,
      state: "unknown",
      headline: "Backlog could not be measured",
      detail: "Convex answered the health probe but not the pending-delta query, so the view backlog is unknown.",
      lastSuccessAt: foldFailed ? null : (input.lastFold?.at ?? null),
      ageMinutes: age,
      evidence: [{ label: "Last fold", value: humanAge(age) }],
    };
  }

  const { posts, views, capped } = input.pending;
  // A fold that is merely *between* passes is healthy — that is the normal state
  // for 23 of every 24 hours. These thresholds therefore describe how far past
  // its slot the most recent pass is: a quarter-cycle over means a pass did not
  // happen, a full cycle over means the schedule is dead.
  const staleAt = input.expectedMinutes * STALE_FACTOR;
  const lateAt = input.expectedMinutes * LATE_FACTOR;

  const evidence: PipelineEvidence[] = [
    { label: "Waiting", value: capped ? `${views}+ views (${posts}+ posts)` : `${plural(views, "view")} (${plural(posts, "post")})` },
    {
      label: "Last fold",
      value: age === null ? "never" : `${humanAge(age)} ago`,
      state: foldFailed ? "critical" : age !== null && age > staleAt ? "warn" : undefined,
    },
    { label: "Result", value: input.lastFold?.detail ?? "no record", state: foldFailed ? "critical" : undefined },
    { label: "Cadence", value: `every ${cadenceLabel(input.expectedMinutes)}` },
  ];

  // A failed fold attempt is reported as a fault in its own right: it means the
  // backlog is not merely young, it is not moving.
  if (foldFailed) {
    return {
      ...base,
      state: "critical",
      headline: "The last view fold failed",
      detail: `${input.lastFold?.detail ?? "The fold ran and did not complete."}${views > 0 ? ` ${plural(views, "view")} across ${plural(posts, "post")} are still waiting.` : ""}`,
      lastSuccessAt: null,
      ageMinutes: age,
      evidence,
    };
  }

  if (age === null) {
    return {
      ...base,
      state: views > 0 ? "warn" : "unknown",
      headline: views > 0 ? "Views are waiting with no fold on record" : "No fold has been recorded",
      detail:
        views > 0
          ? `${plural(views, "view")} have accumulated in Convex and no fold has ever been logged. The nightly sweep has not run since this ledger was introduced.`
          : "The heartbeat ledger holds no fold record yet. It stamps on the first nightly sweep after deploy.",
      lastSuccessAt: null,
      ageMinutes: null,
      evidence,
    };
  }

  if (views === 0) {
    return {
      ...base,
      state: "ok",
      headline: "Nothing waiting",
      detail: `Every recorded view is already folded into Postgres. Last pass ${humanAge(age)} ago.`,
      lastSuccessAt: input.lastFold?.at ?? null,
      ageMinutes: age,
      evidence,
    };
  }

  if (age > staleAt) {
    return {
      ...base,
      state: "critical",
      headline: `View totals are ${humanAge(age)} stale`,
      detail: `${plural(views, "view")} across ${plural(posts, "post")} have been waiting ${humanAge(age)} — the fold runs every ${cadenceLabel(input.expectedMinutes)}, so at least one pass has been missed. Cards and ranking read the stale numbers.`,
      lastSuccessAt: input.lastFold?.at ?? null,
      ageMinutes: age,
      evidence,
    };
  }

  if (age > lateAt) {
    return {
      ...base,
      state: "warn",
      headline: `Fold is running late`,
      detail: `${plural(views, "view")} waiting; the last fold was ${humanAge(age)} ago against a ${cadenceLabel(input.expectedMinutes)} cadence.`,
      lastSuccessAt: input.lastFold?.at ?? null,
      ageMinutes: age,
      evidence,
    };
  }

  return {
    ...base,
    state: "ok",
    headline: `${plural(views, "view")} waiting — on schedule`,
    detail: `Last fold ${humanAge(age)} ago, within the ${cadenceLabel(input.expectedMinutes)} cadence. Deltas accumulate between passes by design.`,
    lastSuccessAt: input.lastFold?.at ?? null,
    ageMinutes: age,
    evidence,
  };
}

/* ── RSS intake ────────────────────────────────────────────────────────── */

export interface RssSignals {
  activeFeeds: number;
  /** Active feeds whose last poll completed with items or a clean 304. */
  successfulFeeds: number;
  /** Active feeds carrying consecutive failures. */
  failingFeeds: number;
  /** Active feeds that have never completed a poll. */
  neverPolled: number;
  /** Most recent successful poll across all active feeds. */
  lastSuccessAt: Date | null;
  /** Most recent article the intake actually created. */
  lastImportedAt: Date | null;
  /** Full poll cadence, from the job registry. */
  expectedMinutes: number;
}

export function classifyRssIntake(input: RssSignals, now = Date.now()): PipelineCheck {
  const base = {
    id: "rss-intake" as const,
    label: "RSS intake",
    expectedMinutes: input.expectedMinutes,
  };

  if (input.activeFeeds === 0) {
    return {
      ...base,
      state: "unknown",
      headline: "No active feeds",
      detail: "Nothing is being syndicated, so there is no intake to measure.",
      lastSuccessAt: null,
      ageMinutes: null,
      evidence: [{ label: "Feeds", value: "0 active" }],
    };
  }

  const age = input.lastSuccessAt
    ? Math.round((now - input.lastSuccessAt.getTime()) / 60_000)
    : null;
  const successAt = input.lastSuccessAt?.toISOString() ?? null;

  const evidence: PipelineEvidence[] = [
    { label: "Feeds", value: `${input.successfulFeeds}/${input.activeFeeds} clean last cycle` },
    {
      label: "Failing",
      value: input.failingFeeds === 0 ? "none" : plural(input.failingFeeds, "feed"),
      state: input.failingFeeds === 0 ? undefined : "warn",
    },
    {
      label: "Never polled",
      value: input.neverPolled === 0 ? "none" : plural(input.neverPolled, "feed"),
      state: input.neverPolled === 0 ? undefined : "warn",
    },
    {
      label: "Last import",
      value: input.lastImportedAt ? `${humanAge(Math.round((now - input.lastImportedAt.getTime()) / 60_000))} ago` : "never",
    },
    { label: "Cadence", value: `every ${cadenceLabel(input.expectedMinutes)}` },
  ];

  if (age === null) {
    return {
      ...base,
      state: "warn",
      headline: "No feed has completed a poll",
      detail: `${plural(input.activeFeeds, "active feed")} and no successful poll on record. The intake has never run, or its very first cycle has not happened yet.`,
      lastSuccessAt: null,
      ageMinutes: null,
      evidence,
    };
  }

  const silentFor = age > input.expectedMinutes * STALE_FACTOR;
  const behind = age > input.expectedMinutes * LATE_FACTOR;

  if (silentFor) {
    return {
      ...base,
      state: "critical",
      headline: `No successful poll in ${humanAge(age)}`,
      detail: `The intake runs every ${cadenceLabel(input.expectedMinutes)}, so at least one cycle produced nothing at all${input.failingFeeds > 0 ? ` and ${plural(input.failingFeeds, "feed")} are failing` : ""}. ${input.lastImportedAt ? `The last article imported was ${humanAge(Math.round((now - input.lastImportedAt.getTime()) / 60_000))} ago.` : "No article has ever been imported."}`,
      lastSuccessAt: successAt,
      ageMinutes: age,
      evidence,
    };
  }

  if (behind || input.failingFeeds > 0) {
    return {
      ...base,
      state: "warn",
      headline: behind ? `Polls are behind by ${humanAge(age - input.expectedMinutes)}` : `${plural(input.failingFeeds, "feed")} failing`,
      detail: `Last successful poll ${humanAge(age)} ago against a ${cadenceLabel(input.expectedMinutes)} cadence. ${input.successfulFeeds}/${input.activeFeeds} feeds answered cleanly on the last cycle.`,
      lastSuccessAt: successAt,
      ageMinutes: age,
      evidence,
    };
  }

  return {
    ...base,
    state: "ok",
    headline: `Polled ${humanAge(age)} ago`,
    detail:
      input.lastImportedAt && now - input.lastImportedAt.getTime() < 24 * 60 * 60 * 1000
        ? `Syndication is landing: the newest article was imported ${humanAge(Math.round((now - input.lastImportedAt.getTime()) / 60_000))} ago.`
        : "Feeds are answering on schedule. A quiet cycle usually means the upstreams published nothing new.",
    lastSuccessAt: successAt,
    ageMinutes: age,
    evidence,
  };
}

/* ── Scheduler ─────────────────────────────────────────────────────────── */

export interface SchedulerJobSignal {
  id: string;
  name: string;
  cron: string;
  essential: boolean;
  lastRun: string | null;
  ageMinutes: number | null;
  expectedMinutes: number;
  stale: boolean;
  ok: boolean;
}

export interface SchedulerSignals {
  jobs: SchedulerJobSignal[];
  /** Which tier served the heartbeats. */
  ledger: HeartbeatLedger;
}

export function classifyScheduler(input: SchedulerSignals): PipelineCheck {
  const { jobs, ledger } = input;
  const base = { id: "scheduler" as const, label: "Scheduler heartbeats", expectedMinutes: null };

  const essential = jobs.filter((j) => j.essential);
  const staleEssential = essential.filter((j) => j.stale);
  const staleOther = jobs.filter((j) => !j.essential && j.stale);
  const everRan = jobs.filter((j) => j.ageMinutes !== null);

  const freshest = everRan.reduce<number | null>(
    (acc, j) => (acc === null || (j.ageMinutes ?? Infinity) < acc ? j.ageMinutes : acc),
    null
  );

  const evidence: PipelineEvidence[] = [
    {
      label: "Ledger",
      value: ledger === "redis" ? "Redis" : ledger === "database" ? "Postgres (Redis unavailable)" : "unavailable",
      state: ledger === "unavailable" ? "critical" : ledger === "database" ? "warn" : undefined,
    },
    { label: "Jobs tracked", value: plural(jobs.length, "job") },
    { label: "Freshest beat", value: humanAge(freshest) },
  ];
  for (const job of staleEssential) {
    evidence.push({
      label: job.name,
      value: job.lastRun ? `${humanAge(job.ageMinutes)} late` : "never ran",
      state: "critical",
    });
  }
  for (const job of staleOther) {
    evidence.push({
      label: job.name,
      value: job.lastRun ? `${humanAge(job.ageMinutes)} since last run` : "never ran",
      state: "warn",
    });
  }

  /*
   * Nothing in the registry has ever recorded a run here.
   *
   * That is deliberately checked before any staleness verdict, because it is the
   * one situation where every row looks equally alarming and none of them is a
   * measurement. Seventeen jobs reading "never ran" is not seventeen failures:
   * a registry with no observations at all is the ordinary state of a fresh
   * instance, a development workstation, or a deployment whose scheduler has not
   * started, whereas seventeen simultaneous collapses is not a state a running
   * system reaches. The console used to report the second for the first, which
   * sent operators to check cron delivery on machines that had simply never been
   * scheduled. An absence of any observation is not evidence of failure, so it
   * reports as unmeasured and names the difference.
   *
   * The two sub-cases stay separate because their instructions differ: a ledger
   * nobody can read is an infrastructure problem, a readable ledger with no
   * record in it is a scheduler that has not been watched yet.
   */
  if (everRan.length === 0) {
    return {
      ...base,
      state: "unknown",
      headline:
        ledger === "unavailable"
          ? "Heartbeat ledger unavailable"
          : `No run recorded by any of the ${plural(jobs.length, "job")}`,
      detail:
        ledger === "unavailable"
          ? "Neither Redis nor Postgres answered, so job staleness cannot be measured. This is blind, not quiet — do not read it as healthy."
          : `The ledger is readable (${ledger === "redis" ? "Redis" : "Postgres"}) and holds no heartbeat for any registered job, so staleness is unmeasured rather than late. On a new or local instance this is expected; if this is production, check that Inngest and the edge cron are actually being triggered, because a scheduler that has never run looks exactly like one that is broken.`,
      lastSuccessAt: null,
      ageMinutes: null,
      evidence,
    };
  }

  if (staleEssential.length > 0) {
    const named = staleEssential
      .map((j) => `${j.name} (${j.lastRun ? `${humanAge(j.ageMinutes)} ago` : "never"})`)
      .join(", ");
    return {
      ...base,
      state: "critical",
      headline: `${plural(staleEssential.length, "essential job")} has stopped firing`,
      detail: `${named}. Each is expected every ${cadenceLabel(staleEssential[0]?.expectedMinutes ?? 0)} or so; the Vercel safety net only runs a day, so a stall here means the work is simply not being done.`,
      lastSuccessAt: null,
      ageMinutes: staleEssential[0]?.ageMinutes ?? null,
      evidence,
    };
  }

  if (staleOther.length > 0) {
    return {
      ...base,
      state: "warn",
      headline: `${plural(staleOther.length, "background job")} behind schedule`,
      detail: `${staleOther.map((j) => j.name).join(", ")} ${staleOther.length === 1 ? "is" : "are"} past the expected spacing. Essential jobs are all current, so nothing reader-facing is stalled yet.`,
      lastSuccessAt: null,
      ageMinutes: freshest,
      evidence,
    };
  }

  return {
    ...base,
    state: "ok",
    headline: "Every job is beating on schedule",
    detail: `${plural(essential.length, "essential job")} and ${plural(jobs.length - essential.length, "background job")} all beat within their expected spacing. Freshest beat ${humanAge(freshest)} ago.`,
    lastSuccessAt: null,
    ageMinutes: freshest,
    evidence,
  };
}

/* ── Gathering ─────────────────────────────────────────────────────────── */

export interface RssIntakeSnapshot {
  activeFeeds: number;
  successfulFeeds: number;
  failingFeeds: number;
  neverPolled: number;
  lastSuccessAt: string | null;
  lastImportedAt: string | null;
}

export interface PipelineHealthReport {
  generatedAt: string;
  overall: PipelineState;
  checks: PipelineCheck[];
  scheduler: { ledger: HeartbeatLedger; jobs: SchedulerJobSignal[] };
  viewSync: {
    configured: boolean;
    urlSource: "env" | "setting" | "none";
    state: "unknown" | "ok" | "failing";
    error: string | null;
    pendingPosts: number;
    pendingViews: number;
    capped: boolean;
    lastFoldAt: string | null;
    lastFoldOk: boolean;
    lastFoldDetail: string | null;
  };
  rss: RssIntakeSnapshot;
}

/** Statuses that mean "the poll completed" — an empty or unchanged feed is a
 *  healthy answer, not a failure. Everything else (`HTTP_ERROR`, `TIMEOUT`,
 *  `PARSE_ERROR`, `NETWORK_ERROR`) is the intake being blocked. */
const CLEAN_POLL_STATUSES = new Set(["OK", "NOT_MODIFIED", "EMPTY"]);

function expectedMinutesFor(jobId: string, fallback: number): number {
  return CRON_JOBS.find((job) => job.id === jobId)?.everyMinutes ?? fallback;
}

/**
 * Assemble the report. Every source is read defensively: one unavailable
 * dependency degrades its own check to `unknown` and leaves the others intact,
 * because a health page that returns 500 whenever a dependency is down is a
 * health page that is missing exactly when it is needed.
 */
export async function getPipelineHealth(now = Date.now()): Promise<PipelineHealthReport> {
  const foldExpectedMinutes = expectedMinutesFor("hive-sweep", 1440);
  const rssExpectedMinutes = expectedMinutesFor("rss-poll", 720);

  const [configured, scheduler, lastFold, feeds, lastImport] = await Promise.all([
    convexAvailable().catch(() => false),
    getSchedulerStatus().catch((error) => {
      log.warn("cron status unavailable", { error: String(error) });
      return null;
    }),
    readHeartbeat(VIEW_SYNC_HEARTBEAT).catch(() => null),
    prisma.rssFeed
      .findMany({
        where: { isActive: true },
        select: { lastPolled: true, lastStatus: true, consecutiveFailures: true },
      })
      .catch((error) => {
        log.warn("feed snapshot unavailable", { error: String(error) });
        return null;
      }),
    prisma.rssArticle
      .aggregate({ _max: { importedAt: true } })
      .catch(() => ({ _max: { importedAt: null } })),
  ]);

  // Only ask Convex for the backlog when there is a deployment to ask. The
  // probe also refreshes `convexHealth()`, which is how a failure becomes a
  // reportable fact rather than a silent `[]`.
  let pending: { posts: number; views: number; capped: boolean } | null = null;
  if (configured) {
    const summary = await convexPendingSummary(500).catch(() => null);
    if (summary !== null && convexHealth().state !== "failing") {
      pending = {
        posts: summary.posts,
        views: summary.views,
        // `done` is the honest signal: false means there were more rows to
        // examine than one page holds, so the figure is a floor, not a total.
        capped: !summary.done,
      };
    }
  }
  const convex = convexHealth();

  const jobs = scheduler?.jobs ?? null;
  const jobRows: SchedulerJobSignal[] = (jobs ?? []).map((job) => ({
    id: job.id,
    name: job.name,
    cron: job.cron,
    essential: job.essential,
    lastRun: job.lastRun,
    ageMinutes: job.ageMinutes,
    expectedMinutes: job.everyMinutes,
    stale: job.stale,
    ok: job.ok,
  }));

  const cleanFeeds = feeds?.filter((f) => f.lastStatus !== null && CLEAN_POLL_STATUSES.has(f.lastStatus)) ?? [];
  const successTimes = cleanFeeds
    .map((f) => (f.lastPolled ? new Date(f.lastPolled).getTime() : 0))
    .filter((t) => t > 0);
  const rssSnapshot: RssIntakeSnapshot = {
    activeFeeds: feeds?.length ?? 0,
    successfulFeeds: cleanFeeds.length,
    failingFeeds: feeds?.filter((f) => f.consecutiveFailures > 0).length ?? 0,
    neverPolled: feeds?.filter((f) => f.lastPolled === null).length ?? 0,
    lastSuccessAt: successTimes.length > 0 ? new Date(Math.max(...successTimes)).toISOString() : null,
    lastImportedAt: lastImport._max.importedAt ? lastImport._max.importedAt.toISOString() : null,
  };

  const checks: PipelineCheck[] = [
    classifyViewSync({
      configured,
      reachable: convex.state,
      error: convex.error,
      pending,
      lastFold,
      expectedMinutes: foldExpectedMinutes,
    }),
    classifyRssIntake(
      {
        activeFeeds: rssSnapshot.activeFeeds,
        successfulFeeds: rssSnapshot.successfulFeeds,
        failingFeeds: rssSnapshot.failingFeeds,
        neverPolled: rssSnapshot.neverPolled,
        lastSuccessAt: rssSnapshot.lastSuccessAt ? new Date(rssSnapshot.lastSuccessAt) : null,
        lastImportedAt: rssSnapshot.lastImportedAt ? new Date(rssSnapshot.lastImportedAt) : null,
        expectedMinutes: rssExpectedMinutes,
      },
      now
    ),
    classifyScheduler({
      jobs: jobRows,
      // The tier the *read* used, which the scheduler status just captured. The
      // module-level `heartbeatLedger()` is the same value here by construction,
      // but reading it from the status keeps the classification tied to the
      // exact snapshot the job list came from.
      ledger: scheduler?.ledger ?? heartbeatLedger(),
    }),
  ];

  return {
    generatedAt: new Date(now).toISOString(),
    overall: overallPipelineState(checks),
    checks,
    scheduler: { ledger: scheduler?.ledger ?? heartbeatLedger(), jobs: jobRows },
    viewSync: {
      configured,
      urlSource: convexUrlSource(),
      state: convex.state,
      error: convex.error,
      pendingPosts: pending?.posts ?? 0,
      pendingViews: pending?.views ?? 0,
      capped: pending?.capped ?? false,
      lastFoldAt: lastFold?.at ?? null,
      lastFoldOk: lastFold?.ok ?? false,
      lastFoldDetail: lastFold?.detail ?? null,
    },
    rss: rssSnapshot,
  };
}
