import { distance } from "fastest-levenshtein";
import { classifyIntent, scoreAllIntents, INTENT_PATTERNS, type Intent } from "@/lib/neural-intent";

/**
 * Routing for the general-purpose agent.
 *
 * The Neural Mind's classifier (`neural-intent.ts`) is tuned for the admin
 * console: its patterns describe platform records, and anything unmatched
 * falls to `unknown`, which the console answers deterministically. That is the
 * right behaviour for an operator and the wrong one for a person — "explain
 * quantum entanglement" is not a failed platform query, it is a general topic.
 *
 * So this module re-classifies *chat* input with three additions the console
 * classifier does not have:
 *
 *   1. A **general** bucket for anything that is not platform business. A
 *      general question routes to `general`, not to `unknown`.
 *   2. **Fuzzy keyword matching.** A classifier that matches whole tokens only
 *      loses to "how r my creaters doin" — the intent is obvious, the spelling
 *      is not. Levenshtein distance at word level tolerates typos without
 *      shipping the whole fuzzy-matching machinery into every token compare.
 *   3. **Explicit ambiguity**. When two intents tie, the router says so and
 *      the caller asks one clarifying question instead of guessing. A tool
 *      call made from a coin flip is worse than a question.
 *
 * Rules of engagement, deliberately conservative:
 *   - The console's exact matches still win first. Fuzzy matching is a second
 *     pass, so nothing that already classifies correctly can reclassify.
 *   - The mutation guard is untouched: an intent that can change state must
 *     never be *guessed* into existence by fuzzy matching, so mutating intents
 *     are excluded from the fuzzy pass entirely.
 *   - The user's spelling is never corrected. `normalizeInput` cleans Unicode
 *     and whitespace; it does not edit what they wrote.
 */

/* ── Normalisation ───────────────────────────────────────────────────────── */

/**
 * Canonical form of a chat turn.
 *
 * NFC so that visually identical text compares identically, whitespace
 * collapsed so multi-line pastes classify like a sentence. Spelling is left
 * exactly as the user wrote it — correcting it is the model's job to avoid,
 * not the pipeline's to perform.
 */
export function normalizeInput(input: string): string {
  return input.normalize("NFC").replace(/\s+/g, " ").trim();
}

/* ── Vocabulary ──────────────────────────────────────────────────────────── */

/**
 * Which platform tool-culture a turn belongs to, decided from fuzzy matches.
 *
 * Tool names match the tools in `agent-tools.ts`. The mapping is intentionally
 * small: the tools do the fine-grained work (which creator, which city), the
 * router only has to decide *whether platform senses are wanted*.
 */
export type AgentRoute =
  | "general"
  | "platform"
  | "web"
  | "code"
  | "ambiguous";

export interface RoutingDecision {
  route: AgentRoute;
  /** The console intent, when the platform vocabulary matched. */
  intent: Intent | null;
  /** 0–1, only meaningful for platform routes. */
  confidence: number;
  /** Non-empty when two intents tied — the caller should ask ONE question. */
  clarify: boolean;
}

/**
 * Platform intent → route map. Everything in `RECORD_INTENTS` that has a tool
 * behind it routes to `platform`; research intents route to `web`.
 */
const INTENT_ROUTE: Partial<Record<Intent, AgentRoute>> = {
  creator_intelligence: "platform",
  monetization_report: "platform",
  traffic_depth: "platform",
  regional_analysis: "platform",
  trend_query: "platform",
  growth_report: "platform",
  system_health: "platform",
  content_analysis: "platform",
  user_analysis: "platform",
  hive_report: "platform",
  external_signals: "platform",
  web_research: "web",
  external_learn: "web",
};

/** Fuzzy keyword vocabulary per route (scored per matched word). */
const ROUTE_KEYWORDS: Record<"platform" | "web" | "code", string[]> = {
  platform: [
    "creator", "creators", "revenue", "earnings", "payouts", "payout", "mpesa",
    "subscribers", "followers", "traffic", "bounce", "views", "posts", "users",
    "monetization", "analytics", "nairobi", "kampala", "kigali", "tanzania",
    "kenya", "uganda", "region", "regional", "trending", "trends", "hive",
    "brain", "memory", "platform", "dashboard", "stats", "revenue's",
  ],
  web: ["news", "weather", "today", "latest", "current", "price", "who", "when", "won", "winner", "election", "score", "results"],
  code: ["python", "javascript", "code", "function", "algorithm", "reverse", "sort", "calculate", "compute", "debug", "regex", "script"],
};

