import { prisma } from "@/lib/prisma";
import { extractKeywords, analyzeSentiment, extractEntities, summarizeText, stripHtml } from "@/lib/neural-text";
import { createLogger } from "@/lib/logger";

export interface HivePostInput {
  id: string;
  title: string;
  excerpt?: string | null;
  content: string;
  slug: string;
  category?: { name?: string | null; slug?: string | null } | null;
}

export interface HiveCommentInput {
  id: string;
  content: string;
  postId: string;
}

export interface HiveStatus {
  online: boolean;
  total: number;
  sourceBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  topTopics: { topic: string; count: number }[];
  recentLearnings: {
    source: string;
    category: string;
    content: string;
    tags: string;
    confidence: number;
    learnedAt: Date;
  }[];
}

export interface EngagedPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  authorNode: string | null;
  views: number;
  comments: number;
  likes: number;
  velocity: number;
  daysLive: number;
  postedAt: Date;
}

export interface EngagementSnapshot {
  trending: EngagedPost[];
  rising: EngagedPost[];
  categories: { name: string; velocity: number; posts: number }[];
  ranked: EngagedPost[];
}

export interface TrainResult {
  signalsCreated: number;
  signalsUpdated: number;
  lessons: string[];
}

export interface HiveSweepResult {
  postsScanned: number;
  commentsScanned: number;
  postsLearned: number;
  commentsLearned: number;
  memoriesCreated: number;
  totalMemories: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

class HiveBrain {
  private readonly log = createLogger("hive-brain");

  async ingestPost(post: HivePostInput): Promise<number> {
    const text = `${post.title} ${post.excerpt ?? ""} ${stripHtml(post.content).slice(0, 1800)}`;
    if (text.trim().length < 20) return 0;

    if (await this.alreadyLearned("postId", post.id)) return 0;

    const keywords = extractKeywords(text, 8);
    const entities = extractEntities(text).slice(0, 3);
    const sentiment = analyzeSentiment(text);
    const summary = summarizeText(stripHtml(text), 2);
    const tagNames = [...keywords.slice(0, 6).map(k => k.keyword), post.category?.name ?? post.category?.slug ?? "uncategorized", "platform"]
      .slice(0, 12)
      .join(",");

    let created = 0;

    await prisma.neuralMemory.create({
      data: {
        source: "internal",
        category: "topic",
        content: `${post.title} — ${summary}${summary ? "." : ""} Sentiment: ${sentiment.sentiment} (${sentiment.score.toFixed(2)}).`,
        tags: tagNames,
        confidence: 0.8,
        metadata: JSON.stringify({ postId: post.id, slug: post.slug, title: post.title, type: "post", sentiment: sentiment.sentiment }),
        sourceUrl: `post:${post.slug}`,
      },
    });
    created += 1;

    for (const entity of entities) {
      await prisma.neuralMemory.create({
        data: {
          source: "internal",
          category: "entity",
          content: `${entity.value} (${entity.type}) — from post "${post.title}"`,
          tags: [entity.type, entity.value.toLowerCase(), ...keywords.slice(0, 3).map(k => k.keyword)].join(","),
          confidence: 0.7,
          metadata: JSON.stringify({ postId: post.id, type: "entity", entityType: entity.type }),
          sourceUrl: `post:${post.slug}`,
        },
      });
      created += 1;
    }

    return created;
  }

  async ingestComment(comment: HiveCommentInput): Promise<number> {
    const text = stripHtml(comment.content).slice(0, 1200);
    if (text.trim().length < 2) return 0;

    if (await this.alreadyLearned("commentId", comment.id)) return 0;

    const sentiment = analyzeSentiment(text);
    const keywords = extractKeywords(text, 4);
    const snippet = text.length > 120 ? `${text.slice(0, 120)}…` : text;

    await prisma.neuralMemory.create({
      data: {
        source: "internal",
        category: "opinion",
        content: `Comment sentiment ${sentiment.sentiment} (${sentiment.score.toFixed(2)}): "${snippet}"`,
        tags: [...keywords.map(k => k.keyword), sentiment.sentiment, "comment"].slice(0, 8).join(","),
        confidence: 0.65,
        metadata: JSON.stringify({ commentId: comment.id, postId: comment.postId, type: "comment", sentiment: sentiment.sentiment }),
        sourceUrl: null,
      },
    });

    return 1;
  }

