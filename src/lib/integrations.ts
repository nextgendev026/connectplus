import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { runChecks, type ServiceCheck } from "@/lib/status";
import { getCronStatus, type CronJobStatus } from "@/lib/cron-schedule";
import { heartbeatLedger } from "@/lib/job-heartbeat";
import { convexHealth, convexUrl, convexUrlSource } from "@/lib/convex";
import { cacheProbe } from "@/lib/redis";

/**
 * Integration registry for the admin console.
 *
 * Every third-party or first-party service the platform depends on is described
 * once, here: what it is, which credentials it needs, whether those exist, and
 * a live probe where a cheap read-only one is available. The API route is a thin
 * wrapper and the page is a thin view, so adding an integration is one entry —
 * not a new page, a new endpoint and a new card that can drift apart.
 *
 * Probes are strictly read-only and timeboxed. A probe never throws: an
 * unreachable service becomes a `down`/`degraded` status with the reason
 * attached, because the whole point of this page is to survive the outage it
 * is reporting.
 */

export type IntegrationStatus = "operational" | "degraded" | "down" | "unconfigured";

export interface IntegrationField {
  label: string;
  /** Environment variable backing this field, when there is one. */
  env?: string;
  present: boolean;
  /** Masked or non-sensitive display value. */
  value?: string | null;
  required: boolean;
  hint?: string;
  /** True when the value is managed from the Settings console, not the env. */
  managedBySetting?: string;
}

export type IntegrationCategory =
  | "Edge & hosting"
  | "Background jobs"
  | "Data & cache"
  | "Storage"
  | "Payments"
  | "Messaging"
  | "AI"
  | "Content"
  | "Monitoring"
  | "App";

export interface Integration {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  status: IntegrationStatus;
  detail: string;
  latencyMs: number | null;
  fields: IntegrationField[];
  links: { label: string; href: string }[];
  notes?: string;
  /** Wiring verdict for the "is it properly connected?" question. */
  verdict: "healthy" | "attention" | "action-required" | "optional";
}

export interface IntegrationsReport {
  generatedAt: string;
  summary: {
    total: number;
    operational: number;
    degraded: number;
    down: number;
    unconfigured: number;
    actionRequired: number;
  };
  integrations: Integration[];
  crons: CronJobStatus[];
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const env = (name: string) => (process.env[name] ?? "").trim();
const has = (name: string) => env(name).length > 0;

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

function field(
  label: string,
  envName: string,
  opts: { required?: boolean; hint?: string; secret?: boolean } = {}
): IntegrationField {
  const raw = env(envName);
  return {
    label,
    env: envName,
    present: raw.length > 0,
    value: raw ? (opts.secret ? maskValue(raw) : raw) : null,
    required: opts.required ?? true,
    hint: opts.hint,
  };
}

interface ProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
  body?: unknown;
  ms: number;
}

