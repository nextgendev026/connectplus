import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may read a story that is not published.
 *
 * Why this is worth a test rather than a code comment. `GET /api/posts/[id]`
 * answered for any id *or slug* with no session check at all, so an unfinished
 * draft — a private note, an embargoed piece, a story held back by moderation —
 * was readable by anyone holding its id, and by anyone who could guess its slug.
 * Slugs come from headlines and are effectively public, and the studio editor
 * loads drafts through this exact call, which is what made the leak easy to
 * reach rather than theoretical.
 *
 * The gate is deliberately a 404 rather than a 403: a 403 confirms the id
 * exists, which is itself information about a story nobody has seen.
 */

const db = vi.hoisted(() => ({
  post: { findFirst: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  session: null as null | { user: { id: string; role?: string } },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ auth: async () => db.session }));
vi.mock("@/lib/thumb", () => ({ postCoverSrc: (id: string) => `/api/thumb/post/${id}` }));
vi.mock("@/lib/moderation", () => ({ moderateContent: async () => ({}) }));
vi.mock("@/lib/neural-vector", () => ({
  embedPost: async () => {},
  findDuplicate: async () => null,
}));
vi.mock("@/lib/auto-tag", () => ({ autoTagPost: async () => {} }));
vi.mock("@/lib/redis", () => ({ redisIncr: async () => {} }));

const { GET } = await import("@/app/api/posts/[id]/route");

const AUTHOR = "author-1";

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    slug: "unfinished-headline",
    title: "Unfinished",
    content: "…",
    status: "DRAFT",
    moderationStatus: "PENDING",
    authorId: AUTHOR,
    viewCount: 3,
    ...overrides,
  };
}

function get() {
  return GET(new Request("http://localhost/api/posts/post-1") as never, {
    params: Promise.resolve({ id: "post-1" }),
  });
}

beforeEach(() => {
  db.post.findFirst.mockReset();
  db.post.update.mockReset();
  db.user.findUnique.mockReset();
  db.session = null;
});

describe("an unpublished story", () => {
  it("is invisible to anonymous readers — by id or by slug", async () => {
    db.post.findFirst.mockResolvedValue(post());

    const res = await get();

    expect(res.status).toBe(404);
    // The body must not betray that the row exists.
    expect(await res.json()).toEqual({ error: "Post not found" });
    expect(db.post.update).not.toHaveBeenCalled();
  });

  it("is invisible to a different signed-in account", async () => {
    db.post.findFirst.mockResolvedValue(post());
    db.session = { user: { id: "someone-else", role: "USER" } };
    db.user.findUnique.mockResolvedValue({ role: "USER" });

    const res = await get();

    expect(res.status).toBe(404);
  });

  it("is readable by its author", async () => {
    db.post.findFirst.mockResolvedValue(post());
    db.session = { user: { id: AUTHOR, role: "USER" } };

    const res = await get();

    expect(res.status).toBe(200);
    // The author's own draft must not inflate the public view count.
    expect(db.post.update).not.toHaveBeenCalled();
  });

  it("is readable by a moderator, whose role is read fresh from the database", async () => {
    db.post.findFirst.mockResolvedValue(post());
    // The session claims USER; the database says ADMIN. The database wins, so a
    // role change takes effect without waiting for a new sign-in.
    db.session = { user: { id: "mod-1", role: "USER" } };
    db.user.findUnique.mockResolvedValue({ role: "ADMIN" });

    const res = await get();

    expect(res.status).toBe(200);
  });

  it("stays hidden when a stale session claims a role the account no longer has", async () => {
    db.post.findFirst.mockResolvedValue(post());
    db.session = { user: { id: "demoted-1", role: "ADMIN" } };
    db.user.findUnique.mockResolvedValue({ role: "USER" });

    const res = await get();

    expect(res.status).toBe(404);
  });

  it("hides a story that is published but not yet approved", async () => {
    db.post.findFirst.mockResolvedValue(
      post({ status: "PUBLISHED", moderationStatus: "PENDING" })
    );

    const res = await get();

    expect(res.status).toBe(404);
  });
});

describe("a published story", () => {
  it("is public without a session and counts the view", async () => {
    db.post.findFirst.mockResolvedValue(
      post({ status: "PUBLISHED", moderationStatus: "APPROVED" })
    );

    const res = await get();

    expect(res.status).toBe(200);
    expect(db.post.update).toHaveBeenCalledTimes(1);
    // No extra role lookup on the hot public path.
    expect(db.user.findUnique).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.post.viewCount).toBe(4);
  });
});
