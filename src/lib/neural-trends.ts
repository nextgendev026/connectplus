import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { extractKeywords, extractEntities, analyzeSentiment, stripHtml } from "@/lib/neural-text";
import { research, type ResearchFinding } from "@/lib/web-research";

const log = createLogger("neural-trends");

export interface PlatformSignal {
  subject: string;
  count: number;
  views: number;
  score: number;
  category?: string | null;
}

export interface WebSignal {
  subject: string;
  findings: ResearchFinding[];
  score: number;
}

export interface TrendResult {
  subject: string;
  platform: number;
  web: number;
  velocity: number;
  sentiment: number;
  sources: string[];
  category?: string | null;
}

export interface TrendSnapshot {
  generatedAt: string;
  trends: TrendResult[];
  platformSignals: PlatformSignal[];
  webSignals: WebSignal[];
  summary: string;
  memoryCreated: number;
}

const DAY_MS = 86_400_000;

/**
 * The combined trend radar. Notices what the platform is buzzing about and
 * cross-checks it against the live web, then persists what it learns into
 * NeuralMemory (category "trend") so the mind keeps feeding itself.
 */
export class NeuralTrends {
  private readonly log = createLogger("neural-trends");

  /** Recent platform heat: posts in the last 7 days, bucketed by topic. */
  async collectPlatformSignals(days = 7, top = 12): Promise<PlatformSignal[]> {
    const since = new Date(Date.now() - days * DAY_MS);
    const posts = await prisma.post.findMany({
      where: {
        status: "PUBLISHED",
        publishedAt: { gte: since },
      },
      select: {
        id: true,
        title: true,
        excerpt: true,
        viewCount: true,
        category: { select: { name: true } },
        tags: { select: { name: true } },
      },
      orderBy: { viewCount: "desc" },
      take: 300,
    });

    const buckets = new Map<string, { count: number; views: number; category: string | null }>();
    const push = (key: string, views: number, category?: string | null) => {
      const b = buckets.get(key);
      if (b) {
        b.count += 1;
        b.views += views;
        if (category && !b.category) b.category = category;
      } else {
        buckets.set(key, { count: 1, views, category: category ?? null });
      }
    };

    for (const p of posts) {
      const kws = extractKeywords(`${p.title} ${p.excerpt ?? ""}`, 4).map((k) => k.keyword);
      kws.forEach((k) => push(k, p.viewCount ?? 0, p.category?.name));
      if (kws.length === 0) push((p.title ?? "uncategorized").split(" ").slice(0, 4).join(" "), p.viewCount ?? 0, p.category?.name);
    }

    // Enrich with explicitly tagged topics (author-curated signal).
    for (const p of posts) {
      p.tags?.slice(0, 4).forEach((t) => push(t.name, p.viewCount ?? 0, p.category?.name));
    }

    const maxViews = Math.max(...[...buckets.values()].map((b) => b.views), 1);
    return [...buckets.entries()]
      .map(([subject, b]) => ({
        subject,
        count: b.count,
        views: b.views,
        category: b.category,
        score: b.count * 0.55 + (b.views / maxViews) * 100 * 0.45,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, top);
  }

  /** Cross-check top platform subjects against the live web (keyless research). */
  async collectWebSignals(subjects: string[], maxSources = 2): Promise<WebSignal[]> {
    const signals: WebSignal[] = [];
    const unique = [...new Set(subjects.map((s) => s.split(/\s+/).slice(0, 4).join(" ")))]
      .filter(Boolean)
      .slice(0, 5);
    for (const subject of unique) {
      try {
        const findings = await research(subject, maxSources).catch(() => []);
        if (findings.length === 0) continue;
        const avgLen = findings.reduce((n, f) => n + (f.text?.length ?? 0), 0) / findings.length;
        signals.push({
          subject,
          findings,
          score: findings.length * 60 + Math.min(avgLen, 40),
        });
      } catch (e) {
        this.log.warn(`web signal failed for "${subject}"`, e);
      }
    }
    return signals.sort((a, b) => b.score - a.score).slice(0, 8);
  }

  /**
   * Run the full sweep: platform heat → web research → merge & rank →
   * persist lessons to memory so the mind is continuously taught by the web.
   */
  async sweepTrends(opts?: { days?: number; persist?: boolean }): Promise<TrendSnapshot> {
    const { days = 7, persist = true } = opts ?? {};
    const started = Date.now();

    const platformSignals = await this.collectPlatformSignals(days);

    // Combine platform subjects with a few editorial "if nothing trending" seeds
    // so the sweep stays useful on quiet days.
    const seeds = ["East Africa", "technology", "creators economy"];
    const researchTargets = [
      ...platformSignals.slice(0, 5).map((p) => p.subject),
      ...seeds.filter((s) => !platformSignals.some((p) => p.subject.toLowerCase() === s.toLowerCase())),
    ].slice(0, 7);

    const webSignals = await this.collectWebSignals(researchTargets);

    // Merge: subjects present in both bubble up.
    const merged = new Map<string, TrendResult>();
    for (const p of platformSignals) {
      merged.set(p.subject.toLowerCase(), {
        subject: p.subject,
        platform: Math.round(Math.min(p.score, 100) * 10) / 10,
        web: 0,
        velocity: 0,
        sentiment: 0,
        sources: [],
        category: p.category,
      });
    }
    for (const w of webSignals) {
      const key = w.subject.toLowerCase();
      const existing = merged.get(key);
      const sentiment = w.findings.length > 0 ? analyzeSentiment(w.findings.map((f) => f.text ?? "").join(" ")).score : 0;
      if (existing) {
        existing.web = Math.round(Math.min(w.score, 100) * 10) / 10;
        existing.sentiment = Math.round(sentiment * 100) / 100;
        existing.sources = w.findings.map((f) => f.url).filter(Boolean);
      } else {
        merged.set(key, {
          subject: w.subject,
          platform: 0,
          web: Math.round(Math.min(w.score, 100) * 10) / 10,
          velocity: 0,
          sentiment: Math.round(sentiment * 100) / 100,
          sources: w.findings.map((f) => f.url).filter(Boolean),
          category: null,
        });
      }
    }

    const trends = [...merged.values()]
      .map((t) => ({ ...t, heat: t.platform + t.web }))
      .sort((a, b) => b.heat - a.heat)
      .filter((t) => t.platform > 0 || t.web > 0)
      .slice(0, 20);

    // Estimate 7-day velocity against last week's snapshot if we have one.
    const prev = await prisma.neuralMemory.findMany({
      where: { source: "brain", category: "trend", createdAt: { lt: new Date(started - DAY_MS) } },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const prevScores = new Map<string, number>();
    for (const m of prev) {
      try {
        const meta = JSON.parse(m.metadata ?? "{}");
        if (typeof meta.heat === "number") prevScores.set(m.tags.toLowerCase(), meta.heat);
      } catch {
        /* tolerate malformed */
      }
    }
    for (const t of trends) {
      t.velocity = Math.round((t.heat - (prevScores.get(t.subject.toLowerCase()) ?? t.heat)) * 10) / 10;
    }

    const memoryCreated = persist ? await this.persist(trends, platformSignals, webSignals) : 0;

    return {
      generatedAt: new Date(started).toISOString(),
      trends,
      platformSignals: platformSignals.slice(0, 8),
      webSignals,
      summary: this.buildSummary(trends),
      memoryCreated,
    };
  }

  private buildSummary(trends: TrendResult[]): string {
    const rising = trends.filter((t) => t.velocity > 0).slice(0, 3);
    const hot = trends.filter((t) => t.web > 0).slice(0, 3);
    const lines = [
      `Trend radar is awake. ${trends.length} subjects tracked across the platform and the web.`,
      "",
    ];
    if (hot.length > 0) {
      lines.push(`**Buzzing on the web right now:**`);
      hot.forEach((t) => lines.push(`• ${t.subject} (${t.web}/100)`));
      lines.push("");
    }
    if (rising.length > 0) {
      lines.push(`**Fastest risers on the platform (7d):**`);
      rising.forEach((t) => lines.push(`• ${t.subject} (${t.velocity > 0 ? "+" : ""}${t.velocity})`));
    } else {
      lines.push("_No strong risers this window — the mind is holding a steady baseline._");
    }
    if (trends.length === 0) lines.push("_Nothing substantial yet. Publish more and the radar gets sharper._");
    return lines.join("\n");
  }

  /** Upsert trend lessons into neural memory (idempotent per subject-window). */
  private async persist(trends: TrendResult[], platformSignals: PlatformSignal[], webSignals: WebSignal[]): Promise<number> {
    let created = 0;
    const windowKey = new Date().toISOString().slice(11, 13); // hour window — keeps snapshots distinct

    // 1) One combined snapshot entry.
    await prisma.neuralMemory.create({
      data: {
        source: "brain",
        category: "trend",
        content: this.buildSummary(trends),
        tags: "trend,radar",
        confidence: 0.7,
        metadata: JSON.stringify({
          scope: "snapshot",
          total: trends.length,
          platform: platformSignals.slice(0, 8).map((p) => p.subject),
          web: webSignals.slice(0, 8).map((w) => w.subject),
          window: windowKey,
          generatedAt: new Date().toISOString(),
        }),
      },
    });
    created += 1;

    // 2) One row per tracked subject (heat + velocity marker for next sweep).
    for (const t of trends) {
      const existing = await prisma.neuralMemory.findFirst({
        where: { source: "brain", category: "trend", tags: t.subject.toLowerCase() },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        await prisma.neuralMemory.update({
          where: { id: existing.id },
          data: {
            content: `Subject "${t.subject}" — platform heat ${t.platform}/100, web signal ${t.web}/100, 7d velocity ${t.velocity > 0 ? "+" : ""}${t.velocity}.${t.sources.length ? ` Sources: ${t.sources.slice(0, 3).join(", ")}` : ""}`,
            metadata: JSON.stringify({ heat: t.platform + t.web, velocity: t.velocity, sentiment: t.sentiment }),
            confidence: 0.6,
          },
        });
      } else {
        await prisma.neuralMemory.create({
          data: {
            source: "brain",
            category: "trend",
            content: `Subject "${t.subject}" — platform heat ${t.platform}/100, web signal ${t.web}/100, 7d velocity ${t.velocity > 0 ? "+" : ""}${t.velocity}.${t.sources.length ? ` Sources: ${t.sources.slice(0, 3).join(", ")}` : ""}`,
            tags: t.subject.toLowerCase(),
            confidence: 0.6,
            metadata: JSON.stringify({ heat: t.platform + t.web, velocity: t.velocity, sentiment: t.sentiment, category: t.category }),
            sourceUrl: t.sources[0] ?? null,
          },
        });
        created += 1;
      }
    }
    return created;
  }
}

export const neuralTrends = new NeuralTrends();
