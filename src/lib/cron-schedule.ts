import { createLogger } from "./logger";
import {
  isStale,
  heartbeatAgeMinutes,
  heartbeatLedger,
  readHeartbeats,
  recordHeartbeat,
  type HeartbeatLedger,
  type JobHeartbeat,
} from "./job-heartbeat";
import {
  runAnalyticsRetention,
  runBrainDiagnosis,
  runEmbedPosts,
  runFeedHealth,
  runHiveSweep,
  runMarketingSweep,
  runPaymentsLifecycle,
  runPlatformPulse,
  runPublishScheduled,
  runRadioSweep,
  runRecoverThumbnails,
  runRssPollInline,
  runSportsIntel,
  runSportsLive,
  runSportsNotify,
  runStatusWatchdog,
} from "./cron-jobs";

/**
 * Single source of truth for every scheduled job.
 *
 * Cadence lives here, in Inngest's cron triggers (see src/inngest/functions.ts,
 * which mirrors these expressions) and in this registry — so the admin console
 * can show each job's real schedule, and the daily Vercel safety net can decide
 * what to cover without hard-coding a second schedule table.
 *
 * Vercel's cron slot is deliberately spent on ONE call a day: it re-runs only
 * the `essential` jobs whose heartbeat has gone stale, which is a no-op while
 * Inngest is healthy. That keeps the free scheduler as a genuine fallback
 * rather than a duplicate workload racing against the queue.
 */

export interface CronJobDef {
  id: string;
  name: string;
  description: string;
  /** Inngest cron expression, UTC. */
  cron: string;
  /** Expected spacing, used to judge staleness. */
  everyMinutes: number;
  /** Covered by the Vercel safety net when Inngest goes quiet. */
  essential: boolean;
  run: () => Promise<unknown>;
}

