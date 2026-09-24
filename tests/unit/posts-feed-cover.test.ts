import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every post a feed response carries must name a cover.
 *
 * Why this is a test rather than a comment. `POST_SELECT` deliberately omits
 * `coverImage`, because stored covers can be multi-megabyte base64 data URIs
 * and selecting them bloated every response by megabytes. The contract is
 * therefore that a response *derives* the field — `coverImage: postCoverSrc(id)`
 * — rather than passing it through.
 *
 * The unranked branch did that. The ranked (`?personalized=true`) branch did
 * not, so a ranked post arrived at the client with the property absent.
 * `coverSrc(undefined, …)` reads a missing field exactly like a missing cover
 * and mints a generated `/api/thumb/<code>` placeholder, so the home page — the
 * one surface that swaps the server's pool for the ranked response once a
 * signed-in reader is ranked — replaced every real cover with a generic branded
 * card. It looked correct to a crawler and to a signed-out visitor, who both
 * receive the server pool, and only broke for the readers who had an account.
 *
 * The assertion is deliberately framed as "the field is present and points at
 * the post's own cover route" rather than "equals this literal", so it keeps its
 * meaning if the URL shape changes but still catches a branch that forgets to
 * attach anything at all.
 */

const db = vi.hoisted(() => ({
  post: { findMany: vi.fn(), count: vi.fn() },
  session: null as null | { user: { id: string; role?: string } },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ auth: async () => db.session }));
vi.mock("@/lib/thumb", () => ({ postCoverSrc: (id: string) => `/api/thumb/post/${id}` }));
vi.mock("@/lib/redis", () => ({
  cacheGet: async () => null,
  cacheSet: async () => {},
  redisIncr: async () => {},
}));
vi.mock("@/lib/hive-brain", () => ({ hiveBrain: { ingestPost: async () => {} } }));
vi.mock("@/lib/moderation", () => ({ moderateContent: () => ({ score: 0, flags: [], suggested: "CLEAN" }) }));
vi.mock("@/lib/neural-vector", () => ({ embedPost: async () => {}, findDuplicate: async () => null }));
vi.mock("@/lib/auto-tag", () => ({ autoTagPost: async () => {} }));
vi.mock("@/lib/plans", () => ({
  checkPostsQuota: async () => {},
  QuotaError: class extends Error {},
}));
vi.mock("@/lib/studio/save-ledger", () => ({
  claimCreate: async () => ({ status: "claimed" }),
  completeCreate: async () => {},
  readIdempotencyKey: () => null,
  releaseClaim: async () => {},
}));
vi.mock("@/lib/feed-ranker", () => ({
  // Identity ranking: the ordering is not what this test is about, so the ranked
  // pool is handed back unchanged and the page slice is taken from it as-is.
  rankFeed: async (posts: unknown[]) => ({ posts, variant: "control" }),
}));
// Keep the real `mergeLiveViewCounts` (it must preserve extra fields like the
// cover); only stub the Convex round trip, which is a network call.
vi.mock("@/lib/convex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/convex")>()),
  convexViewCounts: async () => new Map<string, number>(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { NextRequest } = await import("next/server");
const { GET } = await import("@/app/api/posts/route");

function post(id: string) {
  return {
    id,
    title: `Story ${id}`,
    slug: `story-${id}`,
    excerpt: "…",
    viewCount: 1,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    author: { id: `u-${id}`, name: "Editorial Team", username: "editorial", avatar: null },
    category: { id: "c1", name: "News", slug: "news" },
    tags: [],
    _count: { comments: 0, likes: 0 },
    source: null,
    sourceUrl: null,
  };
}

const POOL = [post("post-aaaaaa"), post("post-bbbbbb"), post("post-cccccc")];

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/posts${query}`));
}

beforeEach(() => {
  db.post.findMany.mockReset();
  db.post.count.mockReset();
  db.session = null;
  // Two shapes come through Prisma: the feed query (returns the pool) and the
  // source-enrichment query (keys off `where.id.in`).
  db.post.findMany.mockImplementation(async (args: { where?: { id?: unknown } }) =>
    args?.where?.id
      ? POOL.map((p) => ({ id: p.id, source: p.source, sourceUrl: p.sourceUrl }))
      : POOL
  );
  db.post.count.mockResolvedValue(POOL.length);
});

describe("GET /api/posts cover resolution", () => {
  it("names a cover on every post in the ranked (personalized) feed", async () => {
    db.session = { user: { id: "reader-1", role: "USER" } };

    const res = await get("?personalized=true&page=1&limit=10");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { posts: { id: string; coverImage?: string }[] };
    expect(body.posts.length).toBeGreaterThan(0);
    for (const p of body.posts) {
      // Absent is the bug: it reads as "no cover" downstream.
      expect("coverImage" in p).toBe(true);
      expect(p.coverImage).toBe(`/api/thumb/post/${p.id}`);
    }
  });

  it("names a cover on every post in the unranked feed", async () => {
    const res = await get("?page=1&limit=10");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { posts: { id: string; coverImage?: string }[] };
    expect(body.posts.length).toBeGreaterThan(0);
    for (const p of body.posts) {
      expect("coverImage" in p).toBe(true);
      expect(p.coverImage).toBe(`/api/thumb/post/${p.id}`);
    }
  });

  it("keeps the two branches in agreement — neither may drop the field", async () => {
    db.session = { user: { id: "reader-1", role: "USER" } };
    const ranked = (await (await get("?personalized=true&page=1&limit=10")).json()) as {
      posts: Record<string, unknown>[];
    };
    db.session = null;
    const plain = (await (await get("?page=1&limit=10")).json()) as {
      posts: Record<string, unknown>[];
    };

    // Compare on the id set both branches share, rather than on order.
    const byId = new Map(plain.posts.map((p) => [p.id as string, p]));
    for (const p of ranked.posts) {
      const other = byId.get(p.id as string);
      if (!other) continue;
      expect(Boolean(p.coverImage)).toBe(Boolean(other.coverImage));
    }
  });
});
