import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Database mocked shut, like the rest of the unit suite.
 *
 * The mind's action tools write to Post, Comment and ModerationLog. Those are
 * exercised here through stubs so the tests pin *what* would be written without
 * touching a real database — a scheduling bug that publishes content should be
 * caught by a test, not by production.
 */
const postFindUnique = vi.fn();
const postUpdate = vi.fn();
const commentFindUnique = vi.fn();
const commentFindMany = vi.fn();
const commentDelete = vi.fn();
const moderationLogCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: {
      findUnique: (...a: unknown[]) => postFindUnique(...a),
      update: (...a: unknown[]) => postUpdate(...a),
    },
    comment: {
      findUnique: (...a: unknown[]) => commentFindUnique(...a),
      findMany: (...a: unknown[]) => commentFindMany(...a),
      delete: (...a: unknown[]) => commentDelete(...a),
    },
    moderationLog: {
      create: (...a: unknown[]) => moderationLogCreate(...a),
    },
  },
}));

const { mindActions, spamScore } = await import("@/lib/mind-actions");
const { parseWhen } = await import("@/lib/neural-mind");
const { inferLanguage } = await import("@/lib/platform-intelligence");
const { classifyIntent } = await import("@/lib/neural-intent");

/**
 * The `data` payload of the first call to a mocked Prisma method.
 *
 * Typed strictly on purpose: `calls[0][0]` is `undefined`-able under this
 * project's index-access rules, and a test that silently reads `undefined`
 * would pass while asserting nothing.
 */
function firstCallData(fn: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const call = fn.mock.calls[0];
  if (!call) throw new Error("expected the mock to have been called");
  const arg = call[0] as { data: Record<string, unknown> } | undefined;
  if (!arg?.data) throw new Error("expected the call to carry a data payload");
  return arg.data;
}

beforeEach(() => {
  postFindUnique.mockReset();
  postUpdate.mockReset();
  commentFindUnique.mockReset();
  commentFindMany.mockReset();
  commentDelete.mockReset();
  moderationLogCreate.mockReset();
  postUpdate.mockResolvedValue({});
  commentDelete.mockResolvedValue({});
  moderationLogCreate.mockResolvedValue({ id: "log_1" });
});

