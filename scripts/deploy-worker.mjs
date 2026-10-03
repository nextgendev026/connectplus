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
 *   CLOUDFLARE_KV_NAMESPACE_ID=...    bind an existing KV namespace instead of
 *                                     resolving one (see the SNAPSHOTS binding)
 *   KV_NAMESPACE_TITLE=...            the namespace to reuse or create
 *   KV_BINDING=off                    deploy without the KV binding
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
// The origin the edge worker fronts. This is now the Cloudflare-hosted Next app
// (`connectplus-app`), not Vercel — the Vercel deployment is paused and no
// longer in the request path. Override with ORIGIN=... when pointing at a
// preview or a rollback deployment.
const ORIGIN = process.env.ORIGIN ?? "https://connectplus-app.connectplusapp.workers.dev";
const CRON_SECRET = (process.env.CRON_SECRET ?? "").trim();
// Where the worker's high-frequency durable records go, because the KV write
// allowance is not the right budget for them. Derived from ORIGIN by default:
// forgetting the variable on a redeploy would silently put the tick ledger
// (~1,150 writes/day) back over Cloudflare's 1,000/day ceiling, and a wrong
// URL is harmless anyway — every write falls back to KV when the remote tier
// refuses, which is exactly the behaviour of an unset variable. Set
// REMOTE_KV_URL=off to pin a deployment to KV only.
const RAW_REMOTE_KV = (process.env.REMOTE_KV_URL ?? "").trim().replace(/\/+$/, "");
const REMOTE_KV_URL = RAW_REMOTE_KV === "off" ? "" : RAW_REMOTE_KV || `${ORIGIN}/api/edge/kv`;
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

/**
 * Cloudflare's free plan allows FIVE Cron Triggers per Worker.
 *
 * This list used to have six, the extra one being a second six-hourly slot for
 * `thumbnail-recovery`. The API rejects the whole upload when the limit is
 * exceeded. The old code printed the error and carried on, so the sixth trigger
 * was simply never registered and nothing said so. The tell was in production:
 * `thumbnail-recovery` had heartbeats from other schedulers and none matching
 * its own cron.
 *
 * Low-frequency jobs no longer need a trigger of their own. The `due-sweep` on
 * the fifteen-minute slot asks the app to run whatever its registry says is
 * overdue, which covers `thumbnail-recovery` and the four jobs that had never
 * run at all — for one trigger instead of six.
 *
 * (In a block comment, never write a cron expression whose minute field is a
 * wildcard: the two characters that end this comment appear inside it.)
 */
const CRON_TRIGGER_LIMIT_FREE = 5;

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

/**
 * The worker's durable snapshot store, as a KV binding.
 *
 * The Cache API is per-colo, so a snapshot warmed by a reader in one data
 * centre was invisible to the cron tick running in another. KV gives the worker
 * one globally readable copy (and one place to record what the last tick did),
 * which is what lets the tick skip a rebuild it does not need.
 *
 * The namespace is reused if it already exists, so repeat deploys do not pile up
 * empty namespaces — and if the token cannot manage KV at all, the deploy
 * continues without the binding. The worker is written to fall back to the Cache
 * API when SNAPSHOTS is absent, so this is a capability question, not a hard
 * dependency.
 */
const KV_TITLE = process.env.KV_NAMESPACE_TITLE ?? `${NAME}-snapshots`;
const KV_OFF = process.env.KV_BINDING === "off";

