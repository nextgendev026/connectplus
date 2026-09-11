#!/usr/bin/env node
/**
 * cron-job.org scheduler sync.
 *
 * Registers (or updates) the heavy ConnectPlus jobs on cron-job.org so the
 * platform keeps running its nightlies and watchers without Vercel Cron or
 * Inngest Cloud. Idempotent: existing jobs are matched by title and patched.
 *
 * Secrets come from the environment (or a local .env file, never committed):
 *   CRONJOB_TOKEN  - cron-job.org API key (Settings -> API key)
 *   CRON_SECRET    - shared secret the /api/cron endpoint verifies
 *   APP_URL        - base URL of the deployment (default: connectplusapp.vercel.app)
 *
 * Usage:
 *   node scripts/cronjob-sync.mjs            upsert all jobs
 *   node scripts/cronjob-sync.mjs --list     list existing jobs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = "https://api.cron-job.org";
const TIMEZONE = "UTC";

function loadEnv() {
  const env = { ...process.env };
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in env)) env[key] = value;
    }
  } catch {
    // no .env file — rely on process env
  }
  return env;
}

const env = loadEnv();
const token = env.CRONJOB_TOKEN;
const secret = env.CRON_SECRET ?? "";
const appUrl = (env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? "https://connectplusapp.vercel.app").replace(/\/+$/, "");

if (!token) {
  console.error("CRONJOB_TOKEN is not set (put it in .env or the environment).");
  process.exit(1);
}

const ALL = [-1];
const every = (step) => Array.from({ length: Math.floor(60 / step) }, (_, i) => i * step);

/** One entry per heavy job. Trigger names must match /api/cron. */
const JOBS = [
  { title: "connectPlus — publish scheduled stories", trigger: "publish-scheduled", minutes: every(5) },
  { title: "connectPlus — status watchdog", trigger: "status-watchdog", minutes: every(5) },
  { title: "connectPlus — radio status sweep", trigger: "radio-sweep", minutes: every(15) },
  { title: "connectPlus — RSS poll", trigger: "rss-poll", minutes: [0] },
  { title: "connectPlus — recover thumbnails", trigger: "recover-thumbnails", hours: [0, 6, 12, 18], minutes: [0] },
  { title: "connectPlus — hive sweep", trigger: "hive-sweep", hours: [1], minutes: [0] },
  { title: "connectPlus — embed posts", trigger: "embed-posts", hours: [3], minutes: [0] },
];

function jobPayload(title, trigger, schedule) {
  return {
    enabled: true,
    saveResponses: true,
    title,
    url: `${appUrl}/api/cron?trigger=${trigger}`,
    requestMethod: 0, // GET
    requestTimeout: 280,
    schedule: {
      timezone: TIMEZONE,
      expiresAt: 0,
      hours: schedule.hours ?? ALL,
      mdays: ALL,
      minutes: schedule.minutes ?? ALL,
      months: ALL,
      wdays: ALL,
    },
    extendedData: secret ? { headers: { "x-cron-secret": secret } } : undefined,
  };
}

async function api(method, pathname, body) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`cron-job.org rejected the API key (HTTP ${res.status}).`, { cause: res });
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`cron-job.org ${method} ${pathname} failed: HTTP ${res.status} ${text}`, {
      cause: res,
    });
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// cron-job.org throttles bursts (HTTP 429). Retry with backoff and respect a
// Retry-After hint if the API sends one.
async function apiWithRetry(method, pathname, body, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await api(method, pathname, body);
    } catch (err) {
      const is429 = err.message.includes("HTTP 429");
      if (!is429 || attempt === attempts) throw err;
      const retryAfter = Number(err.cause?.headers?.get?.("retry-after"));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 1000 * 2 ** attempt;
      console.warn(`[retry]  ${pathname} (attempt ${attempt}) HTTP 429 — waiting ${wait}ms`);
      await sleep(wait);
    }
  }
}

async function listJobs() {
  const data = await api("GET", "/jobs");
  return data.jobs ?? [];
}

async function upsertJobs() {
  const existing = await listJobs();
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const job of JOBS) {
    const payload = jobPayload(job.title, job.trigger, job);
    const found = existing.find((j) => j.title === job.title);
    try {
      if (found) {
        await apiWithRetry("PATCH", `/jobs/${found.jobId}`, { job: payload });
        console.log(`[updated] ${job.title} -> ${payload.url} (job #${found.jobId})`);
        updated++;
      } else {
        const res = await apiWithRetry("PUT", "/jobs", { job: payload });
        console.log(`[created] ${job.title} -> ${payload.url} (job #${res.jobId})`);
        created++;
      }
    } catch (err) {
      failed++;
      console.error(`[failed]  ${job.title}: ${err.message}`);
    }
    // PUT is rate limited to 1 req/s — pace ourselves.
    await sleep(1200);
  }

  console.log(`\nDone: ${created} created, ${updated} updated, ${failed} failed (${JOBS.length} total).`);
  console.log(`Scheduler: ${appUrl}/api/cron (timezone ${TIMEZONE}).`);
}

async function main() {
  const flag = process.argv[2];
  if (flag === "--list") {
    const jobs = await listJobs();
    console.log(`${jobs.length} job(s) in the account:`);
    for (const j of jobs) {
      console.log(`  #${j.jobId}  ${j.enabled ? "on " : "off"}  ${j.title || "(untitled)"}  ${j.url}`);
    }
    return;
  }
  await upsertJobs();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});