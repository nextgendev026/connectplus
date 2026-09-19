import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { mindActions, type ActionResult } from "@/lib/mind-actions";

/**
 * The approval queue: how the brain gets things done without being trusted to
 * do them alone.
 *
 * The mind is given unrestricted *read* access to the platform, because reading
 * cannot break a publication. Writes are the other half of that bargain: the
 * brain can propose any action it supports, and nothing happens until a named
 * admin approves it. That is not ceremony — a chat box is an input a language
 * model can write to, and "confirm, publish it" typed once too often is a story
 * live before anyone read it.
 *
 * Three rules are enforced here rather than trusted upstream:
 *
 *  1. **The tool must be on the allowlist.** `tool` arrives as a string from a
 *     model, so an unknown value is a rejection, not a new capability.
 *  2. **The summary is derived from the tool, not from the model.** What the
 *     approver reads is generated from the validated arguments, so a persuasive
 *     rationale cannot describe a smaller action than the one that will run.
 *  3. **A decision is claimed atomically.** Approving is an `updateMany` gated on
 *     `status: PENDING`, so two admins clicking at once execute the tool once,
 *     and a proposal that already ran cannot run again.
 *
 * Proposals expire. An approval given a day after the request is an approval
 * given to a world that has moved on — the post has been edited, the comment
 * thread has grown — so stale requests are retired rather than left as a trap.
 */

const log = createLogger("brain-approvals");

/** How long a proposal stays actionable before it is retired. */
export const PROPOSAL_TTL_HOURS = 24;

export type ApprovalRisk = "low" | "medium" | "high";
export type ProposalStatus = "PENDING" | "APPROVED" | "REJECTED" | "FAILED" | "EXPIRED";

/** The tools the brain is allowed to propose. Anything else is refused. */
export type ApprovalTool = "publish_post" | "schedule_post" | "flag_comment" | "remove_comment";

export interface ApprovalToolSpec {
  id: ApprovalTool;
  label: string;
  risk: ApprovalRisk;
  /** Arguments that must be present and non-empty, by name. */
  required: string[];
  /**
   * What the approver is authorising, built from the validated arguments only.
   * Kept synchronous and pure so it cannot leak model prose into the decision.
   */
  describe: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, actorId: string) => Promise<ActionResult>;
}

const asString = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
};

export const APPROVAL_TOOLS: Record<ApprovalTool, ApprovalToolSpec> = {
  publish_post: {
    id: "publish_post",
    label: "Publish a story",
    risk: "high",
    required: ["postId"],
    describe: (args) => `Publish post ${asString(args, "postId")} — it goes live on the public site immediately.`,
    // No acting-admin argument here: publishing leaves no moderation ledger row,
    // so the attribution lives on the proposal itself (`reviewedBy`).
    run: (args) => mindActions.publishPost({ postId: asString(args, "postId"), confirm: true }),
  },
  schedule_post: {
    id: "schedule_post",
    label: "Schedule a story",
    risk: "medium",
    required: ["postId", "when"],
    describe: (args) =>
      `Schedule post ${asString(args, "postId")} for ${asString(args, "when")}. It publishes itself at that time.`,
    run: (args) => mindActions.schedulePost({ postId: asString(args, "postId"), when: asString(args, "when"), confirm: true }),
  },
  flag_comment: {
    id: "flag_comment",
    label: "Flag a comment",
    risk: "medium",
    required: ["commentId"],
    describe: (args) => `Log comment ${asString(args, "commentId")} as flagged on the moderation ledger.`,
    run: (args, actorId) =>
      mindActions.flagComment({
        commentId: asString(args, "commentId"),
        moderatorId: actorId,
        reason: asString(args, "reason") || undefined,
        confirm: true,
      }),
  },
  remove_comment: {
    id: "remove_comment",
    label: "Delete a comment",
    risk: "high",
    required: ["commentId", "reason"],
    describe: (args) =>
      `Delete comment ${asString(args, "commentId")} and any replies under it. Irreversible. Reason given: ${asString(args, "reason")}`,
    run: (args, actorId) =>
      mindActions.removeComment({
        commentId: asString(args, "commentId"),
        moderatorId: actorId,
        reason: asString(args, "reason"),
        confirm: true,
      }),
  },
};

