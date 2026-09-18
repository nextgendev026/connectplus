import { getSiteConfig } from "./settings";
import type { TipsShareSummary } from "./sports-share";

/**
 * Share cards and structured data.
 *
 * One theme runs through this module: what a crawler, a messenger or another
 * social network sees when a connectPlus URL is pasted somewhere has to
 * describe the story WE published — our title, our words, our thumbnail. A
 * syndicated story arrives carrying its origin's promo text ("… Read more at
 * https://publisher.co.ke/story"), and echoing that into a card hands another
 * platform the publisher's raw URL in place of our own article details.
 */

/** Fallback origin when site config cannot be read (cold boot, DB blip). */
const FALLBACK_ORIGIN = "https://connectplusapp.vercel.app";

/**
 * Promo trailers that syndicated feeds append to the end of an excerpt. They
 * almost always lead straight to the origin's URL, so the trailer goes with it.
 */
const PROMO_TRAILER =
  /\b(?:(?:read|see|view|continue|full)\s+(?:the\s+)?(?:more|story|article|post|details)|the\s+post\s+[\s\S]{1,200}?\s+appeared\s+first\s+on\b)[\s\S]*$/i;

/** Absolute URLs, with or without a scheme. */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/**
 * Bare domains — "nation.africa", "kbc.co.ke/2026/story" — which leak exactly
 * what a full URL does. Restricted to plausible public suffixes so ordinary
 * prose ("5 p.m. briefing") is left alone.
 */
