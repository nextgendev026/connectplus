import { createLogger } from "./logger";
import {
  isStale,
  heartbeatAgeMinutes,
  readHeartbeats,
  recordHeartbeat,
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
    essential: false,
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
export async function getCronStatus(): Promise<CronJobStatus[]> {
  const beats = await readHeartbeats(CRON_JOBS.map((j) => j.id));
  return CRON_JOBS.map((job) => {
    const hb: JobHeartbeat | null = beats[job.id] ?? null;
    return {
      ...job,
      lastRun: hb?.at ?? null,
      ageMinutes: heartbeatAgeMinutes(hb),
      stale: isStale(hb, job.everyMinutes),
      ok: hb?.ok ?? false,
    };
  });
}

export interface SafetyNetResult {
  checked: number;
  ran: { jobId: string; ageMinutes: number | null; result: unknown }[];
  skipped: { jobId: string; ageMinutes: number | null }[];
  errors: { jobId: string; error: string }[];
}

/**
 * Vercel safety net: run the essential jobs that Inngest appears to have
 * stopped delivering. Fresh heartbeats mean the queue is doing its job, so
 * this returns immediately without touching the database, feeds or upstreams.
 */
export async function runStaleEssentialJobs(
  opts: { force?: boolean } = {}
): Promise<SafetyNetResult> {
  const beats = await readHeartbeats(ESSENTIAL_JOBS.map((j) => j.id));
  const out: SafetyNetResult = { checked: ESSENTIAL_JOBS.length, ran: [], skipped: [], errors: [] };

  for (const job of ESSENTIAL_JOBS) {
    const hb = beats[job.id] ?? null;
    const stale = opts.force === true || isStale(hb, job.everyMinutes);
    if (!stale) {
      out.skipped.push({ jobId: job.id, ageMinutes: heartbeatAgeMinutes(hb) });
      continue;
    }

    try {
      log.warn("safety net running stalled job", {
        jobId: job.id,
        ageMinutes: heartbeatAgeMinutes(hb),
      });
      const result = await job.run();
      await recordHeartbeat(job.id, { ok: true, detail: "run by Vercel safety net" });
      out.ran.push({ jobId: job.id, ageMinutes: heartbeatAgeMinutes(hb), result });
    } catch (err) {
      out.errors.push({ jobId: job.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return out;
}
