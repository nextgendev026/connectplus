/**
 * Explicit lifecycle transitions, for the records where a wrong one costs money.
 *
 * Status columns are strings, so nothing stopped `Tip` from going
 * `refunded → succeeded` or a `CreatorPayout` from being marked `paid` twice.
 * Each of those is a real double-payment: the payout job marks a batch paid, the
 * status write races, the row is written again, and the money leaves twice. None
 * of it is visible in a type checker, because `"paid"` and `"succeeded"` are both
 * valid `String`s for every column.
 *
 * The vocabularies below are **read from the schema comments and the write paths**,
 * not invented: `prisma/schema.prisma` annotates each `status` column with its own
 * allowed set ("pending | processing | succeeded | failed | cancelled | expired"
 * for a payment intent), and every value here appears in the code that writes it.
 * A machine that disagreed with the writers would reject valid transitions, which
 * is worse than having none — so where the real vocabulary was unclear it is
 * omitted and listed at the bottom rather than guessed.
 *
 * A same-state transition is a no-op rather than a legal move: `PAID → PAID` is
 * exactly the double-payment this module exists to refuse, so self-transitions are
 * denied unless a machine explicitly allows them.
 */

export type TransitionCheck =
  | { ok: true; from: string | null; to: string }
  | { ok: false; from: string | null; to: string; reason: string };

export interface Machine<S extends string> {
  entity: string;
  /** Every state the record can be in. */
  states: readonly S[];
  /** Which states it may be in from nothing (a new row). */
  initial: readonly S[];
  transitions: Readonly<Record<S, readonly S[]>>;
  /** States that admit no further change. */
  terminal: readonly S[];
}

/**
 * Where a record may move next.
 *
 * A transition *out of* an unknown state is refused rather than allowed: a status
 * this machine has not heard of means the vocabulary changed underneath it, and
 * the safe answer to "may this unknown state become paid" is no.
 */
export function canTransition<S extends string>(
  machine: Machine<S>,
  from: string | null,
  to: string
): TransitionCheck {
  const target = to as S;

  if (!machine.states.includes(target)) {
    return { ok: false, from, to, reason: `"${to}" is not a ${machine.entity} state` };
  }

  if (from === null) {
    return machine.initial.includes(target)
      ? { ok: true, from, to }
      : { ok: false, from, to, reason: `a new ${machine.entity} cannot start as "${to}"` };
  }

  if (from === to) {
    return { ok: false, from, to, reason: `${machine.entity} is already "${to}"` };
  }

  const source = from as S;
  if (!machine.states.includes(source)) {
    return { ok: false, from, to, reason: `"${from}" is not a ${machine.entity} state` };
  }

  const allowed = machine.transitions[source];
  if (!allowed || !allowed.includes(target)) {
    const terminal = machine.terminal.includes(source);
    return {
      ok: false,
      from,
      to,
      reason: terminal
        ? `"${from}" is final for a ${machine.entity}`
        : `a ${machine.entity} cannot go from "${from}" to "${to}"`,
    };
  }

  return { ok: true, from, to };
}

