/**
 * Money, as integers.
 *
 * Every amount on this platform is a `Float` in the database today, and floats
 * are not money: `0.1 + 0.2` is not `0.3`, and a fee computed as a percentage of a
 * float drifts a little further from the truth on every row. The damage is not
 * hypothetical here, because the payment paths *compare* amounts — a Daraja
 * callback's declared amount against the intent we created — and a comparison
 * that fails a legitimate payment, or passes an illegitimate one near a boundary,
 * is the same bug seen from two sides. (That comparison also carried a ±1
 * whole-unit tolerance, so `500` and `499` matched. See `amountMismatch` below.)
 *
 * The fix is to stop representing money as a fraction at all. Every value becomes
 * an integer count of minor units — cents, or Kenyan cents — and integers add,
 * subtract and compare exactly. This module is the only place that converts.
 *
 * Two rules it exists to enforce:
 *
 *  1. **Parsing is textual, never `parseFloat`.** `Number("1.005") * 100` is
 *     `100.49999999999999`, so the naive version reads `"1.005"` as 100 cents.
 *     The decimal string is therefore read digit by digit, which keeps
 *     `"645.55"` exactly 64 555 minor units.
 *
 *     Two callers want two different things from a fraction, so there are two
 *     functions rather than one compromise. `toMinorUnits` is **strict**: at most
 *     two decimal places, and a third is refused rather than rounded, because a
 *     provider declaring `645.551` is telling us something is wrong upstream.
 *     `toMinorUnitsRounded` snaps to two places, and exists for one job —
 *     converting the legacy `Float` columns, where `0.30000000000000004` is not a
 *     third decimal place, it is binary floating point, and refusing it would drop
 *     a real row from the backfill.
 *  2. **Splits are exact, not approximately exact.** `splitFee` guarantees
 *     `fee + net === gross` for every gross and every rate, because the remainder
 *     is assigned rather than left to rounding. A revenue split that loses a cent
 *     per row is a reconciliation report nobody can close.
 */

export const CURRENCIES = ["KES", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Minor units per major unit. Both rails settle to two decimal places. */
export const SCALE = 100;

export interface Money {
  /** Integer count of minor units. Never fractional, never negative. */
  readonly amountMinor: number;
  readonly currency: Currency;
}

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/**
 * Parse a decimal amount into minor units, exactly.
 *
 * Accepts a number or a string — providers send both (`645` from Daraja's JSON,
 * `"6.45"` from PayPal) — and reads it as decimal text. Returns `null` for
 * anything that is not a finite, non-negative decimal with at most two fractional
 * digits, because a third fractional digit means someone is trying to charge a
 * fraction of a cent and guessing which way to round is how money goes missing.
 *
 * A number is converted through `String(value)`, which for a value that is already
 * a clean decimal reproduces the shortest representation a human would write.
 * Scientific notation (`1e3`) and values whose string form carries more than two
 * decimals are refused rather than silently mangled.
 */
export function toMinorUnits(value: number | string): number | null {
  // Surrounding whitespace on a *string* is tolerated (a configured value may
  // arrive padded); anything else unusual is not.
  const raw = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value.trim();
  if (!raw) return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return null; // no sign, no exponent, no "NaN"

  const [whole = "0", fraction = ""] = raw.split(".");
  if (fraction.length > 2) return null;

  const padded = (fraction + "00").slice(0, 2);
  const major = Number(whole);
  const minor = Number(padded);
  if (!Number.isSafeInteger(major) || !Number.isFinite(minor)) return null;

  const total = major * SCALE + minor;
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * Parse a decimal, snapping to two places with half-up rounding.
 *
 * For values that were *meant* to be two decimals and are not, because they
 * travelled through a binary float: `0.1 + 0.2` is `0.30000000000000004`, and a
 * strict parse refuses it. `"1.005"` becomes 101 here, which is what a person
 * means by it.
 *
 * Not for provider declarations — those go through strict `toMinorUnits`, so a
 * third decimal place is visible rather than rounded away.
 */
export function toMinorUnitsRounded(value: number | string): number | null {
  const raw = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value.trim();
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;

  const [whole = "0", fraction = ""] = raw.split(".");
  const majorPart = Number(whole);
  if (!Number.isSafeInteger(majorPart)) return null;

  const rest = fraction.slice(2);
  const hundredths = Number((fraction + "00").slice(0, 2));
  if (!Number.isFinite(hundredths)) return null;

  const roundsUp = rest.length > 0 && Number(`0.${rest}`) >= 0.5;
  const total = majorPart * SCALE + hundredths + (roundsUp ? 1 : 0);
  return Number.isSafeInteger(total) ? total : null;
}

/** Construct a `Money`, refusing a value that is not a non-negative integer. */
export function money(amountMinor: number, currency: Currency): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new TypeError(`Money must be an integer number of minor units, got ${amountMinor}`);
  }
  if (amountMinor < 0) {
    throw new TypeError(`Money must not be negative, got ${amountMinor}`);
  }
  return { amountMinor, currency };
}

