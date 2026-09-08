import { prisma } from "@/lib/prisma";
import { redisAvailable, redisSetEx, redisGetRaw, cacheGet, cacheSet } from "@/lib/redis";
import { STATIONS } from "@/lib/radio-stations";

export type ServiceStatus = "operational" | "degraded" | "down" | "unconfigured";

export interface ServiceCheck {
  id: string;
  name: string;
  description: string;
  status: ServiceStatus;
  latencyMs: number | null;
  detail: string;
  critical?: boolean;
}

export interface DayStatus {
  /** ISO date (YYYY-MM-DD) */
  date: string;
  level: 0 | 1 | 2; // 0 = up, 1 = degraded, 2 = down
  worst: ServiceStatus | "nodata";
  /** True when no probe was recorded for this day. */
  nodata?: boolean;
}

export interface CronRun {
  id: string;
  name: string;
  lastRun: string | null;
  state: "Active" | "completed" | "failed" | null;
}

export interface StatusResponse {
  overall: "operational" | "degraded" | "down";
  checkedAt: string;
  services: ServiceCheck[];
  /** 90-day worst-of-day history per service id (oldest → newest). */
  history: Record<string, DayStatus[]>;
  /** Last-run info for Inngest cron functions. */
  crons: CronRun[];
}

/* ------------------------------------------------------------------ */
/* Service metadata                                                    */
/* ------------------------------------------------------------------ */

const SERVICE_META: Record<string, { name: string; description: string; critical?: boolean }> = {
  database: { name: "Database", description: "Supabase Postgres — stories, users, engagement", critical: true },
  redis: { name: "Redis Cache", description: "Redis Cloud — feed cache, forex baseline, radio metadata" },
  radio: { name: "Radio Streams", description: "Upstream station audio reachability" },
  forex: { name: "Forex Rates", description: "open.er-api.com — daily reference rates" },
  weather: { name: "Weather Service", description: "Open-Meteo — forecasts and GPS weather" },
  inngest: { name: "Background Jobs", description: "Inngest — cron sweeps, scheduled publishing, RSS polling" },
};

export function serviceBase(id: string) {
  return { id, ...(SERVICE_META[id] ?? { name: id, description: "" }) };
}

/* ------------------------------------------------------------------ */
/* Individual checks                                                   */
/* ------------------------------------------------------------------ */

const PROBE_TIMEOUT = 6_000;

export async function checkDatabase(): Promise<{ status: ServiceStatus; detail: string }> {
  await prisma.$queryRaw`SELECT 1`;
  const count = await prisma.post.count({ where: { status: "PUBLISHED" } });
  return { status: "operational", detail: `Connected — ${count.toLocaleString()} published stories` };
}

export async function checkRedis(): Promise<{ status: ServiceStatus; detail: string }> {
  if (!redisAvailable()) {
    return { status: "unconfigured", detail: "REDIS_URL not set — caches bypassed, direct DB reads" };
  }
  const probeKey = `status:probe:${Date.now()}`;
  await redisSetEx(probeKey, 10, "ok");
  const roundtrip = await redisGetRaw(probeKey);
  if (roundtrip !== "ok") {
    return { status: "down", detail: "Probe write/read failed" };
  }
  const feedVersion = await cacheGet<number>("feed:version").catch(() => null);
  return { status: "operational", detail: `Round-trip OK — feed version ${feedVersion ?? 0}` };
}

async function fetchReachable(url: string, timeoutMs = PROBE_TIMEOUT): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ConnectPlus-Status/1.0)", Range: "bytes=0-1" },
    });
    // Cancel the body immediately — live streams never "end".
    res.body?.cancel().catch(() => {});
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function checkRadio(): Promise<{ status: ServiceStatus; detail: string }> {
  const sampleIds = ["capital-fm", "kiss-100", "radio-maisha", "clouds-fm", "radio-rwanda"];
  const samples = sampleIds
    .map((id) => STATIONS.find((s) => s.id === id))
    .filter((s): s is (typeof STATIONS)[number] => Boolean(s));
  const results = await Promise.all(samples.map((s) => fetchReachable(s.streamUrl)));
  const reachable = results.filter(Boolean).length;
  if (reachable === samples.length) {
    return { status: "operational", detail: `${reachable}/${samples.length} sampled upstreams reachable` };
  }
  if (reachable > 0) {
    return { status: "degraded", detail: `${reachable}/${samples.length} sampled upstreams reachable` };
  }
  return { status: "down", detail: "No sampled upstreams reachable" };
}

