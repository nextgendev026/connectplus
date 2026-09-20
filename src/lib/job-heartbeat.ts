import { prisma } from "./prisma";
import { redisAvailable, redisGetRaw, redisSetEx } from "./redis";

/**
 * Cron heartbeats.
 *
 * Every scheduled job — whether Inngest's own cron trigger fired it, an admin
 * pressed "run now", or the Vercel safety net ran it inline — stamps a heartbeat
 * here when it starts. That single ledger serves three purposes:
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
 * TWO tiers, deliberately:
 *
 *   • Redis is the fast path — one key per job, so concurrent workers never race
 *     on a read-modify-write.
 *   • Postgres is the durable path. This is not belt-and-braces for its own
 *     sake: when Redis credentials are rejected, a Redis-only ledger does not
 *     merely lose history, it turns into a LIE. Every job reads back as "never
 *     ran", so the console reports Inngest as degraded and the safety net
 *     re-runs every essential job on every pass — a false alarm that sends an
 *     operator chasing the wrong system. Falling back to a row in Postgres means
 *     staleness stays a measurement of the job, not of the cache.
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
/** Postgres rows use the same prefix so both tiers share one namespace. */
const DB_KEY_PREFIX = "cron-heartbeat:";

/**
 * Where the last heartbeat was actually read from. The console needs this: "12
 * jobs have never run" is a very different claim from "the ledger is
 * unavailable", and only one of them is the operator's problem.
 */
export type HeartbeatLedger = "redis" | "database" | "unavailable";

let ledgerTier: HeartbeatLedger = "unavailable";

/** Which tier served the most recent read/write. */
export function heartbeatLedger(): HeartbeatLedger {
  return ledgerTier;
}

/**
 * True when the heartbeat ledger can be trusted. Callers use this to avoid
 * reporting job staleness as fact while the ledger is blind.
 */
export function heartbeatLedgerHealthy(): boolean {
  return ledgerTier !== "unavailable";
}

async function dbRead(jobId: string): Promise<JobHeartbeat | null> {
  try {
    const row = await prisma.platformSetting.findUnique({
      where: { key: `${DB_KEY_PREFIX}${jobId}` },
      select: { value: true },
    });
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as JobHeartbeat;
    return parsed?.at ? parsed : null;
  } catch {
    return null;
  }
}

async function dbWrite(jobId: string, payload: JobHeartbeat): Promise<boolean> {
  try {
    await prisma.platformSetting.upsert({
      where: { key: `${DB_KEY_PREFIX}${jobId}` },
      update: { value: JSON.stringify(payload) },
      create: {
        key: `${DB_KEY_PREFIX}${jobId}`,
        value: JSON.stringify(payload),
        group: "system",
        label: `Heartbeat — ${jobId}`,
        type: "secret",
        isSecret: true,
        isEnabled: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function recordHeartbeat(
  jobId: string,
  opts: { ok?: boolean; detail?: string | null } = {}
): Promise<void> {
  const payload: JobHeartbeat = {
    jobId,
    at: new Date().toISOString(),
    ok: opts.ok ?? true,
    detail: opts.detail ?? null,
  };

  if (redisAvailable()) {
    // `redisSetEx` reports whether a store accepted the write. Do **not** wrap
    // this in `.then(() => true)` — that maps "the promise resolved" to "the
    // write landed", and a Redis that is configured but refusing credentials
    // resolves every time. That is how this ledger came to write nowhere at all
    // while reporting success to its caller.
    const written = await redisSetEx(
      `${KEY_PREFIX}${jobId}`,
      TTL_SECONDS,
      JSON.stringify(payload)
    ).catch(() => false);
    if (written) {
      ledgerTier = "redis";
      return;
    }
  }

  // Redis is absent or rejecting writes — record durably instead of dropping the
  // only evidence that this job ran at all.
  if (await dbWrite(jobId, payload)) ledgerTier = "database";
}

export async function readHeartbeat(jobId: string): Promise<JobHeartbeat | null> {
  if (redisAvailable()) {
    const raw = await redisGetRaw(`${KEY_PREFIX}${jobId}`).catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as JobHeartbeat;
        if (parsed?.at) {
          ledgerTier = "redis";
          return parsed;
        }
      } catch {
        // fall through to the durable tier
      }
    }
  }

  const fromDb = await dbRead(jobId);
  if (fromDb) ledgerTier = "database";
  return fromDb;
}

export async function readHeartbeats(
  jobIds: readonly string[]
): Promise<Record<string, JobHeartbeat | null>> {
  const entries = await Promise.all(
    jobIds.map(async (id) => [id, await readHeartbeat(id)] as const)
  );
  const out = Object.fromEntries(entries);
  // Only downgrade to "unavailable" when nothing at all was found in either
  // tier — an empty-but-working ledger is not an outage.
  if (!heartbeatLedgerHealthy() && Object.values(out).some((v) => v !== null)) {
    ledgerTier = "database";
  }
  return out;
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