/** Build from a major-unit value (a plan price, a provider amount). */
export function fromMajor(value: number | string, currency: Currency): Money | null {
  const minor = toMinorUnits(value);
  return minor === null ? null : money(minor, currency);
}

function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

export function add(a: Money, b: Money): Money {
  if (!sameCurrency(a, b)) throw new TypeError(`Cannot add ${a.currency} to ${b.currency}`);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

/** Subtract, refusing to produce a negative amount — that is a bug upstream. */
export function subtract(a: Money, b: Money): Money {
  if (!sameCurrency(a, b)) throw new TypeError(`Cannot subtract ${b.currency} from ${a.currency}`);
  const difference = a.amountMinor - b.amountMinor;
  if (difference < 0) {
    throw new TypeError(`Subtraction would produce a negative amount (${a.amountMinor} - ${b.amountMinor})`);
  }
  return money(difference, a.currency);
}

/**
 * Multiply by a rate expressed in basis points (1 bps = 0.01%).
 *
 * Integer rates keep the whole calculation in integers. `BigInt` would be the
 * natural tool and is unavailable: the project targets below ES2020, where the
 * type library has no `BigInt` declaration at all. So the bound is checked
 * instead, and the checked bound is narrow enough to be reassuring: a safe integer
 * divided by the largest rate (10 000 bps) caps a single amount at about 900
 * billion major units. Anything past that throws rather than silently losing
 * precision, which is the one thing money must never do quietly.
 *
 * Rounding is half-up, which is what every invoice and every provider does.
 */
export function multiplyByBps(value: Money, bps: number): Money {
  if (!Number.isFinite(bps) || bps < 0) throw new TypeError(`Invalid rate: ${bps}`);
  const rate = Math.round(bps);
  const product = value.amountMinor * rate;
  if (!Number.isSafeInteger(product)) {
    throw new TypeError(`Money calculation overflowed (${value.amountMinor} × ${rate})`);
  }
  // Integer half-up: floor((product + half) / scale), exact while `product` is safe.
  const result = Math.floor((product + 5_000) / 10_000);
  return money(result, value.currency);
}

/**
 * Split a gross amount into a fee and a net, exactly.
 *
 * The net is the *remainder*, not an independently rounded figure: computing both
 * from the gross lets the two disagree by a cent, and a payout ledger whose parts
 * do not sum to its whole is one nobody can reconcile. The guarantee this function
 * makes — and that its test pins for a wide range of grosses and rates — is
 * `fee + net === gross`, always, in the same currency.
 */
export function splitFee(gross: Money, feeBps: number): { fee: Money; net: Money } {
  const fee = multiplyByBps(gross, feeBps);
  return { fee, net: subtract(gross, fee) };
}

/**
 * Round to whole shillings, for the M-Pesa rail.
 *
 * Safaricom cannot charge a fractional shilling, so a KES amount must be a whole
 * number of shillings before it is sent. Half-up, and the result keeps the same
 * currency — this is a rail restriction, not a conversion.
 */
export function toWholeShillings(value: Money): Money {
  if (value.currency !== "KES") return value;
  const shillings = Math.round(value.amountMinor / SCALE);
  return money(shillings * SCALE, value.currency);
}

/**
 * Convert USD to KES and round to whole shillings, for the Daraja rail.
 *
 * **The unit of the rate is the easy thing to get wrong, and the first version of
 * this function did.** The conversion happens minor-unit to minor-unit, and one US
 * cent is `rate` Kenyan cents, not `rate/100`:
 *
 *     KES_minor = USD_minor × rate
 *
 * so \$5.00 (500 minor) at 129 KES/USD is 64 500 Kenyan cents = KES 645.00. (The
 * first version of this function multiplied by `rate / 100` instead and priced a
 * five-dollar plan at KES 6.45 — silently, because 6.45 is a plausible number.)
 *
 * The rate therefore arrives as an integer **scaled by 100** (`MPESA_KES_PER_USD`
 * of `129` → `12900`) and the division by 100 happens exactly once, inside the
 * integer maths. Rounding to whole shillings happens last, because it is a property
 * of the rail and not of the amount.
 */
export function convertToKesWholeShillings(usd: Money, kesPerUsdHundredths: number): Money {
  if (usd.currency !== "USD") throw new TypeError("Only USD is converted to KES");
  if (!Number.isSafeInteger(kesPerUsdHundredths) || kesPerUsdHundredths <= 0) {
    throw new TypeError(`Invalid KES-per-USD rate: ${kesPerUsdHundredths} (expected an integer scaled by 100)`);
  }
  const product = usd.amountMinor * kesPerUsdHundredths;
  if (!Number.isSafeInteger(product)) throw new TypeError("Money conversion overflowed");
  const kesMinor = Math.floor((product + 50) / 100); // half-up on the cent
  return toWholeShillings(money(kesMinor, "KES"));
}

/** The helper a call site needs for a whole-number env rate like `129`. */
export function rateHundredths(kesPerUsd: number | string): number {
  const minor = toMinorUnits(kesPerUsd);
  if (minor === null) throw new TypeError(`Invalid KES-per-USD rate: ${kesPerUsd}`);
  return minor;
}

/* ── Comparisons, which is where floats actually bite ─────────────────────── */

/** Exact equality. Two amounts of the same currency match or they do not. */
export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

/**
 * Do a provider's declared amount and the amount we asked for agree?
 *
 * **This replaces a tolerance, and the tolerance is worth explaining.** The Daraja
 * callback used to accept a payload when `Math.abs(received - expected) > 1` was
 * false — a window of ±1 *major* unit, i.e. up to one whole shilling, or one whole
 * dollar on the USD-converted rail. The comment said "the STK push fixed the
 * amount, so a different one means the payload was not produced by that request",
 * which is exactly right and exactly what ±1 stopped being true. A callback
 * claiming `$499` against a `$500` plan was accepted and a year of membership
 * granted.
 *
 * The tolerance existed because float comparison is unreliable. Integer minor
 * units remove the unreliability, so the tolerance can go: any difference at all
 * is now a mismatch. `null` (a provider that declared nothing) is *not* a match —
 * a payload without an amount cannot be verified, and treating absence as
 * agreement is how the check silently stops protecting anything.
 */
export function amountMismatch(
  expected: number | string | null | undefined,
  received: number | string | null | undefined,
  currency: Currency
): { mismatch: boolean; expectedMinor: number | null; receivedMinor: number | null; reason?: string } {
  const expectedMinor = expected === null || expected === undefined ? null : toMinorUnits(expected);
  const receivedMinor = received === null || received === undefined ? null : toMinorUnits(received);

  if (expectedMinor === null) {
    return { mismatch: true, expectedMinor, receivedMinor, reason: "the expected amount could not be read" };
  }
  if (receivedMinor === null) {
    return { mismatch: true, expectedMinor, receivedMinor, reason: "the provider declared no amount" };
  }
  if (expectedMinor !== receivedMinor) {
    return { mismatch: true, expectedMinor, receivedMinor, reason: "the amounts differ" };
  }
  return { mismatch: false, expectedMinor, receivedMinor };
}

/** Major-unit value, for display and for writing to a legacy float column. */
export function toMajor(value: Money): number {
  return value.amountMinor / SCALE;
}

/** A stable decimal string: always two places, no exponent. */
export function format(value: Money): string {
  const sign = value.amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(value.amountMinor);
  const major = Math.floor(absolute / SCALE);
  const minor = absolute % SCALE;
  return `${sign}${major}.${String(minor).padStart(2, "0")}`;
}

/** Round-trip a legacy float into minor units for a migration or a backfill. */
export function fromLegacyFloat(value: number | null | undefined, currency: Currency): Money | null {
  if (value === null || value === undefined) return null;
  const minor = toMinorUnitsRounded(value);
  return minor === null ? null : money(minor, currency);
}