describe("schedulePost", () => {
  it("rejects an unreadable date instead of guessing one", async () => {
    const result = await mindActions.schedulePost({ postId: "c1", when: "next full moon" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_date");
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it("refuses to schedule into the past", async () => {
    const result = await mindActions.schedulePost({ postId: "c1", when: new Date(Date.now() - 86_400_000), confirm: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("past_date");
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it("will not schedule a post that is already live", async () => {
    postFindUnique.mockResolvedValue({ id: "p1", title: "Live story", status: "PUBLISHED", scheduledAt: null });
    const result = await mindActions.schedulePost({ postId: "p1", when: new Date(Date.now() + 3_600_000), confirm: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not_schedulable");
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it("previews and changes nothing without confirmation", async () => {
    postFindUnique.mockResolvedValue({ id: "p1", title: "Draft story", status: "DRAFT", scheduledAt: null });
    const when = new Date(Date.now() + 3_600_000);
    const result = await mindActions.schedulePost({ postId: "p1", when });

    expect(result.ok).toBe(true);
    expect(result.needsConfirmation).toBe(true);
    expect(postUpdate).not.toHaveBeenCalled();
  });

  /**
   * The convention this pins: a schedule in this app is `DRAFT` + `scheduledAt`,
   * which is what `runPublishScheduled` sweeps for. Writing a separate
   * "SCHEDULED" status here would create a post no job ever publishes.
   */
  it("writes scheduledAt without inventing a new status", async () => {
    postFindUnique.mockResolvedValue({ id: "p1", title: "Draft story", status: "DRAFT", scheduledAt: null });
    const when = new Date(Date.now() + 3_600_000);
    const result = await mindActions.schedulePost({ postId: "p1", when, confirm: true });

    expect(result.ok).toBe(true);
    expect(postUpdate).toHaveBeenCalledTimes(1);
    const data = firstCallData(postUpdate);
    expect(data).toEqual({ scheduledAt: when });
    expect(data).not.toHaveProperty("status");
  });
});

describe("publishPost", () => {
  it("never publishes past a rejection", async () => {
    postFindUnique.mockResolvedValue({ id: "p1", title: "Rejected story", status: "DRAFT", slug: "s", moderationStatus: "REJECTED" });
    const result = await mindActions.publishPost({ postId: "p1", confirm: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("blocked_by_moderation");
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it("requires confirmation before going live", async () => {
    postFindUnique.mockResolvedValue({ id: "p1", title: "Draft", status: "DRAFT", slug: "s", moderationStatus: "APPROVED" });
    const result = await mindActions.publishPost({ postId: "p1" });
    expect(result.needsConfirmation).toBe(true);
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it("publishes on confirmation", async () => {
    postFindUnique.mockResolvedValue({ id: "p1", title: "Draft", status: "DRAFT", slug: "my-story", moderationStatus: "APPROVED" });
    const result = await mindActions.publishPost({ postId: "p1", confirm: true });
    expect(result.ok).toBe(true);
    const data = firstCallData(postUpdate);
    expect(data.status).toBe("PUBLISHED");
    expect(data.publishedAt).toBeInstanceOf(Date);
    expect(result.summary).toContain("/posts/my-story");
  });
});

describe("comment triage", () => {
  it("records a flag on the moderation ledger with the comment id", async () => {
    commentFindUnique.mockResolvedValue({
      id: "cm1",
      content: "normal comment",
      postId: "p1",
      author: { username: "wanjiru" },
    });
    const result = await mindActions.flagComment({ commentId: "cm1", moderatorId: "admin1", confirm: true });

    expect(result.ok).toBe(true);
    const data = firstCallData(moderationLogCreate);
    expect(data.action).toBe("FLAG");
    expect(data.postId).toBe("p1");
    expect(data.reason).toContain("comment:cm1");
  });

  it("will not delete a comment without a stated reason", async () => {
    commentFindUnique.mockResolvedValue({ id: "cm1", content: "x", postId: "p1", author: { username: "a" }, _count: { replies: 0 } });
    const result = await mindActions.removeComment({ commentId: "cm1", moderatorId: "admin1", reason: "  ", confirm: true });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("reason_required");
    expect(commentDelete).not.toHaveBeenCalled();
  });

  it("audits before it deletes", async () => {
    commentFindUnique.mockResolvedValue({ id: "cm1", content: "buy now", postId: "p1", author: { username: "spammer" }, _count: { replies: 2 } });
    const result = await mindActions.removeComment({ commentId: "cm1", moderatorId: "admin1", reason: "obvious link farm", confirm: true });

    expect(result.ok).toBe(true);
    expect(moderationLogCreate).toHaveBeenCalledTimes(1);
    expect(commentDelete).toHaveBeenCalledTimes(1);
    // The ledger row must be written before the comment it describes disappears.
    const auditOrder = moderationLogCreate.mock.invocationCallOrder[0] ?? 0;
    const deleteOrder = commentDelete.mock.invocationCallOrder[0] ?? 0;
    expect(auditOrder).toBeGreaterThan(0);
    expect(auditOrder).toBeLessThan(deleteOrder);
    expect(result.detail?.cascades).toBe(2);
  });
});

describe("spamScore", () => {
  it("clears ordinary conversation", () => {
    expect(spamScore("Great piece — how did you get the M-Pesa data?")).toBe(0);
  });

  it("flags link farms and solicitation", () => {
    const spam = "Make money fast! Visit https://a.example https://b.example https://c.example or WhatsApp +254700000000";
    expect(spamScore(spam)).toBeGreaterThanOrEqual(0.5);
  });

  it("caps at 1", () => {
    expect(spamScore("VIAGRA CASINO ESCORT !!!!! https://a.b https://c.d https://e.f call me +254700000000")).toBe(1);
  });
});

describe("inferLanguage", () => {
  it("reads Kiswahili from Swahili markers", () => {
    const result = inferLanguage("Habari ya leo kwa watu wa Nairobi, pesa na biashara katika mji hii sana lakini");
    expect(result.language).toBe("Kiswahili");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("reads English from English markers", () => {
    const result = inferLanguage("The creators and the platform have been working with their audience on this story");
    expect(result.language).toBe("English");
  });

  it("reports Unknown rather than guessing on empty input", () => {
    expect(inferLanguage("").language).toBe("Unknown");
    expect(inferLanguage("").confidence).toBe(0);
  });
});

describe("parseWhen", () => {
  it("reads an explicit ISO date", () => {
    const parsed = parseWhen("schedule it for 2026-09-20 09:00 please");
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(8);
    expect(parsed?.getDate()).toBe(20);
    expect(parsed?.getHours()).toBe(9);
  });

  it("reads a relative window", () => {
    const parsed = parseWhen("schedule in 3 hours");
    expect(parsed).not.toBeNull();
    const deltaMinutes = ((parsed as Date).getTime() - Date.now()) / 60_000;
    expect(deltaMinutes).toBeGreaterThan(175);
    expect(deltaMinutes).toBeLessThan(185);
  });

  it("reads tomorrow with a time, including pm", () => {
    const parsed = parseWhen("publish tomorrow at 3pm");
    expect(parsed).not.toBeNull();
    expect((parsed as Date).getHours()).toBe(15);
  });

  it("returns null rather than a guess when there is no date", () => {
    expect(parseWhen("schedule this post soonish")).toBeNull();
  });
});

describe("new intent routing", () => {
  it("classifies creator, money, traffic, region and action asks", () => {
    expect(classifyIntent("show me the creator directory").intent).toBe("creator_intelligence");
    expect(classifyIntent("creator analytics for our writers").intent).toBe("creator_intelligence");
    expect(classifyIntent("monetization report").intent).toBe("monetization_report");
    expect(classifyIntent("mpesa payouts status").intent).toBe("monetization_report");
    expect(classifyIntent("what is our bounce rate").intent).toBe("traffic_depth");
    expect(classifyIntent("time spent on the app").intent).toBe("traffic_depth");
    expect(classifyIntent("competitor analysis").intent).toBe("external_signals");
    expect(classifyIntent("regional news this week").intent).toBe("external_signals");
    expect(classifyIntent("create a thumbnail for my story").intent).toBe("mind_action");
    expect(classifyIntent("flag this comment now").intent).toBe("mind_action");
  });

  it("leaves the pre-existing classifications untouched", () => {
    expect(classifyIntent("how is the system running today").intent).toBe("system_health");
    expect(classifyIntent("user growth report").intent).toBe("user_analysis");
    expect(classifyIntent("show me the growth report").intent).toBe("growth_report");
    expect(classifyIntent("what should I write about next").intent).toBe("curate_content");
    expect(classifyIntent("write a post about Nairobi fintech").intent).toBe("write_content");
    expect(classifyIntent("hello there").intent).toBe("general_chat");
    expect(classifyIntent("purple unicorns fly at noon").intent).toBe("unknown");
  });
});