export const CRON_JOBS: readonly CronJobDef[] = [
  {
    id: "publish-scheduled",
    name: "Scheduled publishing",
    description: "Publishes stories whose scheduledAt time has arrived, then notifies and learns from them.",
    cron: "*/5 * * * *",
    everyMinutes: 5,
    essential: true,
    run: () => runPublishScheduled(),
  },
  {
    id: "rss-poll",
    name: "RSS syndication",
    description: "Polls every active Kenyan/regional feed, filters spam, and files items by category.",
    // TWICE A DAY — 00:00 and 12:00 UTC. Deliberate, and not a place to "improve"
    // the freshness by tightening the expression:
    //
    //   • The poll is the single biggest consumer of outbound egress and upstream
    //     requests in the schedule. Every cycle re-downloads each source's
    //     document, and each of those documents is mostly *unchanged*. Six-hourly
    //     already meant four copies a day of the same bytes; twice daily halves
    //     that again, and the ETag/Last-Modified conditional GETs mean an
    //     unchanged feed often costs a 304 rather than the body anyway.
    //   • News does not arrive on a schedule that four passes a day can exploit.
    //     A story that breaks at 09:00 is on the site by midday and its reader
    //     will not have noticed the difference.
    //   • A manual poll is always available: the admin console's "Poll now" and
    //     `GET /api/cron?trigger=rss-poll` both bypass this cadence, so an
    //     operator who needs a story in the next minute can still get it.
    //
    // Per-feed `pollInterval` still throttles individual sources inside a cycle,
    // so a slow publisher is not dragged along by the registry's schedule.
    cron: "0 */12 * * *",
    everyMinutes: 720,
    essential: true,
    run: () => runRssPollInline(),
  },
  {
    id: "status-watchdog",
    name: "Status watchdog",
    description: "Probes every service and alerts on degradation, with a 6h Redis cooldown per episode.",
    cron: "*/5 * * * *",
    everyMinutes: 5,
    essential: true,
    run: () => runStatusWatchdog(),
  },
  {
    id: "radio-status-sweep",
    name: "Radio metadata sweep",
    description: "Refreshes now-playing and listener counts for every station into the Redis cache.",
    cron: "*/15 * * * *",
    everyMinutes: 15,
    essential: false,
    run: () => runRadioSweep(),
  },
  {
    id: "sports-live",
    name: "Livescore heartbeat",
    description: "Refreshes the multi-source livescore snapshot, regenerates upcoming picks and grades finished ones every two minutes.",
    // Driven by the Cloudflare edge Worker's Cron Trigger as well as Inngest,
    // so the board and the model keep moving even when Inngest Cloud is not
    // synced — and so the front end never has to be the thing that triggers it.
    cron: "*/2 * * * *",
    everyMinutes: 2,
    essential: false,
    run: () => runSportsLive(),
  },
  {
    id: "sports-notify",
    name: "Favourite alerts",
    description: "Notifies readers when a favourited match kicks off, goes live, finishes or settles a pick.",
    cron: "*/5 * * * *",
    everyMinutes: 5,
    // Deliberately NOT in the daily safety net: a once-a-day catch-up is the
    // wrong recovery for a five-minute job, and it would fire on every pass
    // since a job this frequent always looks stale to a daily check. Its real
    // recovery is the livescore board, which drives this and the pick top-up
    // through `runThrottled` whenever a visitor loads it (see
    // src/app/api/sports/live/route.ts). Silence here is measured in minutes,
    // not days, so it must be repaired in minutes.
    essential: false,
    run: () => runSportsNotify(),
  },
  {
    id: "sports-intel",
    name: "Sports intelligence",
    description: "Teaches the hive mind the latest fixtures, regenerates betting picks, and grades finished ones.",
    cron: "*/30 * * * *",
    everyMinutes: 30,
    essential: false,
    run: () => runSportsIntel(40),
  },
  {
    id: "thumbnail-recovery",
    name: "Thumbnail recovery",
    description: "Re-derives cover images for syndicated posts that shipped without one.",
    cron: "15 */6 * * *",
    everyMinutes: 360,
    // Essential, not optional. This is the only thing that can repair a story
    // that was imported before its publisher's image was available, and it is
    // the difference between a feed of covers and a feed of painted
    // placeholders. While it was non-essential it was reachable *only* through
    // Inngest, so when that queue went quiet the backlog simply stopped
    // shrinking and nothing anywhere said so. As an essential job the Vercel
    // safety net also picks it up when its heartbeat is stale, which costs
    // nothing while Inngest is healthy.
    essential: true,
    run: () => runRecoverThumbnails(20),
  },
  {
    id: "hive-sweep",
    name: "Nightly hive training",
    description: "Sweeps new memories, trains the brain, ingests RSS, and folds Convex view deltas into Postgres.",
    cron: "0 1 * * *",
    everyMinutes: 1440,
    essential: false,
    run: () => runHiveSweep(),
  },
  {
    id: "embed-posts",
    name: "Semantic index",
    description: "Embeds published posts that are missing or stale so semantic search stays sharp.",
    cron: "30 1 * * *",
    everyMinutes: 1440,
    essential: false,
    run: () => runEmbedPosts(400),
  },
  {
    id: "payments-lifecycle",
    name: "Payment reconciliation",
    description:
      "Reconciles PayPal memberships against the provider, expires lapsed periods, and reports stuck M-Pesa prompts.",
    // Every six hours is enough: this repairs drift (a webhook that never
    // arrived, a period that has ended), and drift does not compound in minutes.
    cron: "30 */6 * * *",
    everyMinutes: 360,
    essential: false,
    run: () => runPaymentsLifecycle(),
  },
  {
    id: "status-daily-snapshot",
    name: "Daily status snapshot",
    description: "Stamps the day's first health result into the 90-day uptime history.",
    cron: "5 0 * * *",
    everyMinutes: 1440,
    essential: false,
    run: () => runStatusWatchdog(),
  },
  {
    id: "marketing-sweep",
    name: "Self-marketing sweep",
    description:
      "Drafts campaigns and topic suggestions from live trends, shares newly published stories, and sends anything approved.",
    // Every fifteen minutes because the freshness that matters here is a
    // *story*, not a campaign: a piece published at 09:04 should be on the
    // Facebook Page at 09:15, and the sweep is the only path that does that
    // without a human. Each pass is cheap and idempotent — drafting is skipped
    // while four drafts are already waiting, and a story is shared by its URL at
    // most once — so running often costs reads, not duplicates.
    cron: "*/15 * * * *",
    everyMinutes: 15,
    // Not in the daily safety net, for the same reason as sports-notify: silence
    // here is measured in minutes and a once-a-day recovery would be a day late.
    essential: false,
    run: () => runMarketingSweep(),
  },
  {
    id: "feed-health",
    name: "Outbound feed health",
    description:
      "Fetches our own RSS, JSON and category feeds and verifies they parse and that their item links resolve, alerting when a feed a partner depends on breaks.",
    // Hourly. Three small fetches, and the cadence that matters is how quickly a
    // partner's feed going dark reaches a human. The alert is deduped per
    // episode, so running often costs a check, not a stream of email.
    cron: "30 * * * *",
    everyMinutes: 60,
    essential: false,
    run: () => runFeedHealth(),
  },
  {
    id: "platform-pulse",
    name: "Platform pulse",
    description:
      "Records traffic depth, creator shape and revenue each run and diffs them against the previous pulse, so bounce rate, session time and returning share are monitored over time rather than only measured once.",
    // Six-hourly. The window it reads is a rolling seven days, so sampling it
    // more often would produce deltas that move mostly with the clock rather
    // than with the audience. Four readings a day is enough to see a real shift.
    cron: "45 */6 * * *",
    everyMinutes: 360,
    essential: false,
    run: () => runPlatformPulse(),
  },
  {
    id: "analytics-retention",
    name: "Analytics retention",
    description:
      "Rolls high-volume event tables up into daily metrics, then deletes rows past their retention window. Financial and moderation records are explicitly retained.",
    // Daily at 02:30 UTC, one slot before the brain's own diagnosis. Ordered
    // this way on purpose: the diagnosis reads job heartbeats, and a retention
    // run that is still mid-delete while it is being measured would be reported
    // as a stalled job rather than a busy one.
    //
    // The hour also matters for a subtler reason. This job deletes rows, and the
    // only safe time to delete is when nobody is querying them; 02:30 UTC is
    // inside the quiet window for this audience (05:30 in Nairobi, 04:30 in
    // Lagos), and the daily buckets it writes are complete by then because it
    // only rolls up days that have ended.
    cron: "30 2 * * *",
    everyMinutes: 1440,
    // Not in the daily safety net. A retention pass that missed its slot is
    // caught up the next night with no loss — it is a rolling window, not a
    // point-in-time obligation — and a mid-day catch-up would run a large
    // delete inside peak traffic.
    essential: false,
    run: () => runAnalyticsRetention(),
  },
  {
    id: "brain-diagnose",
    name: "Brain self-diagnosis",
    description:
      "Runs the mind's own health probes — database, cache tier, every scheduler heartbeat, pipelines, offload, hive recency — plus a self-test of the deterministic engines. Findings are stored in the hive, a fault that survives three consecutive runs is filed as a tracked issue (and closed again when it stops appearing), and the self-healing envelope is applied within its cap.",
    // Daily, at 03:15 UTC. Deliberately the quiet hour: the probes compare job
    // heartbeats against their own windows, and a diagnosis run while the
    // high-frequency jobs are mid-flight would report their normal in-flight
    // state as staleness. Findings are stored either way, so the console always
    // has the last report without re-running anything.
    cron: "15 3 * * *",
    everyMinutes: 1440,
    // Not in the Vercel safety net: a diagnosis that failed at 03:15 is worth a
    // retry on the next night, not a catch-up run in the middle of the day when
    // the numbers it reads mean something different.
    essential: false,
    run: () => runBrainDiagnosis(),
  },
];

