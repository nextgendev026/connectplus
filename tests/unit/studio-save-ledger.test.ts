import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The draft-creation idempotency ledger.
 *
 * The property under test is narrow and absolute: **a retry of the same save
 * attempt must not produce a second draft.** So the assertions are about the four
 * answers `claimCreate` can give and what each must mean — in particular that
 * "claimed, in flight" is never answered as though a document existed, and that a
 * claim belonging to another writer never resolves to their draft.
 */

const claimCreateFn = vi.fn();
const claimFindUnique = vi.fn();
const claimUpdate = vi.fn();
const claimDeleteMany = vi.fn();
const claimFindMany = vi.fn();
const postFindUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    studioSaveClaim: {
      create: (...a: unknown[]) => claimCreateFn(...a),
      findUnique: (...a: unknown[]) => claimFindUnique(...a),
      update: (...a: unknown[]) => claimUpdate(...a),
      deleteMany: (...a: unknown[]) => claimDeleteMany(...a),
      findMany: (...a: unknown[]) => claimFindMany(...a),
    },
    post: { findUnique: (...a: unknown[]) => postFindUnique(...a) },
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const { CLAIM_WINDOW_MS, claimCreate, completeCreate, readIdempotencyKey, releaseClaim, saveIdempotencyKey, sweepClaims } =
  await import("@/lib/studio/save-ledger");

const NOW = new Date("2026-09-21T12:00:00Z");
const uniqueViolation = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

beforeEach(() => {
  vi.clearAllMocks();
  claimCreateFn.mockResolvedValue({ id: "k" });
  claimFindUnique.mockResolvedValue(null);
  claimUpdate.mockResolvedValue({ id: "k" });
  claimDeleteMany.mockResolvedValue({ count: 0 });
  claimFindMany.mockResolvedValue([]);
  postFindUnique.mockResolvedValue({ id: "post_1" });
});

describe("saveIdempotencyKey", () => {
  it("is derived, not random, so an identical retry carries the same key", () => {
    const input = { sessionId: "s1", revision: 3, contentHash: "abcdef0123456789" };
    expect(saveIdempotencyKey(input)).toBe(saveIdempotencyKey({ ...input }));
  });

  it("separates two writers editing identical text", () => {
    const a = saveIdempotencyKey({ sessionId: "s1", revision: 1, contentHash: "abc" });
    const b = saveIdempotencyKey({ sessionId: "s2", revision: 1, contentHash: "abc" });
    expect(a).not.toBe(b);
  });

  it("separates two revisions of the same document", () => {
    const a = saveIdempotencyKey({ sessionId: "s1", revision: 1, contentHash: "abc" });
    const b = saveIdempotencyKey({ sessionId: "s1", revision: 2, contentHash: "abc" });
    expect(a).not.toBe(b);
  });
});

