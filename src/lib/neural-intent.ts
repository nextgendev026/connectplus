export type Intent =
  | "system_health"
  | "content_analysis"
  | "user_analysis"
  | "moderation_report"
  | "threat_scan"
  | "growth_report"
  | "regional_analysis"
  | "trend_query"
  | "hive_report"
  | "recommendation"
  | "external_learn"
  | "knowledge_search"
  | "memory_manage"
  | "run_sweep"
  | "general_platform"
  | "unknown";

export interface IntentPattern {
  intent: Intent;
  keywords: string[];
  phrases: string[];
  boostKeywords: string[];
}

// The classifier below is the fixed "logic wiring" of the Neural Mind. Every
// phrase an admin has used before is ALSO persisted into the Hive Brain as an
// intent-map memory (see learnFromInteraction) and re-injected here via
// `applyLearnedAliases`, so the brains literally grow their grasp of how the
// admin asks over time.
const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: "system_health",
    keywords: ["health", "status", "system", "uptime", "diagnostics", "operational", "running", "working", "healthy", "performance", "swahili", "hali"],
    phrases: [
      "system status", "how is the system", "platform health", "system health",
      "how are things", "is everything ok", "how is everything", "system check",
      "check the system", "how is the platform doing", "what is the state of things",
      "how are we doing", "everything working", "all systems go",
    ],
    boostKeywords: ["all", "services", "running", "working", "ok", "fine", "good", "check"],
  },
  {
    intent: "content_analysis",
    keywords: ["content", "posts", "articles", "blog", "topics", "quality", "tags", "categories", "publishing", "stories", "ambitious"],
    phrases: [
      "content analysis", "analyze content", "analyze the posts", "top posts", "best posts",
      "what topics", "content quality", "how is content doing", "content performance",
      "what are people writing about", "what is being written", "what do the posts talk about",
      "analyse the stories", "what topics dominate", "topic report",
    ],
    boostKeywords: ["engagement", "views", "popular", "trending", "topics", "written", "writing"],
  },
  {
    intent: "user_analysis",
    keywords: ["users", "user", "growth", "signup", "registrations", "active", "members", "audience", "writers", "sign-ups"],
    phrases: [
      "user analysis", "user growth", "how many users", "user report", "user activity",
      "how are users growing", "user numbers", "who is joining", "new members",
      "how is the audience", "user engagement stats",
    ],
    boostKeywords: ["new", "retention", "churn", "engagement", "joined", "signing"],
  },
  {
    intent: "moderation_report",
    keywords: ["moderation", "moderate", "flagged", "review", "queue", "pending", "rejected", "approved", "approve", "reject", "spam", "abuse"],
    phrases: [
      "moderation status", "moderation report", "flagged content", "review queue",
      "moderation queue", "what needs review", "what is pending", "content to approve",
      "show me the queue", "what is waiting for approval", "review pending posts",
    ],
    boostKeywords: ["spam", "abuse", "approve", "reject", "pending", "flag"],
  },
  {
    intent: "threat_scan",
    keywords: ["threat", "security", "attack", "suspicious", "malicious", "breach", "vulnerability", "risk", "safe", "anon", "bot"],
    phrases: [
      "threat scan", "security check", "security scan", "any threats", "threat level",
      "scan for threats", "is the platform secure", "are we under attack",
      "any security issues", "run a security scan",
    ],
    boostKeywords: ["hack", "spam", "bot", "ddos", "attack", "intrusion"],
  },
  {
    intent: "growth_report",
    keywords: ["growth", "trend", "forecast", "prediction", "project", "metrics", "kpi", "report", "numbers", "overview"],
    phrases: [
      "growth report", "growth forecast", "how is growth", "growth trends", "platform report",
      "overall report", "give me the numbers", "performance overview", "30 day report",
      "weekly report", "monthly report", "how much have we grown",
    ],
    boostKeywords: ["increase", "decrease", "month", "week", "quarter", "30", "days"],
  },
  {
    intent: "regional_analysis",
    keywords: ["region", "city", "node", "nairobi", "kampala", "dar", "kigali", "geographic", "area", "countries", "regions"],
    phrases: [
      "regional analysis", "which city", "regional breakdown", "node activity", "city stats",
      "how are the regions", "regional performance", "where are users from",
      "which cities are active",
    ],
    boostKeywords: ["location", "country", "district", "mombasa", "arusha", "region"],
  },
  {
    intent: "trend_query",
    keywords: ["trend", "trending", "hot", "popular", "buzz", "news", "happening"],
    phrases: [
      "what's trending", "whats trending", "trending topics", "hot topics", "what's new",
      "what is happening", "whats happening", "what is hot", "what should people be reading",
      "what are the hot stories", "trending right now", "what is buzzing",
    ],
    boostKeywords: ["now", "today", "recently", "latest", "week", "topics"],
  },
  {
    intent: "hive_report",
    keywords: ["hive", "brain", "mind", "learned", "learnt", "learnings", "intelligence", "remember", "memories", "recall", "knowledge base"],
    phrases: [
      "hive mind", "hive report", "hive status", "what have you learned",
      "what did you learn", "what do you remember", "your intelligence", "brain report",
      "learning report", "what does the hive know", "hive knowledge", "what have you been fed",
      "what do you know", "show my hive", "hive intelligence",
    ],
    boostKeywords: ["ai", "machine", "ml", "knowledge", "yesterday", "today", "feed", "logic"],
  },
  {
    intent: "recommendation",
    keywords: ["recommend", "recommendation", "suggest", "suggestion", "discover", "personalized", "feed", "read"],
    phrases: [
      "what should i read", "what should i read next", "recommend some posts",
      "suggest what to read", "recommend content", "give me recommendations",
      "populate my feed", "what's worth reading", "what should you show me",
      "show me something good", "what should i publish", "suggest a topic to write about",
      "what should i write", "give me story ideas",
    ],
    boostKeywords: ["article", "post", "trending", "interesting", "top", "fresh", "idea", "topic"],
  },
  {
    intent: "external_learn",
    keywords: ["learn", "fetch", "crawl", "scrape", "analyze url", "read page", "teach"],
    phrases: [
      "learn from", "fetch this", "analyze this url", "learn from this page", "crawl this",
      "go and learn", "teach yourself", "study this", "read this url", "learn from this article",
    ],
    boostKeywords: ["http", "www", ".com", ".org", "url", "link", "site"],
  },
  {
    intent: "knowledge_search",
    keywords: ["knowledge", "memory", "know", "search"],
    phrases: [
      "search knowledge", "what do you know about", "check knowledge", "search the memory",
      "look up", "find what you know", "what have you learned about", "tell me about",
      "do you remember anything about",
    ],
    boostKeywords: ["find", "search", "look up", "about"],
  },
  {
    intent: "memory_manage",
    keywords: ["forget", "clear", "delete", "purge", "wipe", "remove"],
    phrases: [
      "clear your memory", "clear the memory", "delete memory", "clear knowledge base",
      "forget everything", "wipe the hive", "clear the brain", "delete everything you learned",
    ],
    boostKeywords: ["remove", "clear", "purge", "wipe", "all"],
  },
  {
    intent: "run_sweep",
    keywords: ["sweep", "scan posts", "learn from posts", "ingest", "index", "sync"],
    phrases: [
      "run a sweep", "sweep the posts", "learn from the posts", "ingest new posts",
      "scrape the feeds", "update the brain", "run training", "train the brains",
      "run the learning cycle", "sweep everything",
    ],
    boostKeywords: ["posts", "feed", "learn", "train", "run", "update"],
  },
];

