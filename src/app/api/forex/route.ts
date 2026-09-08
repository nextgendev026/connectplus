import { NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 30;

const CACHE_TTL = 30 * 60; // 30 min — free tier friendly
const PREV_TTL = 24 * 60 * 60;

/** Currencies relevant to East African listeners + majors. */
const CURRENCIES = ["KES", "UGX", "TZS", "RWF", "NGN", "ZAR", "USD", "EUR", "GBP"] as const;
type Currency = (typeof CURRENCIES)[number];

export interface ForexQuote {
  code: Currency;
  /** Units of `code` per 1 USD */
  rate: number;
  /** Percent change vs previous cached snapshot (approx day change). */
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

  // Previous snapshot for day-change deltas.
  const prev = await cacheGet<ForexResponse>("forex:latest").catch(() => null);
  const prevRates = new Map(
    (prev?.quotes ?? []).map((q) => [q.code, q.rate] as const)
  );

  const quotes: ForexQuote[] = CURRENCIES.filter((c) => rates[c] !== undefined).map((c) => {
    const rate = rates[c]!;
    const prevRate = prevRates.get(c);
    let changePct: number | null = null;
    let direction: ForexQuote["direction"] = "flat";
    if (prevRate && prevRate > 0) {
      changePct = ((rate - prevRate) / prevRate) * 100;
      direction = changePct > 0.005 ? "up" : changePct < -0.005 ? "down" : "flat";
    }
    return { code: c, rate, changePct, direction };
  });

  const body: ForexResponse = {
    base: "USD",
    updatedAt: new Date().toISOString(),
    quotes,
    source: "open.er-api.com",
    cached: false,
  };

  await cacheSet("forex:latest", body, CACHE_TTL).catch(() => {});
  // Keep a longer-lived copy purely for change deltas.
  await cacheSet("forex:prev", body, PREV_TTL).catch(() => {});

  return NextResponse.json(body);
}