export function isApprovalTool(value: unknown): value is ApprovalTool {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(APPROVAL_TOOLS, value);
}

export interface ProposalDTO {
  id: string;
  tool: string;
  label: string;
  args: Record<string, unknown>;
  rationale: string;
  summary: string;
  risk: string;
  status: ProposalStatus;
  source: string;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decidedNote: string | null;
  result: string | null;
  createdAt: string;
  /** True once the TTL has passed and the proposal is no longer actionable. */
  expired: boolean;
}

function toDTO(row: {
  id: string;
  tool: string;
  args: string;
  rationale: string;
  summary: string;
  risk: string;
  status: string;
  source: string;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  decidedNote: string | null;
  result: string | null;
  createdAt: Date;
}): ProposalDTO {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(row.args) as Record<string, unknown>;
  } catch {
    args = {};
  }
  const spec = isApprovalTool(row.tool) ? APPROVAL_TOOLS[row.tool] : null;
  return {
    id: row.id,
    tool: row.tool,
    label: spec?.label ?? row.tool.replace(/_/g, " "),
    args,
    rationale: row.rationale,
    summary: row.summary,
    risk: row.risk,
    status: row.status as ProposalStatus,
    source: row.source,
    requestedBy: row.requestedBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    decidedNote: row.decidedNote,
    result: row.result,
    createdAt: row.createdAt.toISOString(),
    expired: row.status === "PENDING" && Date.now() - row.createdAt.getTime() > PROPOSAL_TTL_HOURS * 3_600_000,
  };
}

export interface ProposeInput {
  tool: unknown;
  args: Record<string, unknown>;
  rationale: string;
  requestedBy?: string | null;
  source?: string;
}

export interface ProposeResult {
  ok: boolean;
  /** Present when the proposal was filed (or already existed). */
  proposal?: ProposalDTO;
  /** The tool's own refusal, when the request was invalid. */
  error?: string;
  message: string;
}

/**
 * File a write request.
 *
 * Identical pending requests are folded together rather than stacked: a brain
 * that asks twice in one conversation must not present the admin with two
 * buttons for one action.
 */
export async function proposeAction(input: ProposeInput): Promise<ProposeResult> {
  if (!isApprovalTool(input.tool)) {
    return {
      ok: false,
      error: "unknown_tool",
      message: `"${String(input.tool)}" is not an action I am allowed to request. I can propose: ${Object.keys(APPROVAL_TOOLS).join(", ")}.`,
    };
  }
  const spec = APPROVAL_TOOLS[input.tool];

  const missing = spec.required.filter((key) => !asString(input.args, key));
  if (missing.length > 0) {
    return {
      ok: false,
      error: "missing_arguments",
      message: `To ${spec.label.toLowerCase()} I still need: ${missing.join(", ")}.`,
    };
  }

  const summary = spec.describe(input.args);
  const argsJson = JSON.stringify(input.args);

  const existing = await prisma.brainActionProposal.findFirst({
    where: { tool: spec.id, args: argsJson, status: "PENDING" },
  });
  if (existing) {
    return {
      ok: true,
      proposal: toDTO(existing),
      message: `Already waiting for approval: ${summary}`,
    };
  }

  const row = await prisma.brainActionProposal.create({
    data: {
      tool: spec.id,
      args: argsJson,
      rationale: (input.rationale || summary).slice(0, 2_000),
      summary,
      risk: spec.risk,
      source: input.source ?? "chat",
      requestedBy: input.requestedBy ?? null,
    },
  });
  log.warn("action proposed, awaiting approval", {
    proposalId: row.id,
    tool: spec.id,
    risk: spec.risk,
    requestedBy: input.requestedBy ?? "unknown",
  });

  return {
    ok: true,
    proposal: toDTO(row),
    message: `Queued for approval: ${summary} Nothing has changed yet — approve it in Admin → Health → Approvals.`,
  };
}

