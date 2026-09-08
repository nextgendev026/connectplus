import { NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 30;

const CACHE_TTL = 30 * 60; // 30 min — free tier friendly
// Day-change baseline lives well beyond the cache window (and any serverless
// cold start) so percentages survive restarts instead of resetting to null.
const BASELINE_TTL = 48 * 60 * 60;

/** Currencies relevant to East African listeners + majors. */
const CURRENCIES = ["KES", "UGX", "TZS", "RWF", "NGN", "ZAR", "USD", "EUR", "GBP"] as const;
type Currency = (typeof CURRENCIES)[number];

export interface ForexQuote {
  code: Currency;
  /** Units of `code` per 1 USD */
  rate: number;
  /** Percent change vs the day baseline (approx day change). */
  changePct: number | null;
  direction: "up" | "down" | "flat";
}

export interface ForexResponse {
  base: "USD";
  updatedAt: string;
  quotes: ForexQuote[];
  source: string;
  cached: boolean;
}

/** Daily baseline snapshot stored in Redis — the reference for day change. */
interface ForexBaseline {
  /** UTC date (YYYY-MM-DD) the baseline was captured on. */
  date: string;
  rates: Partial<Record<Currency, number>>;
  updatedAt: string;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchRates(): Promise<Partial<Record<Currency, number>> | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (data.result !== "success" || !data.rates) return null;
    const out: Partial<Record<Currency, number>> = {};
    for (const c of CURRENCIES) {
      const v = data.rates[c];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[c] = v;
    }
    return Object.keys(out).length >= 2 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Load the day baseline, computing day-change deltas, then roll it forward:
 *  - baseline for today  → deltas are vs today's open (persist all day)
 *  - baseline from yesterday → deltas are vs yesterday's close (true day
 *    change), then the baseline rolls to today's rates
 *  - no baseline → deltas null, baseline seeded with current rates
 */
async function applyDayChange(
  rates: Partial<Record<Currency, number>>
): Promise<{ quotes: ForexQuote[] }> {
  const today = utcToday();
  const baseline = await cacheGet<ForexBaseline>("forex:baseline").catch(() => null);

  // Baseline rates to diff against: today's open, or yesterday's close.
  const refRates = baseline?.rates ?? null;

  const quotes: ForexQuote[] = CURRENCIES.filter((c) => rates[c] !== undefined).map((c) => {
    const rate = rates[c]!;
    const refRate = refRates?.[c];
    let changePct: number | null = null;
    let direction: ForexQuote["direction"] = "flat";
    if (typeof refRate === "number" && refRate > 0) {
      changePct = ((rate - refRate) / refRate) * 100;
      direction = changePct > 0.005 ? "up" : changePct < -0.005 ? "down" : "flat";
    }
    return { code: c, rate, changePct, direction };
  });

  // Roll the baseline forward when absent or stale (new UTC day).
  if (!baseline || baseline.date !== today) {
    const next: ForexBaseline = {
      date: today,
      rates,
      updatedAt: new Date().toISOString(),
    };
    await cacheSet("forex:baseline", next, BASELINE_TTL).catch(() => {});
  }

  return { quotes };
}

export async function GET() {
  const cached = await cacheGet<ForexResponse>("forex:latest").catch(() => null);
  if (cached && Date.now() - new Date(cached.updatedAt).getTime() < CACHE_TTL * 1000) {
    return NextResponse.json({ ...cached, cached: true });
  }

  const rates = await fetchRates();

  if (!rates) {
    // Fall back to the previous snapshot when upstream is unavailable.
    if (cached) {
      return NextResponse.json({ ...cached, cached: true, source: `${cached.source} (stale)` });
    }
    return NextResponse.json({ error: "Forex service unavailable" }, { status: 503 });
  }

  const { quotes } = await applyDayChange(rates);

  const body: ForexResponse = {
    base: "USD",
    updatedAt: new Date().toISOString(),
    quotes,
    source: "open.er-api.com",
    cached: false,
  };

  await cacheSet("forex:latest", body, CACHE_TTL).catch(() => {});

  return NextResponse.json(body);
}