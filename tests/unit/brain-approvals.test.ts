import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The approval queue, against a mocked database and mocked tools.
 *
 * The properties worth pinning are the ones that keep the brain from acting on
 * its own: an unknown tool is refused, an incomplete request never reaches a
 * human, the summary shown to the approver is built from the validated arguments
 * rather than from the model's prose, and a decision is claimed exactly once so
 * two clicks cannot publish twice.
 */
const proposalFindFirst = vi.fn();
const proposalCreate = vi.fn();
const proposalFindMany = vi.fn();
const proposalFindUnique = vi.fn();
const proposalUpdateMany = vi.fn();
const proposalUpdate = vi.fn();
const proposalCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainActionProposal: {
      findFirst: (...a: unknown[]) => proposalFindFirst(...a),
      create: (...a: unknown[]) => proposalCreate(...a),
      findMany: (...a: unknown[]) => proposalFindMany(...a),
      findUnique: (...a: unknown[]) => proposalFindUnique(...a),
      updateMany: (...a: unknown[]) => proposalUpdateMany(...a),
      update: (...a: unknown[]) => proposalUpdate(...a),
      count: (...a: unknown[]) => proposalCount(...a),
    },
  },
}));

const publishPost = vi.fn();
const schedulePost = vi.fn();
const flagComment = vi.fn();
const removeComment = vi.fn();

vi.mock("@/lib/mind-actions", () => ({
  mindActions: {
    publishPost: (...a: unknown[]) => publishPost(...a),
    schedulePost: (...a: unknown[]) => schedulePost(...a),
    flagComment: (...a: unknown[]) => flagComment(...a),
    removeComment: (...a: unknown[]) => removeComment(...a),
  },
}));

const { APPROVAL_TOOLS, PROPOSAL_TTL_HOURS, decideProposal, isApprovalTool, pendingProposals, proposeAction } =
  await import("@/lib/brain-approvals");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    tool: "publish_post",
    args: JSON.stringify({ postId: "cabcdefghijklmnopqrstuvwx" }),
    rationale: "The editor asked for it to go live.",
    summary: "Publish post cabcdefghijklmnopqrstuvwx — it goes live on the public site immediately.",
    risk: "high",
    status: "PENDING",
    source: "chat",
    requestedBy: "admin-1",
    reviewedBy: null,
    reviewedAt: null,
    decidedNote: null,
    result: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of [
    proposalFindFirst,
    proposalCreate,
    proposalFindMany,
    proposalFindUnique,
    proposalUpdateMany,
    proposalUpdate,
    proposalCount,
    publishPost,
    schedulePost,
    flagComment,
    removeComment,
  ]) {
    fn.mockReset();
  }
});

describe("the approval allowlist", () => {
  it("accepts only the tools the platform supports", () => {
    expect(isApprovalTool("publish_post")).toBe(true);
    expect(isApprovalTool("remove_comment")).toBe(true);
    expect(isApprovalTool("drop_database")).toBe(false);
    expect(isApprovalTool("constructor")).toBe(false); // prototype keys are not tools
    expect(isApprovalTool(null)).toBe(false);
  });

  it("derives the approver-facing summary from the arguments, not from the model", () => {
    const summary = APPROVAL_TOOLS.remove_comment.describe({ commentId: "c123", reason: "spam links" });
    expect(summary).toContain("c123");
    expect(summary).toContain("spam links");
    expect(summary).toContain("Irreversible");
  });
});