const BARE_DOMAIN_PATTERN =
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:co\.ke|africa|com|org|net|io|info|news|tv|fm|media|press|blog|online|site|ke)\b(?:\/[^\s<>"']*)?/gi;

/** The canonical origin for absolute metadata, share and JSON-LD URLs. */
export async function resolveSiteOrigin(): Promise<string> {
  try {
    const cfg = await getSiteConfig();
    return (cfg.siteUrl || process.env.AUTH_URL || FALLBACK_ORIGIN).replace(/\/+$/, "");
  } catch {
    return (process.env.AUTH_URL || FALLBACK_ORIGIN).replace(/\/+$/, "");
  }
}

/**
 * Text safe to show on another platform's card.
 *
 * Strips markup, the origin's URL — in any of the shapes a feed writes it — and
 * the promo sentence wrapped around it, then trims to a length messengers
 * render without truncating mid-word.
 */
export function stripSourcePromo(input: string | null | undefined, max = 320): string {
  if (!input) return "";
  let text = String(input)
    .replace(/<[^>]+>/g, " ")
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " "); // markdown links/images
  text = text.replace(PROMO_TRAILER, " ");
  text = text.replace(URL_PATTERN, " ");
  text = text.replace(BARE_DOMAIN_PATTERN, " ");
  text = text
    .replace(/[#*_~`>|]+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:·]+/, "")
    .trim();

  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  const body = lastStop > max * 0.55 ? cut.slice(0, lastStop + 1) : cut;
  return `${body.trimEnd().replace(/[.,;:!?]$/, "")}…`;
}

export interface ShareCardInput {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  content?: string | null;
  publishedAt?: Date | null;
  author?: { name?: string | null; username: string } | null;
  category?: { name: string } | null;
  tags?: { name: string }[];
}

/**
 * The card another platform should render for one of our articles.
 *
 * Deliberately has no `source`/`sourceUrl` field: the origin of a syndicated
 * story is credited *on the page*, where a reader can follow it, and is not
 * part of the payload that describes our article elsewhere.
 */
export interface ShareCard {
  url: string;
  canonical: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
  author: string | null;
  publishedTime: string | null;
  tags: string[];
  /** `article` for a story, `website` for a hub or a board. */
  type: "article" | "website";
}

/** Compose the share card for a stored post. */
export async function articleShareCard(post: ShareCardInput): Promise<ShareCard> {
  let siteName = "connectPlus";
  let origin = await resolveSiteOrigin();
  try {
    siteName = (await getSiteConfig()).siteName;
  } catch {
    // keep defaults
  }
  origin = origin || FALLBACK_ORIGIN;

  const canonical = `${origin}/article/${post.slug}`;
  const description =
    stripSourcePromo(post.excerpt) ||
    stripSourcePromo(post.content, 220) ||
    `Read "${post.title}" on ${siteName}${post.category ? ` — ${post.category.name}` : "."}`;

  return {
    url: canonical,
    canonical,
    title: post.title,
    description,
    // Always the cover route WE serve, never the publisher's image host: a card
    // that points at another domain is the raw URL in picture form.
    image: `${origin}/api/thumb/post/${post.id}`,
    siteName,
    author: post.author ? post.author.name ?? `@${post.author.username}` : null,
    publishedTime: post.publishedAt?.toISOString() ?? null,
    tags: (post.tags ?? []).map((t) => t.name).slice(0, 8),
    type: "article",
  };
}

/**
 * The card a shared tips link should render as.
 *
 * A board link used to fall through to the generic site card, so the most-shared
 * URL on the sports desk — the one that travels through WhatsApp groups —
 * advertised nothing about picks. This describes what is actually behind the
 * link: the fixture and pick when the URL names one, the model's published
 * record otherwise, and the sports card artwork rather than the site default.
 *
 * Deliberately says "not financial advice" in the description: a card is read by
 * people who never load the page, so the disclaimer cannot be page-only.
 */
export async function sportsShareCard(
  summary: TipsShareSummary,
  opts: { matchId?: string | null } = {}
): Promise<ShareCard> {
  const origin = await resolveSiteOrigin();
  let siteName = "connectPlus";
  try {
    siteName = (await getSiteConfig()).siteName;
  } catch {
    // keep the default
  }

  const suffix = opts.matchId ? `&match=${encodeURIComponent(opts.matchId)}` : "";
  const canonical = `${origin}/sports?tab=tips${suffix}`;
  const pick = summary.pick;

  const title = pick
    ? `${pick.fixture}: ${pick.selection} — ${pick.confidence}% from the model`
    : "Today's football picks, with the reasoning";

  const recordLine =
    summary.accuracy !== null
      ? `The model has been right ${summary.accuracy}% across ${summary.settled} settled picks.`
      : null;

  const description = pick
    ? [
        // The competition is omitted, not faked, when the provider only gave us
        // a code (`rus.1`) — a card that names a database key reads as a bug.
        pick.competition ? `${pick.competition}.` : null,
        "Every pick arrives with the reasons behind it — only picks you can still act on.",
        recordLine,
        "18+ — not financial advice.",
      ]
        .filter(Boolean)
        .join(" ")
    : [
        summary.livePicks > 0 ? `${summary.livePicks} actionable picks on the board right now.` : null,
        "Model-generated football picks, each with the reasoning behind it.",
        recordLine,
        "18+ — not financial advice.",
      ]
        .filter(Boolean)
        .join(" ");

  return {
    url: canonical,
    canonical,
    title,
    description,
    image: `${origin}/og-tips.png`,
    siteName,
    author: null,
    publishedTime: null,
    tags: ["Football", "Predictions", "Livescores", "Betting tips"],
    type: "website",
  };
}

/**
 * `WebPage` + `BreadcrumbList` for a static page.
 *
 * Returns a JSON string, already escaped: a `</script>` inside the payload must
 * not be able to close the tag it is embedded in.
 */
export function webPageJsonLd(params: {
  url: string;
  name: string;
  description: string;
  siteName: string;
  updated?: string;
}): string {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": params.url,
        url: params.url,
        name: params.name,
        description: params.description,
        inLanguage: "en",
        isPartOf: { "@type": "WebSite", name: params.siteName, url: new URL(params.url).origin },
        ...(params.updated ? { dateModified: params.updated } : {}),
        breadcrumb: { "@id": `${params.url}#breadcrumb` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${params.url}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: new URL(params.url).origin,
          },
          { "@type": "ListItem", position: 2, name: params.name, item: params.url },
        ],
      },
    ],
  };
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * `FAQPage` structured data for the questions a public page actually answers.
 *
 * Handing search engines the question/answer pairs verbatim is what lets a page
 * appear as an expandable result, and it is also what keeps the copy honest:
 * Google will not surface an answer that is not on the page, so the markup and
 * the prose have to agree. Only pass questions the page genuinely answers — a
 * mismatched FAQ is treated as spam, not as extra reach.
 *
 * Returns a JSON string, escaped the same way as `webPageJsonLd`.
 */
export function faqJsonLd(params: { url: string; questions: readonly FaqEntry[] }): string {
  const graph = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${params.url}#faq`,
    url: params.url,
    mainEntity: params.questions.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}
