import { prisma } from "@/lib/prisma";
import {
  embedText,
  encodeVector,
  decodeVector,
  cosineSimilarity,
  normalize,
  EMBEDDING_DIM,
} from "@/lib/embeddings";
import { stripHtml } from "@/lib/neural-text";
import { createLogger } from "@/lib/logger";

const log = createLogger("neural-vector");

const MIN_TEXT = 12;

function postText(title: string, excerpt: string | null, content: string): string {
  return `${title} ${excerpt ?? ""} ${stripHtml(content).slice(0, 4000)}`.trim();
}

/**
 * Compute and upsert the semantic embedding for a single post. Returns true if
 * an embedding was written. Mirrors "vector pre-computation" from the roadmap.
 */
export async function embedPost(post: {
  id: string;
  title: string;
  excerpt: string | null;
  content: string;
}): Promise<boolean> {
  const text = postText(post.title, post.excerpt, post.content);
  if (text.trim().length < MIN_TEXT) return false;

  const vector = normalize(embedText(text));
  const titleVec = normalize(embedText(post.title));

  await prisma.postEmbedding.upsert({
    where: { postId: post.id },
    create: {
      postId: post.id,
      vector: encodeVector(vector),
      titleVec: encodeVector(titleVec),
      dim: EMBEDDING_DIM,
      model: "hash-minilm",
    },
    update: {
      vector: encodeVector(vector),
      titleVec: encodeVector(titleVec),
      dim: EMBEDDING_DIM,
      model: "hash-minilm",
    },
  });

  // Mirror into the pgvector column so indexed cosine search can use it.
  // Best-effort: hosts without the extension keep working on the JSON vector.
  try {
    const literal = `'[${vector.map((x) => x.toFixed(6)).join(",")}]'::vector`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PostEmbedding" ("postId", "pgVec") VALUES ($1, ${literal})
       ON CONFLICT ("postId") DO UPDATE SET "pgVec" = EXCLUDED."pgVec"`,
      post.id
    );
  } catch (err) {
    log.warn("pgvector mirror skipped", { postId: post.id, error: String(err) });
  }
  return true;
}

/**
 * Batch-embed published posts that either lack an embedding or whose content
 * changed. Returns the number embedded. Run from a cron / admin trigger.
 */
export async function indexPublishedPosts(limit = 200): Promise<number> {
  const posts = await prisma.post.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true, title: true, excerpt: true, content: true, updatedAt: true, postEmbedding: { select: { updatedAt: true } } },
  });

  let done = 0;
  for (const p of posts) {
    const stale = !p.postEmbedding || p.postEmbedding.updatedAt < p.updatedAt;
    if (!stale) continue;
    try {
      if (await embedPost(p)) done++;
    } catch (err) {
      log.warn("embed failed", { id: p.id, error: String(err) });
    }
  }
  log.info("indexed posts", { done, scanned: posts.length });
  return done;
}

/**
 * Find posts semantically closest to the given text (excluding an optional id).
 * Uses the pgvector index when available and falls back to the in-process
 * cosine scan over the JSON vectors otherwise.
 */
export async function semanticSearch(
  query: string,
  opts: { excludeId?: string; limit?: number; threshold?: number } = {}
): Promise<{ postId: string; score: number; post?: { id: string; title: string; slug: string; excerpt: string | null; coverImage: string | null; createdAt: Date } }[]> {
  const { excludeId, limit = 6, threshold = 0.18 } = opts;
  const qVec = normalize(embedText(query));

  let scored: { postId: string; score: number }[] = [];
  try {
    const literal = `[${qVec.map((x) => x.toFixed(6)).join(",")}]`;
    const rows = await prisma.$queryRaw<{ postId: string; score: number }[]>`
      SELECT pe."postId", (1 - (pe."pgVec" <=> ${literal}::vector)) AS score
      FROM "PostEmbedding" pe
      JOIN "Post" p ON p.id = pe."postId"
      WHERE p.status = 'PUBLISHED' AND p."moderationStatus" = 'APPROVED'
        AND (${excludeId ?? null}::text IS NULL OR pe."postId" <> ${excludeId ?? null})
        AND (1 - (pe."pgVec" <=> ${literal}::vector)) >= ${threshold}
      ORDER BY pe."pgVec" <=> ${literal}::vector
      LIMIT ${limit}
    `;
    scored = rows.map((r) => ({ postId: r.postId, score: Math.round((r.score ?? 0) * 1000) / 1000 }));
  } catch (err) {
    // pgvector unavailable — fall back to the portable JSON scan.
    log.warn("pgvector search unavailable, using JSON scan", { error: String(err) });
    const embs = await prisma.postEmbedding.findMany({
      where: { post: { status: "PUBLISHED", moderationStatus: "APPROVED" } },
      select: { postId: true, vector: true },
    });
    for (const e of embs) {
      if (excludeId && e.postId === excludeId) continue;
      const vec = normalize(decodeVector(e.vector));
      const score = cosineSimilarity(qVec, vec);
      if (score >= threshold) scored.push({ postId: e.postId, score });
    }
    scored.sort((a, b) => b.score - a.score);
  }

  const ids = scored.slice(0, limit).map((s) => s.postId);
  const posts = await prisma.post.findMany({
    where: { id: { in: ids }, status: "PUBLISHED", moderationStatus: "APPROVED" },
    select: { id: true, title: true, slug: true, excerpt: true, coverImage: true, createdAt: true },
  });
  const byId = new Map(posts.map((p) => [p.id, p]));

  return scored
    .filter((s) => byId.has(s.postId))
    .slice(0, limit)
    .map((s) => ({ postId: s.postId, score: Math.round(s.score * 1000) / 1000, post: byId.get(s.postId) }));
}

/** Related posts for a post (semantic, excluding itself). */
export async function relatedPosts(postId: string, limit = 4): Promise<{ id: string; title: string; slug: string; excerpt: string | null; coverImage: string | null; score: number }[]> {
  const em = await prisma.postEmbedding.findUnique({ where: { postId } });
  if (!em) return [];
  const qVec = normalize(decodeVector(em.vector));
  const embs = await prisma.postEmbedding.findMany({
    where: { post: { status: "PUBLISHED", moderationStatus: "APPROVED" }, NOT: { postId } },
    select: { postId: true, vector: true },
  });
  const scored = embs
    .map((e) => ({ postId: e.postId, score: cosineSimilarity(qVec, normalize(decodeVector(e.vector))) }))
    .filter((s) => s.score >= 0.32)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const posts = await prisma.post.findMany({
    where: { id: { in: scored.map((s) => s.postId) } },
    select: { id: true, title: true, slug: true, excerpt: true, coverImage: true },
  });
  const map = new Map(posts.map((p) => [p.id, p]));
  return scored
    .filter((s) => map.has(s.postId))
    .map((s) => ({ ...map.get(s.postId)!, score: Math.round(s.score * 1000) / 1000 }));
}

/**
 * Detect near-duplicate content by embedding similarity.
 * Returns the most similar existing post if it clears the threshold.
 */
export async function findDuplicate(post: { id?: string; title: string; content: string }, threshold = 0.6): Promise<{ postId: string; score: number } | null> {
  const qVec = normalize(embedText(postText(post.title, null, post.content)));
  const embs = await prisma.postEmbedding.findMany({
    where: post.id ? { NOT: { postId: post.id } } : undefined,
    select: { postId: true, vector: true },
  });
  let best: { postId: string; score: number } | null = null;
  for (const e of embs) {
    const score = cosineSimilarity(qVec, normalize(decodeVector(e.vector)));
    if (!best || score > best.score) best = { postId: e.postId, score };
  }
  return best && best.score >= threshold ? best : null;
}

// ── Phase 3: user preference learning ──────────────────────────────────────

/** Upsert a user's preference embedding from the posts they've interacted with. */
export async function updateUserPreference(userId: string): Promise<void> {
  const [liked, saved] = await Promise.all([
    prisma.like.findMany({
      where: { userId, postId: { not: null } },
      select: { post: { select: { id: true, title: true, excerpt: true, content: true, categoryId: true } } },
      take: 120,
    }),
    prisma.bookmark.findMany({
      where: { userId },
      select: { post: { select: { id: true, title: true, excerpt: true, content: true, categoryId: true } } },
      take: 120,
    }),
  ]);

  const signals: number[][] = [];
  const tagWeights = new Map<string, number>();
  const catWeights = new Map<string, number>();

  const contribute = (post: { title: string; excerpt: string | null; content: string; categoryId: string | null }, w: number) => {
    const v = normalize(embedText(postText(post.title, post.excerpt, post.content)));
    if (v.length) signals.push(v.map((x) => x * w));
    if (post.categoryId) catWeights.set(post.categoryId, (catWeights.get(post.categoryId) ?? 0) + w);
    for (const w2 of extractTagSignal(post)) tagWeights.set(w2, (tagWeights.get(w2) ?? 0) + w);
  };

  for (const l of liked) if (l.post) contribute(l.post, 2);
  for (const b of saved) if (b.post) contribute(b.post, 1.5);

  if (signals.length === 0) {
    // No keeps empty prefs implicit; still write empty so we don't re-query.
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, vector: encodeVector([]), tagVector: "{}", categoryCount: "{}" },
      update: { lastUpdated: new Date() },
    });
    return;
  }

  const len0 = signals[0]?.length ?? 0;
  const avg = normalize(signals.reduce((acc, v) => acc.map((x, i) => x + (v[i] ?? 0)), new Array<number>(len0).fill(0)));

  await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      vector: encodeVector(avg),
      tagVector: JSON.stringify(Object.fromEntries(tagWeights)),
      categoryCount: JSON.stringify(Object.fromEntries(catWeights)),
    },
    update: {
      vector: encodeVector(avg),
      tagVector: JSON.stringify(Object.fromEntries(tagWeights)),
      categoryCount: JSON.stringify(Object.fromEntries(catWeights)),
      lastUpdated: new Date(),
    },
  });
}

// Lightweight tag-affinity signal from a post's high-signal tokens.
function extractTagSignal(post: { title: string; excerpt: string | null; content: string }): string[] {
  const words = `${post.title} ${post.excerpt ?? ""} ${stripHtml(post.content).slice(0, 800)}`
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
    if (out.length >= 12) break;
  }
  return out;
}