  async sweepInternal(): Promise<HiveSweepResult> {
    const startedAt = Date.now();
    const [posts, comments] = await Promise.all([
      prisma.post.findMany({
        where: { status: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        take: 60,
        select: { id: true, title: true, excerpt: true, content: true, slug: true, category: { select: { name: true, slug: true } } },
      }),
      prisma.comment.findMany({
        orderBy: { createdAt: "desc" },
        take: 120,
        select: { id: true, content: true, postId: true },
      }),
    ]);

    let postsLearned = 0;
    let commentsLearned = 0;
    let memoriesCreated = 0;

    for (const post of posts) {
      const created = await this.ingestPost(post);
      if (created > 0) {
        postsLearned += 1;
        memoriesCreated += created;
      }
    }

    for (const comment of comments) {
      const created = await this.ingestComment(comment);
      if (created > 0) {
        commentsLearned += 1;
        memoriesCreated += created;
      }
    }

    const totalMemories = await prisma.neuralMemory.count();
    this.log.info("sweep complete", { posts: posts.length, comments: comments.length, postsLearned, commentsLearned, memoriesCreated, totalMemories, elapsedMs: Date.now() - startedAt });

    return {
      postsScanned: posts.length,
      commentsScanned: comments.length,
      postsLearned,
      commentsLearned,
      memoriesCreated,
      totalMemories,
    };
  }

  async recall(query: string, limit = 6) {
    const keywords = extractKeywords(query, 6).map(k => k.keyword);
    const terms = [query.trim(), ...keywords].filter(t => t.length >= 2);
    const where: { OR: object[] } = { OR: [] };

    for (const term of terms) {
      where.OR.push({ content: { contains: term } });
      where.OR.push({ tags: { contains: term } });
    }

    const memories = await prisma.neuralMemory.findMany({
      where,
      orderBy: [{ accessCount: "desc" }, { createdAt: "desc" }],
      take: limit * 2,
    });

    await prisma.neuralMemory.updateMany({
      where: { id: { in: memories.map(m => m.id) } },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    });

    return memories.slice(0, limit);
  }

  async status(): Promise<HiveStatus> {
    const [total, bySource, byCategory, recent] = await Promise.all([
      prisma.neuralMemory.count(),
      prisma.neuralMemory.groupBy({ by: ["source"], _count: { id: true } }),
      prisma.neuralMemory.groupBy({ by: ["category"], _count: { id: true } }),
      prisma.neuralMemory.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { source: true, category: true, content: true, tags: true, confidence: true, createdAt: true },
      }),
    ]);

    const sourceBreakdown: Record<string, number> = {};
    for (const row of bySource) sourceBreakdown[row.source] = row._count.id;

    const categoryBreakdown: Record<string, number> = {};
    for (const row of byCategory) categoryBreakdown[row.category] = row._count.id;

    const tagRows = await prisma.neuralMemory.findMany({
      orderBy: { accessCount: "desc" },
      take: 250,
      select: { tags: true },
    });

