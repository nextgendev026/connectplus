import { prisma } from "@/lib/prisma";
import { classifyIntent, applyLearnedAliases, extractUrls, isUrl, type Intent } from "@/lib/neural-intent";
import { extractKeywords, analyzeSentiment, extractEntities, summarizeText, stripHtml } from "@/lib/neural-text";
import { hiveBrain } from "@/lib/hive-brain";
import { createLogger } from "@/lib/logger";
import {
  composeDraft,
  continueText,
  buildOutline,
  polishText,
  pickVariant,
  stripInstruction,
  generateHeadline,
  generateTopics,
  type GenerateResult,
} from "@/lib/neural-generate";

export interface NeuralResponse {
  text: string;
  intent: Intent;
  enginesUsed: ("internal" | "external" | "hive" | "llm")[];
  confidence: number;
  sources: string[];
}

export interface PlatformStats {
  totalUsers: number;
  totalPosts: number;
  totalComments: number;
  totalViews: number;
  pendingModeration: number;
  usersThisWeek: number;
  postsThisWeek: number;
  regionalBreakdown: Record<string, { users: number; posts: number; views: number }>;
}

export interface ContentAnalysis {
  totalPosts: number;
  topTopics: { topic: string; count: number; avgViews: number }[];
  avgPostLength: number;
  avgReadTime: number;
  qualityDistribution: { high: number; medium: number; low: number };
  categoryBreakdown: { name: string; count: number }[];
  tagFrequency: { tag: string; count: number }[];
}

export interface UserAnalysis {
  totalUsers: number;
  growthTrend: "accelerating" | "steady" | "declining";
  weeklyGrowthRate: number;
  topRegions: { city: string; users: number; posts: number }[];
  engagementRate: number;
  activeVsInactive: { active: number; inactive: number };
}

class NeuralMindEngine {
  private readonly log = createLogger("neural-mind");

