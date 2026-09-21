import { prisma } from "./prisma";
import { cacheGet, cacheSet, redisDel } from "./redis";
import { DEFAULT_OG_IMAGE } from "./brand";
import { buildAnalyticsSnippet, sanitizeIntegrationHtml } from "./integration-scripts";
import { routableProviderIds } from "./providers/registry";

/**
 * The provider list, read from the registry rather than written here.
 *
 * This module used to be the second of three places that answered "which AI
 * providers exist", and it was the one that offered fields for providers the
 * gateway could not call. Reading the registry removes the possibility of that
 * disagreement rather than relying on the next editor to keep two lists in step.
 */
const ROUTABLE_PROVIDER_IDS = routableProviderIds();

/**
 * Platform settings store — the backbone of the Admin "Settings & Integrations"
 * console. Every key below can be managed from /admin/settings at runtime and
 * feeds the live build: site identity (root metadata), SEO defaults, analytics
 * integrations (custom head scripts), API keys, and feature flags.
 *
 * Values are stored as strings ("true"/"false" for booleans). Secrets are
 * marked `isSecret` and masked in the admin UI.
 */

/** What the site is called when nothing has been configured. */
export const DEFAULT_SITE_ORIGIN = "https://connectplusapp.vercel.app";



/** A loopback origin — a developer's machine, never a place readers can reach. */
function isLoopbackOrigin(value: string): boolean {
  try {
    const { hostname } = new URL(value.includes("://") ? value : `https://${value}`);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * The origin this deployment may present to the public.
 *
 * `siteUrl` is the base of every canonical, sitemap entry, RSS link and share
 * card, and it defaults to the developer's own `AUTH_URL`. That default is fine
 * on a laptop and actively harmful anywhere else: a local run against the
 * shared database seeded `http://localhost:64691` into the live settings, which
 * told every search engine that each page's canonical address was a port on
 * somebody's machine. So a loopback value is never published — the deployment's
 * own host is used instead, and the loopback value survives only when nothing
 * else is known, which means true local development.
 */
export function publicSiteOrigin(configured?: string | null): string {
  const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const fromDeployment = deploymentHost ? `https://${deploymentHost.replace(/^https?:\/\//, "")}` : "";
  const candidate = (configured ?? "").trim();

  if (candidate && !isLoopbackOrigin(candidate)) return candidate.replace(/\/+$/, "");
  if (fromDeployment) return fromDeployment.replace(/\/+$/, "");
  return (candidate || DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
}

export interface SettingDef {
  key: string;
  defaultValue: string;
  group: "general" | "seo" | "integrations" | "plugins" | "api";
  label: string;
  hint?: string;
  type: "text" | "textarea" | "url" | "boolean" | "number" | "secret";
  isPublic?: boolean;
  isSecret?: boolean;
}

export const SETTINGS_CATALOG: SettingDef[] = [
  // ── General ───────────────────────────────────────────────────────────────
  {
    key: "siteName",
    defaultValue: "connectPlus",
    group: "general",
    label: "Site name",
    hint: "Shown in the browser title, brand copy and share cards. Keep it bare — punctuation and trailing spaces end up in every page title.",
    type: "text",
    isPublic: true,
  },
  {
    key: "brainSelfHeal",
    defaultValue: "observe",
    group: "general",
    label: "Self-healing envelope",
    hint:
      "What the brain may do about a fault it finds in its own diagnosis. `off` reports nothing and does nothing; `observe` (default) records exactly what it would have done; `enforce` lets it re-fire a stalled job, re-warm a cold edge snapshot and retry the view fold. Only repairs listed in lib/brain-repair can run, at most three per night, and every one is logged with its outcome.",
    type: "text",
  },
  {
    key: "siteTagline",
    defaultValue: "Voices of the Silicon Savanna",
    group: "general",
    label: "Tagline",
    hint: "Short brand line used in metadata and the footer.",
    type: "text",
    isPublic: true,
  },
  {
    key: "siteDescription",
    defaultValue:
      "East Africa's home for homegrown stories, live radio, and real-time football livescores — with model-generated betting analysis and tips for every fixture. Read, write, listen, and follow the games from Nairobi to Dar es Salaam.",
    group: "general",
    label: "Site description",
    hint: "Default description used for SEO and link previews. Aim for 150–160 characters so search results don't truncate it.",
    type: "textarea",
    isPublic: true,
  },
  {
    key: "siteUrl",
    defaultValue: publicSiteOrigin(process.env.AUTH_URL),
    group: "general",
    label: "Canonical site URL",
    hint: "Used to build absolute links, sitemaps and canonical URLs.",
    type: "url",
    isPublic: true,
  },
  {
    key: "contactEmail",
    defaultValue: "hello@connectplus.io",
    group: "general",
    label: "Contact email",
    hint: "Public contact address shown in the footer and privacy pages.",
    type: "text",
    isPublic: true,
  },
  {
    key: "maintenanceMode",
    defaultValue: "false",
    group: "general",
    label: "Maintenance mode",
    hint: "Shows a banner to visitors while you work on the platform.",
    type: "boolean",
    isPublic: true,
  },
  {
    key: "maintenanceMessage",
    defaultValue: "We're doing some maintenance — some features may be temporarily unavailable.",
    group: "general",
    label: "Maintenance message",
    hint: "Banner text shown when maintenance mode is on.",
    type: "textarea",
    isPublic: true,
  },

  // ── Self-marketing ────────────────────────────────────────────────────────
  //
  // What the brain is allowed to do without being asked. Both default to OFF:
  // copy that publishes itself is the one automation that cannot be un-sent, so
  // it is switched on deliberately, per deployment, by an operator.
  {
    key: "marketingAutopilot",
    defaultValue: "false",
    group: "general",
    label: "Marketing autopilot",
    hint: "Let the hive mind and the model draft campaigns and topic suggestions on their own schedule. Drafts still wait for approval unless auto-publish is on.",
    type: "boolean",
    isPublic: false,
  },
  {
    key: "marketingAutoShare",
    defaultValue: "false",
    group: "general",
    label: "Auto-share new stories",
    hint: "Share every newly published story to the channels enabled below, without a human in the loop.",
    type: "boolean",
    isPublic: false,
  },
  {
    key: "marketingAutoPublish",
    defaultValue: "false",
    group: "general",
    label: "Auto-publish approved copy",
    hint: "Send drafts scoring above the threshold straight out, instead of holding them for approval. Leave off until you trust the voice.",
    type: "boolean",
    isPublic: false,
  },
  {
    key: "marketingShareFacebook",
    defaultValue: "true",
    group: "general",
    label: "Share to the Facebook Page",
    hint: "Whether auto-share posts to the page configured below.",
    type: "boolean",
    isPublic: false,
  },
  {
    key: "marketingShareWhatsapp",
    defaultValue: "true",
    group: "general",
    label: "Share to WhatsApp",
    hint: "Whether auto-share sends to the WhatsApp broadcast number (or hands you a story card to post, when the Cloud API is unset).",
    type: "boolean",
    isPublic: false,
  },
  {
    key: "marketingTone",
    defaultValue:
      "Warm, confident and plain-spoken — the way a well-read friend recommends something. No hype, no exclamation marks, no emoji walls.",
    group: "general",
    label: "Marketing voice",
    hint: "The voice every generated campaign is written in. The model is told this verbatim.",
    type: "textarea",
    isPublic: false,
  },
  {
    key: "marketingHashtags",
    defaultValue: "connectPlus,EastAfrica,Kenya",
    group: "general",
    label: "Default hashtags",
    hint: "Comma-separated, used for generated campaigns and shares.",
    type: "text",
    isPublic: false,
  },
  {
    key: "marketingPublishThreshold",
    defaultValue: "78",
    group: "general",
    label: "Auto-publish score",
    hint: "0-100. Only used when auto-publish is on: a draft must score at least this to go out on its own.",
    type: "number",
    isPublic: false,
  },

  // ── SEO ───────────────────────────────────────────────────────────────────
  {
    key: "ogImage",
    // A real 1200×630 card, generated by scripts/generate-og.mjs — NOT the
    // square app icon, which the platform metadata declares as 1200×630 and
    // which every platform therefore crops, letterboxes or discards.
    defaultValue: "/og-default.png",
    group: "seo",
    label: "Default social share image",
    hint: "Absolute or relative URL used when an article has no cover image. 1200×630 renders un-cropped on every platform.",
    type: "url",
    isPublic: true,
  },
  {
    key: "facebookPageId",
    defaultValue: "",
    group: "integrations",
    label: "Facebook Page ID",
    hint: "The numeric id of the page posts are published to (not the page's @handle).",
    type: "text",
    isPublic: false,
  },
  {
    key: "facebookPageToken",
    defaultValue: "",
    group: "integrations",
    label: "Facebook Page access token",
    hint: "A long-lived page token with pages_manage_posts. Without it, sharing to Facebook is skipped and reported as unconfigured.",
    type: "secret",
    isSecret: true,
    isPublic: false,
  },
  {
    key: "whatsappCloudToken",
    defaultValue: "",
    group: "integrations",
    label: "WhatsApp Cloud API token",
    hint: "Meta Graph token with whatsapp_business_messaging. Optional: without it, WhatsApp shares become a story card and a one-tap share link.",
    type: "secret",
    isSecret: true,
    isPublic: false,
  },
  {
    key: "whatsappPhoneNumberId",
    defaultValue: "",
    group: "integrations",
    label: "WhatsApp phone number ID",
    hint: "The Cloud API sender id messages are sent from.",
    type: "text",
    isPublic: false,
  },
  {
    key: "whatsappBroadcastTo",
    defaultValue: "",
    group: "integrations",
    label: "WhatsApp broadcast number",
    hint: "E.164 number that receives broadcast shares, e.g. 254712345678. Leave empty to use story cards instead of messages.",
    type: "text",
    isPublic: false,
  },
  {
    key: "twitterHandle",
    defaultValue: "@connectplus",
    group: "seo",
    label: "Twitter / X handle",
    hint: "Used in Twitter card metadata (with or without the @). Letters, numbers and underscores only — anything else is stripped, because it becomes a URL in the site's structured data.",
    type: "text",
    isPublic: true,
  },
  {
    key: "seoKeywords",
    defaultValue:
      "East Africa news, Kenya news, Nairobi stories, live football scores, livescore, football betting tips, sports predictions, Kenyan Premier League, African football, live radio Kenya, East African radio, tech blog Africa, Silicon Savanna, African creators",
    group: "seo",
    label: "Default keywords",
    hint: "Comma-separated keywords for the home page.",
    type: "textarea",
    isPublic: true,
  },
  {
    key: "robotsIndex",
    defaultValue: "true",
    group: "seo",
    label: "Allow search engines to index the site",
    hint: "Turns robots meta / robots.txt on or off for the whole site.",
    type: "boolean",
    isPublic: true,
  },

  // ── Integrations (analytics, pixels, chat) ───────────────────────────────
  {
    key: "headScripts",
    defaultValue: "",
    group: "integrations",
    label: "Custom head scripts",
    hint: "Advanced. External <script src> tags from allowlisted analytics/chat hosts only — inline JavaScript, event handlers and other tags are refused (a snippet is code, so it is sanitized and super-admin-only). For Google Analytics, Plausible, Fathom or Umami, use the provider selector instead of pasting code.",
    type: "textarea",
    isSecret: true,
  },
  {
    key: "enableAnalytics",
    defaultValue: "false",
    group: "integrations",
    label: "Enable third-party analytics",
    hint: "Master switch for the analytics snippet below (Google Analytics / Plausible / Fathom).",
    type: "boolean",
  },
  {
    key: "analyticsProvider",
    defaultValue: "none",
    group: "integrations",
    label: "Analytics provider",
    hint: "Select the provider, then paste its ID/snippet below.",
    type: "text",
  },
  {
    key: "analyticsId",
    defaultValue: "",
    group: "integrations",
    label: "Analytics measurement ID",
    hint: "e.g. G-XXXXXXXXXX (GA4), site ID (Plausible), or site key (Fathom).",
    type: "secret",
    isSecret: true,
  },
  {
    key: "enableChatWidget",
    defaultValue: "false",
    group: "integrations",
    label: "Enable third-party chat widget",
    hint: "Master switch for Intercom / Crisp / Tawk snippet pasted below.",
    type: "boolean",
  },
  {
    key: "chatWidgetScript",
    defaultValue: "",
    group: "integrations",
    label: "Chat widget snippet",
    hint: "Advanced. The vendor's external loader <script src> only — inline bootstrap code is refused. Super-admin only.",
    type: "textarea",
    isSecret: true,
  },
  {
    key: "enablePwa",
    defaultValue: "true",
    group: "integrations",
    label: "PWA install prompt",
    hint: "Shows the install prompt for the progressive web app.",
    type: "boolean",
    isPublic: true,
  },
  {
    key: "edgeUrl",
    defaultValue: process.env.EDGE_URL ?? "",
    group: "integrations",
    label: "Cloudflare edge URL",
    hint: "Public URL of the edge-cache Worker (e.g. https://connectplus-edge.<subdomain>.workers.dev). The status page probes <url>/__edge once set. EDGE_URL env wins over this value.",
    type: "url",
    isPublic: true,
  },
  {
    key: "convexUrl",
    defaultValue: process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? "",
    group: "integrations",
    label: "Convex deployment URL",
    hint: "Public URL of the Convex deployment that owns article views and ad metrics (e.g. https://<deployment>.convex.cloud). NEXT_PUBLIC_CONVEX_URL wins over this value. Because the URL is read at request time, setting it here takes effect without a redeploy — the alternative is adding the env var to Vercel and rebuilding.",
    type: "url",
    isPublic: true,
  },
  {
    key: "statusAlertEmails",
    defaultValue: "",
    group: "integrations",
    label: "Status alert emails",
    hint: "Comma-separated addresses that receive service-down alerts from the status watchdog (every 5 min). Falls back to the super admin's email when empty.",
    type: "text",
  },
  {
    key: "statusWebhookUrl",
    defaultValue: "",
    group: "integrations",
    label: "Status alert webhook",
    hint: "Optional Slack/Discord-compatible webhook that receives the same alerts as email.",
    type: "url",
    isSecret: true,
  },

  // ── Feature flags / plugins ──────────────────────────────────────────────
  {
    key: "enableRadio",
    defaultValue: "true",
    group: "plugins",
    label: "Live radio",
    hint: "Show the Live Radio hub and player.",
    type: "boolean",
    isPublic: true,
  },
  {
    key: "enableBrainChat",
    defaultValue: "true",
    group: "plugins",
    label: "Neural Mind brain chat",
    hint: "Enable the NeuroHive chat assistant on the radio page.",
    type: "boolean",
    isPublic: true,
  },
  {
    key: "enableSignups",
    defaultValue: "true",
    group: "plugins",
    label: "New registrations",
    hint: "Allow new accounts to sign up. Turn off for invite-only.",
    type: "boolean",
    isPublic: true,
  },
  {
    key: "enableComments",
    defaultValue: "true",
    group: "plugins",
    label: "Comments",
    hint: "Show the comments section on articles.",
    type: "boolean",
    isPublic: true,
  },
  {
    key: "enableRssIngestion",
    defaultValue: "true",
    group: "plugins",
    label: "RSS ingestion",
    hint: "Allow scheduled RSS feeds to import articles as posts.",
    type: "boolean",
  },
  {
    key: "radioDirectStream",
    defaultValue: "true",
    group: "plugins",
    label: "Direct radio streams (HD)",
    hint:
      "Play the station's own mount in the browser instead of through /api/radio/stream. Full bitrate with no serverless ceiling, and the listener's own connection — not this app's function region — is what the station (and any ad-inserting relay on the way) geolocates. http-only mounts still go through the proxy, because a page served over https may not play an http media subresource, and the player falls back to the proxy automatically when a direct channel fails. Turn this off to route every stream through this origin again: lower fidelity, but station hosts never see a listener's IP.",
    type: "boolean",
    isPublic: true,
  },

  // ── API keys / third-party services ─────────────────────────────────────
  {
    key: "aiProvider",
    defaultValue: "builtin",
    group: "api",
    label: "AI provider",
    // Derived from the registry, so a provider added there appears in this hint
    // without a second edit — and a provider the gateway cannot route can never
    // be advertised here. `tests/unit/docs-drift.test.ts` asserts the two agree.
    hint: `builtin (self-contained) or one of: ${ROUTABLE_PROVIDER_IDS.join(" / ")}. A provider the gateway has no adapter for is not offered.`,
    type: "text",
  },
  // The hints below were wrong in a way that mattered, and the corrections come
  // from `lib/providers/registry.ts` rather than from memory:
  //
  //   • `openaiApiKey` said it was "used for AI headline/excerpt generation when
  //     provider is openai". There is no `openai` provider — the hint was
  //     corrected from a reader that does exist (`visual-studio.ts`, image
  //     generation). The key is live; the label was not.
  //   • `anthropicApiKey` said "used when provider is anthropic". No module reads
  //     it at all, so the field is retained for compatibility with stored values
  //     but is explicitly marked as read by nothing, instead of inviting an
  //     operator to believe it enables something.
  {
    key: "openaiApiKey",
    defaultValue: "",
    group: "api",
    label: "OpenAI API key (image generation)",
    hint: "Enables full-quality image generation in the Visual Studio. It does NOT let the AI gateway call OpenAI — text models route through OpenRouter or OpenCode.",
    type: "secret",
    isSecret: true,
  },
  {
    key: "anthropicApiKey",
    defaultValue: "",
    group: "api",
    label: "Anthropic API key (not in use)",
    hint: "Nothing reads this key: the gateway has no Anthropic adapter. Route Claude through OpenRouter, or add a gateway record in lib/ai-provider.ts. Retained so an existing value is visible rather than silently orphaned.",
    type: "secret",
    isSecret: true,
  },
  {
    key: "openaiModel",
    defaultValue: "",
    group: "api",
    label: "OpenAI image model",
    hint: "Optional override for the image generator's model, e.g. gpt-image-1.",
    type: "text",
  },
  {
    key: "anthropicModel",
    defaultValue: "",
    group: "api",
    label: "Anthropic model (not in use)",
    hint: "Nothing reads this, for the same reason as the key above.",
    type: "text",
  },
  {
    key: "openrouterApiKey",
    defaultValue: "",
    group: "api",
    label: "OpenRouter API key",
    hint: "Powers the free OpenRouter agents (models ending in :free cost nothing).",
    type: "secret",
    isSecret: true,
  },
  {
    key: "openrouterModel",
    defaultValue: "z-ai/glm-5.2:free",
    group: "api",
    label: "OpenRouter model",
    hint: "Leave blank to use the live free model the console reports. Free ids all end in :free and cost nothing.",
    type: "text",
  },
  {
    key: "opencodeApiKey",
    defaultValue: "",
    group: "api",
    label: "OpenCode Zen API key",
    hint: "OpenCode Zen tokens from opencode.ai/zen — used for inline curation and brain training.",
    type: "secret",
    isSecret: true,
  },
  {
    key: "opencodeModel",
    // Free ids only. Zen's paid half (`deepseek-v4-flash`, `glm-5.3`,
    // `claude-sonnet-5`, …) needs a billing method and answers the provider's
    // credits error, so this default is the free counterpart of the old one.
    defaultValue: "deepseek-v4-flash-free",
    group: "api",
    label: "OpenCode Zen model",
    hint: "Free ids only — leave blank for the live free roster, or use e.g. deepseek-v4-flash-free, mimo-v2.5-free, nemotron-3-ultra-free.",
    type: "text",
  },
  {
    key: "supabaseUrl",
    defaultValue: process.env.SUPABASE_URL ?? "",
    group: "api",
    label: "Supabase project URL",
    hint: "Storage endpoint for uploads.",
    type: "url",
    isSecret: true,
  },
];

const CATALOG_BY_KEY = new Map(SETTINGS_CATALOG.map((def) => [def.key, def]));

/** 30s TTL so hot paths (layouts, nav) never hammer the DB. Shared across
 * serverless instances when Redis is configured; the in-memory map is a
 * second-level fallback when Redis is absent or temporarily unavailable. */
const cache = new Map<string, { at: number; value: Record<string, string> }>();
const CACHE_TTL_MS = 30_000;
const CACHE_TTL_SECONDS = 30;

/** Last-known-good values kept forever — served when the DB is unreachable so
 * a database blip degrades page speed instead of taking pages down. */
const lastKnown = new Map<string, Record<string, string>>();

export function settingDef(key: string): SettingDef | undefined {
  return CATALOG_BY_KEY.get(key);
}

export function publicSettingKeys(): string[] {
  return SETTINGS_CATALOG.filter((d) => d.isPublic).map((d) => d.key);
}

/** Ensure every catalog key exists in the DB (idempotent upsert). */
export async function ensureSettings(): Promise<void> {
  // Nothing to seed without a database, and this is the ONE settings path that
  // does not fail soft — so it has to refuse when DATABASE_URL is absent rather
  // than dragging a build down with it.
  if (!process.env.DATABASE_URL) return;

  const existing = await prisma.platformSetting.findMany({
    select: { key: true },
  });
  const existingKeys = new Set(existing.map((s) => s.key));
  const missing = SETTINGS_CATALOG.filter((d) => !existingKeys.has(d.key));
  if (missing.length === 0) return;

  await prisma.platformSetting.createMany({
    data: missing.map((d) => ({
      key: d.key,
      value: d.defaultValue,
      group: d.group,
      label: d.label,
      hint: d.hint,
      type: d.type,
      isPublic: d.isPublic ?? false,
      isSecret: d.isSecret ?? false,
    })),
    skipDuplicates: true,
  });
  cache.clear();
  await redisDel("settings:public").catch(() => {});
  await redisDel("settings:all").catch(() => {});
}

/**
 * The catalog's own defaults, which are a complete answer on their own: every key
 * has one, so "no database" is a degraded configuration rather than a failure.
 * Shared by the no-database short-circuit and the read-failure fallback so the two
 * can never disagree about what an unconfigured platform looks like.
 */
function catalogDefaults(publicOnly: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of SETTINGS_CATALOG) {
    if (publicOnly && !def.isPublic) continue;
    out[def.key] = def.defaultValue;
  }
  return out;
}

/**
 * Read settings as a flat map (catalog defaults fill any row missing from DB).
 * Returns the public-safe subset only when `publicOnly` is true.
 */
export async function getSettings(
  publicOnly = false
): Promise<Record<string, string>> {
  /*
   * Answered from the catalog when no database is configured — a `next build`
   * with no DATABASE_URL, for instance. Prisma rejects every query in that state,
   * so reading "through" it logged one validation error per prerendered page and
   * made the build depend on a database it must not need. The defaults are the
   * correct answer here, not a placeholder for one.
   */
  if (!process.env.DATABASE_URL) return catalogDefaults(publicOnly);

  const cacheKey = publicOnly ? "public" : "all";
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  // Redis-backed shared cache (free-tier friendly: 30s TTL, no-expiry writes
  // are impossible by construction).
  const redisKey = `settings:${cacheKey}`;
  const fromRedis = await cacheGet<Record<string, string>>(redisKey).catch(() => null);
  if (fromRedis) {
    cache.set(cacheKey, { at: Date.now(), value: fromRedis });
    return fromRedis;
  }

  // Fast-fail: if the DB is unreachable (network blip, pooler outage), don't
  // hang every server render for the full connect timeout. Race BOTH the
  // catalog-seed pass and the read against one short deadline, then fall back
  // to stale caches or catalog defaults.
  const rows = await Promise.race([
    prisma.platformSetting.findMany(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("settings-db-deadline")), 1_500)
    ),
  ]).catch(() => null);

  if (rows === null) {
    const stale = lastKnown.get(cacheKey);
    if (stale) return stale;
    return catalogDefaults(publicOnly);
  }

  const out: Record<string, string> = {};
  for (const def of SETTINGS_CATALOG) {
    if (publicOnly && !def.isPublic) continue;
    out[def.key] = def.defaultValue;
  }
  for (const row of rows) {
    if (publicOnly && !row.isPublic) continue;
    out[row.key] = row.value;
  }

  cache.set(cacheKey, { at: Date.now(), value: out });
  lastKnown.set(cacheKey, out);
  await cacheSet(redisKey, out, CACHE_TTL_SECONDS).catch(() => {});
  await cacheSet(`${redisKey}:backup`, out, 24 * 60 * 60).catch(() => {});
  return out;
}

