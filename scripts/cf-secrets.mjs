#!/usr/bin/env node
/**
 * Furnish the Cloudflare app Worker with the environment Vercel used to hold.
 *
 * Cloudflare secrets are write-only: the API stores them, the Worker reads them
 * as bindings, and nobody — including this script — can read them back. That is
 * why the source of truth for the values stays the local `.env` (and the
 * dashboards that issued them), and this script only pushes.
 *
 *   node --env-file=.env scripts/cf-secrets.mjs
 *
 * Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, and the Worker
 * (`connectplus-app` by default) to have been deployed at least once — the
 * secrets endpoint is scoped to an existing script. Order on a fresh setup is
 * therefore: `npm run cf:deploy` once, then this, then redeploy (or not — a
 * secret takes effect on the next request without a redeploy).
 *
 * Values not present in the environment are reported and skipped, so this is
 * safe to run on a machine that only holds a subset of the keys.
 */
const TOKEN = (process.env.CLOUDFLARE_API_TOKEN ?? "").trim();
const ACCOUNT = (process.env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
const WORKER = (process.env.WORKER_NAME ?? "connectplus-app").trim();
const DRY = process.argv.includes("--dry-run");

if (!TOKEN || !ACCOUNT) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.");
  process.exit(1);
}

/**
 * Everything the app reads at runtime that is not safe to put in `[vars]`.
 * Grouped by subsystem so a missing group is obvious in the output.
 */
const SECRETS = [
  // Database
  "DATABASE_URL",
  "DIRECT_URL",
  "LEGACY_DATABASE_URL",
  // Auth + session signing
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  // TOTP: seals the stored MFA secrets at rest (falls back to NEXTAUTH_SECRET)
  "MFA_ENCRYPTION_KEY",
  // Internal cron + edge media plane
  "CRON_SECRET",
  // Media storage (legacy path; the edge plane is preferred)
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "EDGE_URL",
  // Model gateway
  "OPENROUTER_API_KEY",
  "OPENCODE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  // Push
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  // Distributed cache / rate limiting
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  // Error tracking
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  // Convex offload
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_DEPLOY_KEY",
  // Payments
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "DARAJAPAY_CONSUMER_KEY",
  "DARAJAPAY_CONSUMER_SECRET",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  // Inngest (the scheduler that now owns every cadence off Vercel)
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  // Optional edge image resizing
  "NEXT_PUBLIC_IMAGE_RESIZE_ORIGIN",
];

const api = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${WORKER}/secrets`;

async function putSecret(name, text) {
  const res = await fetch(api, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, text, type: "secret_text" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    const detail = body?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(detail);
  }
}

let pushed = 0;
const skipped = [];
const failed = [];

for (const name of SECRETS) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    skipped.push(name);
    continue;
  }
  if (DRY) {
    console.log(`[dry-run] would set ${name} (${String(value).length} chars)`);
    pushed += 1;
    continue;
  }
  try {
    await putSecret(name, value);
    console.log(`✓ ${name}`);
    pushed += 1;
  } catch (err) {
    failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`✗ ${name} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("\n── Cloudflare secret sync ───────────────────────");
console.log(`worker   : ${WORKER}`);
console.log(`pushed   : ${pushed}${DRY ? " (dry run)" : ""}`);
console.log(`skipped  : ${skipped.length}${skipped.length ? ` (${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? ", …" : ""})` : ""}`);
console.log(`failed   : ${failed.length}`);

if (failed.length) {
  console.error("\nFailed secrets are usually one of: the Worker has not been deployed yet,");
  console.error("the token lacks 'Workers Scripts: Edit', or the value is empty in .env.");
  process.exit(1);
}
