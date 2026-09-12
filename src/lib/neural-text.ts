const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","shall","can",
  "to","of","in","for","on","with","at","by","from","as","into","through","during",
  "before","after","above","below","between","out","off","over","under","again",
  "further","then","once","here","there","when","where","why","how","all","both",
  "each","few","more","most","other","some","such","no","nor","not","only","own",
  "same","so","than","too","very","just","don","now","and","but","or","if","this",
  "that","these","those","i","me","my","we","our","you","your","he","him","his",
  "she","her","it","its","they","them","their","what","which","who","whom",
  "about","up",
  "na","wa","ya","kwa","za","ni","katika","la","ile","hiyo","huu","hayo","zile",
]);

const POSITIVE_WORDS = new Set([
  "good","great","excellent","amazing","awesome","love","best","beautiful","happy",
  "success","growth","progress","innovative","inspiring","powerful","remarkable",
  "outstanding","fantastic","brilliant","positive","impressive","thriving","flourishing",
  "booming","opportunity","potential","celebrate","achievement","breakthrough",
  "empower","resilient","unity","peace","prosperity","development",
  "improve","enhance","boost","surge","rise","gain","increase","win",
  "forward","advance","expand","strengthen","support","help","benefit","advantage",
]);

const NEGATIVE_WORDS = new Set([
  "bad","terrible","awful","worst","hate","ugly","sad","angry","fear","worry",
  "failure","decline","crisis","problem","issue","bug","error","crash","threat",
  "risk","danger","concern","troubled","struggling","deteriorating","worsening",
  "collapse","decrease","loss","drop","fall","negative","severe","critical","urgent",
  "ban","block","reject","forbid","restrict","penalty","punish","damage","destroy",
  "exploit","abuse","corrupt","steal","fraud","scam","hack","attack","breach",
]);

const CITIES = new Set([
  "nairobi","kampala","dar es salaam","kigali","mombasa","juba","addis ababa",
  "moshi","arusha","entebbe","lagos","accra","dar","kisumu","nakuru",
  "eldoret","thika","malindi","lamu","zanzibar","mwanza","dodoma",
  "gisenyi","huye","musanze","jimma","hawassa","bahir dar","dire dawa","harar",
]);

/**
 * Countries and regions, matched with word boundaries. The city list answers
 * "where in the region", but an article about Kenya, Rwanda or East Africa as
 * a whole used to yield no place at all — which pushed generated copy onto its
 * "across East Africa" default and produced subjects built from filler words.
 */
const REGIONS = new Set([
  "kenya","uganda","tanzania","rwanda","burundi","ethiopia","somalia","sudan",
  "south sudan","djibouti","eritrea","egypt","nigeria","ghana","south africa",
  "africa","east africa","west africa","north africa","zambia","zimbabwe","botswana",
  "namibia","malawi","mozambique","angola","cameroon","senegal","ivory coast",
  "congo","drc","morocco","tunisia","algeria","libya","mali","niger","chad",
  "europe","asia","america","the americas","middle east","gulf","diaspora",
]);

/** Longest first, so "South Sudan" claims the match before "Sudan". */
const PLACE_NAMES = [...new Set([...CITIES, ...REGIONS])].sort((a, b) => b.length - a.length);

const placePatterns = new Map<string, RegExp>();

/** Word-boundary matcher, so "Mali" never matches inside "Malindi". */
function placePattern(place: string): RegExp {
  const cached = placePatterns.get(place);
  if (cached) return cached;
  const pattern = new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  placePatterns.set(place, pattern);
  return pattern;
}

function titleCaseName(name: string): string {
  return name.split(" ").map((w) => w.slice(0, 1).toUpperCase() + w.slice(1)).join(" ");
}

const ORG_KEYWORDS = ["ministry","department","university","institute","bank","corporation","company","limited","foundation","authority","commission","council","agency","organization","association","forum","summit","conference","initiative","program","project"];

