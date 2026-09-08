import { NextRequest, NextResponse } from "next/server";
import { getStationById } from "@/lib/radio-stations";
import {
  fetchStationStatus,
  getCachedStationStatus,
  setCachedStationStatus,
  type RadioStatus,
} from "@/lib/radio-status-fetch";

export const runtime = "nodejs";
export const maxDuration = 30;

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { expiresAt: number; data: RadioStatus }>();

export async function GET(request: NextRequest) {
  const stationId = request.nextUrl.searchParams.get("stationId");
  const force = request.nextUrl.searchParams.get("force") === "1";

  if (!stationId) {
    return NextResponse.json({ error: "stationId is required" }, { status: 400 });
  }

  const station = getStationById(stationId);
  if (!station) {
    return NextResponse.json({ error: "Unknown station" }, { status: 400 });
  }

  const respond = (data: RadioStatus) => {
    cache.set(station.id, { expiresAt: Date.now() + CACHE_TTL_MS, data });
    return NextResponse.json(data);
  };

  if (!force) {
    // 1. In-memory cache (fast path for the 20s client poller).
    const hit = cache.get(station.id);
    if (hit && hit.expiresAt > Date.now()) {
      return NextResponse.json(hit.data);
    }
    // 2. Redis cache warmed by the Inngest status sweep — fresher than
    //    re-hitting the upstream stream server on every request.
    const cached = await getCachedStationStatus(station.id).catch(() => null);
    if (cached) {
      return respond(cached);
    }
  }

  const live = await fetchStationStatus(station).catch(() => ({
    stationId: station.id,
    song: null,
    listeners: null,
    meta: false,
    source: "none" as const,
  }));

  // Backfill Redis so the next sweep-less request (or the sweep itself)
  // serves from cache instead of hitting the upstream.
  setCachedStationStatus(live).catch(() => {});

  return respond(live);
}