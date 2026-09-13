import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { findingsToContext, research, searchWeb, type ResearchFinding } from "@/lib/web-research";

const log = createLogger("mind-knowledge");

/**
 * The combined mind's window on the open web.
 *
 * The hive learns from our own posts, comments, RSS and conversations — all of
 * which describe *this platform*. That is the wrong shape for a mind that is
 * asked about the world: a question about a league, a market, a competitor or a
 * breaking story has no in-app corpus to answer from, so the reply either
 * guesses or refuses.
 *
 * This module is the one place that turns live web research into permanent
 * memory, so the mind gets broader the more it is used rather than re-fetching
 * the same pages forever:
 *
 *   • `learnTopic`      — research a subject and FILE what it found, deduped by
 *                         source URL so repeating a question costs nothing.
 *   • `knowledgeForSubject` — recall what has already been filed, for a prompt.
 *   • `knowledgeDigest` — how much external knowledge the mind holds, for the
 *                         admin console.
 *
 * Every function is best-effort: research is an enrichment, never a
 * precondition, so a dead network degrades to "the hive knows what it knows".
 */

/** Category marking a memory as learned from the open web. */
export const WEB_KNOWLEDGE_CATEGORY = "external_knowledge";
/** `source` value used for rows written here (matches the chat research path). */
export const WEB_KNOWLEDGE_SOURCE = "external";
/** A single source never contributes more than this much text to a memory. */
const MAX_CONTENT_CHARS = 900;

export interface LearnResult {
  query: string;
  /** Findings returned by the providers. */
  found: number;
  /** Rows actually written — zero means every source was already filed. */
  stored: number;
  /** URLs that were already known. */
  skipped: number;
  sources: string[];
}

/**
 * Research a subject and file it as durable knowledge.
 *
 * Deduped on the source URL: asking about the same thing twice (or a scheduled
 * sweep re-deriving its topics) must not stack near-identical memories, because
 * duplicates both waste tokens and skew keyword recall toward whichever subject
 * was fetched most often.
 */
export async function learnTopic(
  query: string,
  opts: {
    maxSources?: number;
    /** Extra tags appended to every row — e.g. "sports". */
    tags?: string[];
    /** Refresh already-filed URLs instead of skipping them. */
    refresh?: boolean;
  } = {}
): Promise<LearnResult> {
  const clean = (query ?? "").trim().slice(0, 220);
  const result: LearnResult = { query: clean, found: 0, stored: 0, skipped: 0, sources: [] };
  if (clean.length < 3) return result;

  const findings = await research(clean, Math.min(Math.max(opts.maxSources ?? 3, 1), 6)).catch(
    () => [] as ResearchFinding[]
  );
  result.found = findings.length;
  if (findings.length === 0) return result;

  const urls = findings.map((f) => f.url);
  result.sources = urls;

  const known = new Set(
    (
      await prisma.neuralMemory
        .findMany({ where: { sourceUrl: { in: urls } }, select: { sourceUrl: true } })
        .catch(() => [] as { sourceUrl: string | null }[])
    ).map((r) => r.sourceUrl)
  );

  const extraTags = (opts.tags ?? []).map((t) => t.toLowerCase()).filter(Boolean);

  for (const finding of findings) {
    if (known.has(finding.url) && !opts.refresh) {
      result.skipped++;
      continue;
    }
    const body = (finding.text || finding.snippet || "").replace(/\s+/g, " ").trim();
    if (body.length < 80) {
      // A source that yielded no readable text is not worth a memory row: it
      // would match on keywords while teaching the mind nothing.
      result.skipped++;
      continue;
    }

    const row = {
      source: WEB_KNOWLEDGE_SOURCE,
      category: WEB_KNOWLEDGE_CATEGORY,
      content: `${finding.title} — ${body.slice(0, MAX_CONTENT_CHARS)}`,
      tags: [clean.toLowerCase(), ...extraTags, finding.source, "web"].join(","),
      confidence: 0.6,
      metadata: JSON.stringify({
        query: clean,
        provider: finding.source,
        title: finding.title,
        learnedAt: new Date().toISOString(),
      }),
      sourceUrl: finding.url,
    };

    const written = await prisma.neuralMemory
      .create({ data: row })
      .then(() => true)
      .catch(() => false);
    if (written) result.stored++;
  }

  log.info("web knowledge filed", {
    query: clean.slice(0, 80),
    found: result.found,
    stored: result.stored,
    skipped: result.skipped,
  });
  return result;
}

/**
 * Stored web knowledge relevant to a subject, newest and most-used first.
 *
 * Keyword-matched rather than embedded so it works with no vector service, and
 * deliberately limited to the web category — an editorial memory about our own
 * posts is not evidence about the outside world.
 */
