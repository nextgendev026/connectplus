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
  | "general_platform"
  | "unknown";

interface IntentPattern {
  intent: Intent;
  keywords: string[];
  phrases: string[];
  boostKeywords: string[];
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: "system_health",
    keywords: ["health", "status", "system", "uptime", "diagnostics", "operational", "running", "working"],
    phrases: ["system status", "how is the system", "platform health", "system health", "how are things"],
    boostKeywords: ["all", "services", "running", "working"],
  },
  {
    intent: "content_analysis",
    keywords: ["content", "posts", "articles", "blog", "topics", "quality", "tags", "categories", "publishing"],
    phrases: ["content analysis", "analyze content", "top posts", "best posts", "what topics", "content quality"],
    boostKeywords: ["engagement", "views", "popular", "trending"],
  },
  {
    intent: "user_analysis",
    keywords: ["users", "user", "growth", "signup", "registrations", "active", "members", "audience"],
    phrases: ["user analysis", "user growth", "how many users", "user report", "user activity"],
    boostKeywords: ["new", "retention", "churn", "engagement"],
  },
  {
    intent: "moderation_report",
    keywords: ["moderation", "moderate", "flagged", "review", "queue", "pending", "rejected", "approved"],
    phrases: ["moderation status", "moderation report", "flagged content", "review queue", "moderation queue"],
    boostKeywords: ["spam", "abuse", "approve", "reject"],
  },
  {
    intent: "threat_scan",
    keywords: ["threat", "security", "attack", "suspicious", "malicious", "breach", "vulnerability", "risk"],
    phrases: ["threat scan", "security check", "security scan", "any threats", "threat level"],
    boostKeywords: ["hack", "spam", "bot", "ddos"],
  },
  {
    intent: "growth_report",
    keywords: ["growth", "trend", "forecast", "prediction", "project", "metrics", "kpi", "report"],
    phrases: ["growth report", "growth forecast", "how is growth", "growth trends", "platform report"],
    boostKeywords: ["increase", "decrease", "month", "week", "quarter"],
  },
  {
    intent: "regional_analysis",
    keywords: ["region", "city", "node", "nairobi", "kampala", "dar", "kigali", "geographic", "area"],
    phrases: ["regional analysis", "which city", "regional breakdown", "node activity", "city stats"],
    boostKeywords: ["location", "country", "district"],
  },
  {
    intent: "trend_query",
    keywords: ["trend", "trending", "hot", "popular", "buzz", "news", "happening"],
    phrases: ["what's trending", "trending topics", "hot topics", "what's new", "what is happening"],
    boostKeywords: ["now", "today", "recently", "latest"],
  },
  {
    intent: "hive_report",
    keywords: ["hive", "brain", "mind", "learned", "learnt", "learnings", "intelligence", "remember", "memories", "recall"],
    phrases: ["hive mind", "hive report", "hive status", "what have you learned", "what did you learn", "what do you remember", "your intelligence", "brain report", "learning report"],
    boostKeywords: ["ai", "machine", "ml", "knowledge", "yesterday", "today"],
  },
  {
    intent: "recommendation",
    keywords: ["recommend", "recommendation", "suggest", "suggestion", "discover", "personalized", "feed"],
    phrases: ["what should i read", "what should i read next", "recommend some posts", "suggest what to read", "recommend content", "give me recommendations", "populate my feed", "what's worth reading", "what should you show me", "show me something good"],
    boostKeywords: ["article", "post", "trending", "interesting", "top", "fresh"],
  },
  {
    intent: "external_learn",
    keywords: ["learn", "fetch", "crawl", "scrape", "analyze url", "read page"],
    phrases: ["learn from", "fetch this", "analyze this url", "learn from this page", "crawl this"],
    boostKeywords: ["http", "www", ".com", ".org"],
  },
  {
    intent: "knowledge_search",
    keywords: ["knowledge", "memory", "know", "learned", "recall", "search"],
    phrases: ["search knowledge", "what do you know", "check knowledge", "search the memory"],
    boostKeywords: ["find", "search", "look up"],
  },
  {
    intent: "memory_manage",
    keywords: ["forget", "clear memory", "remove knowledge", "delete memory"],
    phrases: ["delete memory", "clear knowledge base", "forget this", "remove knowledge"],
    boostKeywords: ["remove", "clear", "purge"],
  },
];

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