/** All settings + metadata for the admin console (secrets masked). */
export async function getAllSettings() {
  await ensureSettings();
  const rows = await prisma.platformSetting.findMany({
    orderBy: [{ group: "asc" }, { key: "asc" }],
  });
  const defs = SETTINGS_CATALOG;
  return rows.map((row) => {
    const def = CATALOG_BY_KEY.get(row.key);
    return {
      key: row.key,
      value: row.isSecret && row.value ? maskSecret(row.value) : row.value,
      group: row.group,
      label: def?.label ?? row.label ?? row.key,
      hint: def?.hint ?? row.hint ?? null,
      type: row.isSecret ? "secret" : (def?.type ?? row.type ?? "text"),
      isPublic: row.isPublic,
      isSecret: row.isSecret,
    } as SettingRowOut;
  }).concat(
    defs
      .filter((d) => !rows.some((r) => r.key === d.key))
      .map((d) => ({
        key: d.key,
        value: d.defaultValue && d.isSecret ? maskSecret(d.defaultValue) : d.defaultValue,
        group: d.group,
        label: d.label,
        hint: d.hint ?? null,
        type: d.isSecret ? "secret" : d.type,
        isPublic: d.isPublic ?? false,
        isSecret: d.isSecret ?? false,
      }) as SettingRowOut)
  );
}

