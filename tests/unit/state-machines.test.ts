import { describe, expect, it } from "vitest";

import { InvalidTransition, MACHINES, assertTransition, canTransition } from "@/lib/state-machines";

import {
  BRAIN_PROPOSAL,
  CREATOR_PAYOUT,
  MODERATION,
  PAYMENT_INTENT,
  POST_STATUS,
  SUBSCRIPTION,
  TIP,
} from "@/lib/state-machines";

/**
 * The transitions that cost money when they are wrong.
 *
 * Each of these covers a way a status column could already be written into a state
 * its own writer never intended: a tip refunded twice, a payout marked paid after
 * a failure, a proposal approved, executed and approved again. Status columns are
 * strings, so nothing else was stopping any of it.
 */

/**
 * The machines as a plain shape, for the structural assertions below.
 *
 * `Object.entries(MACHINES)` loses the correlation between a machine's `states`
 * and its `transitions` keys — each entry keeps its own literal union, so indexing
 * one by another's state does not type-check. These tests are *about* the shape
 * being uniform, so they read it through the uniform type.
 */
type AnyMachine = {
  entity: string;
  states: readonly string[];
  initial: readonly string[];
  transitions: Record<string, readonly string[]>;
  terminal: readonly string[];
};

const ALL = Object.entries(MACHINES) as [string, AnyMachine][];

describe("every machine is internally consistent", () => {
  it("only ever moves to a state it declares", () => {
    for (const [name, machine] of ALL) {
      for (const [from, targets] of Object.entries(machine.transitions)) {
        expect(machine.states, `${name}.transitions["${from}"] is not a state`).toContain(from);
        for (const target of targets as readonly string[]) {
          expect(machine.states, `${name}: "${from}" → "${target}" targets an undeclared state`).toContain(target);
        }
      }
    }
  });

  it("declares a transition list for every state, and marks terminal ones empty", () => {
    for (const [name, machine] of ALL) {
      for (const state of machine.states) {
        expect(machine.transitions[state], `${name} has no transitions for "${state}"`).toBeDefined();
        if (machine.terminal.includes(state)) {
          expect(machine.transitions[state], `${name} calls "${state}" terminal but allows exits`).toEqual([]);
        }
      }
    }
  });

  it("treats every state with no exits as terminal, and vice versa", () => {
    for (const [name, machine] of ALL) {
      for (const state of machine.states) {
        const exits = machine.transitions[state] ?? [];
        const declaredTerminal = machine.terminal.includes(state);
        expect(declaredTerminal, `${name}: "${state}" has no exits but is not marked terminal`).toBe(exits.length === 0);
      }
    }
  });

  it("allows a new record to start only where the machine says", () => {
    for (const [name, machine] of ALL) {
      for (const state of machine.states) {
        const check = canTransition(machine, null, state);
        expect(check.ok, `${name}: creating a record as "${state}"`).toBe(machine.initial.includes(state));
      }
    }
  });
});

describe("payments cannot be carved out of a terminal state", () => {
  it("allows the happy path", () => {
    expect(canTransition(PAYMENT_INTENT, "pending", "processing").ok).toBe(true);
    expect(canTransition(PAYMENT_INTENT, "processing", "succeeded").ok).toBe(true);
    expect(canTransition(PAYMENT_INTENT, "pending", "succeeded").ok).toBe(true);
  });

  it("refuses a failed payment becoming successful on a retry", () => {
    // The failure mode: a provider retries, the handler runs again, and the
    // intent is granted after it was refused.
    expect(canTransition(PAYMENT_INTENT, "failed", "succeeded").ok).toBe(false);
    expect(canTransition(PAYMENT_INTENT, "expired", "succeeded").ok).toBe(false);
    expect(canTransition(PAYMENT_INTENT, "cancelled", "succeeded").ok).toBe(false);
  });

  it("refuses a nudge backwards, because it is the same as a second grant", () => {
    expect(canTransition(PAYMENT_INTENT, "succeeded", "processing").ok).toBe(false);
    expect(canTransition(PAYMENT_INTENT, "processing", "pending").ok).toBe(false);
  });
});

describe("a subscription stays recoverable but not re-entrant", () => {
  it("moves through a lapsed renewal", () => {
    expect(canTransition(SUBSCRIPTION, "active", "past_due").ok).toBe(true);
    expect(canTransition(SUBSCRIPTION, "past_due", "active").ok).toBe(true);
  });

  it("lets the console reactivate a cancelled membership", () => {
    // Deliberately legal: the reactivate flow re-opens a membership, and a machine
    // that forbade this would block a legitimate operation rather than a hazard.
    expect(canTransition(SUBSCRIPTION, "cancelled", "active").ok).toBe(true);
  });

  it("refuses a subscription that was never active", () => {
    expect(canTransition(SUBSCRIPTION, null, "cancelled").ok).toBe(false);
  });
});