const PERSON_PREFIXES = ["mr","mrs","ms","dr","prof","ceo","cto","mp","minister","president","governor","director","chief","head","senator"];

const EVENT_WORDS = ["summit","conference","festival","award","ceremony","exhibition","expo","forum","gathering","convention","workshop","seminar"];

export function extractKeywords(text: string, topN: number = 10): { keyword: string; score: number }[] {
  const tokens = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(t => t.length >= 3 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
  const freq: Record<string, number> = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  const totalTokens = tokens.length || 1;
  const scored = Object.entries(freq).map(([word, count]) => {
    const tf = count / totalTokens;
    const idf = Math.log(1 + totalTokens / (count + 1));
    return { keyword: word, score: tf * idf };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

export function analyzeSentiment(text: string): { sentiment: "positive" | "negative" | "neutral"; score: number; positiveCount: number; negativeCount: number } {
  const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);
  let positiveCount = 0;
  let negativeCount = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) positiveCount++;
    if (NEGATIVE_WORDS.has(w)) negativeCount++;
  }
  const denom = Math.max(positiveCount + negativeCount, 1);
  const score = (positiveCount - negativeCount) / denom;
  const sentiment = score > 0.1 ? "positive" : score < -0.1 ? "negative" : "neutral";
  return { sentiment, score, positiveCount, negativeCount };
}

export function extractEntities(text: string): { type: "place" | "organization" | "person" | "event"; value: string }[] {
  const entities: { type: "place" | "organization" | "person" | "event"; value: string }[] = [];
  const seen = new Set<string>();
  const lower = text.toLowerCase();

  for (const place of PLACE_NAMES) {
    if (seen.has(place)) continue;
    // A name already inside a longer match ("Africa" in "East Africa") is the
    // same mention, not a second place.
    if ([...seen].some((matched) => matched.includes(place))) continue;
    if (!placePattern(place).test(lower)) continue;
    seen.add(place);
    entities.push({ type: "place", value: titleCaseName(place) });
  }

  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = (words[i] ?? "").replace(/[^\w]/g, "");
    const wLower = w.toLowerCase();
    if (ORG_KEYWORDS.includes(wLower) && i > 0) {
      const org = words.slice(Math.max(0, i - 3), i + 1).join(" ");
      if (!seen.has(org.toLowerCase())) {
        seen.add(org.toLowerCase());
        entities.push({ type: "organization", value: org });
      }
    }
    if (EVENT_WORDS.includes(wLower)) {
      if (!seen.has(wLower)) {
        seen.add(wLower);
        entities.push({ type: "event", value: words.slice(Math.max(0, i - 2), i + 1).join(" ") });
      }
    }
  }

  const capitalized = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  for (const name of capitalized) {
    const nameLower = name.toLowerCase();
    if (seen.has(nameLower) || STOP_WORDS.has(nameLower) || name.length < 3) continue;
    const before = text.slice(Math.max(0, text.indexOf(name) - 20), text.indexOf(name)).toLowerCase();
    if (PERSON_PREFIXES.some(p => before.includes(p))) {
      seen.add(nameLower);
      entities.push({ type: "person", value: name });
    }
  }

  return entities;
}

export function summarizeText(text: string, maxSentences: number = 3): string {
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter(s => s.trim().length > 10);
  if (sentences.length <= maxSentences) return text;

  const scored = sentences.map((s, i) => {
    let score = 0;
    if (i === 0) score += 2;
    else if (i === sentences.length - 1) score += 1;
    const wc = s.split(/\s+/).length;
    if (wc >= 10 && wc <= 40) score += 1;
    const words = s.toLowerCase().split(/\s+/);
    for (const w of words) {
      if (POSITIVE_WORDS.has(w) || NEGATIVE_WORDS.has(w)) score += 1;
    }
    score += extractEntities(s).length;
    return { sentence: s.trim(), score, index: i };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSentences).sort((a, b) => a.index - b.index).map(s => s.sentence).join(". ") + ".";
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}