async function probe(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<ProbeResult> {
  const started = Date.now();
  const { timeoutMs = 6000, ...rest } = init;
  try {
    const res = await fetch(url, {
      ...rest,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body, ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  }
}

/** Map a status-page service probe into the integration shape. */
function fromService(
  svc: ServiceCheck | undefined,
  fallbackDetail: string
): { status: IntegrationStatus; detail: string; latencyMs: number | null } {
  if (!svc) return { status: "unconfigured", detail: fallbackDetail, latencyMs: null };
  return { status: svc.status, detail: svc.detail, latencyMs: svc.latencyMs };
}

function verdictFor(status: IntegrationStatus, requiredConfigured = true): Integration["verdict"] {
  if (status === "down") return "action-required";
  if (status === "degraded") return "attention";
  if (status === "unconfigured") return requiredConfigured ? "action-required" : "optional";
  return "healthy";
}

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */

export async function getIntegrations(): Promise<IntegrationsReport> {
  // One parallel sweep: the status probes (database, redis, radio, upstreams,
  // edge), the cron heartbeat ledger, the settings map and the feed counts.
  const [checks, crons, settings, feedStats] = await Promise.all([
    runChecks().catch(() => null),
    getCronStatus().catch(() => [] as CronJobStatus[]),
    getSettings(false).catch(() => ({}) as Record<string, string>),
    Promise.all([
      prisma.rssFeed.count({ where: { isActive: true } }).catch(() => 0),
      prisma.rssFeed
        .findFirst({ where: { isActive: true }, orderBy: { lastPolled: "desc" }, select: { lastPolled: true } })
        .catch(() => null),
    ]),
  ]);

  const [activeFeeds, newestPoll] = feedStats;
  const svc = (id: string) => checks?.services.find((s) => s.id === id);
  const integrations: Integration[] = [];

  /* ── Cloudflare edge cache ─────────────────────────────────────── */
  {
    const edgeSetting = settings.edgeUrl?.trim();
    const envEdge = env("EDGE_URL");
    const resolved = (envEdge || edgeSetting || "").replace(/\/+$/, "");
    const svcEdge = svc("edge");

    let status: IntegrationStatus = svcEdge?.status ?? "unconfigured";
    let detail = svcEdge?.detail ?? "Not configured";
    let latencyMs = svcEdge?.latencyMs ?? null;

    // Prefer the status-page probe; if it never ran, probe /__edge directly so
    // the console still reports the true state.
    if (!svcEdge && resolved) {
      const r = await probe(`${resolved}/__edge`, { timeoutMs: 5000 });
      status = r.ok ? "operational" : "down";
      latencyMs = r.ms;
      detail = r.ok
        ? `Worker answering (${r.ms}ms) → origin ${(r.body as { origin?: string } | null)?.origin ?? "unknown"}`
        : `Worker unreachable${r.error ? `: ${r.error}` : ` (HTTP ${r.status})`}`;
    }

    integrations.push({
      id: "cloudflare-edge",
      name: "Cloudflare edge cache",
      category: "Edge & hosting",
      description:
        "Worker that fronts the Vercel origin and answers anonymous HTML, API and image requests from Cloudflare's cache.",
      status,
      detail,
      latencyMs,
      verdict: verdictFor(status, false),
      fields: [
        {
          label: "Edge URL",
          env: "EDGE_URL",
          present: Boolean(resolved),
          value: resolved || null,
          required: false,
          hint: envEdge
            ? "Set from the deployment environment."
            : "Falling back to the admin-managed setting — set EDGE_URL in Vercel to pin it per environment.",
          managedBySetting: "edgeUrl",
        },
        field("API token", "CLOUDFLARE_API_TOKEN", {
          required: false,
          secret: true,
          hint: "Only needed to deploy the worker from CI.",
        }),
        field("Account ID", "CLOUDFLARE_ACCOUNT_ID", { required: false }),
      ],
      links: [
        { label: "Cloudflare dashboard", href: "https://dash.cloudflare.com/" },
        { label: "Worker source", href: "https://github.com/connectplus/connectplus" },
      ],
      notes:
        "Deploy with `npm run` → scripts/deploy-worker.mjs. The worker only ever caches anonymous responses — any Cookie or Authorization header is passed straight through.",
    });
  }

  /* ── Inngest ────────────────────────────────────────────────────── */
  {
    const svcInngest = svc("inngest");
    const staleJobs = crons.filter((c) => c.stale && c.essential);
    const neverRun = crons.filter((c) => !c.lastRun);
    let status: IntegrationStatus = svcInngest?.status ?? "unconfigured";
    let detail = svcInngest?.detail ?? "Not configured";

    // Staleness is only evidence when the ledger that records it is readable.
    // With both tiers down every job reads back as "never ran", which used to
    // report Inngest as degraded and send an operator chasing the queue while
    // the real fault was the cache. Say which one it is.
    const ledger = heartbeatLedger();
    if (ledger === "unavailable" && status === "operational") {
      status = "degraded";
      detail =
        "Run history is unavailable — neither Redis nor the database could be read, so job staleness cannot be judged. Check Redis credentials first.";
    } else if (status === "operational" && staleJobs.length > 0) {
      status = "degraded";
      detail = `${staleJobs.length} essential job${staleJobs.length === 1 ? "" : "s"} past due — ${staleJobs
        .map((j) => j.name)
        .join(", ")}`;
    } else if (status === "operational" && neverRun.length === crons.length && crons.length > 0) {
      detail = "Keys configured — no run has been recorded yet (cron app may not be synced)";
    } else if (status === "operational") {
      detail = `Keys configured — ${crons.length - neverRun.length}/${crons.length} jobs reporting${
        ledger === "database" ? " (ledger on Postgres fallback)" : ""
      }`;
    }

    integrations.push({
      id: "inngest",
      name: "Inngest background jobs",
      category: "Background jobs",
      description:
        "Owns every recurring job: RSS syndication, scheduled publishing, nightly brain training, radio metadata, thumbnail recovery and the status watchdog.",
      status,
      detail,
      latencyMs: null,
      verdict: verdictFor(status),
      fields: [
        field("Event key", "INNGEST_EVENT_KEY"),
        field("Signing key", "INNGEST_SIGN_KEY", {
          hint: "Falls back to INNGEST_SIGNING_KEY when unset.",
        }),
        {
          label: "Signing key (alt)",
          env: "INNGEST_SIGNING_KEY",
          present: has("INNGEST_SIGNING_KEY"),
          required: false,
        },
        field("Management key", "INNGEST_MANAGEMENT_KEY", {
          required: false,
          secret: true,
          hint: "Optional — enables run history from Inngest's API.",
        }),
      ],
      links: [
        { label: "Inngest dashboard", href: "https://app.inngest.com/" },
        { label: "Runs", href: "https://app.inngest.com/env/prod/functions" },
      ],
      notes:
        "Cron triggers live in src/inngest/functions.ts and mirror src/lib/cron-schedule.ts. If the app is not synced, the daily Vercel safety net runs the essential jobs instead.",
    });
  }

  /* ── Database ───────────────────────────────────────────────────── */
  {
    const m = fromService(svc("database"), "Not probed");
    integrations.push({
      id: "database",
      name: "Postgres (Supabase)",
      category: "Data & cache",
      description:
        "Primary datastore — stories, users, engagement, feeds, settings and subscriptions. Pooled for runtime, direct for migrations.",
      status: m.status,
      detail: m.detail,
      latencyMs: m.latencyMs,
      verdict: verdictFor(m.status),
      fields: [
        field("Pooled URL", "DATABASE_URL", { secret: true }),
        field("Direct URL", "DIRECT_URL", {
          required: false,
          secret: true,
          hint: "Used by prisma migrate deploy on builds.",
        }),
      ],
      links: [{ label: "Supabase dashboard", href: "https://supabase.com/dashboard" }],
    });
  }

  /* ── Redis ──────────────────────────────────────────────────────── */
  {
    const m = fromService(svc("redis"), "Not probed");
    integrations.push({
      id: "redis",
      name: "Redis cache",
      category: "Data & cache",
      description:
        "Feed cache, settings cache, forex baseline, radio metadata, cron heartbeats and rate limits. Degrades to in-memory when absent.",
      status: m.status,
      detail: m.detail,
      latencyMs: m.latencyMs,
      verdict: verdictFor(m.status, false),
      fields: [
        field("Connection URL", "REDIS_URL", {
          required: false,
          secret: true,
          hint: "Or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN / KV_URL.",
        }),
        field("Upstash REST URL", "UPSTASH_REDIS_REST_URL", { required: false }),
        field("Upstash REST token", "UPSTASH_REDIS_REST_TOKEN", { required: false, secret: true }),
        field("KV URL", "KV_URL", { required: false, secret: true }),
      ],
      links: [],
      notes: "Without Redis the platform still runs: caches fall back to memory and cron heartbeats are skipped.",
    });
  }

  /* ── Cache tier (Upstash KV / Vercel KV / TCP Redis) ───────────── */
  {
    const probeResult = await cacheProbe();
    const status: IntegrationStatus = probeResult.ok
      ? "operational"
      : probeResult.backend === "none"
        ? "unconfigured"
        : "degraded";

    integrations.push({
      id: "cache-tier",
      name: "Cache tier (Upstash KV / Redis)",
      category: "Data & cache",
      description:
        "Shared cache in front of Postgres: livescore snapshots, feed pages, settings, heartbeats and the model's own priors. A hit here is a query that never runs and a function invocation that never happens.",
      status,
      detail: probeResult.detail,
      latencyMs: probeResult.latencyMs,
      verdict: verdictFor(status, false),
      fields: [
        field("KV REST URL", "KV_REST_API_URL", {
          required: false,
          hint: "Injected by the Vercel × Upstash integration when the store is connected to this project.",
        }),
        field("KV REST token", "KV_REST_API_TOKEN", { required: false, secret: true }),
        field("Upstash REST URL", "UPSTASH_REDIS_REST_URL", {
          required: false,
          hint: "Accepted as an alternative to the KV_ names, so a store created straight in Upstash works too.",
        }),
        field("Upstash REST token", "UPSTASH_REDIS_REST_TOKEN", { required: false, secret: true }),
        field("TCP URL", "REDIS_URL", { required: false, secret: true }),
        field("Backend override", "CACHE_BACKEND", {
          required: false,
          hint: "auto (default) prefers the REST tier; `redis` forces the TCP client; `upstash` refuses to fall back.",
        }),
      ],
      links: [{ label: "Upstash console", href: "https://console.upstash.com/" }],
      notes:
        "The REST tier is preferred on serverless because a TCP client opens a socket per function instance — a cold start pays a handshake and a traffic spike competes for the connection limit. On Vercel: Storage → your Upstash database → Connect Project, which injects KV_REST_API_URL and KV_REST_API_TOKEN.",
    });
  }

  /* ── Convex ─────────────────────────────────────────────────────── */
  {
    // Resolve through the client layer, not `env()`, so a URL entered in the
    // admin console counts as configured. Reading the env var directly here is
    // what made the console say "not configured" while the setting it offered
    // was live.
    const url = await convexUrl();
    const source = convexUrlSource();
    let status: IntegrationStatus = "unconfigured";
    let detail =
      "Not configured — view counts stay on Postgres. Add NEXT_PUBLIC_CONVEX_URL in Vercel, or paste the deployment URL below to switch it on without a redeploy.";
    let latencyMs: number | null = null;
    if (url) {
      const r = await probe(`${url.replace(/\/+$/, "")}/version`, { timeoutMs: 5000 });
      latencyMs = r.ms;
      status = r.ok ? "operational" : "degraded";
      // Reachability is not the same as usefulness: a deployment that answers
      // /version while every query in the app throws stores nothing at all. So
      // fold in what the client layer last observed, and only claim
      // "operational" when calls are actually landing.
      const call = convexHealth();
      if (!r.ok) {
        detail = `Configured but unreachable${r.error ? `: ${r.error}` : ` (HTTP ${r.status})`} — view deltas buffer until the nightly sweep`;
      } else if (call.state === "failing") {
        status = "degraded";
        detail = `Deployment answers but queries are failing — ${call.error ?? "unknown error"}. Views and ad metrics are not being recorded.`;
      } else {
        detail = `Deployment reachable (${r.ms}ms)${
          (r.body as { version?: string } | null)?.version
            ? ` — v${(r.body as { version?: string }).version}`
            : ""
        }${call.state === "ok" ? " · queries landing" : ""}`;
      }
    }
    integrations.push({
      id: "convex",
      name: "Convex (view counts)",
      category: "Data & cache",
      description:
        "Off-Supabase write buffer for article reads; folded back into Post.viewCount by the nightly sweep.",
      status,
      detail:
        detail +
        (source === "setting"
          ? " · URL from the admin console"
          : source === "env"
            ? " · URL from NEXT_PUBLIC_CONVEX_URL"
            : ""),
      latencyMs,
      verdict: verdictFor(status, false),
      fields: [
        convexUrlSource() === "env"
          ? field("Public URL", "NEXT_PUBLIC_CONVEX_URL", { required: false })
          : {
              label: "Public URL",
              env: "NEXT_PUBLIC_CONVEX_URL",
              present: Boolean(url),
              value: url || null,
              required: false,
              managedBySetting: "convexUrl",
              hint: url
                ? "Set from the admin console — the env var is unset, so this value is what the app uses."
                : "Paste the deployment URL here (e.g. https://<deployment>.convex.cloud) to switch Convex on without a redeploy.",
            },
        field("Deploy key", "CONVEX_DEPLOY_KEY", { required: false, secret: true }),
      ],
      links: [{ label: "Convex dashboard", href: "https://dashboard.convex.dev/" }],
    });
  }

  /* ── Supabase storage ───────────────────────────────────────────── */
  {
    const url = env("SUPABASE_URL");
    const key = env("SUPABASE_SERVICE_KEY");
    const bucket = env("SUPABASE_STORAGE_BUCKET") || "uploads";
    let status: IntegrationStatus = "unconfigured";
    let detail = "Not configured — uploads fall back to the local directory";
    let latencyMs: number | null = null;

    if (url && key) {
      const r = await probe(`${url.replace(/\/+$/, "")}/storage/v1/bucket/${bucket}`, {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
        timeoutMs: 5000,
      });
      latencyMs = r.ms;
      status = r.ok ? "operational" : r.status === 404 ? "degraded" : "down";
      detail =
        r.status === 404
          ? `Bucket "${bucket}" not found on the project`
          : r.ok
            ? `Bucket "${bucket}" reachable (${r.ms}ms)`
            : `Storage unreachable${r.error ? `: ${r.error}` : ` (HTTP ${r.status})`}`;
    }

    integrations.push({
      id: "supabase-storage",
      name: "Supabase Storage",
      category: "Storage",
      description: "Cover images and uploads for the story studio.",
      status,
      detail,
      latencyMs,
      verdict: verdictFor(status, false),
      fields: [
        field("Project URL", "SUPABASE_URL"),
        field("Service key", "SUPABASE_SERVICE_KEY", { secret: true }),
        field("Bucket", "SUPABASE_STORAGE_BUCKET", { required: false }),
        field("Max upload size", "MAX_FILE_SIZE", { required: false }),
      ],
      links: [{ label: "Storage browser", href: "https://supabase.com/dashboard/project/_/storage/buckets" }],
    });
  }

  /* ── R2 (unused credentials) ────────────────────────────────────── */
  if (has("R2_ACCESS_KEY_ID") || has("R2_BUCKET") || has("R2_ACCOUNT_ID")) {
    integrations.push({
      id: "cloudflare-r2",
      name: "Cloudflare R2 (unused)",
      category: "Storage",
      description: "Object-storage credentials are present in the environment but no code path reads them.",
      status: "unconfigured",
      detail: "Credentials detected but not wired — uploads go to Supabase Storage",
      latencyMs: null,
      verdict: "attention",
      fields: [
        field("Account ID", "R2_ACCOUNT_ID", { required: false }),
        field("Bucket", "R2_BUCKET", { required: false }),
        field("Access key", "R2_ACCESS_KEY_ID", { required: false, secret: true }),
        field("Secret", "R2_SECRET_ACCESS_KEY", { required: false, secret: true }),
        field("Public base URL", "R2_PUBLIC_BASE_URL", { required: false }),
      ],
      links: [],
      notes: "Either wire R2 into the upload route or drop the variables — unused credentials are a standing risk.",
    });
  }

  /* ── Safaricom Daraja (M-Pesa) ──────────────────────────────────── */
  {
    const key = env("MPESA_CONSUMER_KEY");
    const secret = env("MPESA_CONSUMER_SECRET");
    const shortcode = env("MPESA_SHORTCODE");
    const passkey = env("MPESA_PASSKEY");
    const production = env("MPESA_ENV").toLowerCase() === "production";
    const hasAll = Boolean(key && secret && shortcode && passkey);
    const anyPresent = Boolean(key || secret || shortcode || passkey);

    let status: IntegrationStatus = hasAll ? "operational" : anyPresent ? "degraded" : "unconfigured";
    let detail = !anyPresent
      ? "Not configured — M-Pesa checkout is disabled and paid plans cannot be bought"
      : !hasAll
        ? "Partially configured — a missing shortcode or passkey makes every STK push fail"
        : production
          ? "Production credentials configured"
          : "Sandbox credentials configured — no real money moves";
    let latencyMs: number | null = null;

    if (key && secret) {
      // The OAuth exchange is the honest credential test: it proves both halves
      // of the pair, not merely that the variables are non-empty.
      const r = await probe(
        `${production ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke"}/oauth/v1/generate?grant_type=client_credentials`,
        {
          headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
          timeoutMs: 7000,
        }
      );
      latencyMs = r.ms;
      const token = (r.body as { access_token?: string } | null)?.access_token;
      if (!r.ok || !token) {
        status = "down";
        detail = `Safaricom rejected the Daraja credentials${
          r.error ? `: ${r.error}` : ` (HTTP ${r.status})`
        }`;
      } else if (!hasAll) {
        status = "degraded";
        detail = `Credentials verified (${r.ms}ms) but the ${
          !shortcode ? "shortcode" : "passkey"
        } is missing — STK pushes cannot be sent`;
      } else {
        status = "operational";
        detail = `${production ? "Production" : "Sandbox"} credentials verified (${r.ms}ms) — shortcode ${shortcode}`;
      }
    }

    integrations.push({
      id: "daraja",
      name: "Safaricom Daraja (M-Pesa)",
      category: "Payments",
      description:
        "STK-push subscriptions: the prompt lands on the member's handset and the STK result settles their plan.",
      status,
      detail,
      latencyMs,
      verdict: verdictFor(status, false),
      fields: [
        field("Consumer key", "MPESA_CONSUMER_KEY", { secret: true }),
        field("Consumer secret", "MPESA_CONSUMER_SECRET", { secret: true }),
        field("Paybill / till shortcode", "MPESA_SHORTCODE"),
        field("Lipa na M-Pesa passkey", "MPESA_PASSKEY", { secret: true }),
        field("Environment", "MPESA_ENV", {
          required: false,
          hint: '"production" for live money; anything else uses the Daraja sandbox.',
        }),
        field("Transaction type", "MPESA_TRANSACTION_TYPE", {
          required: false,
          hint: "CustomerPayBillOnline (paybill) or CustomerBuyGoodsOnline (till). Defaults to paybill.",
        }),
        field("Callback URL", "MPESA_CALLBACK_URL", {
          required: false,
          hint: "Defaults to <APP_URL>/api/payments/daraja/callback.",
        }),
        field("Callback secret", "MPESA_CALLBACK_TOKEN", {
          required: false,
          hint: "Shared secret appended to the callback URL — a second gate in front of the intent match.",
        }),
        field("KES per USD", "MPESA_KES_PER_USD", {
          required: false,
          hint: "Conversion used to price USD plans on the M-Pesa rail (default 129).",
        }),
      ],
      links: [
        { label: "Daraja portal", href: "https://developer.safaricom.co.ke/" },
        { label: "Payment console", href: "/admin/payments" },
      ],
      notes:
        'The callback lives at /api/payments/daraja/callback, matches the CheckoutRequestID against a PaymentIntent we created, and refuses a "success" with no receipt or the wrong amount. Set MPESA_CALLBACK_IP_CHECK=on to also enforce Safaricom\'s published source IPs.',
    });
  }

  /* ── PayPal ─────────────────────────────────────────────────────── */
  {
    const clientId = env("PAYPAL_CLIENT_ID");
    const secret = env("PAYPAL_CLIENT_SECRET");
    const webhook = env("PAYPAL_WEBHOOK_ID");
    const live = env("PAYPAL_ENV").toLowerCase() === "live";
    const hasKeys = Boolean(clientId && secret);

    let status: IntegrationStatus = hasKeys && webhook ? "operational" : hasKeys ? "degraded" : "unconfigured";
    let detail = !clientId && !secret
      ? "Not configured — PayPal checkout is disabled"
      : !hasKeys
        ? "Partially configured — both the client id and the secret are required"
        : !webhook
          ? "Credentials present but PAYPAL_WEBHOOK_ID is missing, so no webhook can be verified"
          : live
            ? "Live credentials configured"
            : "Sandbox credentials configured — no real money moves";
    let latencyMs: number | null = null;

    if (hasKeys) {
      const r = await probe(
        `${live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"}/v1/oauth2/token`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
          timeoutMs: 7000,
        }
      );
      latencyMs = r.ms;
      const token = (r.body as { access_token?: string } | null)?.access_token;
      if (!r.ok || !token) {
        status = "down";
        detail = `PayPal rejected the API credentials${r.error ? `: ${r.error}` : ` (HTTP ${r.status})`}`;
      } else if (!webhook) {
        status = "degraded";
        detail = `Credentials verified (${r.ms}ms) but PAYPAL_WEBHOOK_ID is missing — inbound webhooks are refused (503) rather than trusted unverified`;
      } else {
        status = "operational";
        detail = `${live ? "Live" : "Sandbox"} credentials verified (${r.ms}ms) — webhook verification enabled`;
      }
    }

    integrations.push({
      id: "paypal",
      name: "PayPal",
      category: "Payments",
      description:
        "Card and wallet subscriptions for international and diaspora members, settled in USD (PayPal cannot settle KES).",
      status,
      detail,
      latencyMs,
      verdict: verdictFor(status, false),
      fields: [
        field("Client id", "PAYPAL_CLIENT_ID"),
        field("Client secret", "PAYPAL_CLIENT_SECRET", { secret: true }),
        field("Webhook id", "PAYPAL_WEBHOOK_ID", {
          hint: "From the app's Webhooks page — without it, inbound webhooks are refused rather than trusted.",
        }),
        field("Environment", "PAYPAL_ENV", {
          required: false,
          hint: '"live" for production; anything else uses the PayPal sandbox.',
        }),
      ],
      links: [
        { label: "PayPal developer dashboard", href: "https://developer.paypal.com/dashboard/applications" },
        { label: "Payment console", href: "/admin/payments" },
      ],
      notes:
        "Webhook URL: <APP_URL>/api/payments/paypal/webhook. Subscribe to PAYMENT.CAPTURE.* and BILLING.SUBSCRIPTION.* — the browser's return trip is never the authority.",
    });
  }

  /* ── Resend ─────────────────────────────────────────────────────── */
  {
    const key = env("RESEND_API_KEY");
    const from = env("MAIL_FROM") || env("RESEND_FROM");
    let status: IntegrationStatus = key && from ? "operational" : key || from ? "degraded" : "unconfigured";
    let detail = !key
      ? "No API key — mail is logged instead of sent"
      : !from
        ? "API key present but no sender address (MAIL_FROM / RESEND_FROM)"
        : "Configured";
    let latencyMs: number | null = null;

    if (key) {
      const r = await probe("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${key}` },
        timeoutMs: 6000,
      });
      latencyMs = r.ms;
      if (!r.ok) {
        status = "down";
        detail = `Resend rejected the API key${r.error ? `: ${r.error}` : ` (HTTP ${r.status})`}`;
      } else {
        status = from ? "operational" : "degraded";
        const domains = (r.body as { data?: unknown[] } | null)?.data;
        detail = `Key verified (${r.ms}ms)${Array.isArray(domains) ? ` — ${domains.length} domain(s)` : ""}${
          from ? `, sending as ${from}` : ", sender missing"
        }`;
      }
    }

    integrations.push({
      id: "resend",
      name: "Resend email",
      category: "Messaging",
      description: "Verification mail, password resets, publish notifications and status alerts.",
      status,
      detail,
      latencyMs,
      verdict: verdictFor(status, false),
      fields: [
        field("API key", "RESEND_API_KEY", { secret: true }),
        field("From address", "MAIL_FROM", { required: false, hint: "Falls back to RESEND_FROM." }),
      ],
      links: [{ label: "Resend dashboard", href: "https://resend.com/emails" }],
    });
  }

  /* ── RSS syndication ────────────────────────────────────────────── */
  {
    const enabled = settings.enableRssIngestion !== "false";
    const lastPoll = newestPoll?.lastPolled ?? null;
    const ageMinutes = lastPoll
      ? Math.round((Date.now() - new Date(lastPoll).getTime()) / 60_000)
      : null;
    let status: IntegrationStatus;
    let detail: string;

    if (!enabled) {
      status = "degraded";
      detail = "Ingestion is switched off in Settings";
    } else if (activeFeeds === 0) {
      status = "unconfigured";
      detail = "No active feeds registered — run scripts/setup-kenyan-feeds.mjs";
    } else if (ageMinutes === null) {
      status = "degraded";
      detail = `${activeFeeds} active feeds, none polled yet`;
    } else if (ageMinutes > 180) {
      status = "degraded";
      detail = `${activeFeeds} active feeds — last poll ${Math.round(ageMinutes / 60)}h ago`;
    } else {
      status = "operational";
      detail = `${activeFeeds} active feeds — last poll ${ageMinutes}m ago`;
    }

    integrations.push({
      id: "rss",
      name: "RSS syndication",
      category: "Content",
      description:
        "Kenyan and regional sources polled hourly, filtered by the combined mind, then filed by category on the way in.",
      status,
      detail,
      latencyMs: null,
      verdict: verdictFor(status, false),
      fields: [
        {
          label: "Active feeds",
          present: activeFeeds > 0,
          value: String(activeFeeds),
          required: true,
        },
        {
          label: "Poll interval",
          env: "RSS_POLL_INTERVAL_SECONDS",
          present: has("RSS_POLL_INTERVAL_SECONDS"),
          value: env("RSS_POLL_INTERVAL_SECONDS") || "43200 (default — twice a day)",
          required: false,
        },
        {
          label: "Ingestion setting",
          present: enabled,
          value: enabled ? "enabled" : "disabled",
          required: true,
          managedBySetting: "enableRssIngestion",
        },
      ],
      links: [{ label: "Manage feeds", href: "/admin/rss" }],
    });
  }

  /* ── AI providers ───────────────────────────────────────────────── */
  {
    const provider = settings.aiProvider || "builtin";
    const providerKeys: Record<string, string> = {
      openai: settings.openaiApiKey || env("OPENAI_API_KEY"),
      anthropic: settings.anthropicApiKey || env("ANTHROPIC_API_KEY"),
      openrouter: settings.openrouterApiKey || env("OPENROUTER_API_KEY"),
      opencode: settings.opencodeApiKey || env("OPENCODE_API_KEY"),
      builtin: "builtin",
    };
    const active = providerKeys[provider] ?? "";
    const status: IntegrationStatus =
      provider === "builtin" ? "operational" : active ? "operational" : "degraded";
    const detail =
      provider === "builtin"
        ? "Self-contained generator and classifier — no external calls"
        : active
          ? `Provider "${provider}" configured`
          : `Provider set to "${provider}" but no key is present — falling back to the builtin engine`;

    integrations.push({
      id: "ai",
      name: "AI providers",
      category: "AI",
      description: "Headline, excerpt and curation work. The builtin engine needs no key and always works.",
      status,
      detail,
      latencyMs: null,
      verdict: verdictFor(status, false),
      fields: [
        {
          label: "Active provider",
          present: true,
          value: provider,
          required: false,
          managedBySetting: "aiProvider",
        },
        {
          label: "OpenAI key",
          env: "OPENAI_API_KEY",
          present: Boolean(providerKeys.openai),
          value: providerKeys.openai && providerKeys.openai !== "builtin" ? maskValue(providerKeys.openai) : null,
          required: false,
          managedBySetting: "openaiApiKey",
        },
        {
          label: "Anthropic key",
          env: "ANTHROPIC_API_KEY",
          present: Boolean(providerKeys.anthropic),
          value: providerKeys.anthropic ? maskValue(providerKeys.anthropic) : null,
          required: false,
          managedBySetting: "anthropicApiKey",
        },
        {
          label: "OpenRouter key",
          env: "OPENROUTER_API_KEY",
          present: Boolean(providerKeys.openrouter),
          value: providerKeys.openrouter ? maskValue(providerKeys.openrouter) : null,
          required: false,
          managedBySetting: "openrouterApiKey",
        },
        {
          label: "OpenCode key",
          env: "OPENCODE_API_KEY",
          present: Boolean(providerKeys.opencode),
          value: providerKeys.opencode ? maskValue(providerKeys.opencode) : null,
          required: false,
          managedBySetting: "opencodeApiKey",
        },
      ],
      links: [{ label: "AI pipeline", href: "/admin/ai" }],
    });
  }

  /* ── Upstream data ──────────────────────────────────────────────── */
  {
    const weather = svc("weather");
    const forex = svc("forex");
    const worst: IntegrationStatus =
      weather?.status === "down" || forex?.status === "down"
        ? "down"
        : weather?.status === "degraded" || forex?.status === "degraded"
          ? "degraded"
          : weather && forex
            ? "operational"
            : "unconfigured";

    integrations.push({
      id: "upstream-data",
      name: "Weather & forex",
      category: "Content",
      description: "Open-Meteo forecasts and open.er-api.com reference rates, both keyless and free.",
      status: worst,
      detail: `Weather: ${weather?.detail ?? "not probed"} · Forex: ${forex?.detail ?? "not probed"}`,
      latencyMs: null,
      verdict: verdictFor(worst, false),
      fields: [],
      links: [
        { label: "Open-Meteo", href: "https://open-meteo.com/" },
        { label: "Exchange rate API", href: "https://www.exchangerate-api.com/" },
      ],
    });
  }

  /* ── Radio ──────────────────────────────────────────────────────── */
  {
    const m = fromService(svc("radio"), "Not probed");
    integrations.push({
      id: "radio",
      name: "Radio streams",
      category: "Content",
      description: "Live station audio, plus the metadata sweep that keeps now-playing warm in Redis.",
      status: m.status,
      detail: m.detail,
      latencyMs: m.latencyMs,
      verdict: verdictFor(m.status, false),
      fields: [
        {
          label: "Direct streams",
          present: settings.radioDirectStream === "true",
          value: settings.radioDirectStream === "true" ? "on (HD, listener IPs exposed)" : "proxied",
          required: false,
          managedBySetting: "radioDirectStream",
        },
      ],
      links: [{ label: "Open radio", href: "/radio" }],
    });
  }

  /* ── Status alerting ────────────────────────────────────────────── */
  {
    const emails = settings.statusAlertEmails?.trim();
    const webhook = settings.statusWebhookUrl?.trim() || env("STATUS_WEBHOOK_URL");
    const configured = Boolean(emails || webhook);
    integrations.push({
      id: "alerts",
      name: "Status alerts",
      category: "Monitoring",
      description: "Where the watchdog sends service-degradation alerts (email and/or Slack-style webhook).",
      status: configured ? "operational" : "unconfigured",
      detail: configured
        ? [emails && `${emails.split(",").filter(Boolean).length} email recipient(s)`, webhook && "webhook"]
            .filter(Boolean)
            .join(" · ")
        : "No recipients — alerts only appear on /status",
      latencyMs: null,
      verdict: verdictFor(configured ? "operational" : "unconfigured", false),
      fields: [
        {
          label: "Alert emails",
          present: Boolean(emails),
          value: emails || null,
          required: false,
          managedBySetting: "statusAlertEmails",
        },
        {
          label: "Webhook URL",
          env: "STATUS_WEBHOOK_URL",
          present: Boolean(webhook),
          value: webhook ? `${webhook.slice(0, 32)}…` : null,
          required: false,
          managedBySetting: "statusWebhookUrl",
        },
      ],
      links: [{ label: "Public status page", href: "/status" }],
    });
  }

  /* ── Hosting ────────────────────────────────────────────────────── */
  {
    const vercelEnv = env("VERCEL_ENV") || env("NODE_ENV") || "unknown";
    const vercelUrl = env("VERCEL_URL") || env("AUTH_URL") || "";
    integrations.push({
      id: "vercel",
      name: "Vercel hosting",
      category: "Edge & hosting",
      description:
        "Builds, serves and schedules. Its single cron slot is spent on the safety net that covers stalled essentials.",
      status: "operational",
      detail: `${vercelEnv}${vercelUrl ? ` — ${vercelUrl.replace(/^https?:\/\//, "")}` : ""}`,
      latencyMs: null,
      verdict: "healthy",
      fields: [
        field("Auth URL", "AUTH_URL", { required: false }),
        field("Cron secret", "CRON_SECRET", { required: false, secret: true }),
        field("Project URL", "VERCEL_URL", { required: false }),
      ],
      links: [{ label: "Vercel dashboard", href: "https://vercel.com/dashboard" }],
      notes:
        "vercel.json keeps one cron: /api/cron/safety-net daily. Inngest owns every other cadence — see the Scheduled jobs table below.",
    });
  }

  /* ── Google sign-in ─────────────────────────────────────────────── */
  {
    const clientId = env("GOOGLE_CLIENT_ID");
    const clientSecret = env("GOOGLE_CLIENT_SECRET");
    const origin = (env("AUTH_URL") || env("NEXTAUTH_URL") || "").replace(/\/+$/, "");
    const redirectUri = `${origin || "<your-domain>"}/api/auth/callback/google`;
    const configured = Boolean(clientId && clientSecret);
    const status: IntegrationStatus = configured ? "operational" : "unconfigured";

    integrations.push({
      id: "google-oauth",
      name: "Google sign-in",
      category: "App",
      description:
        '"Continue with Google" on the sign-in and sign-up pages. The first OAuth sign-in provisions a local account and links to an existing one by email.',
      status,
      // The button is deliberately always rendered now — before credentials
      // exist it shows a disabled, clearly-labelled "not configured" state — so
      // this must NOT claim it is hidden, which is what it used to say.
      detail: configured
        ? `Client ${clientId.slice(0, 14)}… configured — callback ${redirectUri}`
        : "Not configured — the Google button still renders on /auth/signin and /auth/signup, disabled, and says so",
      latencyMs: null,
      verdict: verdictFor(status),
      fields: [
        field("Client ID", "GOOGLE_CLIENT_ID", {
          hint: "Set both the client ID and secret to enable the button; until then it renders disabled.",
        }),
        field("Client secret", "GOOGLE_CLIENT_SECRET", { secret: true }),
        {
          // Informational, not a credential: nothing here is "set" in the
          // environment. Marking this required made the console report a
          // missing variable that an operator cannot actually fill in, which
          // inflated the "needs attention" count with something unhideable.
          label: "Authorized redirect URI",
          present: configured && Boolean(origin),
          value: redirectUri,
          required: false,
          hint: "Register this exact URI on the OAuth client; without it Google returns redirect_uri_mismatch.",
        },
      ],
      links: [
        { label: "Google Cloud credentials", href: "https://console.cloud.google.com/apis/credentials" },
        { label: "Sign-in page", href: "/auth/signin" },
      ],
      notes:
        "The button asks /api/auth/providers what is configured and enables itself as soon as the env vars exist — set them in Vercel (and .env.local for dev) and restart. No UI change is needed afterwards, and while they are missing the button renders disabled with an explanation rather than disappearing.",
    });
  }

  /* ── PWA ────────────────────────────────────────────────────────── */
  {
    integrations.push({
      id: "pwa",
      name: "Progressive web app",
      category: "App",
      description:
        "Manifest, service worker offline shell, install prompt and push notifications.",
      status: settings.enablePwa === "false" ? "degraded" : "operational",
      detail:
        settings.enablePwa === "false"
          ? "Install prompt disabled in Settings"
          : "Manifest + service worker served; anonymous pages cached, authenticated pages never stored",
      latencyMs: null,
      verdict: settings.enablePwa === "false" ? "attention" : "healthy",
      fields: [
        {
          label: "Install prompt",
          present: settings.enablePwa !== "false",
          value: settings.enablePwa === "false" ? "disabled" : "enabled",
          required: false,
          managedBySetting: "enablePwa",
        },
        field("Push public key", "NEXT_PUBLIC_VAPID_KEY", { required: false }),
      ],
      links: [
        { label: "Manifest", href: "/manifest.webmanifest" },
        { label: "Service worker", href: "/sw.js" },
      ],
    });
  }

  /* ── Web push ──────────────────────────────────────────────────── */
  {
    /*
     * Reported on its own, because "the app installs and works offline" and
     * "an alert reaches a closed phone" are different facts and the panel above
     * was blurring them. The PWA entry read *operational* and said nothing about
     * push, so a deployment with no VAPID pair — where the OS tier can never
     * sign a request and therefore never delivers — looked entirely healthy.
     *
     * That is precisely how a notification pipeline goes missing with nobody
     * noticing: every check the console ran was about the shell, and the shell
     * was fine. Splitting the capability out is what makes the gap visible.
     */
    const hasPublic = env("NEXT_PUBLIC_VAPID_KEY").length > 0;
    const hasPrivate = env("VAPID_PRIVATE_KEY").length > 0;
    const configured = hasPublic && hasPrivate;

    let devices: number | null = null;
    if (configured) {
      devices = await prisma.pushSubscription
        .count()
        .then((n) => n)
        .catch(() => null);
    }

    const status: IntegrationStatus = configured
      ? devices === 0
        ? "degraded"
        : "operational"
      : "unconfigured";

    integrations.push({
      id: "web-push",
      name: "Web push",
      category: "Messaging",
      description:
        "Delivers alerts to the operating system — the tier that reaches a reader whose app is closed, including Arabic-first installs on a phone.",
      status,
      detail: configured
        ? devices === null
          ? "VAPID pair present; the subscription table could not be counted."
          : devices === 0
            ? "Keys are set but no device has subscribed yet — every send is a no-op until a reader allows notifications."
            : `Signing as configured, delivering to ${devices} registered ${devices === 1 ? "device" : "devices"}.`
        : `Push cannot be delivered — ${!hasPublic && !hasPrivate ? "the VAPID pair is missing" : !hasPublic ? "NEXT_PUBLIC_VAPID_KEY is missing" : "VAPID_PRIVATE_KEY is missing"}. Alerts still appear in an open tab; they never reach a closed one. Generate a pair with scripts/generate-vapid-keys.mjs and set both halves (and VAPID_SUBJECT) in the deployment.`,
      latencyMs: null,
      verdict: configured ? verdictFor(status, false) : "attention",
      fields: [
        field("Push public key", "NEXT_PUBLIC_VAPID_KEY", { required: false }),
        field("Push private key", "VAPID_PRIVATE_KEY", { required: false, secret: true }),
        field("Contact subject", "VAPID_SUBJECT", { required: false }),
      ],
      links: [{ label: "Notification settings", href: "/notifications" }],
    });
  }

  const summary = {
    total: integrations.length,
    operational: integrations.filter((i) => i.status === "operational").length,
    degraded: integrations.filter((i) => i.status === "degraded").length,
    down: integrations.filter((i) => i.status === "down").length,
    unconfigured: integrations.filter((i) => i.status === "unconfigured").length,
    actionRequired: integrations.filter((i) => i.verdict === "action-required").length,
  };

  return { generatedAt: new Date().toISOString(), summary, integrations, crons };
}