/** Update a batch of settings. Pass `revealed: true` to persist a revealed secret. */
export async function updateSettings(updates: Record<string, string>) {
  const entries = Object.entries(updates);
  for (const [key, value] of entries) {
    const def = CATALOG_BY_KEY.get(key);
    if (!def) continue;
    await prisma.platformSetting.upsert({
      where: { key },
      update: { value },
      create: {
        key,
        value,
        group: def.group,
        label: def.label,
        hint: def.hint,
        type: def.type,
        isPublic: def.isPublic ?? false,
        isSecret: def.isSecret ?? false,
      },
    });
  }
  cache.clear();
  await redisDel("settings:public").catch(() => {});
  await redisDel("settings:all").catch(() => {});
  return entries.length;
}

interface SettingRowOut {
  key: string;
  value: string;
  group: string;
  label: string;
  hint: string | null;
  type: string;
  isPublic: boolean;
  isSecret: boolean;
}

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

export type SiteConfig = {
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  siteUrl: string;
  contactEmail: string;
  ogImage: string;
  twitterHandle: string;
  seoKeywords: string[];
  robotsIndex: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  features: {
    radio: boolean;
    /**
     * Radio transport, public because the browser has to choose it per channel:
     * `true` prefers the station's own https mount and keeps the same-origin
     * proxy for http-only mounts and as the automatic fallback — see the
     * `radioDirectStream` setting.
     */
    radioDirect: boolean;
    brainChat: boolean;
    signups: boolean;
    comments: boolean;
    pwa: boolean;
    rss: boolean;
    analytics: boolean;
    chatWidget: boolean;
  };
  headScripts: string;
  chatWidgetScript: string;
  /** Which analytics provider to generate a vetted snippet for. */
  analyticsProvider: string;
  analyticsId: string;
};

