import { prisma } from "@/lib/prisma";
import { decodeVector, cosineSimilarity, normalize } from "@/lib/embeddings";
import {
  getFeedRankVariant,
  type FeedRankVariant,
} from "@/lib/experiments";

/**
 * Adaptive feed ranker (Phase 1 + Phase 3).
 *
 * Replaces the pure recency ordering with a blend of:
 *   - semantic affinity  (cosine similarity between the user's learned
 *     preference vector and each post's embedding)
 *   - engagement         (views / likes / comments, normalized across the pool)
 *   - recency            (exponential decay, ~3-day half-life)
 *
 * The blend weights come from the user's A/B variant, so we can measure whether
 * personalization actually improves CTR before shipping it to everyone.
 */

export interface RankablePost {
  id: string;
  createdAt: Date;
  viewCount: number;
  _count?: { likes?: number; comments?: number };
}

const WEIGHTS: Record<FeedRankVariant, { sem: number; eng: number; rec: number }> = {
  control: { sem: 0, eng: 0, rec: 1 },
  "personalized-light": { sem: 0.25, eng: 0.35, rec: 0.4 },
  "personalized-full": { sem: 0.5, eng: 0.3, rec: 0.2 },
};

const RECENCY_HALF_LIFE_HOURS = 72;

function engagement(p: RankablePost): number {
  return (
    p.viewCount +
    (p._count?.likes ?? 0) * 3 +
    (p._count?.comments ?? 0) * 5
  );
}

/**
 * Rank a pool of posts for a user. Deterministic for the same user + data, so
 * paginated "load more" slices stay consistent across requests.
 */
export async function rankFeed<T extends RankablePost>(
  posts: T[],
  userId: string | null | undefined
): Promise<{ posts: T[]; variant: FeedRankVariant }> {
  const variant = getFeedRankVariant(userId);
  if (variant === "control" || posts.length < 2) return { posts, variant };

  const [pref, embeddings] = await Promise.all([
    userId
      ? prisma.userPreference.findUnique({
          where: { userId },
          select: { vector: true },
        })
      : null,
    prisma.postEmbedding.findMany({
      where: { postId: { in: posts.map((p) => p.id) } },
      select: { postId: true, vector: true },
    }),
  ]);

  const userVec = normalize(decodeVector(pref?.vector));
  const vecById = new Map(
    embeddings.map((e) => [e.postId, normalize(decodeVector(e.vector))])
  );

  const w = WEIGHTS[variant];
  const maxEng = Math.max(1, ...posts.map(engagement));
  const now = Date.now();

  const scored = posts
    .map((p) => {
      const emb = vecById.get(p.id);
      const sem =
        userVec.length && emb && emb.length
          ? Math.max(0, cosineSimilarity(userVec, emb))
          : 0;
      const eng = Math.min(1, engagement(p) / maxEng);
      const ageHours = (now - new Date(p.createdAt).getTime()) / 3_600_000;
      const rec = Math.exp(-ageHours / RECENCY_HALF_LIFE_HOURS);
      return { p, score: w.sem * sem + w.eng * eng + w.rec * rec };
    })
    .sort((a, b) => b.score - a.score);

  return { posts: scored.map((s) => s.p), variant };
}