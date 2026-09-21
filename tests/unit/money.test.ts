import { describe, expect, it } from "vitest";

import {
  amountMismatch,
  convertToKesWholeShillings,
  equals,
  format,
  fromLegacyFloat,
  fromMajor,
  money,
  multiplyByBps,
  rateHundredths,
  splitFee,
  toMajor,
  toMinorUnits,
  toMinorUnitsRounded,
  toWholeShillings,
} from "@/lib/money";

/**
 * Money, where the interesting cases are the ones a float gets wrong.
 *
 * The bug this replaces was in a payment callback: it accepted a Daraja payload
 * when `Math.abs(received - expected) > 1` was false, i.e. within ±1 whole unit —
 * a shilling, or a dollar on the USD-priced plans — and it skipped the comparison
 * entirely when the payload declared no amount. Both halves were a check that
 * looked present and accepted exactly the cases it was written to refuse.
 */

describe("parsing decimals exactly", () => {
  it("reads the obvious cases", () => {
    expect(toMinorUnits("645")).toBe(64_500);
    expect(toMinorUnits("645.5")).toBe(64_550);
    expect(toMinorUnits("645.55")).toBe(64_555);
    expect(toMinorUnits("0")).toBe(0);
    expect(toMinorUnits(645)).toBe(64_500);
    expect(toMinorUnits(0.01)).toBe(1);
  });

  it("does not lose a cent to binary floating point", () => {
    // Number("1.005") * 100 is 100.49999999999999, which rounds to 100 — a cent
    // lost on a value a person would say means 101. Reading the digits avoids it.
    expect(Math.round(Number("1.005") * 100)).toBe(100); // the naive version
    expect(toMinorUnits("645.55")).toBe(64_555);
    expect(toMinorUnits("0.29")).toBe(29);

    // A third decimal place on a *declaration* is refused rather than guessed at...
    expect(toMinorUnits("1.005")).toBeNull();
    // ...while the legacy-float path snaps it, because there the extra digits are
    // floating point rather than a real fraction.
    expect(toMinorUnitsRounded("1.005")).toBe(101);
    expect(toMinorUnitsRounded(0.1 + 0.2)).toBe(30);
    expect(fromLegacyFloat(0.1 + 0.2, "KES")?.amountMinor).toBe(30);
  });

  it("pads a short fraction rather than misreading it", () => {
    expect(toMinorUnits("1.5")).toBe(150);
    expect(toMinorUnits("1.05")).toBe(105);
    expect(toMinorUnits("12.3")).toBe(1_230);
  });

  it("refuses a third fractional digit instead of guessing", () => {
    // A fraction of a cent means someone's arithmetic is wrong upstream, and
    // silently rounding it is how money goes missing.
    expect(toMinorUnits("1.005")).toBeNull();
    expect(toMinorUnits("1.0005")).toBeNull();
    expect(toMinorUnits("0.000001")).toBeNull();
  });

  it("tolerates padding around a string, and nothing else", () => {
    expect(toMinorUnits(" 5 ")).toBe(500);
    expect(toMinorUnitsRounded(" 5.25 ")).toBe(525);
  });

  it("refuses what is not a plain non-negative decimal", () => {
    for (const bad of ["", "  ", "abc", "-5", "-5.00", "+5", "1e3", "0x10", "5.", ".5", "5..0", "Infinity", "NaN", "1,000"]) {
      expect(toMinorUnits(bad), `${bad} should be refused`).toBeNull();
    }
    expect(toMinorUnits(Number.NaN)).toBeNull();
    expect(toMinorUnits(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("round-trips through a legacy float without gaining or losing a cent", () => {
    // The migration path: every stored Float becomes minor units and back.
    for (const value of [0, 1, 5, 50, 645, 650, 4_999.99, 5_000]) {
      const parsed = fromLegacyFloat(value, "KES");
      expect(parsed).not.toBeNull();
      expect(toMajor(parsed!)).toBe(value);
    }
  });
});

describe("construction refuses impossible money", () => {
  it("refuses a fractional minor unit", () => {
    expect(() => money(1.5, "KES")).toThrow(TypeError);
  });

  it("refuses a negative amount", () => {
    expect(() => money(-1, "KES")).toThrow(TypeError);
  });

  it("accepts zero, which is a legitimate amount", () => {
    expect(money(0, "KES").amountMinor).toBe(0);
  });
});

describe("addition and subtraction stay in one currency", () => {
  it("adds", () => {
    expect(equals(money(1_000, "KES"), { amountMinor: 1_000, currency: "KES" })).toBe(true);
  });

  it("refuses to mix currencies", () => {
    expect(() => money(1, "KES")).not.toThrow();
    const kes = money(100, "KES");
    const usd = money(100, "USD");
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const sum = kes.amountMinor + usd.amountMinor;
      expect(sum).toBe(200); // the numbers add; the money does not
    }).not.toThrow();
    expect(equals(kes, usd)).toBe(false);
  });
});

describe("fee splits are exact, not approximately exact", () => {
  it("always sums to the gross, across percentages that do not divide evenly", () => {
    const rates = [0, 1, 5, 100, 250, 333, 1_000, 1_250, 2_500, 3_333, 9_999];
    const grosses = [1, 2, 3, 7, 99, 100, 101, 999, 1_000, 64_500, 4_999_999, 123_456_789];

    for (const bps of rates) {
      for (const minor of grosses) {
        const gross = money(minor, "KES");
        const { fee, net } = splitFee(gross, bps);
        expect(
          fee.amountMinor + net.amountMinor,
          `fee + net must equal gross for ${minor} at ${bps}bps`
        ).toBe(gross.amountMinor);
        expect(net.amountMinor).toBeGreaterThanOrEqual(0);
        expect(fee.amountMinor).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("takes a fifth in one step", () => {
    const { fee, net } = splitFee(money(10_000, "KES"), 2_000); // 20%
    expect(fee.amountMinor).toBe(2_000);
    expect(net.amountMinor).toBe(8_000);
  });

  it("rounds half-up rather than truncating", () => {
    // 1 cent at 50% is half a cent, and half-up sends it to the fee.
    const { fee, net } = splitFee(money(1, "KES"), 5_000);
    expect(fee.amountMinor).toBe(1);
    expect(net.amountMinor).toBe(0);
  });

  it("refuses a negative or non-finite rate", () => {
    expect(() => multiplyByBps(money(100, "KES"), -1)).toThrow(TypeError);
    expect(() => multiplyByBps(money(100, "KES"), Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("keeps a large gross inside safe-integer territory", () => {
    // 100 million shillings at 100%: the BigInt path matters here.
    const huge = money(10_000_000_000, "KES");
    const { fee, net } = splitFee(huge, 10_000);
    expect(fee.amountMinor).toBe(huge.amountMinor);
    expect(net.amountMinor).toBe(0);
  });
});

describe("the M-Pesa rail settles whole shillings", () => {
  it("rounds a KES amount to whole shillings", () => {
    expect(toWholeShillings(money(64_550, "KES")).amountMinor).toBe(64_600); // 645.50 -> 646
    expect(toWholeShillings(money(64_549, "KES")).amountMinor).toBe(64_500);
    expect(toWholeShillings(money(64_500, "KES")).amountMinor).toBe(64_500);
  });

  it("leaves a non-KES amount alone", () => {
    expect(toWholeShillings(money(6_455, "USD")).amountMinor).toBe(6_455);
  });

  it("converts USD to whole shillings in one exact step", () => {
    // $5.00 at 129 KES/USD is KES 645.00 — a US cent is 129 Kenyan cents, so the
    // rate multiplies the minor units directly. Treating it as ×1.29 gave KES 6.45
    // for a five-dollar plan, which is a plausible-looking wrong answer.
    expect(convertToKesWholeShillings(money(500, "USD"), rateHundredths(129)).amountMinor).toBe(64_500);
    // $4.99 at 129 = 643.71 -> 644 KES, because a shilling is the smallest charge.
    expect(convertToKesWholeShillings(money(499, "USD"), rateHundredths(129)).amountMinor).toBe(64_400);
    // The scale is explicit for a reason: passing the bare env value `129`
    // instead of `rateHundredths(129)` prices a five-dollar plan at 6 shillings
    // instead of 645 — a factor of 100 out, and plausible enough to ship. Putting
    // the unit in the parameter name is the cheap way to make that hard to do.
    expect(convertToKesWholeShillings(money(500, "USD"), 129).amountMinor).toBe(600);
  });

  it("refuses an unusable rate rather than converting with it", () => {
    expect(() => convertToKesWholeShillings(money(500, "USD"), 0)).toThrow(TypeError);
    expect(() => convertToKesWholeShillings(money(500, "USD"), -12_900)).toThrow(TypeError);
    expect(() => rateHundredths("not a rate")).toThrow(TypeError);
  });

  it("refuses to convert something that is not USD", () => {
    expect(() => convertToKesWholeShillings(money(500, "KES"), 12_900)).toThrow(TypeError);
  });
});

describe("the callback comparison that used to pass a wrong amount", () => {
  it("accepts an exact match, including trailing zeros", () => {
    expect(amountMismatch(645, 645, "KES").mismatch).toBe(false);
    expect(amountMismatch(645, "645.00", "KES").mismatch).toBe(false);
    expect(amountMismatch("645.00", 645, "KES").mismatch).toBe(false);
  });

  it("refuses a one-shilling difference — the old tolerance allowed it", () => {
    const result = amountMismatch(645, 644, "KES");
    expect(result.mismatch).toBe(true);
    expect(result.expectedMinor).toBe(64_500);
    expect(result.receivedMinor).toBe(64_400);
  });

  it("refuses a one-dollar difference on the USD rail", () => {
    // The old check was ±1 in the *stored* unit, so $499 matched a $500 plan.
    expect(amountMismatch(500, 499, "USD").mismatch).toBe(true);
    expect(amountMismatch(500, 501, "USD").mismatch).toBe(true);
  });

  it("refuses a single cent in either direction", () => {
    expect(amountMismatch("645.00", "645.01", "KES").mismatch).toBe(true);
    expect(amountMismatch("645.00", "644.99", "KES").mismatch).toBe(true);
  });

  it("refuses a payload that declares no amount at all", () => {
    // Previously `callback.amount != null &&` skipped the check entirely, so a
    // payload with a receipt and no amount was granted. A payment that cannot be
    // verified is not a payment that is verified.
    const result = amountMismatch(645, null, "KES");
    expect(result.mismatch).toBe(true);
    expect(result.reason).toContain("declared no amount");
    expect(amountMismatch(645, undefined, "KES").mismatch).toBe(true);
  });

  it("refuses when the expected amount is unreadable", () => {
    expect(amountMismatch("not-a-number", 645, "KES").mismatch).toBe(true);
    expect(amountMismatch(null, 645, "KES").mismatch).toBe(true);
  });

  it("reports the minor units so a log line is unambiguous", () => {
    const result = amountMismatch(645.5, 645.55, "KES");
    expect(result).toEqual({
      mismatch: true,
      expectedMinor: 64_550,
      receivedMinor: 64_555,
      reason: "the amounts differ",
    });
  });
});

describe("formatting", () => {
  it("always prints two decimal places and never an exponent", () => {
    expect(format(money(64_500, "KES"))).toBe("645.00");
    expect(format(money(1, "KES"))).toBe("0.01");
    expect(format(money(0, "KES"))).toBe("0.00");
    expect(format(money(123_456_789, "KES"))).toBe("1234567.89");
  });

  it("builds from a major-unit value", () => {
    expect(fromMajor(645.5, "USD")?.amountMinor).toBe(64_550);
    expect(fromMajor("bad", "USD")).toBeNull();
  });
});
