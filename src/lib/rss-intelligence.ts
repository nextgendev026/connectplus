import { moderateContent, type ModerationRisk } from "@/lib/moderation";
import { extractEntities } from "@/lib/neural-text";

/**
 * The combined mind's intake layer for syndicated feeds.
 *
 * Every RSS item crossing into the platform passes through here before it
 * becomes a Post:
 *
 *   1. **Filter** — stubs, tag/category pages, classifieds and gambling promos
 *      never reach the feed; the existing moderation scanner runs on the raw
 *      text instead of imports being waved through as APPROVED.
 *   2. **Categorise** — a weighted keyword/entity read of the item picks one of
 *      the platform's categories, falling back to the feed's own routing hint.
 *
 * Everything is pure so it stays unit-testable: no database, no network.
 */

export interface FeedItemInput {
  title: string;
  url?: string | null;
  summary?: string | null;
  content?: string | null;
  /** The feed's configured routing hint (e.g. "News"). */
  feedCategory?: string | null;
  /** Human-readable source name, used for the relevance signals. */
  source?: string | null;
}

export interface CategoryGuess {
  slug: string;
  name: string;
  score: number;
  /** True when the item's own words decided it, false when a hint did. */
  confident: boolean;
  matched: string[];
}

export interface FeedItemVerdict {
  keep: boolean;
  /** Why the item was dropped — surfaced in poll logs for feed health. */
  reason?: string;
  category: CategoryGuess | null;
  moderation: ModerationRisk;
  /** Text the item was judged on (title + summary + content). */
  text: string;
}

interface CategoryRule {
  slug: string;
  name: string;
  /** Strong signals: a single hit is enough to make this the leading category. */
  strong: string[];
  /** Weak signals: only count when a strong signal agrees. */
  weak: string[];
}

/**
 * The platform's category taxonomy, from the seed. Kenyan media houses publish
 * mostly general news, so `news` carries politics/government/courts, and the
 * topical rules (business, tech, sports…) pull a story out of it when the words
 * are unambiguous.
 */
