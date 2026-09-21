import { NextRequest, NextResponse, after } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";
import { cacheGet, cacheSet, redisIncr } from "@/lib/redis";
import { hiveBrain } from "@/lib/hive-brain";
import { moderateContent } from "@/lib/moderation";
import { embedPost } from "@/lib/neural-vector";
import { rankFeed } from "@/lib/feed-ranker";
import type { FeedRankVariant } from "@/lib/experiments";
import { autoTagPost } from "@/lib/auto-tag";
import { findDuplicate } from "@/lib/neural-vector";
import { postCoverSrc } from "@/lib/thumb";
import { convexViewCounts, mergeLiveViewCounts } from "@/lib/convex";
import { checkPostsQuota, QuotaError } from "@/lib/plans";
import { claimCreate, completeCreate, readIdempotencyKey, releaseClaim } from "@/lib/studio/save-ledger";

// NOTE: `coverImage` is deliberately absent — stored covers can be multi-MB
// base64 data URIs, and selecting them bloated every feed response (and the
// Redis body cache) by megabytes. Responses carry a small /api/thumb/post/<id>
// URL instead (see LIST_COVER mapping in GET).
const POST_SELECT = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  viewCount: true,
  createdAt: true,
  author: { select: { id: true, name: true, username: true, avatar: true } },
  category: { select: { id: true, name: true, slug: true } },
  tags: { select: { id: true, name: true, slug: true } },
  _count: { select: { comments: true, likes: true } },
} as const;

/**
 * Enrich a post page with the original-source attribution (scalars can't ride
 * in an `include`, so fetch them in one batched query and merge).
 */