describe("claimCreate", () => {
  it("claims an unused key", async () => {
    await expect(claimCreate("user_1", "s1:0:abc", NOW)).resolves.toEqual({ status: "claimed" });
    expect(claimCreateFn).toHaveBeenCalledWith({
      data: { id: "s1:0:abc", userId: "user_1", expiresAt: new Date(NOW.getTime() + CLAIM_WINDOW_MS) },
    });
  });

  it("returns the existing draft when the key has already completed", async () => {
    // This is the fix for a lost response: the retry finds the document the first
    // attempt created instead of creating another one.
    claimCreateFn.mockRejectedValue(uniqueViolation);
    claimFindUnique.mockResolvedValue({
      postId: "post_existing",
      userId: "user_1",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    // The mock must agree with itself: the module re-reads the post to confirm it
    // still exists and answers with *that* id, so a mock returning a different id
    // here would be asserting a state the database cannot produce.
    postFindUnique.mockResolvedValue({ id: "post_existing" });

    await expect(claimCreate("user_1", "s1:0:abc", NOW)).resolves.toEqual({
      status: "existing",
      postId: "post_existing",
    });
  });

  it("reports in-flight when the claim exists but produced no document yet", async () => {
    // The concurrent-request case. Answering "existing" here would hand the caller
    // a postId for a row that does not exist; answering "claimed" would let a
    // second draft be created.
    claimCreateFn.mockRejectedValue(uniqueViolation);
    claimFindUnique.mockResolvedValue({
      postId: null,
      userId: "user_1",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    await expect(claimCreate("user_1", "s1:0:abc", NOW)).resolves.toEqual({ status: "in_flight" });
  });

  it("treats an expired claim as absent rather than letting it answer a new save", async () => {
    claimCreateFn.mockRejectedValue(uniqueViolation);
    claimFindUnique.mockResolvedValue({
      postId: "post_old",
      userId: "user_1",
      expiresAt: new Date(NOW.getTime() - 1),
    });

    const result = await claimCreate("user_1", "s1:0:abc", NOW);
    expect(result).toEqual({ status: "in_flight" });
    expect(result).not.toHaveProperty("postId");
  });

  it("never resolves a key presented by a different writer to their draft", async () => {
    claimCreateFn.mockRejectedValue(uniqueViolation);
    claimFindUnique.mockResolvedValue({
      postId: "someone_elses_post",
      userId: "user_OTHER",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    await expect(claimCreate("user_1", "s1:0:abc", NOW)).resolves.toEqual({ status: "in_flight" });
  });

  it("reports in-flight when the claim points at a post that no longer exists", async () => {
    // A claim outlives the document it points at, so returning its postId would
    // give the client an id that 404s on its next request.
    claimCreateFn.mockRejectedValue(uniqueViolation);
    claimFindUnique.mockResolvedValue({
      postId: "post_deleted",
      userId: "user_1",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    postFindUnique.mockResolvedValue(null);

    await expect(claimCreate("user_1", "s1:0:abc", NOW)).resolves.toEqual({ status: "in_flight" });
  });

  it("reports unavailable — not claimed — when the ledger itself cannot be written", async () => {
    // The distinction matters: a caller told "claimed" will proceed believing it
    // is protected. One told "unavailable" makes that decision knowingly.
    claimCreateFn.mockRejectedValue(new Error("connection refused"));
    await expect(claimCreate("user_1", "s1:0:abc", NOW)).resolves.toMatchObject({ status: "unavailable" });
  });

  it("refuses to claim without both a user and a key", async () => {
    await expect(claimCreate("", "key", NOW)).resolves.toMatchObject({ status: "unavailable" });
    await expect(claimCreate("user_1", "", NOW)).resolves.toMatchObject({ status: "unavailable" });
    expect(claimCreateFn).not.toHaveBeenCalled();
  });
});

describe("completeCreate and releaseClaim", () => {
  it("records the document on the claim", async () => {
    await completeCreate("s1:0:abc", "post_1");
    expect(claimUpdate).toHaveBeenCalledWith({ where: { id: "s1:0:abc" }, data: { postId: "post_1" } });
  });

  it("does not throw when completing fails — a future retry is the only cost", async () => {
    claimUpdate.mockRejectedValue(new Error("db down"));
    await expect(completeCreate("k", "p")).resolves.toBeUndefined();
  });

  it("releases only an uncompleted claim, so a successful create is never released", async () => {
    // Releasing a completed claim would let the next retry of the same key create
    // a second draft — the exact bug this module prevents.
    await releaseClaim("s1:0:abc");
    expect(claimDeleteMany).toHaveBeenCalledWith({ where: { id: "s1:0:abc", postId: null } });
  });

  it("does not throw when releasing fails", async () => {
    claimDeleteMany.mockRejectedValue(new Error("db down"));
    await expect(releaseClaim("k")).resolves.toBeUndefined();
  });
});

describe("sweepClaims", () => {
  it("deletes only expired rows and does nothing when there are none", async () => {
    expect(await sweepClaims()).toBe(0);
    expect(claimDeleteMany).not.toHaveBeenCalled();

    claimFindMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    claimDeleteMany.mockResolvedValue({ count: 2 });
    expect(await sweepClaims()).toBe(2);
    expect(claimDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b"] } } });
  });

  it("bounds the batch so a large backlog cannot hold a connection", async () => {
    await sweepClaims();
    const [args] = claimFindMany.mock.calls[0] as [{ take: number; where: { expiresAt: { lt: Date } } }];
    expect(args.take).toBeGreaterThan(0);
    expect(args.take).toBeLessThanOrEqual(10_000);
    expect(args.where.expiresAt.lt).toBeInstanceOf(Date);
  });
});

describe("readIdempotencyKey", () => {
  const request = (headers: Record<string, string>) => ({
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  });

  it("reads either accepted header spelling", () => {
    expect(readIdempotencyKey(request({ "idempotency-key": "s1:0:abcdefgh" }))).toBe("s1:0:abcdefgh");
    expect(readIdempotencyKey(request({ "x-idempotency-key": "s1:0:abcdefgh" }))).toBe("s1:0:abcdefgh");
  });

  it("returns null when no header is present, so behaviour is unchanged for other clients", () => {
    expect(readIdempotencyKey(request({}))).toBeNull();
  });

  it("rejects a key that is too short to be a claim", () => {
    expect(readIdempotencyKey(request({ "idempotency-key": "short" }))).toBeNull();
  });

  it("rejects an over-long key", () => {
    expect(readIdempotencyKey(request({ "idempotency-key": "a".repeat(201) }))).toBeNull();
  });

  it("rejects characters that have no business in a primary key value", () => {
    // The key becomes a primary key. An arbitrary header is not a safe thing to
    // put there, so the shape is constrained rather than trusted.
    for (const bad of ["s1:0:abc def", "s1:0:abc'--", "s1:0:<script>", 's1:0:"quoted"']) {
      expect(readIdempotencyKey(request({ "idempotency-key": bad })), bad).toBeNull();
    }
  });

  it("trims surrounding whitespace rather than treating it as significant", () => {
    expect(readIdempotencyKey(request({ "idempotency-key": "  s1:0:abcdefgh  " }))).toBe("s1:0:abcdefgh");
  });
});

describe("the claim window", () => {
  it("is long enough to cover a retry but bounded", () => {
    // Too short and a retry after a slow request duplicates; too long and an
    // abandoned draft could answer a genuinely new one.
    expect(CLAIM_WINDOW_MS).toBeGreaterThanOrEqual(60_000);
    expect(CLAIM_WINDOW_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});
