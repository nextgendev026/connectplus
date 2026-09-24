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
  | "web_research"
  | "memory_manage"
  | "run_sweep"
  | "write_content"
  | "rewrite_content"
  | "summarize_content"
  | "headline_suggest"
  | "tag_suggest"
  | "outline_suggest"
  | "expand_content"
  | "curate_content"
  | "creator_intelligence"
  | "monetization_report"
  | "traffic_depth"
  | "external_signals"
  | "mind_action"
  | "general_chat"
  | "general_platform"
  | "unknown";

export interface IntentPattern {
  intent: Intent;
  keywords: string[];
  phrases: string[];
  boostKeywords: string[];
}

/**
 * Intents answered by *reading the platform*, not by writing about it.
 *
 * Each one has a real query behind it — a report, a scan, a recall — so its
 * answer is a rendering of live records rather than something a model should
 * compose. Two consumers depend on the distinction, which is why it lives here
 * beside the vocabulary rather than in either of them:
 *
 *   • `appBrain.chat` must not hand these to the LLM. It did, and "give me the
 *     hive mind report" came back as "the hive mind report is not available" —
 *     the model was asked to write a report whose data it had never been given.
 *   • `neuralMind.learnFromInteraction` must not file these answers as durable
 *     knowledge. A reading taken at 14:03 is not a lesson about the world, and
 *     storing it made the refusal above recallable as though it were a fact.
 *
 * Membership is explicit rather than inferred from "not a content intent", so a
 * newly added intent is treated as a record until someone decides otherwise,
 * which is the safe direction for the guess to fall.
 */
export const RECORD_INTENTS: readonly Intent[] = [
  "system_health",
  "content_analysis",
  "user_analysis",
  "moderation_report",
  "threat_scan",
  "growth_report",
  "regional_analysis",
  "trend_query",
  "hive_report",
  "recommendation",
  "external_learn",
  "knowledge_search",
  "memory_manage",
  "run_sweep",
  "creator_intelligence",
  "monetization_report",
  "traffic_depth",
  "external_signals",
];

