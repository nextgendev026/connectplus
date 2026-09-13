import { heartbeatAgeMinutes, readHeartbeat, recordHeartbeat } from "./job-heartbeat";
import { createLogger } from "./logger";

const log = createLogger("throttled-job");

/**
 * Run a job at most once per interval, from wherever the app happens to be busy.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every sports cadence (picks, settlement, favourite alerts) lives on Inngest's
 * cron triggers. That is the right home for regular work — but it is also a
 * single point of failure with no self-healing: if the Inngest app is unsynced,
 * paused, or the deployment's cron triggers were never registered, the model
 * stops generating picks and favourited fixtures stop notifying, and nothing in
 * the app notices. The board keeps rendering yesterday's picks and the bell
 * stays empty.
 *
 * So the busiest public surfaces (the livescore feed) carry a *throttled*
 * opportunity to catch up. This is deliberately not "run the job inline": the
 * caller schedules it AFTER the response with `after()`, so a visitor never
 * waits on it, and the heartbeat ledger caps it so a thousand concurrent
 * viewers still produce one attempt per interval.
 *
 * Claiming the slot before running means a stampede collapses to one attempt
 * even across instances; two instances racing on a cold ledger can both fire,
 * which is acceptable because every job it wraps is idempotent by construction
 * (the notification ledger and the prediction upsert both dedupe on their own
 * keys).
 */
export async function runThrottled(
  jobId: string,
  minIntervalMs: number,
  run: () => Promise<unknown>
): Promise<{ ran: boolean; reason: "ok" | "throttled" | "failed" }> {
  const last = await readHeartbeat(jobId).catch(() => null);
  const ageMs = last ? (heartbeatAgeMinutes(last) ?? Number.POSITIVE_INFINITY) * 60_000 : Number.POSITIVE_INFINITY;
  if (ageMs < minIntervalMs) return { ran: false, reason: "throttled" };

  // Claim the slot first so concurrent callers stand down.
  await recordHeartbeat(jobId, { ok: true, detail: "opportunistic run" }).catch(() => {});

  try {
    await run();
    return { ran: true, reason: "ok" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn("throttled job failed", { jobId, error: detail });
    await recordHeartbeat(jobId, { ok: false, detail: detail.slice(0, 160) }).catch(() => {});
    return { ran: false, reason: "failed" };
  }
}
