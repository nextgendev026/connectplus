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
  bindings: [{ type: "plain_text", name: "ORIGIN", text: ORIGIN }],
};

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

const zone = await api(`/accounts/${ACCOUNT}/workers/subdomain`);
const zoneBody = await zone.json();
if (zoneBody.success && zoneBody.result?.subdomain) {
  console.log(`\nlive at: https://${NAME}.${zoneBody.result.subdomain}.workers.dev`);
  console.log(`origin : ${ORIGIN}`);
  console.log(`verify : curl -sI https://${NAME}.${zoneBody.result.subdomain}.workers.dev/ | grep -i x-edge-cache`);
}