  async getPlatformStats(): Promise<PlatformStats> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalUsers, totalPosts, totalComments, viewAgg, pendingModeration, usersThisWeek, postsThisWeek, usersByNode] =
      await Promise.all([
        prisma.user.count(),
        prisma.post.count({ where: { status: "PUBLISHED" } }),
        prisma.comment.count(),
        prisma.post.aggregate({ _sum: { viewCount: true }, where: { status: "PUBLISHED" } }),
        prisma.post.count({ where: { moderationStatus: "PENDING" } }),
        prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
        prisma.post.count({ where: { createdAt: { gte: weekAgo } } }),
        prisma.user.groupBy({ by: ["node"], _count: { id: true }, where: { node: { not: null } } }),
      ]);

    const regionalBreakdown: Record<string, { users: number; posts: number; views: number }> = {};
    for (const node of usersByNode) {
      if (node.node) {
        const postCount = await prisma.post.count({ where: { author: { node: node.node }, status: "PUBLISHED" } });
        const viewSum = await prisma.post.aggregate({ _sum: { viewCount: true }, where: { author: { node: node.node }, status: "PUBLISHED" } });
        regionalBreakdown[node.node] = {
          users: node._count.id,
          posts: postCount,
          views: viewSum._sum.viewCount || 0,
        };
      }
    }

    return {
      totalUsers,
      totalPosts,
      totalComments,
      totalViews: viewAgg._sum.viewCount || 0,
      pendingModeration,
      usersThisWeek,
      postsThisWeek,
      regionalBreakdown,
    };
  }

  async analyzeContent(): Promise<ContentAnalysis> {
    const posts = await prisma.post.findMany({
      where: { status: "PUBLISHED" },
      take: 200,
      orderBy: { viewCount: "desc" },
      include: { tags: true, category: true },
    });

    if (posts.length === 0) {
      return {
        totalPosts: 0,
        topTopics: [],
        avgPostLength: 0,
        avgReadTime: 0,
        qualityDistribution: { high: 0, medium: 0, low: 0 },
        categoryBreakdown: [],
        tagFrequency: [],
      };
    }

    const allText = posts.map(p => `${p.title} ${p.excerpt || ""} ${p.content.slice(0, 500)}`).join(" ");
    const keywords = extractKeywords(allText, 15);

    const topicMap = new Map<string, { count: number; totalViews: number }>();
    for (const kw of keywords) {
      const matchingPosts = posts.filter(p =>
        (p.title + " " + (p.excerpt || "") + " " + p.content).toLowerCase().includes(kw.keyword)
      );
      if (matchingPosts.length > 0) {
        topicMap.set(kw.keyword, {
          count: matchingPosts.length,
          totalViews: matchingPosts.reduce((sum, p) => sum + p.viewCount, 0),
        });
      }
    }

    const topTopics = Array.from(topicMap.entries())
      .map(([topic, data]) => ({ topic, count: data.count, avgViews: data.totalViews / data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const avgPostLength = posts.reduce((sum, p) => sum + p.content.length, 0) / posts.length;
    const avgReadTime = Math.round(avgPostLength / 1000);

    const viewCounts = posts.map(p => p.viewCount).sort((a, b) => a - b);
    const highThreshold = viewCounts[Math.floor(viewCounts.length * 0.8)] || 100;
    const lowThreshold = viewCounts[Math.floor(viewCounts.length * 0.4)] || 10;

    const qualityDistribution = {
      high: posts.filter(p => p.viewCount >= highThreshold).length,
      medium: posts.filter(p => p.viewCount >= lowThreshold && p.viewCount < highThreshold).length,
      low: posts.filter(p => p.viewCount < lowThreshold).length,
    };

    const categoryMap = new Map<string, number>();
    for (const p of posts) {
      const cat = p.category?.name || "Uncategorized";
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    }
    const categoryBreakdown = Array.from(categoryMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    const tagMap = new Map<string, number>();
    for (const p of posts) {
      for (const tag of p.tags) {
        tagMap.set(tag.name, (tagMap.get(tag.name) || 0) + 1);
      }
    }
    const tagFrequency = Array.from(tagMap.entries()).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 20);

    return {
      totalPosts: posts.length,
      topTopics,
      avgPostLength: Math.round(avgPostLength),
      avgReadTime,
      qualityDistribution,
      categoryBreakdown,
      tagFrequency,
    };
  }

  async analyzeUsers(): Promise<UserAnalysis> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [totalUsers, usersThisWeek, usersLastWeek, postsWithAuthors] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
      prisma.post.findMany({ where: { status: "PUBLISHED" }, select: { authorId: true } }),
    ]);

    const weeklyGrowthRate = totalUsers > 0 ? (usersThisWeek / totalUsers) * 100 : 0;
    const growthTrend = usersThisWeek > usersLastWeek * 1.2 ? "accelerating" : usersThisWeek < usersLastWeek * 0.8 ? "declining" : "steady";

    const postsByUser = new Map<string, number>();
    for (const p of postsWithAuthors) {
      postsByUser.set(p.authorId, (postsByUser.get(p.authorId) || 0) + 1);
    }
    const activeUsers = postsByUser.size;
    const inactiveUsers = Math.max(0, totalUsers - activeUsers);

    const usersByNode = await prisma.user.groupBy({ by: ["node"], _count: { id: true }, where: { node: { not: null } } });
    const topRegions = await Promise.all(
      usersByNode.slice(0, 10).map(async (n) => {
        const posts = await prisma.post.count({ where: { author: { node: n.node }, status: "PUBLISHED" } });
        return { city: n.node || "Unknown", users: n._count.id, posts };
      })
    );
    topRegions.sort((a, b) => b.users - a.users);

    const totalPosts = postsWithAuthors.length;
    const totalComments = await prisma.comment.count();
    const engagementRate = totalPosts > 0 ? totalComments / totalPosts : 0;

    return {
      totalUsers,
      growthTrend,
      weeklyGrowthRate,
      topRegions,
      engagementRate,
      activeVsInactive: { active: activeUsers, inactive: inactiveUsers },
    };
  }

  async getModerationReport() {
    const [statusCounts, recentLogs, pendingPosts] = await Promise.all([
      prisma.post.groupBy({ by: ["moderationStatus"], _count: { id: true } }),
      prisma.moderationLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.post.findMany({ where: { moderationStatus: "PENDING" }, take: 10, orderBy: { createdAt: "desc" }, select: { id: true, title: true, createdAt: true, author: { select: { username: true } } } }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const s of statusCounts) statusMap[s.moderationStatus] = s._count.id;

    const actionMap: Record<string, number> = {};
    for (const log of recentLogs) actionMap[log.action] = (actionMap[log.action] || 0) + 1;

    const totalDecisions = (actionMap["APPROVE"] ?? 0) + (actionMap["REJECT"] ?? 0) + (actionMap["FLAG"] ?? 0);
    const approvalRate = totalDecisions > 0 ? (actionMap["APPROVE"] || 0) / totalDecisions : 1;

    return {
      pendingCount: statusMap["PENDING"] || 0,
      approvedCount: statusMap["APPROVED"] || 0,
      flaggedCount: statusMap["FLAGGED"] || 0,
      rejectedCount: statusMap["REJECTED"] || 0,
      recentFlags: actionMap["FLAG"] || 0,
      recentApprovals: actionMap["APPROVE"] || 0,
      approvalRate,
      recentLogs: recentLogs.slice(0, 10),
      pendingPosts,
    };
  }

  async detectAnomalies() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const [recentViews, viewsLast24h, recentPosts, pendingCount] = await Promise.all([
      prisma.pageView.count({ where: { createdAt: { gte: oneHourAgo } } }),
      prisma.pageView.count({ where: { createdAt: { gte: oneDayAgo } } }),
      prisma.post.count({ where: { createdAt: { gte: oneHourAgo } } }),
      prisma.post.count({ where: { moderationStatus: "PENDING" } }),
    ]);

    const avgHourlyViews = viewsLast24h / 24;
    const anomalies: { severity: "high" | "medium" | "low"; description: string }[] = [];

    if (avgHourlyViews > 0 && recentViews > avgHourlyViews * 3) {
      anomalies.push({ severity: "high", description: `Traffic spike detected: ${recentViews} views in the last hour (${(recentViews / Math.max(avgHourlyViews, 1)).toFixed(1)}x normal)` });
    } else if (avgHourlyViews > 0 && recentViews > avgHourlyViews * 2) {
      anomalies.push({ severity: "medium", description: `Elevated traffic: ${recentViews} views in the last hour` });
    }

    if (pendingCount > 50) {
      anomalies.push({ severity: "high", description: `Moderation backlog critical: ${pendingCount} items pending review` });
    } else if (pendingCount > 20) {
      anomalies.push({ severity: "medium", description: `Moderation queue elevated: ${pendingCount} items pending` });
    }

    if (recentPosts > 20) {
      anomalies.push({ severity: "medium", description: `High posting velocity: ${recentPosts} posts in the last hour` });
    }

    if (anomalies.length === 0) {
      anomalies.push({ severity: "low", description: "All systems operating within normal parameters" });
    }

    return { anomalies, recentViews, avgHourlyViews: Math.round(avgHourlyViews), recentPosts };
  }

  async getGrowthReport() {
    const now = new Date();
    const days: { label: string; date: Date }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      days.push({ label: d.toISOString().slice(0, 10), date: d });
    }

    const dailyData = await Promise.all(
      days.map(async ({ label, date }) => {
        const nextDay = new Date(date.getTime() + 24 * 60 * 60 * 1000);
        const [users, posts, views] = await Promise.all([
          prisma.user.count({ where: { createdAt: { gte: date, lt: nextDay } } }),
          prisma.post.count({ where: { createdAt: { gte: date, lt: nextDay } } }),
          prisma.pageView.count({ where: { createdAt: { gte: date, lt: nextDay } } }),
        ]);
        return { date: label, users, posts, views };
      })
    );

    const week1 = dailyData.slice(0, 7);
    const week2 = dailyData.slice(7, 14);
    const week3 = dailyData.slice(14, 21);
    const week4 = dailyData.slice(21, 28);

    const weeklyAverages = [week1, week2, week3, week4].map(w => ({
      avgUsers: w.reduce((s, d) => s + d.users, 0) / Math.max(w.length, 1),
      avgPosts: w.reduce((s, d) => s + d.posts, 0) / Math.max(w.length, 1),
      avgViews: w.reduce((s, d) => s + d.views, 0) / Math.max(w.length, 1),
    }));

    const lastWeekAvg = weeklyAverages[3]?.avgUsers || 0;
    const prevWeekAvg = weeklyAverages[2]?.avgUsers || 1;
    const weekOverWeekGrowth = prevWeekAvg > 0 ? ((lastWeekAvg - prevWeekAvg) / prevWeekAvg) * 100 : 0;

    return { dailyData, weeklyAverages, weekOverWeekGrowth };
  }

  async getRegionalIntelligence() {
    const nodes = await prisma.user.groupBy({ by: ["node"], _count: { id: true }, where: { node: { not: null } } });

    const regionalData = await Promise.all(
      nodes.map(async (n) => {
        const [posts, views] = await Promise.all([
          prisma.post.count({ where: { author: { node: n.node }, status: "PUBLISHED" } }),
          prisma.post.aggregate({ _sum: { viewCount: true }, where: { author: { node: n.node }, status: "PUBLISHED" } }),
        ]);
        const totalViews = views._sum.viewCount || 0;
        return {
          city: n.node || "Unknown",
          users: n._count.id,
          posts,
          views: totalViews,
          postsPerUser: n._count.id > 0 ? posts / n._count.id : 0,
          viewsPerPost: posts > 0 ? totalViews / posts : 0,
        };
      })
    );

    regionalData.sort((a, b) => b.users - a.users);
    const mostEngaged = [...regionalData].sort((a, b) => b.viewsPerPost - a.viewsPerPost);
    const leastEngaged = [...regionalData].sort((a, b) => a.viewsPerPost - b.viewsPerPost);

    return { regions: regionalData, mostEngaged: mostEngaged.slice(0, 3), leastEngaged: leastEngaged.slice(0, 3) };
  }

  // ── External Intelligence Engine ──

  async learnFromRssArticles() {
    const startedAt = Date.now();
    const existingUrls = new Set(
      (await prisma.neuralMemory.findMany({ where: { source: "external" }, select: { sourceUrl: true } }))
        .map(m => m.sourceUrl).filter(Boolean) as string[]
    );

    const articles = await prisma.rssArticle.findMany({
      where: { url: { notIn: Array.from(existingUrls) } },
      take: 50,
      orderBy: { publishedAt: "desc" },
    });

    let memoriesCreated = 0;
    this.log.info("rss learn started", { articlesCandidates: articles.length });

    for (const article of articles) {
      const text = `${article.title} ${article.summary || ""} ${article.content || ""}`.trim();
      if (text.length < 20) continue;

      const keywords = extractKeywords(text, 10);
      const entities = extractEntities(text);
      const sentiment = analyzeSentiment(text);
      const summary = summarizeText(stripHtml(text), 2);

      try {
        await prisma.neuralMemory.create({
          data: {
            source: "external",
            category: "trend",
            content: summary,
            tags: keywords.map(k => k.keyword).join(","),
            confidence: 0.65,
            sourceUrl: article.url,
            sourceFeedId: article.feedId,
            metadata: JSON.stringify({ sentiment: sentiment.sentiment, entityCount: entities.length, articleTitle: article.title }),
          },
        });
        memoriesCreated++;

        for (const entity of entities.slice(0, 3)) {
          await prisma.neuralMemory.create({
            data: {
              source: "external",
              category: "entity",
              content: `${entity.value} (${entity.type}) — found in: ${article.title}`,
              tags: [entity.type, entity.value.toLowerCase(), ...keywords.slice(0, 3).map(k => k.keyword)].join(","),
              confidence: 0.6,
              sourceUrl: article.url,
              sourceFeedId: article.feedId,
            },
          });
        }
      } catch (err) {
        this.log.warn("rss learn skipped article", { url: article.url, error: err instanceof Error ? err.message : String(err) });
        // skip duplicates
      }
    }

    this.log.info("rss learn complete", { memoriesCreated, elapsedMs: Date.now() - startedAt });
    return { articlesAnalyzed: articles.length, memoriesCreated };
  }

  async learnFromUrl(url: string) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "ConnectPlus NeuralMind/1.0" } });
      clearTimeout(timeout);

      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };

      const html = await res.text();
      const text = stripHtml(html).slice(0, 15000);
      if (text.length < 50) return { success: false, error: "Content too short" };
      this.log.info("learned from url", { url: url.slice(0, 100), chars: text.length });

      const keywords = extractKeywords(text, 15);
      const entities = extractEntities(text);
      const sentiment = analyzeSentiment(text);
      const summary = summarizeText(text, 4);

      const memory = await prisma.neuralMemory.create({
        data: {
          source: "external",
          category: "external_knowledge",
          content: summary,
          tags: keywords.map(k => k.keyword).join(","),
          confidence: 0.6,
          sourceUrl: url,
          metadata: JSON.stringify({ sentiment: sentiment.sentiment, wordCount: text.split(/\s+/).length, entityCount: entities.length }),
        },
      });

      for (const entity of entities.slice(0, 5)) {
        await prisma.neuralMemory.create({
          data: {
            source: "external",
            category: "entity",
            content: `${entity.value} (${entity.type}) — learned from ${url}`,
            tags: [entity.type, entity.value.toLowerCase(), ...keywords.slice(0, 3).map(k => k.keyword)].join(","),
            confidence: 0.55,
            sourceUrl: url,
          },
        });
      }

      return { success: true, memory };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Fetch failed";
      return { success: false, error: message };
    }
  }

  async getExternalKnowledge(query: string) {
    const keywords = extractKeywords(query, 5);

    const memories = await prisma.neuralMemory.findMany({
      where: {
        source: "external",
        OR: [
          { content: { contains: query } },
          { tags: { contains: keywords[0]?.keyword || query } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    await prisma.neuralMemory.updateMany({
      where: { id: { in: memories.map(m => m.id) } },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
    });

    return memories;
  }

  // ── Unified Query Processor ──

  // Consult the Hive Brain's learned intent-maps BEFORE static classification so
  // the brains "grasp" phrasing the admin has used before.
  async classifyIntentWithMemory(input: string) {
    const learned = await this.getLearnedIntentMaps();
    const learnedIntent = applyLearnedAliases(input, learned);
    const classified = classifyIntent(input);
    this.log.debug("intent classified", { input: input.slice(0, 60), intent: classified.intent, confidence: classified.confidence, learnedIntent });

    if (learnedIntent && (classified.intent === "unknown" || classified.confidence < 0.5)) {
      return {
        ...classified,
        intent: learnedIntent,
        confidence: Math.max(classified.confidence, 0.6),
        fromMemory: true,
      };
    }
    return { ...classified, fromMemory: false };
  }

  async getLearnedIntentMaps(): Promise<{ phrase: string; intent: Intent }[]> {
    const maps = await prisma.neuralMemory.findMany({
      where: { source: "ai", category: "intent-map" },
      select: { content: true, metadata: true },
      take: 32,
    });
    const out: { phrase: string; intent: Intent }[] = [];
    for (const m of maps) {
      const intent = m.content.replace(/^intent-map:/, "").trim() as Intent;
      if (!intent) continue;
      let meta: { phrases?: string[] } = {};
      try {
        meta = JSON.parse(m.metadata ?? "{}");
      } catch {}
      for (const p of meta.phrases ?? []) {
        if (p && p.trim().length >= 3) out.push({ phrase: p.trim(), intent });
      }
    }
    return out;
  }

  async processQuery(input: string, _history?: { role: string; content: string }[]): Promise<NeuralResponse> {
    const startedAt = Date.now();
    const { intent, confidence } = await this.classifyIntentWithMemory(input);
    this.log.info("processing query", { intent, confidence });
    const urls = extractUrls(input);
    const enginesUsed: ("internal" | "external" | "hive")[] = [];
    const sources: string[] = [];
    // Each intent stores a different report shape in `data`; consumers below
    // destructure it per-case with explicit callback types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any = {};

    switch (intent) {
      case "run_sweep": {
        enginesUsed.push("hive");
        const [sweep, hive] = await Promise.all([hiveBrain.sweepInternal(), hiveBrain.status()]);
        data = { sweep, hive };
        break;
      }
      case "write_content": {
        enginesUsed.push("internal");
        const topic = this.extractDraft(input);
        data = { ...composeDraft(topic), topic };
        break;
      }
      case "rewrite_content": {
        enginesUsed.push("internal");
        const draft = this.extractDraft(input);
        data = { polish: polishText(draft), draft };
        break;
      }
      case "summarize_content": {
        enginesUsed.push("internal");
        const draft = this.extractDraft(input);
        data = { summary: summarizeText(stripHtml(draft), 2).slice(0, 280), draft };
        break;
      }
      case "headline_suggest": {
        enginesUsed.push("internal");
        const draft = this.extractDraft(input);
        const firstLine = draft.split(/\n/)[0]?.slice(0, 60) ?? "Untitled";
        data = { result: generateHeadline(firstLine, draft), draft };
        break;
      }
      case "tag_suggest": {
        enginesUsed.push("internal");
        const draft = this.extractDraft(input);
        data = { result: generateTopics(draft), draft };
        break;
      }
      case "outline_suggest": {
        enginesUsed.push("internal");
        const draft = this.extractDraft(input);
        data = { outline: buildOutline(draft), draft };
        break;
      }
      case "expand_content": {
        enginesUsed.push("internal");
        const draft = this.extractDraft(input);
        data = { extension: continueText(draft), draft };
        break;
      }
      case "curate_content": {
        enginesUsed.push("internal", "hive");
        const [analysis, engagement] = await Promise.all([this.analyzeContent(), hiveBrain.computeEngagement()]);
        data = { analysis, engagement };
        break;
      }
      case "system_health": {
        enginesUsed.push("internal", "hive");
        const [stats, anomalies, hive] = await Promise.all([this.getPlatformStats(), this.detectAnomalies(), hiveBrain.status()]);
        data = { stats, anomalies: anomalies.anomalies, hive };
        break;
      }
      case "content_analysis": {
        enginesUsed.push("internal");
        data = { analysis: await this.analyzeContent() };
        break;
      }
      case "user_analysis": {
        enginesUsed.push("internal");
        data = { users: await this.analyzeUsers() };
        break;
      }
      case "moderation_report": {
        enginesUsed.push("internal");
        data = { moderation: await this.getModerationReport() };
        break;
      }
      case "threat_scan": {
        enginesUsed.push("internal");
        const [anomalies, moderation] = await Promise.all([this.detectAnomalies(), this.getModerationReport()]);
        data = { anomalies: anomalies.anomalies, moderation };
        break;
      }
      case "growth_report": {
        enginesUsed.push("internal");
        data = { growth: await this.getGrowthReport() };
        break;
      }
      case "regional_analysis": {
        enginesUsed.push("internal");
        data = { regional: await this.getRegionalIntelligence() };
        break;
      }
      case "trend_query": {
        enginesUsed.push("internal", "external", "hive");
        const [analysis, externalKnowledge, hiveLearnings] = await Promise.all([
          this.analyzeContent(),
          this.getExternalKnowledge(input),
          hiveBrain.recall(input, 5),
        ]);
        data = { internalTopics: analysis.topTopics, externalKnowledge, hiveLearnings };
        break;
      }
      case "hive_report": {
        enginesUsed.push("hive");
        const [hive, recall] = await Promise.all([hiveBrain.status(), hiveBrain.recall(input, 6)]);
        data = { hive, recall };
        break;
      }
      case "recommendation": {
        enginesUsed.push("internal", "hive");
        const [recommended, engagement] = await Promise.all([hiveBrain.recommend(undefined, 6), hiveBrain.computeEngagement()]);
        data = { recommended, engagement };
        break;
      }
      case "external_learn": {
        enginesUsed.push("external");
        const url = urls[0];
        if (url && isUrl(url)) {
          data = await this.learnFromUrl(url);
          sources.push(url);
        } else {
          data = { results: await this.getExternalKnowledge(input) };
        }
        break;
      }
      case "knowledge_search": {
        enginesUsed.push("external", "hive");
        const [results, hiveRecall] = await Promise.all([this.getExternalKnowledge(input), hiveBrain.recall(input, 5)]);
        data = { results, hiveRecall };
        break;
      }
      case "memory_manage": {
        enginesUsed.push("external");
        if (input.toLowerCase().includes("clear")) {
          const deleted = await prisma.neuralMemory.deleteMany({});
          data = { deleted: deleted.count, action: "clear" };
        } else {
          data = { memories: await this.getMemoryBank({ limit: 10 }), action: "list" };
        }
        break;
      }
      default: {
        // The "conversational brain": decode the language of the query
        // (greetings, thanks, identity, capabilities, or anything else) and
        // answer dynamically instead of repeating a canned platform overview.
        enginesUsed.push("internal", "hive");
        const [hive, recall] = await Promise.all([hiveBrain.status(), hiveBrain.recall(input, 3)]);
        data = { hive, recall, query: input };
        break;
      }
    }

    const text = await this.synthesizeResponse(intent, data, input);
    this.log.info("query resolved", { intent, enginesUsed, elapsedMs: Date.now() - startedAt });
    return { text, intent, enginesUsed, confidence, sources };
  }

  async synthesizeResponse(
    intent: Intent,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    _input: string
  ): Promise<string> {
    switch (intent) {
      case "system_health": {
        const { stats, anomalies, hive } = data;
        const score = this.calculateHealthScore(stats, anomalies);
        const icon = score > 80 ? "🟢" : score > 50 ? "🟡" : "🔴";
        const lines = [
          `**Platform Health Assessment — Score: ${score}/100** ${icon}`,
          "",
          `**Core Metrics:**`,
          `• Users: ${stats.totalUsers.toLocaleString()} (+${stats.usersThisWeek} this week)`,
          `• Posts: ${stats.totalPosts.toLocaleString()} (+${stats.postsThisWeek} this week)`,
          `• Total Views: ${stats.totalViews.toLocaleString()}`,
          `• Comments: ${stats.totalComments.toLocaleString()}`,
          `• Moderation Queue: ${stats.pendingModeration} pending items`,
          "",
          `**Regional Nodes:** ${Object.keys(stats.regionalBreakdown).length} active`,
          `**Hive Brain:** online — ${hive.total} knowledge entries (${hive.sourceBreakdown.internal ?? 0} internal / ${hive.sourceBreakdown.external ?? 0} external)`,
        ];
        if (anomalies.length > 0 && !(anomalies.length === 1 && anomalies[0].severity === "low")) {
          lines.push("", `**Anomalies Detected (${anomalies.length}):**`);
          for (const a of anomalies) lines.push(`• [${a.severity.toUpperCase()}] ${a.description}`);
        } else {
          lines.push("", "**No anomalies detected.** All systems operating within normal parameters.");
        }
        return lines.join("\n");
      }

      case "content_analysis": {
        const { analysis } = data as { analysis: ContentAnalysis };
        const lines = [
          "**Content Intelligence Report**",
          "",
          `**Publishing Volume:** ${analysis.totalPosts} posts analyzed`,
          `**Average Post Length:** ${analysis.avgPostLength.toLocaleString()} characters (~${analysis.avgReadTime} min read)`,
          "",
          "**Top Topics by Engagement:**",
        ];
        analysis.topTopics.slice(0, 5).forEach((t, i) => lines.push(`${i + 1}. **${t.topic}** — ${t.count} posts, avg ${Math.round(t.avgViews)} views`));
        lines.push("", "**Tag Frequency:**");
        analysis.tagFrequency.slice(0, 8).forEach(t => lines.push(`• ${t.tag}: ${t.count} uses`));
        lines.push("", "**Quality Distribution:**", `• High: ${analysis.qualityDistribution.high} · Medium: ${analysis.qualityDistribution.medium} · Low: ${analysis.qualityDistribution.low}`);
        lines.push("", "**Categories:**");
        analysis.categoryBreakdown.forEach(c => lines.push(`• ${c.name}: ${c.count} posts`));
        return lines.join("\n");
      }

      case "user_analysis": {
        const { users } = data as { users: UserAnalysis };
        const lines = [
          "**User Intelligence Report**",
          "",
          `**Total Users:** ${users.totalUsers.toLocaleString()}`,
          `**Growth Trend:** ${users.growthTrend} (${users.weeklyGrowthRate.toFixed(1)}% weekly)`,
          `**Engagement Rate:** ${users.engagementRate.toFixed(1)} comments per post`,
          "",
          "**Top Regions:**",
        ];
        users.topRegions.slice(0, 5).forEach((r, i) => lines.push(`${i + 1}. **${r.city}** — ${r.users} users, ${r.posts} posts`));
        lines.push("", "**Active vs Inactive:**", `• Active (posted at least once): ${users.activeVsInactive.active}`, `• Inactive: ${users.activeVsInactive.inactive}`);
        return lines.join("\n");
      }

      case "moderation_report": {
        const { moderation } = data;
        const lines = [
          "**Moderation Intelligence Report**",
          "",
          `**Queue Status:** ${moderation.pendingCount} items pending review`,
          `• Approved: ${moderation.approvedCount} · Flagged: ${moderation.flaggedCount} · Rejected: ${moderation.rejectedCount}`,
          `**Approval Rate:** ${(moderation.approvalRate * 100).toFixed(1)}%`,
          `**Recent Actions:** ${moderation.recentApprovals} approvals, ${moderation.recentFlags} flags`,
        ];
        if (moderation.pendingPosts.length > 0) {
          lines.push("", "**Awaiting Review:**");
          moderation.pendingPosts.forEach((p: { title: string; author: { username: string } }) => lines.push(`• "${p.title}" by @${p.author.username}`));
        }
        return lines.join("\n");
      }

      case "threat_scan": {
        const { anomalies, moderation } = data;
        const threatLevel = anomalies.length > 3 ? "ELEVATED" : anomalies.length > 1 ? "LOW" : "MINIMAL";
        const icon = threatLevel === "ELEVATED" ? "🔴" : threatLevel === "LOW" ? "🟡" : "🟢";
        const lines = [
          `**Security Assessment — Threat Level: ${threatLevel}** ${icon}`,
          "",
          `**Anomalies:** ${anomalies.length} detected`,
        ];
        anomalies.forEach((a: { severity: string; description: string }) => lines.push(`• [${a.severity.toUpperCase()}] ${a.description}`));
        lines.push("", "**Moderation Intelligence:**", `• Pending review: ${moderation.pendingCount}`, `• Flagged (recent): ${moderation.recentFlags}`, `• Approval rate: ${(moderation.approvalRate * 100).toFixed(1)}%`);
        return lines.join("\n");
      }

      case "growth_report": {
        const { growth } = data;
        const lines = [
          "**Growth Report — Last 30 Days**",
          "",
          `**Week-over-Week Growth:** ${growth.weekOverWeekGrowth >= 0 ? "+" : ""}${growth.weekOverWeekGrowth.toFixed(1)}%`,
          "",
          "**Daily Averages:**",
        ];
        growth.weeklyAverages.forEach((w: { avgUsers: number; avgPosts: number; avgViews: number }, i: number) => lines.push(`• Week ${i + 1}: ~${Math.round(w.avgUsers)} users/day, ~${Math.round(w.avgPosts)} posts/day, ~${Math.round(w.avgViews)} views/day`));
        const lastWeek = growth.dailyData.slice(-7);
        const totalUsers = lastWeek.reduce((s: number, d: { users: number }) => s + d.users, 0);
        const totalPosts = lastWeek.reduce((s: number, d: { posts: number }) => s + d.posts, 0);
        lines.push("", "**Last 7 Days Totals:**", `• ${totalUsers} new users`, `• ${totalPosts} new posts`);
        return lines.join("\n");
      }

      case "regional_analysis": {
        const { regional } = data;
        const lines = [
          "**Regional Network Intelligence**",
          "",
          `**${regional.regions.length} active nodes**`,
          "",
          "**All Nodes (by users):**",
        ];
        regional.regions.forEach((r: { city: string; users: number; posts: number; views: number; viewsPerPost: number }) => lines.push(`• **${r.city}**: ${r.users} users, ${r.posts} posts, ${r.views.toLocaleString()} views (${r.viewsPerPost.toFixed(0)} views/post)`));
        if (regional.mostEngaged.length > 0) {
          lines.push("", "**Most Engaged:**");
          regional.mostEngaged.forEach((r: { city: string; viewsPerPost: number }) => lines.push(`• ${r.city}: ${r.viewsPerPost.toFixed(0)} views/post`));
        }
        return lines.join("\n");
      }

      case "hive_report": {
        const { hive, recall } = data;
        const internal = hive.sourceBreakdown.internal ?? 0;
        const external = hive.sourceBreakdown.external ?? 0;
        const lines = [
          `**🐝 Hive Mind Report**`,
          "",
          `**Brain Status:** online — ${hive.total} knowledge entries in shared memory`,
          `• Internal (learned from this platform): ${internal}`,
          `• External (learned from RSS/URLs): ${external}`,
          `• AI lessons taught (from admin interactions): ${hive.sourceBreakdown.ai ?? 0}`,
          `• Knowledge types: ${Object.entries(hive.categoryBreakdown).map(([c, n]) => `${c} (${n})`).join(", ")}`,
          "",
          "**Learned Topics (signals):**",
        ];
        if (hive.topTopics.length > 0) {
          hive.topTopics.slice(0, 12).forEach((t: { topic: string; count: number }) => lines.push(`• ${t.topic} ×${t.count}`));
        } else {
          lines.push("• The hive is still warming up. Run a learning sweep or publish content.");
        }
        lines.push("", "**Most Recent Learnings:**");
        if (hive.recentLearnings.length > 0) {
          hive.recentLearnings.slice(0, 6).forEach((m: { source: string; category: string; content: string }) => lines.push(`• [${m.source}/${m.category}] ${m.content.slice(0, 120)}`));
        } else {
          lines.push("• No learnings recorded yet.");
        }
        if (recall && recall.length > 0) {
          lines.push("", "**Recalled for Your Query:**");
          recall.slice(0, 4).forEach((m: { content: string }) => lines.push(`• ${m.content.slice(0, 120)}`));
        }
        return lines.join("\n");
      }

      case "trend_query": {
        const { internalTopics, externalKnowledge, hiveLearnings } = data;
        const lines = ["**Trend Intelligence**", ""];
        if (internalTopics.length > 0) {
          lines.push("**Platform Trends:**");
          internalTopics.slice(0, 5).forEach((t: { topic: string; count: number; avgViews: number }, i: number) => lines.push(`${i + 1}. **${t.topic}** — ${t.count} mentions, avg ${Math.round(t.avgViews)} views`));
          lines.push("");
        }
        if (externalKnowledge.length > 0) {
          lines.push("**External Learnings:**");
          externalKnowledge.slice(0, 5).forEach((m: { content: string }) => lines.push(`• ${m.content.slice(0, 120)}...`));
          lines.push("");
        }
        if (hiveLearnings && hiveLearnings.length > 0) {
          lines.push("**Hive Brain Learned Signals:**");
          hiveLearnings.slice(0, 5).forEach((m: { category: string; source: string; content: string }) => lines.push(`• [${m.category}@${m.source}] ${m.content.slice(0, 120)}`));
          lines.push("");
        }
        if (internalTopics.length === 0 && externalKnowledge.length === 0 && !(hiveLearnings && hiveLearnings.length > 0)) {
          lines.push("No trend data available yet. The external mind is still learning from RSS feeds.");
        }
        return lines.join("\n");
      }

      case "external_learn": {
        if (data.error) return `Failed to learn from the provided source: ${data.error}`;
        if (data.result === "batch_learned") return `**Batch Learning Complete**\n\nAnalyzed ${data.articlesAnalyzed} RSS articles and created ${data.memoriesCreated} new knowledge entries.`;
        if (data.memory) {
          const lines = [
            "**Learning Complete**",
            "",
            `New knowledge entry created from: ${data.memory.sourceUrl}`,
            `**Summary:** ${data.memory.content.slice(0, 300)}`,
            `**Tags:** ${data.memory.tags}`,
            `**Confidence:** ${(data.memory.confidence * 100).toFixed(0)}%`,
          ];
          return lines.join("\n");
        }
        return `Learning request processed. ${data.results?.length || 0} related memories found.`;
      }

      case "knowledge_search": {
        const { results, hiveRecall } = data;
        if (results.length === 0 && !(hiveRecall && hiveRecall.length > 0)) return "No matching knowledge found in the memory bank. Try different keywords or learn from new sources.";
        const lines = [`**Knowledge Search Results** (${(results.length || 0) + (hiveRecall ? hiveRecall.length : 0)} found)`, ""];
        if (results.length > 0) {
          lines.push("**From External Learning:**");
          results.slice(0, 5).forEach((m: { category: string; source: string; content: string }, i: number) => lines.push(`[${i + 1}] **${m.category}** (${m.source}) — ${m.content.slice(0, 150)}...`));
          lines.push("");
        }
        if (hiveRecall && hiveRecall.length > 0) {
          lines.push("**From Hive Brain Memory:**");
          hiveRecall.slice(0, 5).forEach((m: { category: string; source: string; content: string }, i: number) => lines.push(`[${i + 1}] **${m.category}** (${m.source}) — ${m.content.slice(0, 150)}`));
        }
        return lines.join("\n");
      }

      case "memory_manage": {
        if (data.action === "clear") return `**Knowledge Base Cleared**\n\n${data.deleted} memory entries removed.`;
        const lines = [`**Knowledge Base** (${data.memories.total} total entries)`, ""];
        data.memories.memories.slice(0, 5).forEach((m: { source: string; category: string; content: string }) => lines.push(`• [${m.source}] ${m.category}: ${m.content.slice(0, 80)}...`));
        return lines.join("\n");
      }

      case "recommendation": {
        const { recommended, engagement } = data;
        if (!recommended || recommended.length === 0) {
          return "No fresh content to recommend yet. Publish more posts and the hive will start ranking them by engagement velocity.";
        }
        const lines = [
          "**🍯 Personalised Recommendations**",
          "",
          "**Trending Right Now:**",
        ];
        engagement.trending.slice(0, 3).forEach((p: { title: string; categoryName: string | null; velocity: number }, i: number) => lines.push(`${i + 1}. **${p.title}** — ${p.categoryName ?? "uncategorised"} (velocity ${p.velocity.toFixed(1)})`));
        lines.push("", "**Rising Fast:**");
        engagement.rising.slice(0, 3).forEach((p: { title: string; views: number; daysLive: number }, i: number) => lines.push(`${i + 1}. **${p.title}** — ${p.views} views in ${p.daysLive}d`));
        lines.push("", "**Why the Hive Ranked These:**");
        recommended.slice(0, 6).forEach((r: { post: { title: string }; reason: string }, i: number) => lines.push(`${i + 1}. **${r.post.title}** — ${r.reason}`));
        lines.push("", "The feed adapts automatically as engagement flows into the hive — likes, comments and views teach the ranking model.");
        return lines.join("\n");
      }

      case "run_sweep": {
        const { sweep, hive } = data;
        const activity = sweep.memoriesCreated > 30 ? "high activity" : sweep.memoriesCreated > 0 ? "normal" : "quiet";
        return [
          "**🧹 Learning Sweep Complete**",
          "",
          `• Posts scanned: ${sweep.postsScanned} · learned from ${sweep.postsLearned}`,
          `• Comments scanned: ${sweep.commentsScanned} · learned from ${sweep.commentsLearned}`,
          `• New memory entries: ${sweep.memoriesCreated}`,
          `• Activity level: ${activity}`,
          "",
          `**Hive Brain is now at ${hive.total.toLocaleString()} knowledge entries.** The neural mind is freshly wired and ready — ask me anything again and I'll understand it better. 🐝`,
        ].join("\n");
      }

      case "write_content": {
        const { draft, headline, tags, topic } = data as { draft: string; headline: string; tags: string[]; topic: string };
        return [
          `**✍️ Draft ready — "${headline}"**`,
          "",
          "Here is a working draft to get you started:",
          "",
          draft,
          "",
          `**Suggested tags:** ${tags.map((t) => `#${t.replace(/\s+/g, "")}`).join(" ")}`,
          "",
          `_Topic detected: ${topic.slice(0, 90)}. Paste a draft into chat and ask me to rewrite, expand, summarize or tag it — I read and write content directly._`,
        ].join("\n");
      }

      case "rewrite_content": {
        const { polish, draft } = data as { polish: ReturnType<typeof polishText>; draft: string };
        if (!draft || draft.trim().length < 20) {
          return "I need some text to polish. Paste your paragraph or draft into the chat (e.g. \"rewrite this: <your text>\") and I'll tighten it up.";
        }
        const before = polish.original.split(/\s+/).length;
        const after = polish.rewritten.split(/\s+/).length;
        return [
          `**✨ Polished draft** (${polish.changes} improvements, ${before} → ${after} words)`,
          "",
          polish.rewritten,
          "",
          polish.notes.length > 0 ? ["**What changed:**", ...polish.notes.map((n) => `• ${n}`)].join("\n") : "**What changed:** your draft was already clean — no filler or marathon sentences to cut.",
        ].join("\n");
      }

      case "summarize_content": {
        const { summary, draft } = data as { summary: string; draft: string };
        if (!draft || draft.trim().length < 20) {
          return "Paste some text into chat (e.g. \"summarize this: <your text>\") and I'll condense it into a tight excerpt you can use as the post summary.";
        }
        return [
          `**📝 Summary / excerpt** (${draft.split(/\s+/).length} → ${summary.split(/\s+/).length} words)`,
          "",
          summary,
          "",
          "_Drop this into the Excerpt field, or ask me for headlines, tags or an outline of the same text._",
        ].join("\n");
      }

      case "headline_suggest": {
        const { result } = data as { result: GenerateResult };
        const lines = [`**📰 Headline suggestions**`, "", `1. **${result.primary}**`];
        result.alternatives.forEach((a, i) => lines.push(`${i + 2}. ${a}`));
        lines.push("", "_Click one to lift it straight into your title — or ask me to write, polish or outline the full piece._");
        return lines.join("\n");
      }

      case "tag_suggest": {
        const { result } = data as { result: GenerateResult };
        const all = [result.primary, ...result.alternatives].filter(Boolean);
        return [
          `**🏷️ Tag suggestions**`,
          "",
          all.map((t) => `• #${t.toLowerCase().replace(/\s+/g, "-")}`).join("\n"),
          "",
          "_These come from keyword + entity extraction on your text. Combine with a category and your post will be discoverable in search, feeds and the topic pages._",
        ].join("\n");
      }

      case "outline_suggest": {
        const { outline } = data as { outline: ReturnType<typeof buildOutline> };
        return [
          `**🗂️ Post outline**`,
          "",
          `**Intro:** ${outline.intro}`,
          "",
          ...outline.sections,
          "",
          `**Closing:** ${outline.closing}`,
          "",
          "_Ask me to expand any section or to write the full draft from this outline._",
        ].join("\n");
      }

      case "expand_content": {
        const { extension, draft } = data as { extension: ReturnType<typeof continueText>; draft: string };
        if (!draft || draft.trim().length < 20) {
          return "Paste your draft into chat (e.g. \"continue this: <your text>\") and I'll keep writing from where you stopped.";
        }
        return [
          `**➕ Continue writing**`,
          "",
          extension.heading ? `Suggestion for the next section: *${extension.heading}*` : "",
          "",
          extension.continuation,
          "",
          "_Append this to your draft and keep going — I can extend it again and again, always anchored to what you've already written._",
        ].filter((l) => l !== "").join("\n");
      }

      case "curate_content": {
        const { analysis, engagement } = data as {
          analysis: ContentAnalysis;
          engagement: { trending: { title: string; categoryName: string | null; velocity: number; views: number }[]; categories: { name: string; velocity: number; posts: number }[] };
        };
        const lines = [`**🧭 Curation brief — what to write & publish next**`, ""];
        if (engagement.categories.length > 0) {
          lines.push("**Hottest categories right now:**");
          engagement.categories.slice(0, 5).forEach((c, i) => lines.push(`${i + 1}. **${c.name}** — ${c.posts} posts, velocity ${c.velocity.toFixed(0)}`));
          lines.push("");
        }
        if (analysis.topTopics.length > 0) {
          lines.push("**Angles already performing:**");
          analysis.topTopics.slice(0, 4).forEach((t, i) => lines.push(`${i + 1}. ${t.topic} — ${t.count} posts, avg ${Math.round(t.avgViews)} views`));
          lines.push("");
        }
        if (engagement.trending.length > 0) {
          lines.push("**Trending right now (great for a follow-up or rebuttal):**");
          engagement.trending.slice(0, 3).forEach((p) => lines.push(`• "${p.title}" — ${p.categoryName ?? "uncategorized"} (${p.views} views)`));
        }
        lines.push("", "_Want me to write any of these? Say \"write about <topic>\" and I'll draft the first version._");
        return lines.join("\n");
      }

      default: {
        const { hive, recall, query } = data as {
          hive: { total: number; sourceBreakdown: Record<string, number> };
          recall: { content: string; source: string; category: string }[];
          query: string;
        };
        return this.generalChatResponse(query, hive.total, recall ?? []);
      }
    }
  }

  /**
   * The conversational brain. It decodes the language of whatever the admin
   * typed — greetings, thanks, identity, capabilities, or free-form questions —
   * and responds dynamically using the query's own keywords, entities and
   * sentiment (plus hive recall) so it never repeats a canned answer.
   */
  private generalChatResponse(input: string, hiveTotal: number, recall: { content: string; source: string; category: string }[]): string {
    const lower = input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const seed = input.slice(0, 200);

    if (/^(hi|hey|hello|jambo|sasa|mambo|habari|hujambo|yo|hola|howdy)\b/.test(lower)) {
      return pickVariant(
        [
          `**Habari! 👋** I'm the Neural Mind — the platform brain wired into the feed, the hive memory and the studio. Ask me about health, growth, trends, or paste some text and I'll write, rewrite, summarize, tag or headline it for you.`,
          `**Sasa! 🙌** Good to see you. I've got ${hiveTotal.toLocaleString()} memories in the hive and a full content toolkit — try \"write about <topic>\", \"polish this: <text>\", or \"curate content\".`,
          `**Jambo! 👋** The brains are online — ${hiveTotal.toLocaleString()} knowledge entries and counting. Ask me anything about the platform, or hand me a draft and I'll make it shine.`,
        ],
        seed
      );
    }

    if (/^(thanks|thank you|asante|nice|great work|good job)\b/.test(lower)) {
      return pickVariant(
        [
          `**Karibu! 🌟** Happy to help. Whenever you have a draft, paste it here and I'll rewrite, summarize, tag or headline it — that's what I'm wired for.`,
          `**Asante sana! 🙏** Anytime. Remember I can also curate what to publish next, scan for threats, or break down the growth report.`,
          `**You're welcome! ✨** The hive learns from every interaction, so the more we talk, the sharper I get. What are you working on?`,
        ],
        seed
      );
    }

    if (/(who are you|what are you|your name|what is your name|tell me about yourself)/.test(lower)) {
      return [
        `**I'm the Neural Mind — ConnectPlus's integrated brain.**`,
        "",
        "Under the hood I'm a pipeline of engines:",
        `• **Neural intent** — I decode the language of your question (keywords, entities, sentiment) instead of matching canned responses.`,
        `• **Hive Brain** — ${hiveTotal.toLocaleString()} shared memories learned from posts, comments, RSS and our conversations.`,
        "• **Content brain** — I write, rewrite, summarize, headline, tag, outline and curate content straight from chat or the studio.",
        "",
        "Try: \"write about Nairobi fintech\", \"polish this: <text>\", \"suggest tags for my draft\", or \"curate content\".",
      ].join("\n");
    }

    if (/(what can you do|what do you do|help|capabilities|commands|how do you work|what should i ask)/.test(lower)) {
      return [
        `**Here's everything the brains can do for you:**`,
        "",
        "**Content creation & writing**",
        "• ✍️ `write about <topic>` — full draft with headline and tags",
        "• ✨ `polish this: <text>` / `rewrite this: <text>` — tighten wording & split long sentences",
        "• 📝 `summarize this: <text>` — instant excerpt",
        "• 📰 `suggest a headline for: <text>` — clickable title options",
        "• 🏷️ `suggest tags for: <text>` — SEO-ready hashtags",
        "• 🗂️ `make an outline for <topic>` — structure for a post",
        "• ➕ `continue this: <text>` — keeps writing from your last line",
        "• 🧭 `curate content` — what to publish next, from live engagement data",
        "",
        "**Platform intelligence**",
        "• 🩺 `system health` · 📊 `content analysis` · 👥 `user analysis`",
        "• 🛡️ `threat scan` · 📈 `growth report` · 🗺️ `regional analysis`",
        "• 🐝 `hive report` · 🔎 `knowledge search` · 🌐 `learn from <url>`",
      ].join("\n");
    }

    if (/(how are you|how are things|are you ok|how is the brain)/.test(lower)) {
      return pickVariant(
        [
          `**Running smooth! ⚡** All engines green — ${hiveTotal.toLocaleString()} memories in the hive, and I just finished wiring the content brain into the studio. How's your writing going today?`,
          `**Firing on all cylinders 🧠** The hive is at ${hiveTotal.toLocaleString()} entries and the content toolkit is loaded. Point me at a draft and I'll show you what I can do.`,
        ],
        seed
      );
    }

    // Free-form: decode the language — keywords, entities and sentiment.
    const keywords = extractKeywords(input, 4).map((k) => k.keyword);
    const entities = extractEntities(input);
    const sentiment = analyzeSentiment(input);

    const understood: string[] = [];
    if (entities.length > 0) {
      understood.push(`you're talking about **${entities.slice(0, 3).map((e) => e.value).join(", ")}**`);
    }
    if (keywords.length > 0) {
      understood.push(`the key themes I picked up are **${keywords.slice(0, 3).join(", ")}**`);
    }
    if (understood.length === 0) {
      understood.push(`I parsed **${input.trim().slice(0, 60)}** as your core question`);
    }

    const tone =
      sentiment.sentiment === "positive"
        ? "The tone reads positive — good energy to build on."
        : sentiment.sentiment === "negative"
          ? "The tone reads more cautious/negative — I can help frame this constructively."
          : "";

    const heads: string[] = [];
    if (/write|draft|compose|create/i.test(lower)) {
      heads.push(`• Say **\"write about ${keywords[0] ?? "your topic"}\"** and I'll draft the full post with a headline and tags.`);
    }
    if (/rewrite|polish|edit|improve/i.test(lower) || entities.length > 0) {
      heads.push(`• Paste the text after **\"polish this:\"** and I'll rewrite it tighter.`);
    }
    if (/trend|topic|idea|write|publish|curat/i.test(lower)) {
      heads.push(`• Ask **\"curate content\"** to see what's hot and what to publish next.`);
    }
    if (recall.length > 0) {
      heads.push(`• From the hive's memory: **${recall.slice(0, 2).map((m) => m.content.slice(0, 80)).join(" | ")}**`);
    }
    if (heads.length === 0) {
      heads.push("• Try **\"curate content\"** for what to publish next, or paste a draft and I'll polish it.");
    }

    return pickVariant(
      [
        `**Got it — ${understood.join(" and ")}.** ${tone} ${tone ? "" : "Here's how I can help:"} ${heads.join(" ")}`,
        `**Interesting — ${understood.join(", ")}.** ${tone ? tone + " " : ""}Let me point you somewhere useful: ${heads.join(" ")}`,
      ],
      seed + lower
    );
  }

  /** Extract the draft/topic from a chat instruction like "polish this: <text>". */
  private extractDraft(input: string): string {
    const text = stripInstruction(input);
    if (text.length < 12) return input;
    return text;
  }

  private calculateHealthScore(stats: PlatformStats, anomalies: { severity: string }[]): number {
    let score = 100;
    if (stats.pendingModeration > 50) score -= 15;
    else if (stats.pendingModeration > 20) score -= 8;
    if (stats.totalUsers === 0) score -= 30;
    if (stats.totalPosts === 0) score -= 20;
    if (stats.postsThisWeek === 0) score -= 10;
    score -= anomalies.filter((a) => a.severity === "high").length * 10;
    score -= anomalies.filter((a) => a.severity === "medium").length * 5;
    return Math.max(0, Math.min(100, score));
  }

  // ── Memory Management ──

  async getMemoryBank(options: { source?: string; category?: string; search?: string; limit?: number; offset?: number } = {}) {
    const { source, category, search, limit = 20, offset = 0 } = options;
    const where: {
      source?: string;
      category?: string;
      OR?: { content?: { contains: string }; tags?: { contains: string } }[];
    } = {};
    if (source && source !== "all") where.source = source;
    if (category && category !== "all") where.category = category;
    if (search) {
      where.OR = [
        { content: { contains: search } },
        { tags: { contains: search } },
      ];
    }
    const [memories, total] = await Promise.all([
      prisma.neuralMemory.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
      prisma.neuralMemory.count({ where }),
    ]);
    return { memories, total };
  }

  async deleteMemory(id: string) {
    try {
      await prisma.neuralMemory.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async getInsights() {
    const [stats, anomalies, moderation, externalMemoryCount, recentExternal] = await Promise.all([
      this.getPlatformStats(),
      this.detectAnomalies(),
      this.getModerationReport(),
      prisma.neuralMemory.count({ where: { source: "external" } }),
      prisma.neuralMemory.findMany({ where: { source: "external" }, orderBy: { createdAt: "desc" }, take: 5 }),
    ]);

    const healthScore = this.calculateHealthScore(stats, anomalies.anomalies);
    const insights: { title: string; summary: string; severity: "info" | "warning" | "critical"; action?: string }[] = [];

    insights.push({
      title: "Platform Health",
      summary: `Health score: ${healthScore}/100. ${stats.totalUsers} users, ${stats.totalPosts} posts, ${stats.totalViews.toLocaleString()} views.`,
      severity: healthScore > 80 ? "info" : healthScore > 50 ? "warning" : "critical",
    });

    if (stats.usersThisWeek > 0) {
      insights.push({
        title: "Growth Update",
        summary: `${stats.usersThisWeek} new users and ${stats.postsThisWeek} new posts this week.`,
        severity: "info",
      });
    }

    if (moderation.pendingCount > 20) {
      insights.push({
        title: "Moderation Alert",
        summary: `${moderation.pendingCount} posts pending review. Queue is elevated.`,
        severity: "warning",
        action: "Review pending posts in the moderation queue",
      });
    }

    for (const a of anomalies.anomalies.filter((x: { severity: string }) => x.severity !== "low")) {
      insights.push({
        title: "Anomaly Detected",
        summary: a.description,
        severity: a.severity === "high" ? "critical" : "warning",
      });
    }

    if (externalMemoryCount > 0) {
      insights.push({
        title: "External Intelligence",
        summary: `${externalMemoryCount} knowledge entries learned from external sources. ${recentExternal.length} recent entries available.`,
        severity: "info",
      });
    }

    return insights;
  }

  // ── AI Teaching Loop ──
  // Every meaningful admin interaction is distilled into a memory lesson that
  // feeds BOTH brains: it becomes part of the hive's shared knowledge bank and
  // sharpens the neural engine's recall for the same intent next time.

  async learnFromInteraction(input: string, intent: Intent, answer: string): Promise<boolean> {
    if (intent === "unknown" || intent === "general_platform") return false;

    await this.teachIntentPhrase(input, intent);

    const body = `${input} ${answer}`;
    const summary = summarizeText(stripHtml(body), 1).slice(0, 140);
    const keywords = extractKeywords(input, 4).map(k => k.keyword);
    const tags = [intent, ...keywords.slice(0, 4)].join(",");
    const metadata = JSON.stringify({ type: "ai-lesson", intent, query: input.slice(0, 120) });

    const existing = await prisma.neuralMemory.findFirst({
      where: { source: "ai", metadata: { contains: `"intent":"${intent}"` } },
      select: { id: true },
    });

    if (existing) {
      await prisma.neuralMemory.update({
        where: { id: existing.id },
        data: {
          content: `AI lesson (${intent}): ${summary}`,
          tags,
          confidence: 0.7,
          accessCount: { increment: 1 },
          lastAccessedAt: new Date(),
        },
      });
      return false;
    }

    await prisma.neuralMemory.create({
      data: {
        source: "ai",
        category: "lesson",
        content: `AI lesson (${intent}): ${summary}`,
        tags,
        confidence: 0.7,
        metadata,
      },
    });
    return true;
  }

  // The heart of the "feed logic" feature: every question the admin asks gets
  // digested into an intent-map memory (shared with the Hive Brain). Next time
  // the same — or a similar — phrasing shows up, BOTH brains recognise it via
  // applyLearnedAliases even if it has no keywords the static classifier knows.
  private async teachIntentPhrase(input: string, intent: Intent): Promise<void> {
    const clean = input.toLowerCase().replace(/\s+/g, " ").trim();
    if (clean.length < 3 || clean.length > 90) return;

    // Skip trivially generic prompts that would add no signal.
    if (/^(hi|hey|hello|sasa|jambo|hola|how are you|thanks|thank you|asante)[\s!.?]*$/i.test(clean)) return;

    const map = await prisma.neuralMemory.findFirst({
      where: { source: "ai", category: "intent-map", content: `intent-map:${intent}` },
      select: { id: true, metadata: true },
    });

    let phrases: string[] = [];
    if (map) {
      try {
        phrases = JSON.parse(map.metadata ?? "{}")?.phrases ?? [];
      } catch {}
    }
    if (!phrases.includes(clean)) {
      phrases = [clean, ...phrases].slice(0, 10);
    }

    const metadata = JSON.stringify({ phrases });
    if (map) {
      await prisma.neuralMemory.update({ where: { id: map.id }, data: { metadata, confidence: 0.8 } });
    } else {
      await prisma.neuralMemory.create({
        data: {
          source: "ai",
          category: "intent-map",
          content: `intent-map:${intent}`,
          tags: `intent-map,${intent}`,
          confidence: 0.8,
          metadata,
        },
      });
    }
  }
}

export const neuralMind = new NeuralMindEngine();