describe("proposing a write", () => {
  it("refuses an unknown tool instead of filing it", async () => {
    const result = await proposeAction({ tool: "publish_everything", args: {}, rationale: "because" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown_tool");
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it("refuses an incomplete request before a human ever sees it", async () => {
    const result = await proposeAction({ tool: "schedule_post", args: { postId: "c1" }, rationale: "later" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_arguments");
    expect(result.message).toContain("when");
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it("files a valid request with the tool's own risk rating", async () => {
    proposalFindFirst.mockResolvedValue(null);
    proposalCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve(row(data)));
    const result = await proposeAction({
      tool: "publish_post",
      args: { postId: "cabcdefghijklmnopqrstuvwx" },
      rationale: "editor approved",
      requestedBy: "admin-1",
    });
    expect(result.ok).toBe(true);
    expect(result.proposal?.risk).toBe("high");
    expect(result.message).toContain("Nothing has changed yet");
  });

  it("folds an identical pending request instead of stacking a second button", async () => {
    proposalFindFirst.mockResolvedValue(row());
    const result = await proposeAction({
      tool: "publish_post",
      args: { postId: "cabcdefghijklmnopqrstuvwx" },
      rationale: "again",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Already waiting");
    expect(proposalCreate).not.toHaveBeenCalled();
  });
});

describe("deciding a proposal", () => {
  it("runs the tool with an explicit confirmation once approved", async () => {
    proposalFindUnique.mockResolvedValue(row());
    proposalUpdateMany.mockResolvedValue({ count: 1 });
    publishPost.mockResolvedValue({ ok: true, action: "publish_post", summary: "“Story” is live." });

    const result = await decideProposal("p1", "approve", "admin-2");
    expect(result.ok).toBe(true);
    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({ postId: "cabcdefghijklmnopqrstuvwx", confirm: true })
    );
    expect(result.message).toContain("is live");
  });

  it("claims the decision atomically, so a second click cannot run it twice", async () => {
    proposalFindUnique.mockResolvedValue(row());
    proposalUpdateMany.mockResolvedValue({ count: 0 });
    const result = await decideProposal("p1", "approve", "admin-2");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Already");
    expect(publishPost).not.toHaveBeenCalled();
  });

  it("never runs a rejected request", async () => {
    proposalFindUnique.mockResolvedValue(row());
    proposalUpdateMany.mockResolvedValue({ count: 1 });
    const result = await decideProposal("p1", "reject", "admin-2", "not ready");
    expect(result.ok).toBe(true);
    expect(result.status).toBe("REJECTED");
    expect(publishPost).not.toHaveBeenCalled();
  });

  it("records a tool failure instead of leaving it re-approvable", async () => {
    proposalFindUnique.mockResolvedValue(row());
    proposalUpdateMany.mockResolvedValue({ count: 1 });
    publishPost.mockRejectedValue(new Error("database offline"));
    const result = await decideProposal("p1", "approve", "admin-2");
    expect(result.ok).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });

  it("refuses to run a request that sat past its expiry", async () => {
    proposalFindUnique.mockResolvedValue(
      row({ createdAt: new Date(Date.now() - (PROPOSAL_TTL_HOURS + 1) * 3_600_000) })
    );
    proposalUpdateMany.mockResolvedValue({ count: 1 });
    const result = await decideProposal("p1", "approve", "admin-2");
    expect(result.ok).toBe(false);
    expect(result.status).toBe("EXPIRED");
    expect(publishPost).not.toHaveBeenCalled();
  });

  it("says so when the proposal has vanished", async () => {
    proposalFindUnique.mockResolvedValue(null);
    const result = await decideProposal("gone", "approve", "admin-2");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no longer exists");
  });
});

describe("pending proposals", () => {
  it("retires anything past its TTL before listing", async () => {
    proposalUpdateMany.mockResolvedValue({ count: 0 });
    proposalFindMany.mockResolvedValue([row()]);
    const list = await pendingProposals();
    expect(proposalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING", createdAt: expect.objectContaining({ lt: expect.any(Date) }) }),
      })
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.label).toBe("Publish a story");
    expect(list[0]?.expired).toBe(false);
  });

  it("marks a stale pending row as expired in the payload", async () => {
    proposalUpdateMany.mockResolvedValue({ count: 0 });
    proposalFindMany.mockResolvedValue([row({ createdAt: new Date(Date.now() - 48 * 3_600_000) })]);
    const list = await pendingProposals();
    expect(list[0]?.expired).toBe(true);
  });
});