export class InvalidTransition extends Error {
  readonly entity: string;
  readonly from: string | null;
  readonly to: string;
  constructor(entity: string, from: string | null, to: string, reason: string) {
    super(reason);
    this.name = "InvalidTransition";
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

/** Throw unless the transition is legal. Use before a status write. */
export function assertTransition<S extends string>(
  machine: Machine<S>,
  from: string | null,
  to: string
): void {
  const check = canTransition(machine, from, to);
  if (!check.ok) throw new InvalidTransition(machine.entity, from, to, check.reason);
}

/* ── The machines ─────────────────────────────────────────────────────────── */

/**
 * `pending → processing → succeeded` is the happy path; every failure path lands
 * on a terminal state, so a payment that failed cannot later be "succeeded" by a
 * retried callback. `succeeded` is terminal — refunds live on `Tip`, and a
 * membership reversal is a subscription transition, not an intent one.
 */
export const PAYMENT_INTENT = {
  entity: "payment intent",
  states: ["pending", "processing", "succeeded", "failed", "cancelled", "expired"],
  initial: ["pending"],
  transitions: {
    pending: ["processing", "succeeded", "failed", "cancelled", "expired"],
    processing: ["succeeded", "failed", "cancelled", "expired"],
    succeeded: [],
    failed: [],
    cancelled: [],
    expired: [],
  },
  terminal: ["succeeded", "failed", "cancelled", "expired"],
} as const satisfies Machine<
  "pending" | "processing" | "succeeded" | "failed" | "cancelled" | "expired"
>;

/**
 * A subscription's states. `cancelled → active` is deliberately allowed: the
 * console's reactivate flow re-opens a cancelled membership, and a machine that
 * forbade it would block a legitimate operation rather than a dangerous one.
 * `past_due` is recoverable because a failed renewal is usually a card that was
 * replaced, not a decided cancellation.
 */
export const SUBSCRIPTION = {
  entity: "subscription",
  states: ["trialing", "active", "past_due", "cancelled"],
  initial: ["trialing", "active"],
  transitions: {
    trialing: ["active", "past_due", "cancelled"],
    active: ["past_due", "cancelled"],
    past_due: ["active", "cancelled"],
    cancelled: ["active"],
  },
  terminal: [],
} as const satisfies Machine<"trialing" | "active" | "past_due" | "cancelled">;

/**
 * Tips: money in, and at most one reversal. `succeeded → refunded` is the only
 * exit, so a refund cannot be applied twice and a failed tip cannot become
 * refunded without having been paid.
 */
export const TIP = {
  entity: "tip",
  states: ["pending", "succeeded", "failed", "refunded"],
  initial: ["pending"],
  transitions: {
    pending: ["succeeded", "failed"],
    succeeded: ["refunded"],
    failed: [],
    refunded: [],
  },
  terminal: ["failed", "refunded"],
} as const satisfies Machine<"pending" | "succeeded" | "failed" | "refunded">;

/**
 * Payouts. The one that matters: `paid` is terminal, because a second write of
 * `paid` over a processing batch is money leaving the account twice.
 */
export const CREATOR_PAYOUT = {
  entity: "payout",
  states: ["pending", "processing", "paid", "failed"],
  initial: ["pending"],
  transitions: {
    pending: ["processing", "failed"],
    processing: ["paid", "failed"],
    paid: [],
    failed: [],
  },
  terminal: ["paid", "failed"],
} as const satisfies Machine<"pending" | "processing" | "paid" | "failed">;

/**
 * Publication. `SCHEDULED → DRAFT` is unscheduling something before it runs;
 * `PUBLISHED → DRAFT` is unpublishing, which the studio offers. There is no
 * `PUBLISHED → PUBLISHED` because "is it already published" is exactly the
 * question the approvals queue has to ask before it publishes (Phase H).
 */
export const POST_STATUS = {
  entity: "post",
  states: ["DRAFT", "SCHEDULED", "PUBLISHED"],
  initial: ["DRAFT"],
  transitions: {
    DRAFT: ["SCHEDULED", "PUBLISHED"],
    SCHEDULED: ["PUBLISHED", "DRAFT"],
    PUBLISHED: ["DRAFT"],
  },
  terminal: [],
} as const satisfies Machine<"DRAFT" | "SCHEDULED" | "PUBLISHED">;

/**
 * Moderation is intentionally reversible: a rejection can be appealed and
 * upheld, and an approval can be reversed when something slips through. The one
 * thing it cannot do is approve itself out of nothing — a post starts `PENDING`.
 */
export const MODERATION = {
  entity: "moderation",
  states: ["PENDING", "APPROVED", "REJECTED"],
  initial: ["PENDING"],
  transitions: {
    PENDING: ["APPROVED", "REJECTED"],
    APPROVED: ["REJECTED"],
    REJECTED: ["APPROVED"],
  },
  terminal: [],
} as const satisfies Machine<"PENDING" | "APPROVED" | "REJECTED">;

/**
 * The brain's write queue. `PENDING → APPROVED` is a human decision; `APPROVED →
 * FAILED` is the tool or its revalidation failing afterwards. There is no
 * `APPROVED → PENDING`, because an approval that could be undone and re-done is
 * an approval that can be executed twice.
 */
export const BRAIN_PROPOSAL = {
  entity: "proposal",
  states: ["PENDING", "APPROVED", "REJECTED", "FAILED", "EXPIRED"],
  initial: ["PENDING"],
  transitions: {
    PENDING: ["APPROVED", "REJECTED", "EXPIRED"],
    APPROVED: ["FAILED"],
    REJECTED: [],
    FAILED: [],
    EXPIRED: [],
  },
  terminal: ["REJECTED", "FAILED", "EXPIRED"],
} as const satisfies Machine<"PENDING" | "APPROVED" | "REJECTED" | "FAILED" | "EXPIRED">;

/**
 * The self-healing envelope. Every direction is legal — an operator must be able
 * to widen it and narrow it again — but the *value* is validated, which is what
 * `repairMode()` already does by reading anything unrecognised as `observe`.
 */
export const REPAIR_MODE = {
  entity: "self-heal envelope",
  states: ["off", "observe", "enforce"],
  initial: ["off", "observe"],
  transitions: {
    off: ["observe", "enforce"],
    observe: ["off", "enforce"],
    enforce: ["off", "observe"],
  },
  terminal: [],
} as const satisfies Machine<"off" | "observe" | "enforce">;

/** Every machine, for a test that walks them all and for the console. */
export const MACHINES = {
  paymentIntent: PAYMENT_INTENT,
  subscription: SUBSCRIPTION,
  tip: TIP,
  creatorPayout: CREATOR_PAYOUT,
  post: POST_STATUS,
  moderation: MODERATION,
  brainProposal: BRAIN_PROPOSAL,
  repairMode: REPAIR_MODE,
} as const;

/*
 * Deliberately absent, with the reason, so their absence is a decision rather
 * than an oversight:
 *
 *  • `SportsPrediction` — the schema declares `PENDING | WON | LOST | VOID`, but
 *    the analyser "updates existing picks in place" and re-settles on a rerun, so
 *    a terminal `WON` may legitimately be rewritten. Encoding that as illegal
 *    here would break the settlement path; Phase N owns prediction lifecycle and
 *    should pin the rule where the writes happen.
 *  • Repair *operations* — these record an outcome (`applied | observed | skipped
 *    | failed`), not a state a record moves between. The envelope that does have
 *    states is `repairMode` above.
 */
