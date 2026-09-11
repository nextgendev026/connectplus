import { createLogger } from "@/lib/logger";

const log = createLogger("web-research");

/**
 * Keyless internet research for the neural mind.
 *
 * Layered so a single provider outage never leaves the brain blind:
 *   1. DuckDuckGo HTML  — broad web results, no API key, no quota.
 *   2. Wikipedia API    — structured encyclopaedic fallback with clean text.
 *
 * Everything is time-boxed and returns `[]` rather than throwing: research is
 * an enhancement to a reply, never a precondition for one.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: "duckduckgo" | "wikipedia";
}

export interface ResearchFinding extends SearchResult {
  /** Readable body text, trimmed for prompt use. */
  text: string;
}

/** Fetch with a hard timeout so one slow host cannot stall a chat turn. */
async function timedFetch(url: string, ms: number, init?: RequestInit): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...(init?.headers ?? {}) },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Unwrap DuckDuckGo's `/l/?uddg=<encoded>` redirect into the real target. */
function unwrapDdg(href: string): string {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.toString();
  } catch {
    return href;
  }
}

async function duckduckgo(query: string, limit: number): Promise<SearchResult[]> {
  const res = await timedFetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=ke-en`,
    8000
  );
  if (!res || !res.ok) return [];
  const html = await res.text();

  const results: SearchResult[] = [];
  // Each result block carries class="result__a" (link) and "result__snippet".
  const blockRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/g;

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) && results.length < limit) {
    const url = unwrapDdg(m[1] ?? "");
    const title = decodeEntities(m[2] ?? "");
    const snippet = decodeEntities(m[3] ?? "");
    if (!title || !/^https?:\/\//.test(url)) continue;
    if (results.some((r) => r.url === url)) continue;
    results.push({ title, url, snippet, source: "duckduckgo" });
  }

  return results;
}

async function wikipedia(query: string, limit: number): Promise<SearchResult[]> {
  const search = await timedFetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&format=json&origin=*&srlimit=${limit}`,
    7000
  );
  if (!search || !search.ok) return [];
  try {
    const data = (await search.json()) as {
      query?: { search?: { title: string; snippet: string }[] };
    };
    return (data.query?.search ?? []).slice(0, limit).map((r) => ({
      title: r.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
      snippet: decodeEntities(r.snippet ?? ""),
      source: "wikipedia" as const,
    }));
  } catch {
    return [];
  }
}

/** Search the open web. Never throws; returns `[]` when every provider fails. */
export async function searchWeb(query: string, limit = 5): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  // Run both in parallel — whichever answers first enriches the other.
  const [ddg, wiki] = await Promise.all([
    duckduckgo(q, limit),
    wikipedia(q, Math.min(2, limit)),
  ]);

  const merged = [...ddg];
  for (const w of wiki) {
    if (!merged.some((r) => r.url === w.url)) merged.push(w);
  }

  log.info("web search", { query: q.slice(0, 80), results: merged.length, ddg: ddg.length, wiki: wiki.length });
  return merged.slice(0, limit);
}

/** Strip a page down to its readable prose. */
export function extractReadable(html: string): string {
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Prefer the main content region when the page declares one.
  const main = body.match(/<(?:article|main)[^>]*>([\s\S]*?)<\/(?:article|main)>/i);
  const inner = main?.[1];
  if (inner && inner.length > 400) body = inner;

  return decodeEntities(body).slice(0, 12000);
}

export async function fetchPageText(url: string, maxChars = 4000): Promise<string> {
  const res = await timedFetch(url, 9000);
  if (!res || !res.ok) return "";
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/json/.test(type)) return "";
  const raw = await res.text();
  const text = /json/.test(type) ? raw.slice(0, maxChars) : extractReadable(raw);
  return text.slice(0, maxChars);
}

/**
 * Full research pass: search, then read the most promising sources.
 * Results are ordered so the caller can prompt the model with them directly.
 */
export async function research(query: string, maxSources = 3): Promise<ResearchFinding[]> {
  const results = await searchWeb(query, maxSources + 2);
  if (results.length === 0) return [];

  const chosen = results.slice(0, maxSources);
  const fetched = await Promise.all(
    chosen.map(async (r) => ({
      ...r,
      text: await fetchPageText(r.url, 3500),
    }))
  );

  // Keep sources that yielded text, then top up with the rest so a reply still
  // gains context when every fetch is blocked (paywalls, JS-only pages).
  const withText = fetched.filter((f) => f.text.length > 120);
  const withoutText = fetched.filter((f) => f.text.length <= 120);
  return [...withText, ...withoutText].slice(0, maxSources);
}

/** Compact prompt-ready context block from findings. */
export function findingsToContext(findings: ResearchFinding[], maxChars = 4500): string {
  if (findings.length === 0) return "";
  const parts: string[] = [];
  let used = 0;
  for (const f of findings) {
    const chunk = `SOURCE: ${f.title} (${f.url})\n${(f.text || f.snippet).slice(0, 1600)}`;
    if (used + chunk.length > maxChars) break;
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join("\n\n---\n\n");
}
