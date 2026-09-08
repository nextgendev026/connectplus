import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redisAvailable, redisSetEx, redisGetRaw, cacheGet } from "@/lib/redis";
import { STATIONS } from "@/lib/radio-stations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ServiceStatus = "operational" | "degraded" | "down" | "unconfigured";

interface ServiceCheck {
  id: string;
  name: string;
  description: string;
  status: ServiceStatus;
  latencyMs: number | null;
  detail: string;
  critical?: boolean;
}

interface StatusResponse {
  overall: "operational" | "degraded" | "down";
  checkedAt: string;
  services: ServiceCheck[];
}

const PROBE_TIMEOUT = 6_000;

/** Small in-memory cache so multiple open tabs share one probe round. */
const CACHE_MS = 15_000;
let memo: { expiresAt: number; data: StatusResponse } | null = null;

async function timed(name: string, fn: () => Promise<{ status: ServiceStatus; detail: string }>): Promise<ServiceCheck> {
  const started = Date.now();
  try {
    const result = await fn();
    return { ...base(name), ...result, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      ...base(name),
      status: "down",
      detail: e instanceof Error ? e.message.slice(0, 120) : "Check failed",
      latencyMs: Date.now() - started,
    };
  }
}

function base(name: string) {
  const meta: Record<string, { id: string; name: string; description: string; critical?: boolean }> = {
    database: { id: "database", name: "Database", description: "Supabase Postgres — stories, users, engagement", critical: true },
    redis: { id: "redis", name: "Redis Cache", description: "Redis Cloud — feed cache, forex baseline, radio metadata" },
    radio: { id: "radio", name: "Radio Streams", description: "Upstream station audio reachability" },
    forex: { id: "forex", name: "Forex Rates", description: "open.er-api.com — daily reference rates" },
    weather: { id: "weather", name: "Weather Service", description: "Open-Meteo — forecasts and GPS weather" },
    inngest: { id: "inngest", name: "Background Jobs", description: "Inngest — cron sweeps, scheduled publishing, RSS polling" },
  };
  return meta[name] ?? { id: name, name, description: "" };
}

async function checkDatabase(): Promise<{ status: ServiceStatus; detail: string }> {
  await prisma.$queryRaw`SELECT 1`;
  const count = await prisma.post.count({ where: { status: "PUBLISHED" } });
  return { status: "operational", detail: `Connected — ${count.toLocaleString()} published stories` };
}

async function checkRedis(): Promise<{ status: ServiceStatus; detail: string }> {
  if (!redisAvailable()) {
    return { status: "unconfigured", detail: "REDIS_URL not set — caches bypassed, direct DB reads" };
  }
  const probeKey = `status:probe:${Date.now()}`;
  await redisSetEx(probeKey, 10, "ok");
  const roundtrip = await redisGetRaw(probeKey);
  if (roundtrip !== "ok") {
    return { status: "down", detail: "Probe write/read failed" };
  }
  // Bonus visibility: how many station metadata entries are warm.
  const statusKeys = await cacheGet<number>("feed:version").catch(() => null);
  return {
    status: "operational",
    detail: `Round-trip OK — feed version ${statusKeys ?? 0}`,
  };
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
  // Probe a geographic spread of stations rather than all 35 (fast + representative).
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
      return { status: "degraded", detail: `Upstream unreachable — serving cached rates from ${new Date(cached.updatedAt).toISOString().slice(11, 16)} UTC` };
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

function checkInngest(): { status: ServiceStatus; detail: string } {
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

async function runChecks(): Promise<StatusResponse> {
  const [database, redis, radio, forex, weather] = await Promise.all([
    timed("database", checkDatabase),
    timed("redis", checkRedis),
    timed("radio", checkRadio),
    timed("forex", checkForex),
    timed("weather", checkWeather),
  ]);
  const inngest = { ...base("inngest"), ...checkInngest(), latencyMs: null };

  const services = [database, redis, radio, forex, weather, inngest];

  const criticalDown = services.some((s) => s.critical && s.status === "down");
  const anyDown = services.some((s) => s.status === "down");
  const anyDegraded = services.some((s) => s.status === "degraded");

  const overall: StatusResponse["overall"] = criticalDown
    ? "down"
    : anyDown || anyDegraded
      ? "degraded"
      : "operational";

  return { overall, checkedAt: new Date().toISOString(), services };
}

export async function GET() {
  if (memo && memo.expiresAt > Date.now()) {
    return NextResponse.json(memo.data);
  }
  const data = await runChecks();
  memo = { expiresAt: Date.now() + CACHE_MS, data };
  return NextResponse.json(data);
}