const RULES: CategoryRule[] = [
  {
    slug: "business",
    name: "Business",
    strong: [
      "shilling", "inflation", "treasury", "budget", "tax", "taxes", "kra", "central bank",
      "cbk", "gdp", "economy", "economic", "investors", "investment", "stock", "nse", "sacco",
      "revenue", "profit", "losses", "bank", "banks", "loan", "loans", "interest rate",
      "business", "trade", "export", "import", "manufacturer", "retail", "startup funding",
      "funding round", "acquisition", "ipo", "tender", "auction", "cbn", "afdb",
    ],
    weak: ["market", "markets", "price", "prices", "jobs", "salary", "employers", "sme"],
  },
  {
    slug: "technology",
    name: "Technology",
    strong: [
      "technology", "tech", "startup", "startups", "software", "app", "apps", "artificial intelligence",
      "ai", "machine learning", "data", "cyber", "hacking", "hackers", "digital", "internet", "online",
      "fintech", "mobile money", "mpesa", "m-pesa", "safaricom", "airtel", "telkom", "broadband",
      "smartphone", "crypto", "blockchain", "bitcoin", "innovation", "gadget", "chip", "satellite",
      "robotics", "drone", "cloud", "silicon savannah",
    ],
    weak: ["platform", "users", "system", "network", "payment", "e-commerce"],
  },
  {
    slug: "sports",
    name: "Sports",
    strong: [
      "football", "soccer", "harambee stars", "harambee starlets", "gor mahia", "afc leopards",
      "bandari", "tusker", "athletics", "marathon", "olympics", "world cup", "premier league",
      "la liga", "serie a", "champions league", "afcon", "caf", "fifa", "rugby", "cricket",
      "netball", "volleyball", "basketball", "boxing", "motorsport", "safari rally", "wrc",
      "coach", "fixture", "match", "goalkeeper", "striker", "league", "tournament", "medal",
      "sprinter", "kenyan athletes", "fifa",
    ],
    weak: ["team", "player", "players", "game", "games", "cup", "tour", "race", "club"],
  },
  {
    slug: "music",
    name: "Music",
    strong: [
      "music", "musician", "artist", "album", "single", "song", "songs", "band", "concert",
      "gengetone", "bongo flava", "bongo", "afrobeats", "gospel", "dj", "playlist", "rapper",
      "rapper", "vocalist", "studio session", "grammy", "collabo", "producer", "record label",
      "kiss 100", "radio jambo", "sauti sol", "nyashinski",
    ],
    weak: ["track", "remix", "perfomance", "performance", "stage", "tour"],
  },
  {
    slug: "culture",
    name: "Culture",
    strong: [
      "culture", "cultural", "heritage", "tradition", "traditional", "celebrity", "celebrities",
      "actor", "actress", "movie", "film", "series", "netflix", "showbiz", "gossip", "scandal",
      "relationship", "wedding", "polygamy", "museum", "art", "artist profile", "theatre",
      "theater", "literature", "book", "author", "fashion week", "miss world",
    ],
    weak: ["fashion", "style", "drama", "interview", "opinion"],
  },
  {
    slug: "lifestyle",
    name: "Lifestyle",
    strong: [
      "health", "hospital", "doctors", "nurses", "medics", "mental health", "wellness",
      "fitness", "nutrition", "diet", "pregnancy", "parenting", "family planning", "disease",
      "outbreak", "cholera", "malaria", "hiv", "covid", "cancer", "insurance", "education",
      "school", "students", "kcse", "kcpe", "university", "housing", "rent", "mortgage",
      "beauty", "skincare", "home decor", "gardening", "pets",
    ],
    weak: ["life", "people", "living", "tips", "how to", "guides"],
  },
  {
    slug: "food",
    name: "Food",
    strong: [
      "food", "recipe", "recipes", "restaurant", "restaurants", "chef", "cuisine", "cooking",
      "kitchen", "meal", "ugali", "nyama choma", "chapati", "pilau", "mandazi", "matoke",
      "menu", "buffet", "cafe", "café", "coffee", "tea estate", "farm produce", "street food",
      "bake", "bakery",
    ],
    weak: ["eat", "eating", "taste", "dish", "drinks"],
  },
  {
    slug: "travel",
    name: "Travel",
    strong: [
      "travel", "tourist", "tourism", "safari", "game drive", "maasai mara", "amboseli",
      "tsavo", "diani", "lamu", "malindi", "serengeti", "mount kenya", "kilimanjaro", "hotel",
      "resort", "lodge", "airline", "flight", "visa", "passport", "holiday", "vacation",
      "destination", "beach", "national park", "wildlife", "migration",
    ],
    weak: ["trip", "tour", "visit", "travelers", "travellers", "adventure"],
  },
  {
    slug: "news",
    name: "News",
    strong: [
      "president", "deputy president", "parliament", "mp", "mps", "senator", "senate", "governor",
      "county", "cabinet", "minister", "ministry", "government", "opposition", "election",
      "elections", "iebc", "petition", "court", "judge", "magistrate", "tribunal", "police",
      "dci", "arrest", "arrested", "charged", "prosecution", "corruption", "graft", "auditor",
      "protest", "demonstration", "strike", "bill", "act", "constitution", "impeachment",
      "ruto", "gachagua", "uhuru", "raila", "mudavadi", "county assembly", "crisis",
      "accident", "crash", "killed", "missing", "fire", "floods", "drought", "landslide",
      "kenya defence forces", "kdf", "al-shabaab", "united nations", "africa union",
    ],
    weak: ["news", "report", "statement", "says", "announced", "meeting", "plans", "country"],
  },
];

/** Items that are advertising or public notices rather than editorial content. */
const NOISE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(?:betting|bet\s?bonus|free\s?bet|jackpot|casino|aviatrix|aviator|odds|bookmaker)\b/i, reason: "gambling-promo" },
  { pattern: /\b(?:tenders?|request for proposal|rfp|prequalification|expression of interest)\b/i, reason: "classifieds-tender" },
  { pattern: /\b(?:obituary|death announcement|requiem mass|burial arrangement|condolence book)\b/i, reason: "classifieds-obituary" },
  { pattern: /\b(?:classifieds?|vacancy|vacancies|job advert|recruitment portal)\b/i, reason: "classifieds-advert" },
  { pattern: /\b(?:sponsored|advertorial|paid content|advertisement feature)\b/i, reason: "advertorial" },
  { pattern: /\b(?:click here to|sign up now|subscribe to read|download our app)\b/i, reason: "promo-cta" },
];

/** URLs that are index pages or feed plumbing, never a story. */
const NON_ARTICLE_URL = /\/(?:tag|tags|category|categories|author|authors|page|search|feed|rss|sitemap|about|contact|advertise|privacy|terms)(?:\/|$|\?)/i;

export const CATEGORY_SLUGS = RULES.map((rule) => rule.slug);