/** Retire proposals that sat past their TTL, so nothing waits forever. */
export async function expireStaleProposals(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - PROPOSAL_TTL_HOURS * 3_600_000);
    const result = await prisma.brainActionProposal.updateMany({
      where: { status: "PENDING", createdAt: { lt: cutoff } },
      data: { status: "EXPIRED", decidedNote: `Expired after ${PROPOSAL_TTL_HOURS}h without a decision.` },
    });
    if (result.count > 0) log.info("expired stale proposals", { count: result.count });
    return result.count;
  } catch (error) {
    log.warn("could not expire proposals", { error: String(error) });
    return 0;
  }
}

export async function pendingProposals(): Promise<ProposalDTO[]> {
  await expireStaleProposals();
  const rows = await prisma.brainActionProposal.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" } });
  return rows.map(toDTO);
}

export async function recentProposals(limit = 10): Promise<ProposalDTO[]> {
  const rows = await prisma.brainActionProposal.findMany({
    where: { status: { not: "PENDING" } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });
  return rows.map(toDTO);
}

export async function pendingProposalCount(): Promise<number> {
  try {
    await expireStaleProposals();
    return await prisma.brainActionProposal.count({ where: { status: "PENDING" } });
  } catch {
    return 0;
  }
}

export interface DecisionResult {
  ok: boolean;
  status: ProposalStatus | null;
  message: string;
  /** The tool's result summary when it ran. */
  result?: string;
}

/**
 * Approve or reject one proposal.
 *
 * The claim happens first and atomically: the row is moved out of PENDING before
 * the tool runs, so a second click — or a second admin — gets "already decided"
 * instead of running the action twice. If the tool then fails, the row records
 * the failure with its reason rather than being silently re-approvable.
 */
export async function decideProposal(
  id: string,
  decision: "approve" | "reject",
  actorId: string,
  note?: string
): Promise<DecisionResult> {
  const row = await prisma.brainActionProposal.findUnique({ where: { id } });
  if (!row) return { ok: false, status: null, message: "That proposal no longer exists." };

  if (Date.now() - row.createdAt.getTime() > PROPOSAL_TTL_HOURS * 3_600_000) {
    await prisma.brainActionProposal
      .updateMany({ where: { id, status: "PENDING" }, data: { status: "EXPIRED" } })
      .catch(() => null);
    return { ok: false, status: "EXPIRED", message: `This request expired after ${PROPOSAL_TTL_HOURS}h. Ask the brain again.` };
  }

  const claim = await prisma.brainActionProposal.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: decision === "approve" ? "APPROVED" : "REJECTED",
      reviewedBy: actorId,
      reviewedAt: new Date(),
      decidedNote: note?.slice(0, 1_000) ?? null,
    },
  });
  if (claim.count === 0) {
    return { ok: false, status: row.status as ProposalStatus, message: `Already ${row.status.toLowerCase()} — nothing ran.` };
  }

  if (decision === "reject") {
    log.info("proposal rejected", { proposalId: id, by: actorId });
    return { ok: true, status: "REJECTED", message: "Rejected. Nothing changed." };
  }

  /* The tool runs with `confirm: true` and the approver's identity, so any audit
   * row the tool writes names the human who actually authorised it. */
  let outcome: ActionResult;
  try {
    const parsed = JSON.parse(row.args) as Record<string, unknown>;
    if (!isApprovalTool(row.tool)) {
      await prisma.brainActionProposal.update({
        where: { id },
        data: { status: "FAILED", result: `Unsupported tool: ${row.tool}` },
      });
      return { ok: false, status: "FAILED", message: `Unsupported tool: ${row.tool}` };
    }
    outcome = await APPROVAL_TOOLS[row.tool].run(parsed, actorId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.brainActionProposal.update({ where: { id }, data: { status: "FAILED", result: message.slice(0, 2_000) } });
    log.error("approved action threw", { proposalId: id, error: message });
    return { ok: false, status: "FAILED", message: `The action failed: ${message}` };
  }

  await prisma.brainActionProposal.update({
    where: { id },
    data: { status: outcome.ok ? "APPROVED" : "FAILED", result: outcome.summary.slice(0, 2_000) },
  });

  log.info("proposal decided", { proposalId: id, tool: row.tool, ok: outcome.ok, by: actorId });
  return {
    ok: outcome.ok,
    status: outcome.ok ? "APPROVED" : "FAILED",
    message: outcome.summary,
    result: outcome.summary,
  };
}