/** Words too short or too common to fuzzy-match safely. */
const FUZZY_STOP = new Set(["the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "how", "r", "u", "da", "pls", "this", "that"]);

/** Max edit distance for a word match, scaled by length. */
function tolerance(word: string): number {
  if (word.length <= 4) return 1;
  if (word.length <= 8) return 2;
  return 3;
}

/** Best fuzzy match of a token against a vocabulary entry, or 0. */
function fuzzyScore(token: string, vocab: string): number {
  if (token === vocab) return 1;
  const d = distance(token, vocab);
  return d <= tolerance(token) ? 0.8 : 0;
}

/**
 * Quality-weighted word match: an exact word is worth twice a near-miss.
 *
 * Weighting matters because the console vocabulary overlaps. "niaje, niambie
 * kuhusu revenue yangu" is a revenue question, but "niaje" is edit-distance 2
 * from creator_intelligence's "niche", and a flat +1 per hit let a greeting
 * outrank the word the question was actually about. Exact matches count
 * double, so a real keyword always beats a lucky typo.
 */
function wordMatch(token: string, vocab: string): number {
  if (token === vocab) return 1;
  return distance(token, vocab) <= tolerance(token) ? 0.5 : 0;
}

/**
 * Mutating verbs and nouns, fuzzy-matched.
 *
 * The console classifier checks substrings — which is how "this" once
 * contained the phrase "hi" — so a fuzzy guard over the same vocabulary has
 * to run at word level: "publishh" is distance 1 from "publish". Anything
 * matching here is routed as platform business without ever becoming a
 * guessed intent; the approval queue still decides what happens.
 */
const MUTATION_VOCAB = ["publish", "schedule", "unpublish", "flag", "delete", "remove", "post", "comment", "thumbnail"];

function matchesMutationVocab(tokens: string[]): boolean {
  return tokens.some((t) => MUTATION_VOCAB.some((m) => fuzzyScore(t, m) > 0));
}

/**
 * Keywords a turn shares with a route, typos included.
 *
 * Only words of length ≥ 3 participate ("r" and "u" would match anything),
 * and a keyword must match some word at distance ≤ tolerance — substring
 * matches are *not* fuzzy matches, they are the console classifier's job.
 */
function routeKeywordScore(input: string, route: "platform" | "web" | "code"): number {
  const tokens = input.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !FUZZY_STOP.has(t));
  let score = 0;
  for (const token of tokens) {
    for (const kw of ROUTE_KEYWORDS[route]) {
      const s = fuzzyScore(token, kw);
      if (s > 0) {
        score += s;
        break; // one vocab hit per word is enough
      }
    }
  }
  return score;
}

/* ── The router ──────────────────────────────────────────────────────────── */

/**
 * Classify one chat turn.
 *
 * The console classifier runs first, exactly as before — a turn it already
 * classifies as platform business keeps that classification, so console and
 * agent never disagree about a question the console has always answered.
 * Only turns the console would drop (`unknown`, `general_chat`) get the
 * fuzzy general-purpose treatment.
 */
export function routeChatInput(input: string): RoutingDecision {
  const normalized = normalizeInput(input);
  const tokens = normalized.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  const meaningful = tokens.filter((t) => t.length >= 3 && !FUZZY_STOP.has(t));
  const { intent, confidence } = classifyIntent(normalized);

  // The console's own answer, where it has one that means platform/web
  // business. Unmapped console intents (writing work) are platform business
  // too, in the sense that they are the console's, not the chat agent's.
  const mappedRoute =
    intent !== "unknown" && intent !== "general_chat" ? (INTENT_ROUTE[intent] ?? "platform") : undefined;
  if (mappedRoute) {
    // Low-confidence console wins are nudges, not decisions: "gimme da
    // latest" reaches here as web_research at a bare keyword score, but it
    // could mean platform trends or world news, and one clarifying question
    // is cheaper than a wrong web search.
    const weak = confidence < 0.3 && meaningful.length <= 4;
    return { route: mappedRoute, intent, confidence, clarify: weak };
  }

  // Ambiguity, decided after the fuzzy scores are known, because there are
  // two different kinds:
  //
  //   1. A tie between two console intents matters only when it crosses route
  //      families — "creators in nairobi" ties creator_intelligence with
  //      regional_analysis, but both are platform reads, so the tools answer
  //      it and asking would be friction. creator-vs-webSearch is a real
  //      fork: the tools behind them cost a network round trip each.
  //   2. A single weak keyword on a short message is a nudge, not a decision.
  //      "gimme da latest" could mean platform trends or world news; one
  //      clarifying question is cheaper than a wrong web search.
  const scored = scoreAllIntents(normalized).filter((s) => s.score > 0);

  // A mutating request never reaches the general-purpose path — neither at
  // console confidence nor one typo away from it. "pls publishh this" scores
  // `general_chat` because "this" contains "hi"; the mutation vocabulary is
  // therefore checked at word level with the same tolerance the rest of the
  // fuzzy pass uses. The route is platform; the *intent* is never guessed —
  // the approval queue still decides what any write actually is.
  if (matchesMutationVocab(meaningful)) {
    return { route: "platform", intent: "mind_action", confidence: 0.6, clarify: false };
  }

  const platformScore = routeKeywordScore(normalized, "platform");
  const webScore = routeKeywordScore(normalized, "web");
  const codeScore = routeKeywordScore(normalized, "code");

  const best = Math.max(platformScore, webScore, codeScore);
  let route: AgentRoute = "general";
  if (best === 0) {
    route = "general";
  } else if (best === platformScore) {
    route = "platform";
  } else if (best === codeScore) {
    route = "code";
  } else {
    route = "web";
  }

  const routeFor = (i: Intent): AgentRoute => INTENT_ROUTE[i] ?? "platform";
  const top = scored[0];
  const second = scored[1];
  const tieAcrossRoutes =
    top !== undefined && second !== undefined && top.score === second.score && routeFor(top.intent) !== routeFor(second.intent);

  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const vagueWin = route !== "general" && best <= 1 && rawTokens.length <= 4;

  // When fuzzy routing chose platform, the intent hint comes from a fuzzy
  // match over the console's own vocabulary rather than from `scoreAllIntents`
  // directly — the console matches substrings, and "creaters" contains
  // "create", which scores write_content and would send the tools chasing a
  // request to write something. Word-level distance is what "typo tolerated"
  // actually means here.
  let fuzzyIntent: Intent | null = null;
  if (route === "platform") {
    let bestScore = 0;
    for (const pattern of INTENT_PATTERNS) {
      // Only intents with a platform *read* behind them are eligible hints —
      // unmapped intents (write_content in particular) would let "creaters",
      // which is edit-distance 2 from "create", masquerade as a request to
      // write something instead of a question about creators.
      if (INTENT_ROUTE[pattern.intent] !== "platform") continue;
      let s = 0;
      for (const kw of pattern.keywords) {
        for (const t of meaningful) s += wordMatch(t, kw);
      }
      for (const phrase of pattern.phrases) {
        const words = phrase.split(/\s+/);
        if (words.length > 0 && words.every((w) => meaningful.some((t) => wordMatch(t, w) > 0))) {
          s += words.every((w) => meaningful.includes(w)) ? 3 : 2;
        }
      }
      if (s > bestScore) {
        bestScore = s;
        fuzzyIntent = pattern.intent;
      }
    }
  }

  return { route, intent: fuzzyIntent, confidence: route === "general" ? 0.5 : Math.min(best / 4, 0.9), clarify: tieAcrossRoutes || vagueWin };
}

/* ── Language mix ────────────────────────────────────────────────────────── */

/**
 * Marker words for the languages this audience actually mixes, and the
 * shorthand they type them in.
 *
 * Same philosophy as `inferLanguage` in platform-intelligence — a heuristic
 * over observed text, reported as inferred — but tuned for *chat* rather than
 * prose: greetings, interjections and slang, because a chat turn is three
 * words where an article is three hundred.
 */
const CHAT_LANGUAGE_MARKERS: Record<string, string[]> = {
  Kiswahili: [
    "niaje", "niaje?", "habari", "sasa", "poa", "niambie", "asante", "karibu",
    "sawa", "sikujua", "kuna", "hapa", "yangu", "wako", "kwangu", "leo",
  ],
  Luganda: ["oli", "otya", "webale", "kale", "gyendi", "bulungi", "nnali"],
  Sheng: ["buda", "msee", "mabeshte", "chapaa", "debe", "manzi", "mbogi", "chez", "ati"],
};

/**
 * The mix a chat turn is written in, e.g. "English + Kiswahili".
 *
 * An empty string means "nothing observed" — the caller treats that as
 * "mirror the user's last known mix" rather than declaring a language.
 */
export function inferChatLanguageMix(input: string): string {
  const words = new Set(input.toLowerCase().match(/[a-zà-ÿ']+/g) ?? []);
  const hits: string[] = [];
  for (const [lang, markers] of Object.entries(CHAT_LANGUAGE_MARKERS)) {
    if (markers.some((m) => words.has(m))) hits.push(lang);
  }
  // Words in the turn that the Latin-script languages above do not claim still
  // default to English — the platform's lingua franca.
  return hits.length > 0 ? ["English", ...hits].join(" + ") : "English";
}
