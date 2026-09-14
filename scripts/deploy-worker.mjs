#!/usr/bin/env node
/**
 * Deploy workers/edge-cache to Cloudflare without installing wrangler.
 *
 * Uploads the module through the Workers API and enables the workers.dev
 * route, so the whole integration works from a locked-down CI box with only a
 * token in the environment.
 *
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/deploy-worker.mjs
 *
 * Optional:
 *   WORKER_NAME=connectplus-edge      override the script name
 *   ORIGIN=https://example.vercel.app override the origin the worker fronts
 *   CRON_SECRET=<same as the app>     lets the worker's Cron Triggers drive
 *                                     /api/cron (uploaded as a secret binding)
 *   CRON_TRIGGERS=off                 skip the Cron Trigger registration
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_DIR = join(ROOT, "workers", "edge-cache");
const MODULE = "index.mjs";

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const NAME = process.env.WORKER_NAME ?? "connectplus-edge";
const ORIGIN = process.env.ORIGIN ?? "https://connectplusapp.vercel.app";
const CRON_SECRET = (process.env.CRON_SECRET ?? "").trim();
const REGISTER_CRONS = process.env.CRON_TRIGGERS !== "off";

/**
 * The schedules registered on the worker. These mirror `SCHEDULES` in
 * workers/edge-cache/src/index.mjs and the job registry in
 * src/lib/cron-schedule.ts — the worker names a job, the app knows what it does.
 */
const CRON_SCHEDULES = [
  { cron: "*/2 * * * *", trigger: "sports-live" },
  { cron: "*/5 * * * *", trigger: "sports-notify" },
  { cron: "*/15 * * * *", trigger: "radio-status-sweep" },
  { cron: "*/30 * * * *", trigger: "sports-intel" },
  { cron: "30 */6 * * *", trigger: "payments-lifecycle" },
];

if (!TOKEN || !ACCOUNT) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
  process.exit(1);
}

const api = (path, init = {}) =>
  fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });

const code = readFileSync(join(WORKER_DIR, "src", MODULE), "utf8");

const metadata = {
  main_module: MODULE,
  compatibility_date: "2026-09-01",
  bindings: [
    { type: "plain_text", name: "ORIGIN", text: ORIGIN },
    // The shared secret travels as a secret binding, never as a plain var: it is
    // the credential that authorises a cron run against the origin.
    ...(CRON_SECRET
      ? [{ type: "secret_text", name: "CRON_SECRET", text: CRON_SECRET }]
      : []),
  ],
};

if (!CRON_SECRET) {
  console.log(
    "note: CRON_SECRET not set — the worker will still ping /api/cron, but the app will answer 401. Pass CRON_SECRET=... to enable the scheduled jobs."
  );
}

const form = new FormData();
form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
form.set(
  MODULE,
  new Blob([code], { type: "application/javascript+module" }),
  MODULE
);

const upload = await api(`/accounts/${ACCOUNT}/workers/scripts/${NAME}`, {
  method: "PUT",
  body: form,
});
const uploadBody = await upload.json();
console.log("upload:", upload.status, uploadBody.success ? "ok" : JSON.stringify(uploadBody.errors));
if (!uploadBody.success) process.exit(1);

// Enable the public workers.dev route.
const sub = await api(`/accounts/${ACCOUNT}/workers/scripts/${NAME}/subdomain`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ enabled: true, previews_enabled: true }),
});
const subBody = await sub.json();
console.log("subdomain:", sub.status, subBody.success ? "enabled" : JSON.stringify(subBody.errors));

/**
 * Register the Cron Triggers.
 *
 * The Workers API has no "set triggers" call — the schedule list is uploaded as
 * part of the script on the schedules endpoint, and it replaces whatever was
 * there. Sending it on every deploy is what keeps the dashboard and this script
 * from disagreeing about when the edge jobs run.
 */
if (REGISTER_CRONS) {
  const schedules = await api(`/accounts/${ACCOUNT}/workers/scripts/${NAME}/schedules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CRON_SCHEDULES.map((s) => ({ cron: s.cron }))),
  });
  const schedulesBody = await schedules.json();
  console.log(
    "schedules:",
    schedules.status,
    schedulesBody.success
      ? CRON_SCHEDULES.map((s) => `${s.cron} → ${s.trigger}`).join(", ")
      : JSON.stringify(schedulesBody.errors)
  );
} else {
  console.log("schedules: skipped (CRON_TRIGGERS=off)");
}

const zone = await api(`/accounts/${ACCOUNT}/workers/subdomain`);
const zoneBody = await zone.json();
if (zoneBody.success && zoneBody.result?.subdomain) {
  console.log(`\nlive at: https://${NAME}.${zoneBody.result.subdomain}.workers.dev`);
  console.log(`origin : ${ORIGIN}`);
  console.log(`verify : curl -sI https://${NAME}.${zoneBody.result.subdomain}.workers.dev/ | grep -i x-edge-cache`);
}