async function checkForex(): Promise<{ status: ServiceStatus; detail: string }> {
  const started = Date.now();
  const reachable = await fetchReachable("https://open.er-api.com/v6/latest/USD");
  if (!reachable) {
    const cached = await cacheGet<{ updatedAt: string }>("forex:latest").catch(() => null);
    if (cached) {
      return { status: "degraded", detail: `Upstream unreachable — serving cached rates` };
    }
    return { status: "down", detail: "Upstream unreachable and no cached rates" };
  }
  return { status: "operational", detail: `Upstream reachable (${Date.now() - started}ms)` };
}

async function checkWeather(): Promise<{ status: ServiceStatus; detail: string }> {
  const started = Date.now();
  const ok = await fetchReachable(
    "https://api.open-meteo.com/v1/forecast?latitude=-1.2864&longitude=36.8172&current=temperature_2m"
  );
  if (!ok) return { status: "down", detail: "Open-Meteo unreachable" };
  return { status: "operational", detail: `Open-Meteo reachable (${Date.now() - started}ms)` };
}

export function checkInngest(): { status: ServiceStatus; detail: string } {
  const eventKey = Boolean(process.env.INNGEST_EVENT_KEY);
  const signKey = Boolean(process.env.INNGEST_SIGN_KEY ?? process.env.INNGEST_SIGNING_KEY);
  if (eventKey && signKey) {
    return { status: "operational", detail: "Cloud queue active — event + signing keys configured" };
  }
  if (eventKey || signKey) {
    return { status: "degraded", detail: "Partially configured — missing one of event/signing keys" };
  }
  return { status: "unconfigured", detail: "Keys not set — jobs fall back to inline execution" };
}

/* ------------------------------------------------------------------ */
/* Parallel run + 90-day history                                       */
/* ------------------------------------------------------------------ */

export async function runChecks(): Promise<Omit<StatusResponse, "crons" | "history">> {
  const [database, redis, radio, forex, weather] = await Promise.all([
    wrap("database", checkDatabase),
    wrap("redis", checkRedis),
    wrap("radio", checkRadio),
    wrap("forex", checkForex),
    wrap("weather", checkWeather),
  ]);
  const inngest = { ...serviceBase("inngest"), ...checkInngest(), latencyMs: null as number | null };
  const services = [database, redis, radio, forex, weather, inngest];

  const criticalDown = services.some((s) => s.critical && s.status === "down");
  const anyDown = services.some((s) => s.status === "down");
  const anyDegraded = services.some((s) => s.status === "degraded");
  const overall: StatusResponse["overall"] = criticalDown ? "down" : anyDown || anyDegraded ? "degraded" : "operational";

  return { overall, checkedAt: new Date().toISOString(), services };
}

