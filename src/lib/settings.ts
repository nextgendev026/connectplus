import { prisma } from "./prisma";
import { cacheGet, cacheSet, redisDel } from "./redis";

/**
 * Platform settings store — the backbone of the Admin "Settings & Integrations"
 * console. Every key below can be managed from /admin/settings at runtime and
 * feeds the live build: site identity (root metadata), SEO defaults, analytics
 * integrations (custom head scripts), API keys, and feature flags.
 *
 * Values are stored as strings ("true"/"false" for booleans). Secrets are
 * marked `isSecret` and masked in the admin UI.
 */

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
    hint: "Shown in the browser title, brand copy and share cards.",
    type: "text",
    isPublic: true,
  },
  {
    key: "siteTagline",
    defaultValue: "Stories that connect East Africa",
    group: "general",
    label: "Tagline",
    hint: "Short brand line used in metadata and the footer.",
    type: "text",
    isPublic: true,
  },
  {
    key: "siteDescription",
    defaultValue:
      "A modern social blogging platform sharing stories, ideas, and perspectives from across East Africa. Join the conversation.",
    group: "general",
    label: "Site description",
    hint: "Default description used for SEO and link previews.",
    type: "textarea",
    isPublic: true,
  },
  {
    key: "siteUrl",
    defaultValue: process.env.AUTH_URL ?? "https://connectplusapp.vercel.app",
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

  // ── SEO ───────────────────────────────────────────────────────────────────
  {
    key: "ogImage",
    defaultValue: "/pwa-512.png",
    group: "seo",
    label: "Default social share image",
    hint: "Absolute or relative URL used when an article has no cover image.",
    type: "url",
    isPublic: true,
  },
  {
    key: "twitterHandle",
    defaultValue: "@connectplus",
    group: "seo",
    label: "Twitter / X handle",
    hint: "Used in Twitter card metadata (without the @ is fine).",
    type: "text",
    isPublic: true,
  },
  {
    key: "seoKeywords",
    defaultValue:
      "blog, East Africa, Nairobi, Kampala, Dar es Salaam, Kigali, stories, writing, community",
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
    hint: "Raw <script> snippets injected into <head> on every page — Google Analytics, Meta Pixel, Plausible, Hotjar, Intercom, etc.",
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
    hint: "Paste the full embed script (Intercom, Crisp, Tawk.to…).",
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

  // ── API keys / third-party services ─────────────────────────────────────
  {
    key: "aiProvider",
    defaultValue: "builtin",
    group: "api",
    label: "AI provider",
    hint: "builtin (self-contained) or openai/anthropic when you add a key below.",
    type: "text",
  },
  {
    key: "openaiApiKey",
    defaultValue: "",
    group: "api",
    label: "OpenAI API key",
    hint: "Used for AI headline/excerpt generation when provider is openai.",
    type: "secret",
    isSecret: true,
  },
  {
    key: "anthropicApiKey",
    defaultValue: "",
    group: "api",
    label: "Anthropic API key",
    hint: "Used when provider is anthropic.",
    type: "secret",
    isSecret: true,
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

export function settingDef(key: string): SettingDef | undefined {
  return CATALOG_BY_KEY.get(key);
}

export function publicSettingKeys(): string[] {
  return SETTINGS_CATALOG.filter((d) => d.isPublic).map((d) => d.key);
}

/** Ensure every catalog key exists in the DB (idempotent upsert). */
export async function ensureSettings(): Promise<void> {
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
 * Read settings as a flat map (catalog defaults fill any row missing from DB).
 * Returns the public-safe subset only when `publicOnly` is true.
 */
export async function getSettings(
  publicOnly = false
): Promise<Record<string, string>> {
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

  await ensureSettings().catch(() => {});

  const rows = await prisma.platformSetting.findMany();
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
  await cacheSet(redisKey, out, CACHE_TTL_SECONDS).catch(() => {});
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
};

/** Derived, typed config for the live site (public-safe subset). */
export async function getSiteConfig(): Promise<SiteConfig> {
  const s = await getSettings(false);
  const bool = (v: string | undefined, fallback = true) =>
    v === undefined ? fallback : v === "true";
  return {
    siteName: s.siteName || "connectPlus",
    siteTagline: s.siteTagline || "Stories that connect East Africa",
    siteDescription:
      s.siteDescription ||
      "A modern social blogging platform sharing stories, ideas, and perspectives from across East Africa.",
    siteUrl: s.siteUrl || process.env.AUTH_URL || "https://connectplusapp.vercel.app",
    contactEmail: s.contactEmail || "hello@connectplus.io",
    ogImage: s.ogImage || "/pwa-512.png",
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
  };
}

/** Build the actual <script> tags to inject for enabled integrations. */
export function buildIntegrationScripts(cfg: SiteConfig): string {
  const parts: string[] = [];
  if (cfg.features.analytics && cfg.headScripts.trim()) {
    parts.push(cfg.headScripts.trim());
  }
  if (cfg.features.chatWidget && cfg.chatWidgetScript.trim()) {
    parts.push(cfg.chatWidgetScript.trim());
  }
  return parts.join("\n");
}