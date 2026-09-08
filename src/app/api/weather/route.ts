import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAIROBI = { lat: -1.2864, lon: 36.8172 };

// Regional defaults for East African cities — avoids external IP lookup
const EA_REGIONS: Record<string, { lat: number; lon: number; label: string }> = {
  nairobi: { lat: -1.2864, lon: 36.8172, label: "Nairobi" },
  kampala: { lat: 0.3476, lon: 32.5825, label: "Kampala" },
  dar: { lat: -6.7924, lon: 39.2083, label: "Dar es Salaam" },
  "dar es salaam": { lat: -6.7924, lon: 39.2083, label: "Dar es Salaam" },
  kigali: { lat: -1.9403, lon: 29.8739, label: "Kigali" },
  mombasa: { lat: -4.0435, lon: 39.6682, label: "Mombasa" },
  arusha: { lat: -3.3869, lon: 36.683, label: "Arusha" },
  moshi: { lat: -3.3327, lon: 37.3379, label: "Moshi" },
  juba: { lat: 4.8594, lon: 31.5713, label: "Juba" },
  entebbe: { lat: 0.0564, lon: 32.4637, label: "Entebbe" },
};

const CACHE_TTL_SECONDS = 900; // 15 minutes — weather doesn't change fast

/**
 * GET /api/weather?lat=..&lon=..&city=..
 *
 * Cached server-side proxy for Open-Meteo. With no coords, tries:
 * 1. Redis-cached location from previous request
 * 2. IP geolocation (rate-limited to once per 30 min)
 * 3. Regional default (Nairobi)
 */
// Server-side cache of last IP location (with place label) — avoids a fresh
// ip-api.com call on every request.
const IP_CACHE_KEY = "weather:iploc";

async function resolveIpLocation(request: NextRequest): Promise<{ lat: number; lon: number; place: string | null }> {
  const cachedLoc = await cacheGet<{ lat: number; lon: number; place: string | null }>(IP_CACHE_KEY);
  if (cachedLoc) return cachedLoc;
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
    if (ip && ip !== "::1" && ip !== "127.0.0.1" && !ip.startsWith("::ffff:")) {
      const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=lat,lon,city,country,status`, {
        signal: AbortSignal.timeout(5000),
      });
      const geo = (await geoRes.json()) as { status?: string; lat?: number; lon?: number; city?: string; country?: string };
      if (geo.status === "success" && typeof geo.lat === "number" && typeof geo.lon === "number") {
        const place = [geo.city, geo.country].filter(Boolean).join(", ") || null;
        const result = { lat: geo.lat, lon: geo.lon, place };
        // Cache IP location for 30 minutes
        await cacheSet(IP_CACHE_KEY, result, 1800).catch(() => {});
        return result;
      }
    }
  } catch {
    /* fall through to default */
  }
  return { lat: NAIROBI.lat, lon: NAIROBI.lon, place: "Nairobi" };
}

export async function GET(request: NextRequest) {
  const latParam = request.nextUrl.searchParams.get("lat");
  const lonParam = request.nextUrl.searchParams.get("lon");
  const cityParam = request.nextUrl.searchParams.get("city")?.toLowerCase();
  const metaOnly = request.nextUrl.searchParams.get("meta") === "1";

  let lat: number;
  let lon: number;
  let placeLabel: string | null = null;

  if (latParam && lonParam) {
    lat = Number(latParam);
    lon = Number(lonParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      lat = NAIROBI.lat;
      lon = NAIROBI.lon;
    }
  } else if (cityParam && EA_REGIONS[cityParam]) {
    // Regional city lookup — zero external API calls
    const region = EA_REGIONS[cityParam];
    lat = region.lat;
    lon = region.lon;
    placeLabel = region.label;
  } else {
    const ipLoc = await resolveIpLocation(request);
    lat = ipLoc.lat;
    lon = ipLoc.lon;
    placeLabel = ipLoc.place;
  }

  // meta=1: lightweight location-only response (no Open-Meteo call).
  if (metaOnly) {
    return NextResponse.json({ coords: { lat, lon }, place: placeLabel });
  }

  // Round to 2 decimal places for cache key efficiency (still ~1km accuracy)
  const cacheKey = `weather:${lat.toFixed(2)}:${lon.toFixed(2)}`;

  // Check Redis cache first
  const cached = await cacheGet<Record<string, unknown>>(cacheKey).catch(() => null);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  try {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day,uv_index",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max",
      hourly: "temperature_2m,weather_code,precipitation_probability,wind_speed_10m",
      timezone: "auto",
      forecast_days: "14",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Weather service unavailable" }, { status: 502 });
    }
    const data = await res.json();
    const result = { ...data, coords: { lat, lon }, place: placeLabel };

    // Cache for 15 minutes
    await cacheSet(cacheKey, result, CACHE_TTL_SECONDS).catch(() => {});

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Weather service unavailable" }, { status: 502 });
  }
}