    const tagCounts = new Map<string, number>();
    for (const row of tagRows) {
      for (const tag of row.tags.split(",").map(t => t.trim()).filter(t => t.length > 1)) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    const topTopics = Array.from(tagCounts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return {
      online: true,
      total,
      sourceBreakdown,
      categoryBreakdown,
      topTopics,
      recentLearnings: recent.map(r => ({
        source: r.source,
        category: r.category,
        content: r.content,
        tags: r.tags,
        confidence: r.confidence,
        learnedAt: r.createdAt,
      })),
    };
  }

  async computeEngagement(): Promise<EngagementSnapshot> {
    const now = new Date();

    const posts = await prisma.post.findMany({
      where: { status: "PUBLISHED", publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      take: 60,
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        publishedAt: true,
        viewCount: true,
        author: { select: { node: true } },
        category: { select: { name: true, slug: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    const ranked: EngagedPost[] = posts.map(p => {
      const postedAt = p.publishedAt ?? now;
      const daysLive = Math.max(1, Math.ceil((now.getTime() - postedAt.getTime()) / DAY_MS));
      const viewsPerDay = daysLive <= 30 ? p.viewCount / daysLive : 0;
      const freshness = postedAt.getTime() > now.getTime() - 72 * 3600 * 1000 ? 3 : 0;
      const velocity = Math.round((viewsPerDay + p._count.comments * 8 + p._count.likes * 6 + freshness) * 100) / 100;
      return {
        id: p.id,
        title: p.title,
        slug: p.slug,
        excerpt: p.excerpt,
        categoryName: p.category?.name ?? null,
        categorySlug: p.category?.slug ?? null,
        authorNode: p.author.node,
        views: p.viewCount,
        comments: p._count.comments,
        likes: p._count.likes,
        velocity,
        daysLive,
        postedAt,
      };
    });

    ranked.sort((a, b) => b.velocity - a.velocity);

    const trending = ranked.slice(0, 6);
    const rising = ranked.filter(p => p.postedAt.getTime() > now.getTime() - 7 * DAY_MS).slice(0, 6);

    const catMap = new Map<string, { name: string; velocity: number; posts: number }>();
    for (const p of ranked) {
      const name = p.categoryName ?? "Uncategorized";
      const cur = catMap.get(name) ?? { name, velocity: 0, posts: 0 };
      cur.velocity += p.velocity;
      cur.posts += 1;
      catMap.set(name, cur);
    }
    const categories = Array.from(catMap.values())
      .map(c => ({ ...c, velocity: Math.round(c.velocity * 100) / 100 }))
      .sort((a, b) => b.velocity - a.velocity);

    return { trending, rising, categories, ranked };
  }

  async recommend(userId?: string, limit = 6): Promise<{ post: EngagedPost; reason: string }[]> {
    const snapshot = await this.computeEngagement();

    let userNode: string | null = null;
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { node: true } });
      userNode = user?.node ?? null;
    }

    const topCatNames = new Set(snapshot.categories.slice(0, 3).map(c => c.name));
    const scored = snapshot.ranked.map(p => {
      let score = p.velocity;
      let reason = "Trending with high engagement";
      if (userNode && p.authorNode === userNode) {
        score *= 1.3;
        reason = `Popular in your node (${userNode})`;
      } else if (p.categoryName && topCatNames.has(p.categoryName)) {
        score *= 1.15;
        reason = `Top performing category: ${p.categoryName}`;
      }
      return { post: p, score, reason };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ post, reason }) => ({ post, reason }));
  }

  async train(): Promise<TrainResult> {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);

    const [engagement, stats, moderation] = await Promise.all([
      this.computeEngagement(),
      prisma.post.count({ where: { status: "PUBLISHED" } }),
      prisma.post.count({ where: { moderationStatus: "PENDING" } }),
    ]);

    const lessons: string[] = [];
    let signalsCreated = 0;
    let signalsUpdated = 0;

    const apply = async (lessonKey: string, content: string, confidence: number, extra: { tags?: string[]; category?: string } = {}) => {
      const existing = await prisma.neuralMemory.findFirst({
        where: {
          source: "internal",
          AND: [
            { metadata: { contains: `"trainDay":"${day}"` } },
            { metadata: { contains: `"lesson":"${lessonKey}"` } },
          ],
        },
        select: { id: true },
      });
      const data = {
        source: "internal",
        category: extra.category ?? "signal",
        content,
        tags: [lessonKey, ...(extra.tags ?? [])].slice(0, 10).join(","),
        confidence,
        metadata: JSON.stringify({ type: "training", trainDay: day, lesson: lessonKey }),
      };
      if (existing) {
        await prisma.neuralMemory.update({ where: { id: existing.id }, data: { ...data, accessCount: { increment: 1 }, lastAccessedAt: new Date() } });
        signalsUpdated += 1;
      } else {
        await prisma.neuralMemory.create({ data });
        signalsCreated += 1;
      }
      lessons.push(content);
    };

    const top = engagement.trending[0];
    if (top) {
      await apply(
        "trending",
        `Training: hottest item is "${top.title}" (velocity ${top.velocity.toFixed(1)}) in ${top.categoryName ?? "uncategorized"} with ${top.views} views, ${top.comments} comments, ${top.likes} likes.`,
        0.9,
        { tags: ["trending", "velocity"], category: "signal" }
      );
    }

    const c = engagement.categories[0];
    if (c) {
      await apply(
        "category",
        `Training: most engaged category is "${c.name}" (${c.posts} posts, cumulative velocity ${c.velocity.toFixed(1)}). Recommend expanding ${c.name.toLowerCase()} coverage.`,
        0.85,
        { tags: ["category", "content"], category: "signal" }
      );
    }

    await apply(
      "publishing",
      `Training: platform has ${stats} published posts and ${moderation} items pending moderation. ${moderation > 20 ? "Queue is elevated — flag for human review." : "Pipeline is healthy."}`,
      0.8,
      { tags: ["publishing", "moderation", "health"], category: "signal" }
    );

    const r = engagement.rising[0];
    if (r) {
      await apply(
        "rising",
        `Training: rising signal detected — "${r.title}" (posted ${r.daysLive}d ago, ${r.views} views, velocity ${r.velocity.toFixed(1)}). Watch-list for promotion.`,
        0.75,
        { tags: ["rising", "detection"], category: "signal" }
      );
    }

    return { signalsCreated, signalsUpdated, lessons };
  }

  private async alreadyLearned(key: "postId" | "commentId", id: string): Promise<boolean> {
    const existing = await prisma.neuralMemory.findFirst({
      where: { metadata: { contains: `"${key}":"${id}"` } },
      select: { id: true },
    });
    return existing !== null;
  }
}

export const hiveBrain = new HiveBrain();