async function resolveKvNamespace() {
  if (KV_OFF) return "";
  const provided = (process.env.CLOUDFLARE_KV_NAMESPACE_ID ?? "").trim();
  if (provided) {
    console.log("kv:", `using the namespace id from the environment (${provided})`);
    return provided;
  }

  const listed = await api(`/accounts/${ACCOUNT}/storage/kv/namespaces?per_page=100`);
  const listBody = await listed.json();
  if (listBody.success) {
    const existing = (listBody.result ?? []).find((ns) => ns.title === KV_TITLE);
    if (existing) {
      console.log("kv:", `reusing "${KV_TITLE}" (${existing.id})`);
      return existing.id;
    }
  }

  const created = await api(`/accounts/${ACCOUNT}/storage/kv/namespaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: KV_TITLE }),
  });
  const createdBody = await created.json();
  if (createdBody.success && createdBody.result?.id) {
    console.log("kv:", `created "${KV_TITLE}" (${createdBody.result.id})`);
    return createdBody.result.id;
  }

  console.log(
    "kv:",
    created.status,
    "could not resolve the namespace — deploying without the binding (the worker falls back to the Cache API):",
    JSON.stringify(createdBody.errors ?? createdBody)
  );
  return "";
}

const kvNamespaceId = await resolveKvNamespace();

/**
 * The media binding: an R2 bucket when the account has R2 enabled, otherwise
 * a dedicated KV namespace.
 *
 * Supabase free tier answers 402 `exceed_egress_quota` once its 5 GB/month of
 * image serving runs out — which takes days on a content site — and takes
 * uploads and every already-stored image down with it. R2 is the destination
 * (10 GB, zero egress, 10M ops/month), but enabling it is a dashboard click
 * this script cannot make (API error 10042). Until then the same keys live in
 * a KV namespace (1 GB, 100k reads/day) and the hand-over later is a redeploy
 * with no app-side change: the URL shape is identical.
 *
 * MEDIA_BINDING=off deploys without any media tier (the worker then answers
 * 503 on /__media and the app falls back to its next configured store).
 */
const MEDIA_BUCKET = process.env.MEDIA_R2_BUCKET ?? `${NAME}-media`;
const MEDIA_OFF = process.env.MEDIA_BINDING === "off";

async function resolveMediaBinding() {
  if (MEDIA_OFF) return null;

  // Does this account have R2 at all? The list call answers 10042 when it is
  // not enabled, which is the branch that matters.
  const listed = await api(`/accounts/${ACCOUNT}/r2/buckets`);
  const listBody = await listed.json().catch(() => ({}));
  if (listBody.success) {
    const has = (listBody.result?.buckets ?? []).some((b) => b.name === MEDIA_BUCKET);
    if (!has) {
      const created = await api(`/accounts/${ACCOUNT}/r2/buckets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: MEDIA_BUCKET }),
      });
      const createdBody = await created.json().catch(() => ({}));
      if (!createdBody.success && created.status !== 409) {
        console.log("media:", created.status, "r2 bucket create failed —", JSON.stringify(createdBody.errors ?? createdBody));
      }
    }
    console.log(`media: r2 bucket "${MEDIA_BUCKET}" (10GB, zero egress)`);
    return { type: "r2_bucket", name: "MEDIA", bucket_name: MEDIA_BUCKET };
  }

  // R2 is not enabled (code 10042) — fall back to a KV namespace so uploads
  // work today; enable R2 in the dashboard and redeploy to switch.
  const title = `${NAME}-media`;
  const kvList = await api(`/accounts/${ACCOUNT}/storage/kv/namespaces?per_page=100`);
  const kvBody = await kvList.json().catch(() => ({}));
  let id = "";
  if (kvBody.success) {
    id = (kvBody.result ?? []).find((ns) => ns.title === title)?.id ?? "";
  }
  if (!id) {
    const created = await api(`/accounts/${ACCOUNT}/storage/kv/namespaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const createdBody = await created.json().catch(() => ({}));
    id = createdBody.success ? createdBody.result?.id ?? "" : "";
    if (!id) {
      console.log("media:", created.status, "no media tier could be created — deploying without one:", JSON.stringify(createdBody.errors ?? createdBody));
      return null;
    }
  }
  console.log(
    `media: KV namespace "${title}" (${id}) — R2 not enabled; enable it in the Cloudflare dashboard (error 10042) and redeploy to move to zero-egress R2. Note KV serves 100k reads/day and holds 1GB.`
  );
  return { type: "kv_namespace", name: "MEDIA_KV", namespace_id: id };
}

const mediaBinding = await resolveMediaBinding();

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
    ...(kvNamespaceId
      ? [{ type: "kv_namespace", name: "SNAPSHOTS", namespace_id: kvNamespaceId }]
      : []),
    // The second durable store, for the high-frequency records the KV write
    // allowance cannot afford (the tick ledger and the livescore snapshot).
    // Omitted when unset, which leaves the shard map preferring KV — the same
    // behaviour as before this existed.
    ...(REMOTE_KV_URL ? [{ type: "plain_text", name: "REMOTE_KV_URL", text: REMOTE_KV_URL }] : []),
    // The media plane: R2 (or its KV stop-gap) behind /__media.
    ...(mediaBinding ? [mediaBinding] : []),
  ],
};

if (!REMOTE_KV_URL) {
  console.log(
    "note: REMOTE_KV_URL is off — the tick ledger and livescore snapshot will keep consuming Cloudflare KV writes (~1.15k/day against a 1k/day allowance). Set REMOTE_KV_URL=https://<app>/api/edge/kv to shard them onto the app's cache tier."
  );
}

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
  // A rejected schedule list is a silent outage: the worker keeps running and
  // every job it was supposed to drive stops firing, with the only evidence a
  // line in this log. Fail the deploy instead.
  if (!schedulesBody.success) {
    throw new Error(
      `Cron Trigger upload failed (${schedules.status}): ${JSON.stringify(schedulesBody.errors)}` +
        (CRON_SCHEDULES.length > CRON_TRIGGER_LIMIT_FREE
          ? ` — ${CRON_SCHEDULES.length} triggers configured but the free plan allows ${CRON_TRIGGER_LIMIT_FREE}. Consolidate onto the due-sweep slot or upgrade the plan.`
          : "")
    );
  }
} else {
  console.log("schedules: skipped (CRON_TRIGGERS=off)");
}

const zone = await api(`/accounts/${ACCOUNT}/workers/subdomain`);
const zoneBody = await zone.json();
if (zoneBody.success && zoneBody.result?.subdomain) {
  console.log(`\nlive at: https://${NAME}.${zoneBody.result.subdomain}.workers.dev`);
  console.log(`origin : ${ORIGIN}`);
  console.log(`records: ${REMOTE_KV_URL ? `high-frequency shard → ${REMOTE_KV_URL}` : "all in Cloudflare KV (REMOTE_KV_URL unset)"}`);
  console.log(`verify : curl -sI https://${NAME}.${zoneBody.result.subdomain}.workers.dev/ | grep -i x-edge-cache`);
}
