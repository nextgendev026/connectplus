import { prisma } from "./prisma";
import { resolveSiteOrigin } from "./seo";
import { createLogger } from "./logger";

const log = createLogger("feed-health");

/**
 * Health of the feeds we publish.
 *
 * A feed is a contract with machines we never hear from. Nobody emails to say
 * "your RSS has been 500-ing since Tuesday" — a partner network just quietly
 * stops carrying the stories, or keeps carrying stale ones, and the first sign
 * is a traffic number drifting down. So the feed is checked on a schedule the
 * way any other endpoint would be:
 *
 *   • it must fetch, and fetch *valid* — XML that parses, a JSON Feed that
 *     declares its version, the fields a consumer needs present on every item;
 *   • its item links must resolve, because a feed full of 404s is worse than an
 *     empty one: it teaches a crawler that the site is broken;
 *   • failure raises the same alert the status watchdog uses, once per episode.
 *
 * The validators are pure and the gathering is separate, so the rules can be
 * tested without a network.
 */

export type FeedState = "ok" | "warn" | "critical";

export interface FeedCheck {
  id: "rss" | "json" | "category";
  label: string;
  url: string;
  state: FeedState;
  itemCount: number;
  /** Links sampled for reachability. */
  linksChecked: number;
  brokenLinks: number;
  errors: string[];
  detail: string;
}

export interface FeedHealthReport {
  generatedAt: string;
  overall: FeedState;
  checks: FeedCheck[];
}

/* ── Pure validators ──────────────────────────────────────────────────────── */

export interface RssValidation {
  ok: boolean;
  itemCount: number;
  selfLink: string | null;
  links: string[];
  errors: string[];
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Validate an RSS 2.0 document far enough to trust it as a syndication source. */
export function validateRss(xml: string): RssValidation {
  const errors: string[] = [];
  const body = xml.trim();

  if (!body) return { ok: false, itemCount: 0, selfLink: null, links: [], errors: ["empty response"] };
  if (!/<rss\b[^>]*version="2\.0"/i.test(body)) errors.push("missing <rss version=\"2.0\">");
  if (!/<channel\b/i.test(body)) errors.push("missing <channel>");
  if (!/<title>/i.test(body)) errors.push("channel has no <title>");

  const items = body.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  if (items.length === 0) errors.push("no <item> elements");

  for (const [i, item] of items.entries()) {
    if (!/<title>/i.test(item)) errors.push(`item ${i + 1} has no <title>`);
    if (!/<link>/i.test(item)) errors.push(`item ${i + 1} has no <link>`);
    if (!/<pubDate>/i.test(item)) errors.push(`item ${i + 1} has no <pubDate>`);
    // A GUID is the item's identity; without one a reader re-shares old stories
    // every time it polls.
    if (!/<guid\b/i.test(item)) errors.push(`item ${i + 1} has no <guid>`);
  }

  const selfMatch = body.match(/<atom:link\b[^>]*rel="self"[^>]*>/i);
  const selfLink = selfMatch ? (selfMatch[0].match(/href="([^"]+)"/i)?.[1] ?? null) : null;
  if (!selfLink) errors.push("no atom:link rel=\"self\"");

  // Item links only — the channel's own <link> is the homepage, and checking it
  // would report a "broken feed" whenever the site itself was briefly down.
  const links = items
    .map((item) => item.match(/<link>([^<]*)<\/link>/i)?.[1])
    .filter((link): link is string => Boolean(link))
    .map((link) => decodeXml(link.trim()));

  return { ok: errors.length === 0, itemCount: items.length, selfLink, links, errors };
}

export interface JsonFeedValidation {
  ok: boolean;
  itemCount: number;
  feedUrl: string | null;
  links: string[];
  errors: string[];
}

/** Validate a JSON Feed 1.x document. */
export function validateJsonFeed(raw: string): JsonFeedValidation {
  const errors: string[] = [];
  let parsed: {
    version?: string;
    feed_url?: string;
    items?: { id?: string; url?: string; title?: string; date_published?: string }[];
  };

  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return { ok: false, itemCount: 0, feedUrl: null, links: [], errors: ["response is not valid JSON"] };
  }

  if (!parsed.version || !parsed.version.startsWith("https://jsonfeed.org/version/")) {
    errors.push("missing or unrecognised JSON Feed version");
  }
  if (!parsed.feed_url) errors.push("missing feed_url");

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  if (items.length === 0) errors.push("no items");

  for (const [i, item] of items.entries()) {
    if (!item?.id) errors.push(`item ${i + 1} has no id`);
    if (!item?.url) errors.push(`item ${i + 1} has no url`);
    if (!item?.title) errors.push(`item ${i + 1} has no title`);
    if (!item?.date_published) errors.push(`item ${i + 1} has no date_published`);
  }

  const links = items.map((item) => item?.url).filter((u): u is string => Boolean(u));

  return { ok: errors.length === 0, itemCount: items.length, feedUrl: parsed.feed_url ?? null, links, errors };
}

/* ── Link reachability ────────────────────────────────────────────────────── */

async function linkResolves(url: string): Promise<boolean> {
  // HEAD first, then GET: some origins answer HEAD with 405 but serve the page.
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (head.status < 400) return true;
    if (head.status !== 405 && head.status !== 501) return false;
  } catch {
    // fall through to GET
  }
  try {
    const get = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000) });
    return get.status < 400;
  } catch {
    return false;
  }
}

/** Sample a few links rather than every one — a check that hammers the site is its own outage. */
export async function countBrokenLinks(links: readonly string[], sample = 5): Promise<{ checked: number; broken: number }> {
  const candidates = links.slice(0, sample);
  const results = await Promise.all(candidates.map((l) => linkResolves(l)));
  return { checked: candidates.length, broken: results.filter((ok) => !ok).length };
}