function countHits(haystack: string, terms: string[]): { count: number; matched: string[] } {
  let count = 0;
  const matched: string[] = [];
  for (const term of terms) {
    // Long terms get a real boundary check so "mp" stays out of "company".
    const pattern = new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`, "i");
    if (pattern.test(haystack)) {
      count += 1;
      matched.push(term);
    }
  }
  return { count, matched };
}

/**
 * Score an item against the taxonomy. Title hits weigh triple (that is where
 * the desk puts the story), and named places from neural-text add a relevance
 * bonus that keeps regional stories inside a topical category.
 */
export function classifyFeedItem(input: FeedItemInput): CategoryGuess | null {
  const title = (input.title ?? "").toLowerCase();
  const body = `${input.title ?? ""} ${input.summary ?? ""} ${input.content ?? ""}`.toLowerCase();
  if (title.length < 3 && body.length < 30) return null;

  const places = extractEntities(`${input.title ?? ""} ${input.summary ?? ""}`).filter(
    (e) => e.type === "place"
  ).length;

  let best: CategoryGuess | null = null;
  for (const rule of RULES) {
    const strong = countHits(body, rule.strong);
    const inTitle = countHits(title, [...rule.strong, ...rule.weak]);
    const weak = countHits(body, rule.weak).count;
    // Weak signals only sharpen a category that already has a strong hit.
    const score = strong.count * 3 + inTitle.count * 3 + (strong.count > 0 ? weak : 0);

    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = {
        slug: rule.slug,
        name: rule.name,
        score,
        confident: strong.count > 0,
        matched: [...new Set([...strong.matched, ...inTitle.matched])].slice(0, 6),
      };
    }
  }

  const hinted = hintCategory(input.feedCategory);
  if (!best) {
    if (!hinted) return null;
    return { ...hinted, score: 1, confident: false, matched: [] };
  }

  // A tie between a topical read and the feed's beat keeps the topical one, but
  // a confident feed hint wins when the item itself is ambiguous.
  if (hinted && !best.confident && hinted.slug !== best.slug) {
    return { ...hinted, score: best.score, confident: false, matched: best.matched };
  }

  // Naming a place strengthens regional relevance without changing the category.
  if (places > 0) best.score += places;

  return best;
}

/** Resolve a feed's configured category label to a taxonomy entry. */
export function hintCategory(hint?: string | null): CategoryGuess | null {
  if (!hint) return null;
  const key = hint.trim().toLowerCase();
  // Media-house feeds are labelled "News" in the registry even when they carry
  // business or sports desks, so map common alternates onto the taxonomy.
  const aliases: Record<string, string> = {
    news: "news",
    general: "news",
    politics: "news",
    world: "news",
    national: "news",
    tech: "technology",
    technology: "technology",
    science: "technology",
    business: "business",
    economy: "business",
    finance: "business",
    markets: "business",
    sports: "sports",
    sport: "sports",
    football: "sports",
    entertainment: "culture",
    showbiz: "culture",
    celebrity: "culture",
    culture: "culture",
    arts: "culture",
    music: "music",
    lifestyle: "lifestyle",
    health: "lifestyle",
    education: "lifestyle",
    food: "food",
    travel: "travel",
    tourism: "travel",
  };
  const slug = aliases[key] ?? (CATEGORY_SLUGS.includes(key) ? key : null);
  if (!slug) return null;
  const rule = RULES.find((r) => r.slug === slug);
  return rule ? { slug: rule.slug, name: rule.name, score: 0, confident: false, matched: [] } : null;
}

/**
 * Decide whether an item becomes a story at all, and run it through the same
 * moderation scanner posts go through. Imports used to be inserted as APPROVED
 * unconditionally, which meant a feed could push anything it liked into the
 * public timeline.
 */
export function evaluateFeedItem(input: FeedItemInput): FeedItemVerdict {
  const text = [input.title, input.summary, input.content].filter(Boolean).join("\n").trim();

  const reject = (reason: string, moderation: ModerationRisk, category: CategoryGuess | null = null): FeedItemVerdict => ({
    keep: false,
    reason,
    category,
    moderation,
    text,
  });

  const title = (input.title ?? "").trim();
  const moderation = moderateContent(title, text);
  const category = classifyFeedItem(input);

  if (title.length < 20) return reject("title-too-short", moderation, category);
  if (text.length < 120) return reject("no-article-body", moderation, category);
  if (input.url && NON_ARTICLE_URL.test(input.url)) return reject("index-page", moderation, category);

  for (const { pattern, reason } of NOISE_PATTERNS) {
    if (pattern.test(text)) return reject(reason, moderation, category);
  }

  if (moderation.suggested === "REJECTED") return reject("moderation-rejected", moderation, category);

  return { keep: true, category, moderation, text };
}
