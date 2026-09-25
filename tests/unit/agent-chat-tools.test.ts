import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  post: { findUnique: vi.fn() },
  brainActionProposal: { count: vi.fn() },
}));
const proposeAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/brain-approvals", () => ({
  proposeAction,
  isApprovalTool: (value: unknown) => ["publish_post", "schedule_post"].includes(String(value)),
}));
vi.mock("@/lib/platform-intelligence", () => ({
  platformIntelligence: { getCreatorContext: vi.fn(), getTrendingFeeds: vi.fn() },
}));

import { generalAgentTools } from "@/lib/agent-tools";

/**
 * The approval seam on the person-facing chat.
 *
 * Two rules carry the "the brain may research freely but must ask before it
 * writes" contract, and both are enforced where the request is built rather
 * than where it is approved — the approver sees a derived summary, not the
 * requester's session, so the ownership check has to have already happened:
 *
 *   1. a story that is not the caller's can never reach the queue from here;
 *   2. a caller's own pending requests are capped, so the queue cannot be
 *      flooded by one chatty session.
 *
 * Everything else about a proposal (allowlist, argument validation, folding
 * duplicates) is `brain-approvals`' own tested job — these tests assert what
 * this tool adds on top of it.
 */
describe("proposeAction — the chat's approval seam", () => {
  const tools = generalAgentTools({ userId: "user-1" });
  const execute = (input: { action: "publish_post" | "schedule_post"; postId: string; when?: string; rationale: string }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tools.proposeAction as any).execute(input, { toolCallId: "call-1", messages: [] });

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.post.findUnique.mockResolvedValue({ authorId: "user-1" });
    prisma.brainActionProposal.count.mockResolvedValue(0);
    proposeAction.mockResolvedValue({
      ok: true,
      message: "Waiting for approval: publish post p1",
      proposal: { id: "prop-1", status: "PENDING" },
    });
  });

  it("files the request tagged with who asked and where from", async () => {
    const result = await execute({ action: "publish_post", postId: "p1", rationale: "Draft is final." });

    expect(result).toMatchObject({ ok: true, proposalId: "prop-1", status: "PENDING" });
    expect(proposeAction).toHaveBeenCalledWith({
      tool: "publish_post",
      args: { postId: "p1" },
      rationale: "Draft is final.",
      requestedBy: "user-1",
      source: "chat",
    });
  });

  it("refuses a story the caller does not own — the approver only sees a summary", async () => {
    prisma.post.findUnique.mockResolvedValue({ authorId: "someone-else" });

    const result = await execute({ action: "publish_post", postId: "p1", rationale: "Publish it." });

    expect(result.ok).toBe(false);
    expect(String(result.message)).toContain("your own stories");
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it("refuses a story that does not exist before anything else runs", async () => {
    prisma.post.findUnique.mockResolvedValue(null);

    const result = await execute({ action: "publish_post", postId: "nope", rationale: "x" });

    expect(result.ok).toBe(false);
    expect(proposeAction).not.toHaveBeenCalled();
    expect(prisma.brainActionProposal.count).not.toHaveBeenCalled();
  });

  it("caps a caller at three pending requests so the queue cannot be flooded", async () => {
    prisma.brainActionProposal.count.mockResolvedValue(3);

    const result = await execute({ action: "schedule_post", postId: "p1", when: "2026-10-01T09:00:00Z", rationale: "x" });

    expect(result.ok).toBe(false);
    expect(String(result.message)).toContain("Three of your requests");
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it("passes the schedule time through when one was given", async () => {
    await execute({ action: "schedule_post", postId: "p1", when: "2026-10-01T09:00:00Z", rationale: "x" });

    expect(proposeAction).toHaveBeenCalledWith(
      expect.objectContaining({ args: { postId: "p1", when: "2026-10-01T09:00:00Z" } })
    );
  });
});

describe("readUrl — what the fetch layer is never given", () => {
  const tools = generalAgentTools({ userId: "user-1" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const execute = (url: string) => (tools.readUrl as any).execute({ url }, { toolCallId: "call-2", messages: [] });

  it("refuses a non-http scheme before anything is fetched", async () => {
    await expect(execute("file:///etc/passwd")).resolves.toEqual({
      error: "Only http(s) URLs can be read.",
    });
    await expect(execute("ftp://example.com/x")).resolves.toEqual({
      error: "Only http(s) URLs can be read.",
    });
  });
});