export const ESSENTIAL_JOBS = CRON_JOBS.filter((j) => j.essential);

export interface CronJobStatus extends CronJobDef {
  lastRun: string | null;
  ageMinutes: number | null;
  stale: boolean;
  ok: boolean;
}

const log = createLogger("cron-schedule");

/** Schedule + last-run + staleness for every job, for the admin console. */
/**
 * The scheduler's state, with the one thing a per-job list cannot express:
 * whether *any* of it has ever been observed here.
 *
 * This exists because the console read `getCronStatus()` and reported "17 of 17
 * jobs behind" on an instance whose heartbeat ledger had never recorded a single
 * run. Every individual row said "never ran", which is true, and the sum of them
 * was a lie: seventeen independent schedulers failing at once is not a state a
 * running system reaches, while a registry that nothing has been recorded for is
 * the ordinary state of a fresh instance, a development workstation, or a
 * deployment whose scheduler has not started yet. Those two situations produce
 * identical rows and completely different instructions, so `measured` — not the
 * job list — is what callers must branch on before claiming anything is late.
 */
export interface SchedulerStatus {
  generatedAt: string;
  jobs: CronJobStatus[];
  /** Registered jobs that have a heartbeat, i.e. that have provably run here. */
  observed: number;
  /** Which tier served the heartbeats, which is what makes them trustworthy. */
  ledger: HeartbeatLedger;
  /**
   * Whether staleness is a measurement. False when nothing at all has been
   * recorded, in which case "never ran" is the absence of evidence rather than
   * evidence of failure.
   */
  measured: boolean;
}

export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const beats = await readHeartbeats(CRON_JOBS.map((j) => j.id));
  const jobs = CRON_JOBS.map((job) => {
    const hb: JobHeartbeat | null = beats[job.id] ?? null;
    return {
      ...job,
      lastRun: hb?.at ?? null,
      ageMinutes: heartbeatAgeMinutes(hb),
      stale: isStale(hb, job.everyMinutes),
      ok: hb?.ok ?? false,
    };
  });

  const observed = jobs.filter((j) => j.ageMinutes !== null).length;
  return {
    generatedAt: new Date().toISOString(),
    jobs,
    observed,
    ledger: heartbeatLedger(),
    measured: observed > 0,
  };
}