async function withSources<T extends { id: string }>(posts: T[]) {
  if (posts.length === 0) return posts;
  const rows = await prisma.post.findMany({
    where: { id: { in: posts.map((p) => p.id) } },
    select: { id: true, source: true, sourceUrl: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return posts.map((p) => {
    const src = byId.get(p.id);
    return {
      ...p,
      source: src?.source ?? null,
      sourceUrl: src?.sourceUrl ?? null,
    };
  });
}

// This route reads query params (page/category/tag/search) and the session, so
// it must render per request — `force-static` froze the first render and made
// every filtered or "load more" request return the same body. Egress is kept
// flat by the Redis body cache below plus the CDN s-maxage in vercel.json.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const category = searchParams.get("category");
    const tag = searchParams.get("tag");
    const search = searchParams.get("search");
    const featured = searchParams.get("featured");
    const mine = searchParams.get("mine") === "true";
    const personalized = searchParams.get("personalized") === "true";

    // Hot anonymous feed reads are cached in Redis for a short window so
    // bursts of traffic share one database hit instead of N (free-tier
    // friendly). Personalized and auth-scoped reads bypass the cache. A
    // version counter invalidates the namespace on publish with one INCR.
    const cacheable = !mine && !personalized && !search && page <= 3;
    const feedVersion = cacheable
      ? ((await cacheGet<number>("feed:version").catch(() => null)) ?? 0)
      : 0;
    const cacheKey = `feed:v${feedVersion}${request.nextUrl.search}`;
    if (cacheable) {
      const cached = await cacheGet<string>(cacheKey).catch(() => null);
      if (cached) {
        return new NextResponse(cached, {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const skip = (page - 1) * limit;

    const baseWhere: {
      status?: string;
      moderationStatus?: string;
      category?: { slug: string };
      tags?: { some: { slug: string } };
      OR?: { title?: { contains: string; mode: "insensitive" }; content?: { contains: string; mode: "insensitive" }; excerpt?: { contains: string; mode: "insensitive" } }[];
      featured?: boolean;
    } = {
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
    };

    let authorId: string | null = null;
    if (mine || personalized) {
      const session = await auth();
      if (!session?.user) {
        if (mine) {
          return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }
      } else {
        authorId = session.user.id;
      }
    }

    const where = authorId
      ? { authorId, category: baseWhere.category, tags: baseWhere.tags, OR: baseWhere.OR, featured: baseWhere.featured }
      : { ...baseWhere };

    if (category) {
      where.category = { slug: category };
    }

    if (tag) {
      where.tags = { some: { slug: tag } };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { content: { contains: search, mode: "insensitive" } },
        { excerpt: { contains: search, mode: "insensitive" } },
      ];
    }

    if (featured === "true") {
      where.featured = true;
    }

    const noFilters = !category && !tag && !search && !featured && !mine;
    const canPersonalize = personalized && noFilters;

    // Phase 1: adaptive ranked feed — same deterministic pool per user so
    // "load more" pagination slices stay consistent.
    if (canPersonalize) {
      const pool = await prisma.post.findMany({
        where: baseWhere,
        orderBy: { createdAt: "desc" },
        take: 50,
        select: POST_SELECT,
      });
      const { posts: ranked, variant } = await rankFeed(pool, authorId);
      const total = ranked.length;
      const pagePosts = await withSources(ranked.slice(skip, skip + limit));
      // Live totals, so a "load more" card shows the same number as the article
      // page it links to. Always a miss for this branch (personalized reads are
      // never cached), and bounded to one page of ids.
      const liveCounts = await convexViewCounts(pagePosts.map((p) => p.id));
      return NextResponse.json({
        posts: mergeLiveViewCounts(pagePosts, liveCounts),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          variant,
        },
      });
    }

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: POST_SELECT,
      }),
      prisma.post.count({ where }),
    ]);
    const enriched = mergeLiveViewCounts(
      (await withSources(posts)).map((post) => ({
        ...post,
        coverImage: postCoverSrc(post.id),
      })),
      // Resolved before the body is cached: a Redis hit returns above and costs
      // no Convex call at all, while a miss bakes the live numbers into the
      // copy every visitor in the next 45s receives.
      await convexViewCounts(posts.map((post) => post.id))
    );

    const body = JSON.stringify({
      posts: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        variant: "control" as FeedRankVariant,
      },
    });

    if (cacheable) {
      await cacheSet(cacheKey, body, 45).catch(() => {});
    }
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": cacheable
          ? "public, s-maxage=60, stale-while-revalidate=120"
          : "private, no-store",
      },
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Declared outside the try so the catch can release the claim. A create that
  // threw must not leave a claim behind: without the release, the writer's retry
  // would be refused by a claim belonging to an attempt that never succeeded.
  let idempotencyKey: string | null = null;
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const userId = session.user.id;

    // Idempotent create. The Studio sends the key `sessionId:revision:hash` on
    // every save, derived rather than random, so a retry of the same intent — a
    // lost response, a re-armed timer — is recognised instead of producing a
    // second draft. A request without the header behaves exactly as before, so
    // this is additive for every other client.
    idempotencyKey = readIdempotencyKey(request);
    if (idempotencyKey) {
      const claim = await claimCreate(userId, idempotencyKey);
      if (claim.status === "existing") {
        const existing = await prisma.post.findUnique({
          where: { id: claim.postId },
          include: {
            author: { select: { id: true, name: true, username: true, avatar: true } },
            category: { select: { id: true, name: true, slug: true } },
            tags: { select: { id: true, name: true, slug: true } },
            _count: { select: { comments: true, likes: true } },
          },
        });
        if (existing) {
          // 200, not 201: nothing was created, and a client that branches on the
          // status should be able to tell the difference.
          return NextResponse.json(
            { post: existing, moderationStatus: existing.moderationStatus, idempotent: true },
            { status: 200 }
          );
        }
        // The claim outlived its document, or pointed at a post since deleted.
        // Reported honestly rather than silently creating a replacement, because
        // the caller's intent is ambiguous at this point and guessing could
        // produce exactly the duplicate this exists to prevent.
        return NextResponse.json(
          {
            error: "This save was already attempted and the draft it created is gone.",
            code: "SAVE_CLAIM_STALE",
            message: "Reload the Studio and start a new draft.",
          },
          { status: 409 }
        );
      }
      if (claim.status === "in_flight") {
        // The claim exists but has no document yet: a concurrent request with the
        // same key is mid-create. Refusing is the whole point — creating here
        // would produce the duplicate draft.
        return NextResponse.json(
          {
            error: "This save is already being processed.",
            code: "SAVE_IN_FLIGHT",
            message: "Retry in a moment.",
          },
          { status: 409, headers: { "Retry-After": "1" } }
        );
      }
      if (claim.status === "unavailable") {
        // The ledger could not be consulted. Proceeding is the right call — a
        // duplicate-prevention feature must not become an outage — but the
        // degradation is logged so it is visible rather than assumed away.
        console.warn("draft idempotency unavailable, proceeding without a claim:", claim.reason);
      }
    }

    const body = await request.json();
    const { title, content, excerpt, coverImage, categoryId, tags, status, scheduledAt } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const author = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, emailVerified: true },
    });
    if (!author) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let slug = slugify(title);
    const existingSlug = await prisma.post.findUnique({ where: { slug } });
    if (existingSlug) {
      slug = `${slug}-${Date.now()}`;
    }

    let scheduleDate: Date | null = null;
    if (scheduledAt) {
      const parsed = new Date(scheduledAt);
      if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now() + 60_000) {
        scheduleDate = parsed;
      }
    }

    const wantsPublish = status === "PUBLISHED" && !scheduleDate;

    // Publishing (live or scheduled) requires a confirmed email.
    if (wantsPublish && !author.emailVerified) {
      return NextResponse.json(
        {
          error: "Your email isn't verified yet.",
          code: "EMAIL_NOT_VERIFIED",
          message: "Confirm your email to publish stories.",
        },
        { status: 403 }
      );
    }

    const postStatus = wantsPublish ? "PUBLISHED" : "DRAFT";

    // Quota: plans with a monthly post cap throttle publishing only — pure
    // drafting stays free. ADMIN / SUPER_ADMIN are always exempt.
    if (wantsPublish || scheduleDate) {
      const role = (session.user as { role?: string }).role;
      try {
        await checkPostsQuota(userId, role);
      } catch (err) {
        if (err instanceof QuotaError) {
          return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
        }
        throw err;
      }
    }

    // Phase 2: run the self-contained moderation scanner.
    const risk = moderateContent(title.trim(), content);
    const scan = risk.suggested === "REJECTED" ? "REJECTED" : risk.suggested === "FLAGGED" ? "FLAGGED" : "CLEAN";
    const trusted = author.role === "CREATOR" || author.role === "ADMIN" || author.role === "SUPER_ADMIN";

    // Trusted writers publish straight through; regular users land in the
    // moderation queue until an admin approves (or the scanner objects).
    let moderationStatus =
      postStatus === "DRAFT"
        ? (scan === "REJECTED" ? "REJECTED" : scan === "FLAGGED" ? "FLAGGED" : "PENDING")
        : scan === "REJECTED"
          ? "REJECTED"
          : scan === "FLAGGED"
            ? "FLAGGED"
            : trusted
              ? "APPROVED"
              : "PENDING";

    // Phase 2: near-duplicate detection against existing published content.
    let duplicate: { postId: string; score: number } | null = null;
    if (wantsPublish && moderationStatus === "APPROVED") {
      duplicate = await findDuplicate({ title: title.trim(), content: content.trim() }).catch(() => null);
      if (duplicate) {
        moderationStatus = "FLAGGED";
        risk.flags.push(`duplicate:${duplicate.score.toFixed(2)}`);
      }
    }

    const tagConnections = tags && Array.isArray(tags)
      ? await Promise.all(
          tags.map(async (tagName: string) => {
            const tagSlug = slugify(tagName);
            const tag = await prisma.tag.upsert({
              where: { slug: tagSlug },
              update: {},
              create: { name: tagName.trim().slice(0, 50), slug: tagSlug },
            });
            return { id: tag.id };
          })
        )
      : [];

    const post = await prisma.post.create({
      data: {
        title: title.trim().slice(0, 300),
        slug,
        content: content.trim(),
        excerpt: excerpt?.trim().slice(0, 500) || null,
        // A derived thumb URL is never a real cover; store nothing instead.
        coverImage:
          coverImage && !String(coverImage).startsWith("/api/thumb/") ? coverImage : null,
        authorId: userId,
        categoryId: categoryId || null,
        status: postStatus,
        moderationStatus,
        aiScore: risk.score,
        aiFlags: risk.flags.join(",") || null,
        publishedAt: postStatus === "PUBLISHED" ? new Date() : null,
        scheduledAt: scheduleDate,
        tags: { connect: tagConnections },
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
        category: { select: { id: true, name: true, slug: true } },
        tags: { select: { id: true, name: true, slug: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    // Bump the feed-cache version so published posts appear immediately.
    redisIncr("feed:version").catch(() => {});
    // The home feed is edge-cached, so a publish has to invalidate it rather
    // than wait out the window; nothing is cached for a slug that has never
    // been requested, which is why the article itself needs no revalidation.
    if (postStatus === "PUBLISHED") revalidatePath("/");

    // Index the semantic embedding + hive engagement (fire-and-forget).
    if (postStatus === "PUBLISHED" && moderationStatus === "APPROVED") {
      embedPost(post).catch(() => {});
      autoTagPost(post.id, `${post.title} ${post.excerpt ?? ""}`).catch(() => {});
      // A story that just went live is the one moment its share is worth
      // anything, so the share goes out with it rather than waiting for the
      // marketing sweep. `after()` keeps the Graph call off the writer's path.
      after(async () => {
        try {
          const { shareNewStory } = await import("@/lib/marketing");
          await shareNewStory({
            id: post.id,
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt,
            categoryName: post.category?.name ?? null,
          });
        } catch {
          // the sweep is the retry path
        }
      });
    }
    // The claim is completed only now, once a document actually exists. A
    // claim completed earlier would answer a retry with a `postId` for a row
    // that was never committed.
    if (idempotencyKey) await completeCreate(idempotencyKey, post.id);

    await hiveBrain.ingestPost(post).catch(() => {});

    return NextResponse.json(
      { post, moderationStatus, aiFlags: risk.flags, duplicate },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating post:", error);
    // Release so the writer's retry is not blocked by a failed attempt.
    if (idempotencyKey) await releaseClaim(idempotencyKey);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