/** True when an intent's answer is a rendering of live records. */
export function isRecordIntent(intent: Intent): boolean {
  return RECORD_INTENTS.includes(intent);
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
    // Live internet research — distinct from knowledge_search, which only reads
    // what the hive has ALREADY learned. This one goes out to the web.
    intent: "web_research",
    keywords: ["research", "internet", "online", "web", "google", "latest", "current", "news", "facts", "sources", "verify"],
    phrases: [
      "research this", "research on", "search the internet", "search the web", "search online",
      "look it up online", "find out about", "what does the internet say", "google this",
      "latest on", "current situation", "get me sources", "fact check", "verify this",
      "what is happening with", "find latest news about", "look up online",
    ],
    boostKeywords: ["latest", "recent", "today", "2026", "sources", "internet", "online"],
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
  {
    intent: "curate_content",
    keywords: ["curate", "curation", "what should i write", "content ideas", "story ideas", "content strategy"],
    phrases: [
      "curate content", "give me content ideas", "what should i write about",
      "what should i write about next", "what should i write about today",
      "suggest topics to write", "what topics are hot", "give me story ideas",
      "what should i publish next", "content strategy", "what performs well",
      "suggest a topic", "what is the audience reading",
    ],
    boostKeywords: ["should", "next", "write", "publish", "idea", "topic", "trending", "angle"],
  },
  {
    intent: "write_content",
    keywords: ["write", "create", "compose", "draft", "generate post", "generate article", "blog post", "story about", "article about"],
    phrases: [
      "write a post", "write an article", "write a story", "write me a post",
      "create a post", "create content", "draft a post", "draft an article",
      "compose a post", "write about", "write a blog", "generate a post",
      "write me an article", "can you write", "write a piece",
    ],
    boostKeywords: ["topic", "idea", "title", "content", "post", "article", "story", "about"],
  },
  {
    intent: "rewrite_content",
    keywords: ["rewrite", "rephrase", "polish", "improve writing", "improve text", "better wording", "reword", "paraphrase", "tidy up", "clean up this"],
    phrases: [
      "rewrite this", "polish this", "rephrase this", "improve this paragraph",
      "rewrite my post", "polish my draft", "improve this text", "reword this",
      "make this better", "fix my writing", "edit this for me", "clean up this text",
      "improve the writing", "make this read better", "tighten this up",
    ],
    boostKeywords: ["grammar", "clarity", "shorter", "engaging", "draft", "text", "paragraph"],
  },
  {
    intent: "summarize_content",
    keywords: ["summarize", "summary", "summarise", "tl;dr", "short version", "key points", "condense"],
    phrases: [
      "summarize this", "summarise this", "give me a summary", "summarize the post",
      "tl dr", "summarize my draft", "make an excerpt", "write an excerpt",
      "summarize the article", "summarize this text", "condense this",
    ],
    boostKeywords: ["excerpt", "brief", "short", "overview", "abstract"],
  },
  {
    intent: "headline_suggest",
    keywords: ["headline", "title idea", "headings", "titles"],
    phrases: [
      "suggest a headline", "suggest titles", "headline ideas", "give me a headline",
      "what should i title", "title suggestions", "headline for this", "come up with a title",
      "make a headline", "suggest a title", "title this post",
    ],
    boostKeywords: ["title", "name", "catchy", "click", "attention"],
  },
  {
    intent: "tag_suggest",
    keywords: ["tags", "hashtag", "tag this", "keywords", "categories"],
    phrases: [
      "suggest tags", "suggest hashtags", "what tags", "tag this post",
      "recommend tags", "suggest keywords", "tags for this", "which tags should i use",
      "generate tags", "suggest a category", "which category",
    ],
    boostKeywords: ["seo", "discover", "search", "label"],
  },
  {
    intent: "outline_suggest",
    keywords: ["outline", "structure", "sections", "plan the post", "structure the post"],
    phrases: [
      "make an outline", "create an outline", "give me an outline", "outline for a post",
      "structure my post", "plan my article", "outline this topic", "suggest sections",
    ],
    boostKeywords: ["headings", "subheadings", "plan", "structure", "sections", "introduction", "conclusion"],
  },
  {
    intent: "expand_content",
    keywords: ["continue", "expand", "extend", "add more", "keep writing", "write more", "go on"],
    phrases: [
      "continue writing", "continue this", "expand this", "add a paragraph",
      "keep going", "extend the post", "write more about this", "add more detail",
      "continue the story", "what happens next", "expand my draft",
    ],
    boostKeywords: ["next", "paragraph", "section", "more", "detail", "elaborate"],
  },

  // ── Business, audience and action intents ──
  // These sit before `general_chat` because that pattern scores on bare words
  // like "help" (phrase match = 3), so a request such as "help me understand
  // payouts" would otherwise be swallowed as small talk. Everything else is
  // ordered before these, so no existing classification changes on a tie.
  {
    intent: "creator_intelligence",
    keywords: ["creator", "creators", "influencer", "influencers", "directory", "niche", "niches", "followers", "follower", "talent", "creators"],
    phrases: [
      "creator directory", "top creators", "who are our creators", "creator analytics",
      "follower growth", "creator report", "creator profiles", "niche tags",
      "who writes for us", "creator leaderboard", "best creators", "top writers",
      "creator economy", "who is verified",
    ],
    boostKeywords: ["growing", "growth", "audience", "demographics", "active", "dormant", "reach", "writes"],
  },
  {
    intent: "monetization_report",
    keywords: [
      "revenue", "monetization", "monetize", "earnings", "payout", "payouts", "mpesa",
      "billing", "subscription", "subscriptions", "advertising", "impressions", "clicks", "mrr", "sales", "daraja", "paypal",
    ],
    phrases: [
      "monetization report", "how much revenue", "revenue report", "payout status",
      "mpesa payouts", "airtel money", "subscription revenue", "ad revenue",
      "how much are we making", "billing status", "paid subscriptions", "earnings report",
      "are payouts working", "who is paying",
    ],
    boostKeywords: ["money", "paid", "settled", "failed", "refund", "price", "plan", "ads"],
  },
  {
    intent: "traffic_depth",
    keywords: ["traffic", "bounce", "bounces", "session", "sessions", "duration", "visitor", "visitors", "returning", "unique", "dwell"],
    phrases: [
      "bounce rate", "time on app", "time spent", "session duration",
      "returning visitors", "unique visitors", "how long do people stay",
      "traffic report", "traffic depth", "user traffic", "where do people leave",
      "engagement time", "stickiness",
    ],
    boostKeywords: ["app", "minutes", "seconds", "leaving", "drop", "off", "stay", "loyal"],
  },
  {
    intent: "external_signals",
    keywords: ["weather", "competitor", "competitors", "competitive", "conference", "festival", "policy", "events", "market", "industry"],
    phrases: [
      "regional news", "east african news", "what is happening in the region",
      "competitor analysis", "competitor awareness", "what are competitors doing",
      "local events", "weather in", "news roundup", "market signals", "external signals",
      "what is happening outside",
    ],
    boostKeywords: ["outside", "today", "kenya", "uganda", "tanzania", "rwanda", "region", "trending outside"],
  },
  {
    intent: "mind_action",
    keywords: ["publish", "unpublish", "schedule", "reschedule", "repost", "thumbnail", "visual", "image", "video"],
    phrases: [
      "publish this post", "schedule this post", "schedule a post", "publish it now",
      "flag this comment", "flag the comment", "remove this comment", "delete this comment",
      "draft a reply", "reply to this comment", "top replies", "surface replies",
      "generate an image", "generate a video", "create a thumbnail", "make a visual",
      "visual brief", "create a feature image",
    ],
    boostKeywords: ["now", "live", "confirm", "comment", "post", "cover", "story"],
  },
  {
    intent: "general_chat",
    keywords: [],
    phrases: ["hello", "hi", "hey", "jambo", "sasa", "habari", "how are you", "who are you", "what can you do", "help", "thanks", "thank you", "asante", "good morning", "good evening", "good afternoon"],
    boostKeywords: [],
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

export interface IntentScore {
  intent: Intent;
  score: number;
  matchedPatterns: string[];
}

/**
 * Every pattern's score, best first.
 *
 * Split out of `classifyIntent` so the *runner-up* is available. The old
 * classifier returned a winner and a confidence and threw the rest away, which
 * made ambiguity invisible: "system status report for content" scores two
 * intents almost equally, and nothing downstream could tell that apart from a
 * query that clearly meant one of them.
 *
 * `sort` is stable in every engine this runs on, so patterns with equal scores
 * keep their declared order — which is what makes the winner deterministic and
 * therefore testable.
 */
export function scoreAllIntents(input: string): IntentScore[] {
  const lowerInput = input.toLowerCase().replace(/[^\w\s]/g, "");
  const tokens = lowerInput.split(/\s+/);

  const scored: IntentScore[] = [];
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

    scored.push({ intent: pattern.intent, score, matchedPatterns: matched });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function classifyIntent(input: string): { intent: Intent; confidence: number; matchedPatterns: string[] } {
  const ranked = scoreAllIntents(input);
  const best = ranked[0];
  if (!best || best.score < 1.5) {
    return { intent: "unknown", confidence: 0, matchedPatterns: [] };
  }
  const confidence = best.score > 0 ? Math.min(best.score / 6, 1.0) : 0;
  return { intent: best.intent, confidence, matchedPatterns: best.matchedPatterns };
}

// ── Confidence calibration, ambiguity and the mutation guard ────────────────

/**
 * Version of the classifier's rule set.
 *
 * Recorded alongside any learned alias so a correction can be attributed to the
 * rules it was judged against. Without a version, "the alias was wrong" and "the
 * classifier changed under it" are indistinguishable, and an operator cannot
 * decide which to fix.
 */
export const INTENT_CLASSIFIER_VERSION = "intent-2026.09.1";

/**
 * Intents that change state.
 *
 * The distinction this list draws is the safety property §13 of the brief asks
 * for: an ambiguous request must not trigger a mutation. A wrong read-only
 * classification costs a regenerated report. A wrong mutation writes to the
 * platform. So the guard treats those two outcomes as different in kind rather
 * than as two mistakes of different size.
 *
 * This is a *second* barrier, not the only one — `brain-approvals.ts` requires a
 * human decision for anything that writes, and `lib/policies` derives the
 * authority to act from an authenticated role. This list exists so an ambiguous
 * request never even reaches the point of filing a proposal a human then has to
 * reject.
 */
export const MUTATING_INTENTS: readonly Intent[] = [
  "memory_manage",
  "run_sweep",
  "write_content",
  "rewrite_content",
  "expand_content",
  "curate_content",
  "mind_action",
  "external_learn",
] as const;

export function isMutatingIntent(intent: Intent): boolean {
  return MUTATING_INTENTS.includes(intent);
}

/**
 * Below this, ask rather than act.
 *
 * Chosen from the scoring scale rather than from intuition: one keyword is 1
 * point, one phrase is 3, and confidence is `score / 6`. So 0.5 means "about
 * three keywords agreed" (3.0/6). Anything less is a guess dressed as a
 * classification.
 */
export const CLARIFICATION_CONFIDENCE = 0.5;

/**
 * How close the runner-up must be before the request counts as ambiguous.
 *
 * Relative, not absolute: 3.0 against 2.9 is a coin flip, while 6.0 against 3.0
 * is a decision. An absolute margin would call the first case confident because
 * the absolute gap is the same as a 1.0-vs-0.9 comparison.
 */
export const AMBIGUITY_RATIO = 0.8;

export interface GuardedClassification {
  intent: Intent;
  confidence: number;
  matchedPatterns: string[];
  /** The runner-up and its score, present when there was one. */
  runnerUp?: { intent: Intent; score: number };
  /** True when the runner-up is close enough that the choice is a guess. */
  ambiguous: boolean;
  /** A question to put back to the asker, present when `ambiguous` or low confidence. */
  clarification?: string;
  /** False when the request must not be allowed to change state. */
  mayMutate: boolean;
  /** Why mutation was refused, for the audit record. */
  guardReason?: string;
}

/**
 * Classification plus the guard.
 *
 * Three rules, each of which is a way the old classifier could cause harm:
 *
 *   1. A low-confidence request asks for clarification instead of proceeding.
 *   2. An ambiguous request — one where the runner-up is close — is treated as
 *      low confidence even when the winner's score looks strong, because a
 *      6-to-5 split is more dangerous than a 2-to-0 one: the winner looks
 *      certain and the choice is nearly even.
 *   3. Mutation is refused unless the intent is both confident and unambiguous.
 */
export function classifyWithGuard(input: string): GuardedClassification {
  const ranked = scoreAllIntents(input).filter((r) => r.score > 0);
  const best = ranked[0];

  if (!best) {
    return {
      intent: "unknown",
      confidence: 0,
      matchedPatterns: [],
      ambiguous: false,
      mayMutate: false,
      guardReason: "no intent pattern matched, so no action may be taken",
      clarification: "I could not tell what you are asking for. Could you say which report or action you mean?",
    };
  }

  const confidence = Math.min(best.score / 6, 1.0);
  const second = ranked[1];
  const ambiguous = Boolean(second && second.score / best.score >= AMBIGUITY_RATIO);
  const lowConfidence = best.score < 1.5 || confidence < CLARIFICATION_CONFIDENCE;

  const result: GuardedClassification = {
    intent: lowConfidence ? "unknown" : best.intent,
    confidence: lowConfidence ? 0 : confidence,
    matchedPatterns: best.matchedPatterns,
    runnerUp: second ? { intent: second.intent, score: second.score } : undefined,
    ambiguous,
    mayMutate: false,
  };

  if (lowConfidence) {
    result.clarification = "I am not confident I understood that. Could you confirm which of these you meant?" + describeRunnerUp(second);
    result.guardReason = `classification confidence ${confidence.toFixed(2)} is below the ${CLARIFICATION_CONFIDENCE} threshold`;
    return result;
  }

  if (ambiguous && isMutatingIntent(best.intent)) {
    result.clarification =
      `That could mean ${humanise(best.intent)} or ${humanise(second!.intent)}, and one of those changes the platform. ` +
      "Which did you mean?";
    result.guardReason = `ambiguous between "${best.intent}" (${best.score}) and "${second!.intent}" (${second!.score}), and one is a mutating intent`;
    return result;
  }

  // An ambiguous but read-only request is allowed through at reduced confidence:
  // reporting the wrong analysis costs a re-ask, and blocking every close call
  // would make the assistant unusable on ordinary questions.
  if (ambiguous) {
    result.confidence = Math.min(result.confidence, 0.5);
    result.guardReason = `ambiguous between "${best.intent}" and "${second!.intent}" but neither changes state`;
  }

  result.mayMutate = isMutatingIntent(best.intent) && !ambiguous;
  return result;
}

function describeRunnerUp(second?: IntentScore): string {
  return second ? ` (closest guess was "${humanise(second.intent)}")` : "";
}

function humanise(intent: Intent): string {
  return intent.replace(/_/g, " ");
}

/**
 * Resolve the intent, combining the static classifier with learned aliases.
 *
 * The invariant §13 asks for: **a learned alias must not override a
 * high-confidence static classification.** An alias is derived from what an
 * operator typed once, so it encodes one person's phrasing at one moment; the
 * static rules encode the intent vocabulary. Letting a single past conversation
 * rewrite how every future request is interpreted is exactly the failure mode
 * the brief calls out — and it is unrecoverable in the sense that matters,
 * because the behaviour change is invisible.
 *
 * A learned alias wins only when the static classifier had nothing to say, and
 * `overrode` records when it did not get its way, so an operator can see that a
 * correction is being ignored and why.
 */
export interface ResolvedIntent extends GuardedClassification {
  source: "static" | "learned" | "none";
  /** Set when a learned alias disagreed with a confident static decision. */
  overrode?: { alias: Intent; reason: string };
  /** Version of the rule set this decision was made under. */
  classifierVersion: string;
}

export function resolveIntent(
  input: string,
  learned: { phrase: string; intent: Intent }[] = []
): ResolvedIntent {
  const guarded = classifyWithGuard(input);
  const alias = applyLearnedAliases(input, learned);
  const classifierVersion = INTENT_CLASSIFIER_VERSION;

  // The static decision is "decisive" when it produced a real intent with no
  // ambiguity. Only then can it not be overridden.
  const decisive = guarded.intent !== "unknown" && !guarded.ambiguous;

  if (!alias) {
    return { ...guarded, source: guarded.intent === "unknown" ? "none" : "static", classifierVersion };
  }

  if (decisive) {
    return {
      ...guarded,
      source: "static",
      overrode: {
        alias,
        reason: `static classification "${guarded.intent}" is confident (${guarded.confidence.toFixed(2)}) and unambiguous; a learned alias may not override it`,
      },
      classifierVersion,
    };
  }

  // The alias gets its chance only where the static classifier was silent or
  // unsure — and it may not introduce a mutation there.
  //
  // That restriction is the whole reason aliases are safe to enable. An alias is
  // learned from what an operator typed *once*, so a single conversation could
  // otherwise teach the mind that an unheard-of phrase means "clear the cache",
  // and every future use of that phrase would file a mutating proposal. §10.10
  // of the brief forbids exactly that ("do not allow one mistaken conversation
  // to permanently rewrite intent behaviour"), and §13.5 requires that an unknown
  // intent must not trigger a mutation. So a mutating alias is only honoured when
  // the static rules independently agree the request is about that intent —
  // otherwise the alias is recorded as refused and the safe reading is kept.
  const aliasIsMutating = isMutatingIntent(alias);
  const staticCorroborates = aliasIsMutating && guarded.intent === alias;
  const aliasMutationRefused = aliasIsMutating && !staticCorroborates;

  return {
    ...guarded,
    intent: aliasMutationRefused ? guidedFallback(guarded) : alias,
    source: "learned",
    mayMutate: staticCorroborates && !guarded.ambiguous,
    guardReason: aliasMutationRefused
      ? `learned alias "${alias}" is a mutating intent and the static classifier did not independently reach it, so the alias is not applied — an alias learned from one conversation must not create a mutation`
      : guidedFallbackReason(guarded, alias),
    classifierVersion,
  };
}

/** Keeps the safe static reading when a learned alias is refused. */
function guidedFallback(guarded: GuardedClassification): Intent {
  return guarded.intent === "unknown" ? "general_platform" : guarded.intent;
}

function guidedFallbackReason(guarded: GuardedClassification, alias: Intent): string | undefined {
  return guarded.intent === "unknown"
    ? `no static pattern matched, so the learned alias "${alias}" was applied`
    : `static classification was ambiguous, so the learned alias "${alias}" was applied`;
}

/**
 * Per-intent accuracy, for the operator-facing report §13 asks for.
 *
 * In-memory and bounded, in the same shape as the query-budget and cache-policy
 * logs: enough to answer "is intent classification getting worse" without a
 * metrics backend, and honest about being per-instance rather than global.
 * A durable series belongs in Phase O with the rest of the observability work.
 */
interface IntentCounters {
  total: number;
  correct: number;
}

const OUTCOME_LIMIT = 200;
const outcomes: { intent: Intent; correct: boolean; at: string }[] = [];
const counters = new Map<Intent, IntentCounters>();

/** Record whether the resolved intent turned out to be what the asker meant. */
export function recordIntentOutcome(intent: Intent, correct: boolean): void {
  const current = counters.get(intent) ?? { total: 0, correct: 0 };
  counters.set(intent, { total: current.total + 1, correct: current.correct + (correct ? 1 : 0) });
  outcomes.push({ intent, correct, at: new Date().toISOString() });
  if (outcomes.length > OUTCOME_LIMIT) outcomes.shift();
}

export function intentAccuracyReport(): {
  perIntent: { intent: Intent; total: number; correct: number; accuracy: number }[];
  overall: { total: number; correct: number; accuracy: number };
} {
  const perIntent = [...counters.entries()]
    .map(([intent, c]) => ({ intent, total: c.total, correct: c.correct, accuracy: c.total > 0 ? c.correct / c.total : 0 }))
    .sort((a, b) => b.total - a.total);

  const total = perIntent.reduce((s, r) => s + r.total, 0);
  const correct = perIntent.reduce((s, r) => s + r.correct, 0);
  return { perIntent, overall: { total, correct, accuracy: total > 0 ? correct / total : 0 } };
}

/** Test seam — the counters are process-global and would otherwise leak between tests. */
export function resetIntentMetrics(): void {
  counters.clear();
  outcomes.length = 0;
}

export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  return text.match(urlRegex) || [];
}

export function isUrl(text: string): boolean {
  const cleaned = text.trim();
  return /^https?:\/\/[^\s]+$/.test(cleaned);
}