/** Derived, typed config for the live site (public-safe subset). */
export async function getSiteConfig(): Promise<SiteConfig> {
  const s = await getSettings(false);
  const bool = (v: string | undefined, fallback = true) =>
    v === undefined ? fallback : v === "true";
  return {
    siteName: s.siteName || "connectPlus",
    siteTagline: s.siteTagline || "Voices of the Silicon Savanna",
    siteDescription:
      s.siteDescription ||
      "Homegrown stories, tech, and ideas from East Africa's Silicon Savanna — Nairobi to Kigali, Kampala to Dar es Salaam.",
    siteUrl: publicSiteOrigin(s.siteUrl || process.env.AUTH_URL),
    contactEmail: s.contactEmail || "hello@connectplus.io",
    ogImage: s.ogImage || DEFAULT_OG_IMAGE,
    twitterHandle: s.twitterHandle || "@connectplus",
    seoKeywords: (s.seoKeywords || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    robotsIndex: bool(s.robotsIndex, true),
    maintenanceMode: bool(s.maintenanceMode, false),
    maintenanceMessage:
      s.maintenanceMessage ||
      "We're doing some maintenance — some features may be temporarily unavailable.",
    features: {
      radio: bool(s.enableRadio, true),
      radioDirect: bool(s.radioDirectStream, true),
      brainChat: bool(s.enableBrainChat, true),
      signups: bool(s.enableSignups, true),
      comments: bool(s.enableComments, true),
      pwa: bool(s.enablePwa, true),
      rss: bool(s.enableRssIngestion, true),
      analytics: bool(s.enableAnalytics, false),
      chatWidget: bool(s.enableChatWidget, false),
    },
    headScripts: s.headScripts || "",
    chatWidgetScript: s.chatWidgetScript || "",
    analyticsProvider: s.analyticsProvider || "none",
    analyticsId: s.analyticsId || "",
  };
}

/**
 * Build the actual <script> tags to inject for enabled integrations.
 *
 * Nothing here is rendered verbatim any more. Analytics comes from a vetted
 * provider template, and any custom snippet is reduced to the safe subset by
 * `sanitizeIntegrationHtml` — so a setting can no longer carry arbitrary
 * JavaScript into every page. See lib/integration-scripts for the rules.
 */
export function buildIntegrationScripts(cfg: SiteConfig): string {
  const parts: string[] = [];

  if (cfg.features.analytics) {
    const provider = buildAnalyticsSnippet(cfg.analyticsProvider, cfg.analyticsId);
    if (provider) parts.push(provider);
    if (cfg.headScripts.trim()) {
      const safe = sanitizeIntegrationHtml(cfg.headScripts);
      if (safe.html.trim()) parts.push(safe.html);
    }
  }

  if (cfg.features.chatWidget && cfg.chatWidgetScript.trim()) {
    const safe = sanitizeIntegrationHtml(cfg.chatWidgetScript);
    if (safe.html.trim()) parts.push(safe.html);
  }

  return parts.join("\n");
}