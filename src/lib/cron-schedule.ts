import { createLogger } from "./logger";
import {
  isStale,
  heartbeatAgeMinutes,
  readHeartbeats,
  recordHeartbeat,
  type JobHeartbeat,
} from "./job-heartbeat";
import {
  runEmbedPosts,
  runHiveSweep,
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
    cron: "0 * * * *",
    everyMinutes: 60,
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
    description: "Refreshes the multi-source livescore snapshot and grades finished picks every two minutes.",
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
    id: "status-daily-snapshot",
    name: "Daily status snapshot",
    description: "Stamps the day's first health result into the 90-day uptime history.",
    cron: "5 0 * * *",
    everyMinutes: 1440,
    essential: false,
    run: () => runStatusWatchdog(),
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