describe("tips and payouts settle once", () => {
  it("allows one refund and refuses a second", () => {
    expect(canTransition(TIP, "pending", "succeeded").ok).toBe(true);
    expect(canTransition(TIP, "succeeded", "refunded").ok).toBe(true);
    expect(canTransition(TIP, "refunded", "succeeded").ok).toBe(false);
  });

  it("refuses to refund money that was never collected", () => {
    expect(canTransition(TIP, "pending", "refunded").ok).toBe(false);
    expect(canTransition(TIP, "failed", "refunded").ok).toBe(false);
  });

  it("refuses paying a payout twice — the double-payment case", () => {
    expect(canTransition(CREATOR_PAYOUT, "pending", "processing").ok).toBe(true);
    expect(canTransition(CREATOR_PAYOUT, "processing", "paid").ok).toBe(true);
    // Marking an already-paid batch paid again is money leaving twice.
    expect(canTransition(CREATOR_PAYOUT, "paid", "paid").ok).toBe(false);
    expect(canTransition(CREATOR_PAYOUT, "paid", "processing").ok).toBe(false);
  });

  it("refuses to pay a failed payout without going back through processing", () => {
    expect(canTransition(CREATOR_PAYOUT, "failed", "paid").ok).toBe(false);
  });
});

describe("publication and moderation", () => {
  it("allows scheduling, publishing and unpublishing", () => {
    expect(canTransition(POST_STATUS, "DRAFT", "SCHEDULED").ok).toBe(true);
    expect(canTransition(POST_STATUS, "SCHEDULED", "PUBLISHED").ok).toBe(true);
    expect(canTransition(POST_STATUS, "SCHEDULED", "DRAFT").ok).toBe(true);
    expect(canTransition(POST_STATUS, "PUBLISHED", "DRAFT").ok).toBe(true);
  });

  it("refuses publishing something already published", () => {
    // This is the question the approvals queue has to answer before it publishes
    // (Phase H): "is it already live" must not be a no-op that looks like success.
    const check = canTransition(POST_STATUS, "PUBLISHED", "PUBLISHED");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("already");
  });

  it("refuses a post starting life published", () => {
    expect(canTransition(POST_STATUS, null, "PUBLISHED").ok).toBe(false);
  });

  it("keeps moderation reversible", () => {
    expect(canTransition(MODERATION, "PENDING", "APPROVED").ok).toBe(true);
    expect(canTransition(MODERATION, "APPROVED", "REJECTED").ok).toBe(true);
    expect(canTransition(MODERATION, "REJECTED", "APPROVED").ok).toBe(true);
    expect(canTransition(MODERATION, null, "APPROVED").ok).toBe(false);
  });
});

describe("the brain's write queue", () => {
  it("requires a decision before execution", () => {
    expect(canTransition(BRAIN_PROPOSAL, "PENDING", "APPROVED").ok).toBe(true);
    expect(canTransition(BRAIN_PROPOSAL, "PENDING", "REJECTED").ok).toBe(true);
    expect(canTransition(BRAIN_PROPOSAL, "PENDING", "EXPIRED").ok).toBe(true);
    expect(canTransition(BRAIN_PROPOSAL, "APPROVED", "FAILED").ok).toBe(true);
  });

  it("refuses to un-approve a proposal, which would allow executing it twice", () => {
    expect(canTransition(BRAIN_PROPOSAL, "APPROVED", "PENDING").ok).toBe(false);
    expect(canTransition(BRAIN_PROPOSAL, "APPROVED", "APPROVED").ok).toBe(false);
  });

  it("refuses to revive a rejected, failed or expired proposal", () => {
    for (const state of ["REJECTED", "FAILED", "EXPIRED"] as const) {
      expect(canTransition(BRAIN_PROPOSAL, state, "APPROVED").ok, `${state} → APPROVED`).toBe(false);
      expect(canTransition(BRAIN_PROPOSAL, state, "PENDING").ok, `${state} → PENDING`).toBe(false);
    }
  });
});

describe("an unknown status is a refusal, not a pass", () => {
  it("refuses a state the machine has never heard of", () => {
    // A vocabulary that changed underneath the machine means someone else changed
    // the writers; the safe answer to "may this unknown state become paid" is no.
    const check = canTransition(CREATOR_PAYOUT as never, "settled", "paid");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("not a payout state");
  });

  it("refuses a target that is not a state", () => {
    expect(canTransition(TIP, "pending", "PAID").ok).toBe(false);
  });

  it("says what it refused and why", () => {
    const check = canTransition(TIP, "failed", "succeeded");
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.from).toBe("failed");
      expect(check.to).toBe("succeeded");
      // A refusal out of a final state says so, rather than reporting a missing
      // edge — "is final" tells an operator the truth about the record.
      expect(check.reason).toContain("final");
    }

    // A refusal between two live states names both ends and the direction.
    const inFlight = canTransition(PAYMENT_INTENT, "processing", "pending");
    expect(inFlight.ok).toBe(false);
    if (!inFlight.ok) expect(inFlight.reason).toContain("cannot go from");
  });
});

describe("assertTransition throws a typed error", () => {
  it("passes a legal move", () => {
    expect(() => assertTransition(TIP, "pending", "succeeded")).not.toThrow();
  });

  it("throws InvalidTransition naming the entity and both states", () => {
    try {
      assertTransition(CREATOR_PAYOUT, "paid", "paid");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransition);
      const invalid = error as InvalidTransition;
      expect(invalid.entity).toBe("payout");
      expect(invalid.from).toBe("paid");
      expect(invalid.to).toBe("paid");
      expect(invalid.message).toContain("already");
    }
  });
});
