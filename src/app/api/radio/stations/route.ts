import { NextResponse } from "next/server";
import { STATIONS } from "@/lib/radio-stations";
import {
  getCachedStationStatus,
  type RadioStatus,
} from "@/lib/radio-status-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export interface StationWithSignal {
  id: string;
  song: string | null;
  listeners: number | null;
  meta: boolean;
  source: RadioStatus["source"];
  live: boolean;
}

/**
 * GET /api/radio/stations
 *
 * One lightweight call returning every station's latest known signal
 * (warmed by the 15-minute Inngest sweep, served from Redis). The radio
 * grid polls this instead of firing N status requests — one round-trip for
 * the whole dial, so cards show real now-playing data on first paint.
 */
export async function GET() {
  const settled = await Promise.allSettled(
    STATIONS.map((s) => getCachedStationStatus(s.id))
  );

  const signals: StationWithSignal[] = STATIONS.map((s, i) => {
    const r = settled[i];
    const cached =
      r && r.status === "fulfilled" ? (r.value as RadioStatus | null) : null;
    return {
      id: s.id,
      song: cached?.song ?? null,
      listeners: cached?.listeners ?? null,
      meta: cached?.meta ?? false,
      source: cached?.source ?? "none",
      live: (cached?.source ?? "none") !== "none",
    };
  });

  return NextResponse.json(
    {
      stations: STATIONS.map((s) => ({
        id: s.id,
        name: s.name,
        country: s.country,
        city: s.city,
        region: s.region,
        genre: s.genre,
        language: s.language,
        frequency: s.frequency,
        color: s.color,
        icon: s.icon,
        tagline: s.tagline,
        logoUrl: s.logoUrl ?? null,
        programming: s.programming,
        favorite: s.favorite,
        verified: s.verified,
        channels: 1 + (s.fallbacks?.length ?? 0),
      })),
      signals,
      generatedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180",
      },
    }
  );
}
