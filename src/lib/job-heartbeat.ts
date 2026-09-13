import { redisAvailable, redisGetRaw, redisSetEx } from "./redis";

/**
 * Cron heartbeats.
 *
 * Every scheduled job — whether Inngest's own cron trigger fired it, an admin
 * pressed "run now", or the Vercel safety net ran it inline — stamps a
 * heartbeat here when it starts. That single ledger serves three purposes:
 *
 *   1. The admin Integrations console shows the true last-run time for each
 *      job without needing Inngest's Management API (which is a paid/optional
 *      integration and is unset in production).
 *   2. The daily Vercel safety net can tell which *essential* jobs Inngest has
 *      stopped delivering and run only those, so the free scheduler stays a
 *      fallback instead of a duplicate workload.
 *   3. A job that silently stops firing becomes visible instead of being
 *      discovered days later when the feed is cold.
 *
 * One key per job (not a shared hash) so concurrent workers never race on a
 * read-modify-write.
 */

export interface JobHeartbeat {
  jobId: string;
  /** ISO timestamp of the most recent start. */
  at: string;
  ok: boolean;
  detail?: string | null;
}

const KEY_PREFIX = "cron:hb:";
const TTL_SECONDS = 30 * 24 * 60 * 60;

export async function recordHeartbeat(
  jobId: string,
  opts: { ok?: boolean; detail?: string | null } = {}
): Promise<void> {
  if (!redisAvailable()) return;
  const payload: JobHeartbeat = {
    jobId,
    at: new Date().toISOString(),
    ok: opts.ok ?? true,
    detail: opts.detail ?? null,
  };
  await redisSetEx(`${KEY_PREFIX}${jobId}`, TTL_SECONDS, JSON.stringify(payload)).catch(
    () => {}
  );
}

export async function readHeartbeat(jobId: string): Promise<JobHeartbeat | null> {
  const raw = await redisGetRaw(`${KEY_PREFIX}${jobId}`).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as JobHeartbeat;
    return parsed?.at ? parsed : null;
  } catch {
    return null;
  }
}

export async function readHeartbeats(
  jobIds: readonly string[]
): Promise<Record<string, JobHeartbeat | null>> {
  const entries = await Promise.all(
    jobIds.map(async (id) => [id, await readHeartbeat(id)] as const)
  );
  return Object.fromEntries(entries);
}

/** Minutes since the last heartbeat, or null when the job has never run. */
export function heartbeatAgeMinutes(hb: JobHeartbeat | null): number | null {
  if (!hb) return null;
  const at = new Date(hb.at).getTime();
  if (Number.isNaN(at)) return null;
  return Math.round((Date.now() - at) / 60_000);
}

/** A job is stale when it has never run, or has not run within `graceMinutes`. */
export function isStale(
  hb: JobHeartbeat | null,
  expectedEveryMinutes: number,
  graceFactor = 2
): boolean {
  const age = heartbeatAgeMinutes(hb);
  if (age === null) return true;
  return age > expectedEveryMinutes * graceFactor;
}