async function wrap(
  id: string,
  fn: () => Promise<{ status: ServiceStatus; detail: string }>
): Promise<ServiceCheck> {
  const started = Date.now();
  try {
    const result = await fn();
    return { ...serviceBase(id), ...result, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      ...serviceBase(id),
      status: "down",
      detail: e instanceof Error ? e.message.slice(0, 120) : "Check failed",
      latencyMs: Date.now() - started,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Uptime history (Redis-backed, worst-of-day)                         */
/* ------------------------------------------------------------------ */

const HISTORY_DAYS = 90;
const HISTORY_KEY = "status:history";
const HISTORY_TTL = 95 * 24 * 60 * 60; // just over the window

const STATUS_LEVEL: Record<ServiceStatus, 0 | 1 | 2> = {
  operational: 0,
  degraded: 1,
  down: 2,
  unconfigured: 0,
};

/**
 * Record today's worst status per service in a Redis hash, then return the
 * 90-day series. Uses HSET status:history → field `<date>:<serviceId>` with
 * the numeric level; today's entry is only overwritten when it gets worse,
 * so the day reflects its worst observed state.
 */
export async function recordAndReadHistory(
  services: ServiceCheck[]
): Promise<Record<string, DayStatus[]>> {
  const today = new Date().toISOString().slice(0, 10);
  const history: Record<string, DayStatus[]> = {};
  for (const s of services) history[s.id] = [];

  // Without Redis we can't persist; return empty series (page hides bars).
  if (!redisAvailable()) return history;

  try {
    // Read the whole hash once.
    const rawAll = await redisGetRaw(`${HISTORY_KEY}:all`);
    const all: Record<string, number> = rawAll ? JSON.parse(rawAll) : {};

    for (const s of services) {
      const level = STATUS_LEVEL[s.status];
      const field = `${today}:${s.id}`;
      const prev = all[field];
      // Only escalate (0 → 1 → 2); a good probe never erases a bad one.
      if (prev === undefined || level > prev) {
        all[field] = level;
        // Re-write only when changed to keep the write volume near zero.
        await redisSetEx(`${HISTORY_KEY}:all`, HISTORY_TTL, JSON.stringify(all));
      }
    }

    // Assemble per-service 90-day series (oldest → newest).
    const dates: string[] = [];
    const now = new Date();
    for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    for (const s of services) {
      history[s.id] = dates.map((date) => {
        const level = all[`${date}:${s.id}`];
        const worst: DayStatus["worst"] =
          level === 2 ? "down" : level === 1 ? "degraded" : level === 0 ? "operational" : "nodata";
        return {
          date,
          level: (level === undefined ? 0 : level) as 0 | 1 | 2,
          worst,
          ...(level === undefined ? { nodata: true as const } : {}),
        };
      });
    }
  } catch {
    // History is best-effort; never fail the status endpoint over it.
  }

  return history;
}

/* ------------------------------------------------------------------ */
/* Inngest cron last-run times (Management API, read-only)             */
/* ------------------------------------------------------------------ */

interface InngestFunctionRun {
  id: string;
  startedAt?: string;
  status?: string;
}

/**
 * Query Inngest's Management API for the latest run of each watched cron.
 * Returns empty array when INNGEST_MANAGEMENT_KEY is unset or the API is
 * unreachable — the UI hides the section rather than failing the page.
 */
export async function fetchCronRuns(): Promise<CronRun[]> {
  const mgmtKey = process.env.INNGEST_MANAGEMENT_KEY;
  const envId = process.env.INNGEST_ENV_ID ?? "prod";
  if (!mgmtKey) return [];

  const watched = [
    { fnId: "radio-status-sweep", name: "Radio metadata sweep" },
    { fnId: "rss-poll", name: "RSS poll" },
  ];

  const results: CronRun[] = [];
  for (const w of watched) {
    try {
      const res = await fetch(
        `https://api.inngest.com/v1/apps/connectplus/functions/${w.fnId}/runs?limit=1`,
        {
          signal: AbortSignal.timeout(6000),
          headers: { Authorization: `Bearer ${mgmtKey}`, Accept: "application/json" },
        }
      );
      if (!res.ok) {
        results.push({ id: w.fnId, name: w.name, lastRun: null, state: null });
        continue;
      }
      const body = (await res.json()) as { data?: InngestFunctionRun[] };
      const run = body.data?.[0];
      results.push({
        id: w.fnId,
        name: w.name,
        lastRun: run?.startedAt ?? null,
        state: (run?.status as CronRun["state"]) ?? null,
      });
    } catch {
      results.push({ id: w.fnId, name: w.name, lastRun: null, state: null });
    }
  }
  return results;
}