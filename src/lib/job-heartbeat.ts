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
 *
 * The distinction is about the *read path*, not about whether a record was
 * found. A tier that answered — even with "no such key" — is readable, and an
 * empty-but-readable ledger is a genuine measurement of silence. A tier that
 * threw told us nothing at all. Collapsing both into "unavailable" is how the
 * console came to report seventeen jobs as overdue on the strength of a ledger
 * that had never been written to, so the two cases are kept apart here.
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

/**
 * Test seam — resets the tier so a suite is not affected by earlier reads.
 *
 * The tier is upgraded as reads succeed and never downgraded, deliberately: a
 * single transient failure should not flip a working ledger to "blind" and send
 * an operator looking for an outage that is not there. That makes the value
 * process-global, which is correct at runtime and needs a reset in tests.
 */
export function resetHeartbeatLedger(): void {
  ledgerTier = "unavailable";
}

/**
 * The durable tier's answer, with the *absence* of a record kept separate from
 * the failure to ask. A missing row and a rejected query both used to return
 * `null`, which is why a working-but-never-written ledger was indistinguishable
 * from a broken one.
 */
type DbRead = { state: "found"; beat: JobHeartbeat } | { state: "missing" } | { state: "error" };

async function dbRead(jobId: string): Promise<DbRead> {
  try {
    const row = await prisma.platformSetting.findUnique({
      where: { key: `${DB_KEY_PREFIX}${jobId}` },
      select: { value: true },
    });
    if (!row?.value) return { state: "missing" };
    const parsed = JSON.parse(row.value) as JobHeartbeat;
    return parsed?.at ? { state: "found", beat: parsed } : { state: "missing" };
  } catch {
    return { state: "error" };
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
    let raw: string | null = null;
    let answered = false;
    try {
      raw = await redisGetRaw(`${KEY_PREFIX}${jobId}`);
      answered = true;
    } catch {
      // A configured Redis that refuses the command is a blind fast tier, not an
      // empty one. Fall through and let the durable tier speak.
      answered = false;
    }

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as JobHeartbeat;
        if (parsed?.at) {
          ledgerTier = "redis";
          return parsed;
        }
      } catch {
        // Malformed payload: treat the durable tier as the source of truth.
      }
    } else if (answered && ledgerTier === "unavailable") {
      /*
       * The fast tier answered, and holds no record for this job. That is an
       * authoritative *absence*, and it means the ledger is readable — so record
       * which tier is speaking before the durable tier gets a turn. Without
       * this, a healthy Redis with nothing in it left the tier at "unavailable",
       * and every caller that treats "unavailable" as blindness reported a
       * ledger outage instead of a scheduler that has not run.
       */
      ledgerTier = "redis";
    }
  }

  const fromDb = await dbRead(jobId);
  if (fromDb.state === "found") {
    ledgerTier = "database";
    return fromDb.beat;
  }
  if (fromDb.state === "missing" && ledgerTier === "unavailable") {
    // The durable tier was asked and answered: there is no such row. Same
    // reasoning as above — a missing record is a readable ledger reporting
    // silence, which is the one case where "this job has never run" is a fact.
    ledgerTier = "database";
  }
  return null;
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