export async function knowledgeForSubject(
  subject: string,
  limit = 4
): Promise<{ title: string; url: string | null; text: string }[]> {
  const term = (subject ?? "").trim().slice(0, 60);
  if (term.length < 3) return [];

  // Match the subject plus its distinctive words, so "UEFA Champions League"
  // also finds a memory tagged "champions".
  const words = term
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
    .slice(0, 3);

  const rows = await prisma.neuralMemory
    .findMany({
      where: {
        category: WEB_KNOWLEDGE_CATEGORY,
        OR: [{ tags: { contains: term.toLowerCase() } }, ...words.map((w) => ({ content: { contains: w } }))],
      },
      orderBy: [{ accessCount: "desc" }, { createdAt: "desc" }],
      take: Math.min(Math.max(limit, 1), 12),
      select: { content: true, sourceUrl: true, metadata: true },
    })
    .catch(() => [] as { content: string; sourceUrl: string | null; metadata: string | null }[]);

  if (rows.length === 0) return [];

  await prisma.neuralMemory
    .updateMany({
      where: { sourceUrl: { in: rows.map((r) => r.sourceUrl).filter((u): u is string => Boolean(u)) } },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    })
    .catch(() => null);

  return rows.map((r) => {
    let title = "";
    try {
      title = (JSON.parse(r.metadata ?? "{}") as { title?: string }).title ?? "";
    } catch {
      title = "";
    }
    const [head, ...rest] = r.content.split(" — ");
    return {
      title: title || head || "Source",
      url: r.sourceUrl,
      text: (rest.join(" — ") || r.content).slice(0, 700),
    };
  });
}

/** Prompt-ready block of remembered web knowledge, or "" when none applies. */
export async function webKnowledgeContext(subject: string, limit = 4): Promise<string> {
  const found = await knowledgeForSubject(subject, limit);
  if (found.length === 0) return "";
  return findingsToContext(
    found.map((f) => ({
      title: f.title,
      url: f.url ?? "",
      snippet: f.text,
      text: f.text,
      source: "duckduckgo" as const,
    })),
    2500
  );
}

/**
 * Recall a subject from memory first, and only hit the network if the hive is
 * genuinely blank on it — the cheap path for repeated questions.
 */
export async function answerFromMemoryOrWeb(subject: string): Promise<{
  context: string;
  origin: "memory" | "web" | "none";
}> {
  const remembered = await webKnowledgeContext(subject);
  if (remembered) return { context: remembered, origin: "memory" };

  const learned = await learnTopic(subject, { maxSources: 3 });
  if (learned.stored === 0) {
    // Nothing filed; fall back to a live search purely for this answer.
    const results = await searchWeb(subject, 3).catch(() => []);
    if (results.length === 0) return { context: "", origin: "none" };
    return {
      context: findingsToContext(
        results.map((r) => ({ ...r, text: r.snippet })),
        2500
      ),
      origin: "web",
    };
  }
  return { context: await webKnowledgeContext(subject), origin: "web" };
}

export interface KnowledgeDigest {
  /** Total external knowledge rows filed. */
  rows: number;
  /** Distinct source hosts, so one blog cannot look like breadth. */
  hosts: number;
  lastLearnedAt: string | null;
  /** The most recent subjects filed, for the console. */
  recent: { title: string; url: string | null }[];
}

export async function knowledgeDigest(limit = 8): Promise<KnowledgeDigest> {
  const rows = await prisma.neuralMemory
    .findMany({
      where: { category: WEB_KNOWLEDGE_CATEGORY },
      orderBy: { createdAt: "desc" },
      select: { sourceUrl: true, metadata: true, createdAt: true },
      take: 400,
    })
    .catch(() => [] as { sourceUrl: string | null; metadata: string | null; createdAt: Date }[]);

  const hosts = new Set<string>();
  for (const r of rows) {
    try {
      if (r.sourceUrl) hosts.add(new URL(r.sourceUrl).hostname);
    } catch {
      // ignore malformed urls
    }
  }

  const recent = rows.slice(0, limit).map((r) => {
    let title = "";
    try {
      title = (JSON.parse(r.metadata ?? "{}") as { title?: string }).title ?? "";
    } catch {
      title = "";
    }
    return { title: title || r.sourceUrl || "Untitled source", url: r.sourceUrl };
  });

  return {
    rows: rows.length,
    hosts: hosts.size,
    lastLearnedAt: rows[0]?.createdAt?.toISOString() ?? null,
    recent,
  };
}