// ── Learned-alias injection ──
// The Hive Brain persists every admin question as a small "intent-map" memory.
// We inject those learned phrases here so the Neural Mind's grasp sharpens with
// usage. Pass in an array of learned phrases: { phrase, intent }.
export function applyLearnedAliases(
  input: string,
  learned: { phrase: string; intent: Intent }[]
): Intent | null {
  if (learned.length === 0) return null;
  const lowerInput = input.toLowerCase();
  const hits = new Map<Intent, number>();
  for (const item of learned) {
    if (item.phrase && lowerInput.includes(item.phrase.toLowerCase())) {
      hits.set(item.intent, (hits.get(item.intent) ?? 0) + 1);
    }
  }
  let best: Intent | null = null;
  let bestCount = 0;
  for (const [intent, count] of hits) {
    if (count > bestCount) {
      best = intent;
      bestCount = count;
    }
  }
  return best;
}

export function classifyIntent(input: string): { intent: Intent; confidence: number; matchedPatterns: string[] } {
  const lowerInput = input.toLowerCase().replace(/[^\w\s]/g, "");
  const tokens = lowerInput.split(/\s+/);

  let bestIntent: Intent = "general_platform";
  let bestScore = 0;
  let bestMatches: string[] = [];

  for (const pattern of INTENT_PATTERNS) {
    let score = 0;
    const matched: string[] = [];

    for (const kw of pattern.keywords) {
      if (tokens.includes(kw) || lowerInput.includes(kw)) {
        score += 1;
        matched.push(`kw:${kw}`);
      }
    }

    for (const phrase of pattern.phrases) {
      if (lowerInput.includes(phrase)) {
        score += 3;
        matched.push(`phrase:${phrase}`);
      }
    }

    for (const bk of pattern.boostKeywords) {
      if (tokens.includes(bk) || lowerInput.includes(bk)) {
        score += 0.5;
        matched.push(`boost:${bk}`);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIntent = pattern.intent;
      bestMatches = matched;
    }
  }

  const confidence = bestScore > 0 ? Math.min(bestScore / 6, 1.0) : 0;
  if (bestScore < 1.5) {
    return { intent: "unknown", confidence: 0, matchedPatterns: [] };
  }
  return { intent: bestIntent, confidence, matchedPatterns: bestMatches };
}

export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  return text.match(urlRegex) || [];
}

export function isUrl(text: string): boolean {
  const cleaned = text.trim();
  return /^https?:\/\/[^\s]+$/.test(cleaned);
}