/**
 * The per-job last-run table.
 *
 * Kept as-is because the safety net and the integrations registry genuinely
 * want the list; anything deciding whether to *alarm* belongs on
 * `getSchedulerStatus()` instead, where `measured` is available.
 */
export async function getCronStatus(): Promise<CronJobStatus[]> {
  return (await getSchedulerStatus()).jobs;
}

export interface SafetyNetResult {
  checked: number;
  /** Which registry slice this sweep considered. */
  scope: SafetyNetScope;
  ran: { jobId: string; ageMinutes: number | null; result: unknown }[];
  skipped: { jobId: string; ageMinutes: number | null }[];
  /** Due, but not started because the sweep ran out of its time budget. */
  deferred: string[];
  errors: { jobId: string; error: string }[];
}

/**
 * `"essential"` is the jobs whose absence a reader can see. `"all"` is the
 * whole registry.
 */
export type SafetyNetScope = "essential" | "all";

export interface SafetyNetOptions {
  force?: boolean;
  /**
   * Which jobs to consider. Defaults to `"essential"`, which is what Vercel's
   * once-a-day safety net wants.
   *
   * `"all"` exists because of a gap that a live production check made obvious:
   * four jobs (`feed-health`, `platform-pulse`, `analytics-retention`,
   * `status-daily-snapshot`) reported `lastRun: null` — they had **never run
   * once**. They are the ones with no second scheduler: they are
   * `essential: false`, so the safety net skipped them by design, and Inngest —
   * their only other owner — was not delivering. A job that has never run is
   * indistinguishable from a job that is broken, which is exactly the silent
   * failure this module was written to end.
   */
  scope?: SafetyNetScope;
  /**
   * Stop starting new jobs once this much time has elapsed. A sweep can find
   * many jobs due at once — after an outage, or on the first tick after deploy —
   * and a serverless invocation has a hard ceiling. Deferred jobs stay stale and
   * run on the next tick, which is the correct failure direction: late, never
   * lost, and never a truncated response that looks like success.
   */
  budgetMs?: number;
}

/** Leaves headroom under the 300s function ceiling for the response itself. */
const DEFAULT_SWEEP_BUDGET_MS = 240_000;

/**
 * Run the jobs whose own heartbeat says they are overdue.
 *
 * A fresh heartbeat means whatever else owns the job is delivering, so this
 * returns immediately without touching the database, the feeds or an upstream.
 * That is what makes it safe to call from a frequent tick: the cost of a sweep
 * with nothing due is a handful of ledger reads.
 */
export async function runStaleJobs(opts: SafetyNetOptions = {}): Promise<SafetyNetResult> {
  const scope: SafetyNetScope = opts.scope ?? "essential";
  const jobs = scope === "all" ? CRON_JOBS : ESSENTIAL_JOBS;
  const budgetMs = opts.budgetMs ?? DEFAULT_SWEEP_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  const beats = await readHeartbeats(jobs.map((j) => j.id));
  const out: SafetyNetResult = {
    checked: jobs.length,
    scope,
    ran: [],
    skipped: [],
    deferred: [],
    errors: [],
  };

  for (const job of jobs) {
    const hb = beats[job.id] ?? null;
    const stale = opts.force === true || isStale(hb, job.everyMinutes);
    if (!stale) {
      out.skipped.push({ jobId: job.id, ageMinutes: heartbeatAgeMinutes(hb) });
      continue;
    }

    if (Date.now() >= deadline) {
      out.deferred.push(job.id);
      continue;
    }

    try {
      log.warn("safety net running stalled job", {
        jobId: job.id,
        scope,
        ageMinutes: heartbeatAgeMinutes(hb),
      });
      const result = await job.run();
      await recordHeartbeat(job.id, { ok: true, detail: `run by ${scope} sweep` });
      out.ran.push({ jobId: job.id, ageMinutes: heartbeatAgeMinutes(hb), result });
    } catch (err) {
      out.errors.push({ jobId: job.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return out;
}

/**
 * The essential-only sweep Vercel still owns.
 *
 * Kept as its own name because the scope is a real part of the contract: this
 * is the reader-facing slice, and the once-a-day cadence only makes sense for
 * it. New callers that want everything should say so explicitly.
 */
export function runStaleEssentialJobs(
  opts: Omit<SafetyNetOptions, "scope"> = {}
): Promise<SafetyNetResult> {
  return runStaleJobs({ ...opts, scope: "essential" });
}