/* ── Gathering ────────────────────────────────────────────────────────────── */

const SEVERITY: Record<FeedState, number> = { ok: 0, warn: 1, critical: 2 };

export function worseFeedState(a: FeedState, b: FeedState): FeedState {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    headers: { Accept: "application/rss+xml, application/feed+json, application/json, */*" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, text: await res.text() };
}

/**
 * Check every feed we publish.
 *
 * Never throws for one bad feed: each check degrades to `critical` on its own so
 * the others still report, because a health check that blanks out when it finds
 * a problem is missing exactly when it is needed.
 */
export async function checkFeedHealth(opts: { origin?: string; sample?: number } = {}): Promise<FeedHealthReport> {
  let origin = opts.origin;
  if (!origin) {
    origin = await resolveSiteOrigin();
  }
  origin = origin.replace(/\/$/, "");
  const sample = opts.sample ?? 5;

  const categorySlug = await prisma.category
    .findFirst({ where: { posts: { some: { status: "PUBLISHED" } } }, select: { slug: true, name: true } })
    .then((c) => c ?? null)
    .catch(() => null);

  const checks: FeedCheck[] = [];

  // 1. RSS
  {
    const url = `${origin}/feed.xml`;
    const check: FeedCheck = {
      id: "rss", label: "RSS feed", url, state: "ok",
      itemCount: 0, linksChecked: 0, brokenLinks: 0, errors: [], detail: "",
    };
    try {
      const { status, text } = await fetchText(url);
      if (status !== 200) {
        check.state = "critical";
        check.errors.push(`HTTP ${status}`);
        check.detail = `The RSS feed answered ${status}.`;
      } else {
        const v = validateRss(text);
        check.itemCount = v.itemCount;
        check.errors = v.errors;
        if (!v.ok) check.state = "critical";
        else if (v.itemCount === 0) {
          check.state = "warn";
        }
        const broken = v.ok ? await countBrokenLinks(v.links, sample) : { checked: 0, broken: 0 };
        check.linksChecked = broken.checked;
        check.brokenLinks = broken.broken;
        if (broken.broken > 0) check.state = worseFeedState(check.state, broken.broken === broken.checked ? "critical" : "warn");
        check.detail = v.ok
          ? `${v.itemCount} items, ${broken.checked - broken.broken}/${broken.checked} sampled links resolve.`
          : `Invalid: ${v.errors.slice(0, 3).join("; ")}`;
      }
    } catch (error) {
      check.state = "critical";
      check.errors.push(String(error).slice(0, 160));
      check.detail = "The RSS feed could not be fetched.";
    }
    checks.push(check);
  }

  // 2. JSON Feed
  {
    const url = `${origin}/feed.xml?format=json`;
    const check: FeedCheck = {
      id: "json", label: "JSON feed", url, state: "ok",
      itemCount: 0, linksChecked: 0, brokenLinks: 0, errors: [], detail: "",
    };
    try {
      const { status, text } = await fetchText(url);
      if (status !== 200) {
        check.state = "critical";
        check.errors.push(`HTTP ${status}`);
        check.detail = `The JSON feed answered ${status}.`;
      } else {
        const v = validateJsonFeed(text);
        check.itemCount = v.itemCount;
        check.errors = v.errors;
        if (!v.ok) check.state = "critical";
        else if (v.itemCount === 0) check.state = "warn";
        check.detail = v.ok
          ? `${v.itemCount} items, valid JSON Feed ${v.feedUrl ? "" : "(no feed_url)"}`.trim()
          : `Invalid: ${v.errors.slice(0, 3).join("; ")}`;
      }
    } catch (error) {
      check.state = "critical";
      check.errors.push(String(error).slice(0, 160));
      check.detail = "The JSON feed could not be fetched.";
    }
    checks.push(check);
  }

  // 3. A category feed — the path a partner subscribing to one subject actually uses.
  {
    const slug = categorySlug?.slug;
    const url = slug ? `${origin}/feed/${slug}` : "";
    const check: FeedCheck = {
      id: "category",
      label: slug ? `Category feed (${categorySlug?.name})` : "Category feed",
      url: url || `${origin}/feed/<category>`,
      state: slug ? "ok" : "warn",
      itemCount: 0, linksChecked: 0, brokenLinks: 0, errors: [], detail: "",
    };
    if (!slug) {
      check.detail = "No category has published stories yet, so there was nothing to check.";
    } else {
      try {
        const { status, text } = await fetchText(url);
        if (status !== 200) {
          check.state = "critical";
          check.errors.push(`HTTP ${status}`);
          check.detail = `The category feed answered ${status}.`;
        } else {
          const v = validateRss(text);
          check.itemCount = v.itemCount;
          check.errors = v.errors;
          if (!v.ok) check.state = "critical";
          else if (v.itemCount === 0) check.state = "warn";
          check.detail = v.ok
            ? `${v.itemCount} items for /${slug}.`
            : `Invalid: ${v.errors.slice(0, 3).join("; ")}`;
        }
      } catch (error) {
        check.state = "critical";
        check.errors.push(String(error).slice(0, 160));
        check.detail = "The category feed could not be fetched.";
      }
    }
    checks.push(check);
  }

  const overall = checks.reduce<FeedState>((acc, c) => worseFeedState(acc, c.state), "ok");
  log.info("feed health checked", { overall, checks: checks.map((c) => `${c.id}:${c.state}`) });

  return { generatedAt: new Date().toISOString(), overall, checks };
}
