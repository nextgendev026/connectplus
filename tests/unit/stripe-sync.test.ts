import { describe, expect, it } from "vitest";
import {
  mapStripeStatus,
  subscriptionPeriod,
  invoiceSubscriptionId,
  invoicePeriod,
  isUniqueViolation,
} from "@/lib/stripe-sync";

type Sub = Parameters<typeof subscriptionPeriod>[0];
type Inv = Parameters<typeof invoiceSubscriptionId>[0];

const DAY = 86_400_000;

describe("mapStripeStatus", () => {
  it("maps the statuses that grant access", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("trialing")).toBe("trialing");
  });

  it("treats unpaid and past_due as recoverable rather than cancelled", () => {
    expect(mapStripeStatus("past_due")).toBe("past_due");
    expect(mapStripeStatus("unpaid")).toBe("past_due");
  });

  it("maps everything terminal to cancelled", () => {
    expect(mapStripeStatus("canceled")).toBe("cancelled");
    expect(mapStripeStatus("incomplete_expired")).toBe("cancelled");
    expect(mapStripeStatus("paused")).toBe("cancelled");
  });
});

describe("subscriptionPeriod", () => {
  it("reads the anchor and bill_until this API generation exposes", () => {
    const start = Math.floor(Date.now() / 1000);
    const sub = {
      billing_cycle_anchor: start,
      billing_schedules: [{ bill_until: { timestamp: start + 30 * 86400 } }],
    } as unknown as Sub;

    const { start: s, end } = subscriptionPeriod(sub, "monthly");
    expect(s.getTime()).toBe(start * 1000);
    expect(end.getTime()).toBe((start + 30 * 86400) * 1000);
  });

  it("falls back to a cycle-derived window when Stripe sends neither", () => {
    const sub = {} as unknown as Sub;
    const { start, end } = subscriptionPeriod(sub, "yearly");
    expect(end.getFullYear() - start.getFullYear()).toBe(1);
  });

  it("falls back to the start date when only that is present", () => {
    const start = Math.floor(Date.now() / 1000) - 7 * 86400;
    const sub = { start_date: start } as unknown as Sub;
    const { start: s, end } = subscriptionPeriod(sub, "monthly");
    expect(s.getTime()).toBe(start * 1000);
    expect(end.getTime()).toBeGreaterThan(s.getTime());
  });

  it("still returns a usable window for a null subscription", () => {
    const { start, end } = subscriptionPeriod(null, "monthly");
    expect(end.getTime() - start.getTime()).toBeGreaterThan(27 * DAY);
  });
});

describe("invoiceSubscriptionId", () => {
  it("prefers the top-level subscription field", () => {
    const inv = { subscription: "sub_top", lines: { data: [] } } as unknown as Inv;
    expect(invoiceSubscriptionId(inv)).toBe("sub_top");
  });

  it("falls back to the invoice line's subscription details", () => {
    const inv = {
      subscription: null,
      lines: { data: [{ parent: { subscription_details: { subscription: "sub_line" } } }] },
    } as unknown as Inv;
    expect(invoiceSubscriptionId(inv)).toBe("sub_line");
  });

  it("returns undefined when the invoice is not subscription-backed", () => {
    const inv = { subscription: null, lines: { data: [] } } as unknown as Inv;
    expect(invoiceSubscriptionId(inv)).toBeUndefined();
  });
});

describe("invoicePeriod", () => {
  it("prefers the invoice's own period, which is authoritative at payment time", () => {
    const start = Math.floor(Date.now() / 1000);
    const period = invoicePeriod({
      period_start: start,
      period_end: start + 31 * 86400,
    } as unknown as Inv);
    expect(period?.start.getTime()).toBe(start * 1000);
    expect(period?.end.getTime()).toBe((start + 31 * 86400) * 1000);
  });

  it("returns null when the invoice carries no period", () => {
    expect(invoicePeriod({} as unknown as Inv)).toBeNull();
  });
});

describe("isUniqueViolation", () => {
  it("recognises a Prisma unique-constraint violation (duplicate delivery)", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
  });

  it("does not swallow other errors", () => {
    expect(isUniqueViolation(new Error("connection reset"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation({ code: "P2025" })).toBe(false);
  });
});
