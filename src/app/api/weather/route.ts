import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAIROBI = { lat: -1.2864, lon: 36.8172 };

/**
 * GET /api/weather?lat=..&lon=..
 *
 * Server-side proxy for Open-Meteo so the browser never hits CORS or mixed
 * content. With no coords, resolves the client IP to a location
 * (ip-api.com, free) and falls back to Nairobi (regional default).
 */
export async function GET(request: NextRequest) {
  const latParam = request.nextUrl.searchParams.get("lat");
  const lonParam = request.nextUrl.searchParams.get("lon");

  let lat: number | null = latParam ? Number(latParam) : null;
  let lon: number | null = lonParam ? Number(lonParam) : null;

  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    // IP geolocation fallback.
    try {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
      if (ip && ip !== "::1" && ip !== "127.0.0.1") {
        const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=lat,lon,status`, {
          signal: AbortSignal.timeout(5000),
        });
        const geo = (await geoRes.json()) as { status?: string; lat?: number; lon?: number };
        if (geo.status === "success" && typeof geo.lat === "number" && typeof geo.lon === "number") {
          lat = geo.lat;
          lon = geo.lon;
        }
      }
    } catch {
      // ignore — fall through to default
    }
    if (lat == null || lon == null) {
      lat = NAIROBI.lat;
      lon = NAIROBI.lon;
    }
  }

  try {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min",
      timezone: "auto",
      forecast_days: "3",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Weather service unavailable" }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json({ ...data, coords: { lat, lon } });
  } catch {
    return NextResponse.json({ error: "Weather service unavailable" }, { status: 502 });
  }
}