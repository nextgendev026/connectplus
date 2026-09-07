"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Loader2, Sun, Cloud, CloudRain, CloudSnow, CloudLightning, Wind, Droplets, Thermometer, LocateFixed } from "lucide-react";
import { requestGeolocation, fetchIpLocation, DEFAULT_LOCATION, type GeoResult } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface CurrentWeather {
  temperature_2m: number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  weather_code: number;
  wind_speed_10m: number;
  is_day: number;
}

interface DailyWeather {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
}

interface OpenMeteoResponse {
  current?: CurrentWeather;
  daily?: DailyWeather;
}

function describeWeather(code: number): { label: string; icon: typeof Sun } {
  if (code === 0) return { label: "Clear sky", icon: Sun };
  if (code <= 2) return { label: "Partly cloudy", icon: Cloud };
  if (code <= 48) return { label: "Cloudy / fog", icon: Cloud };
  if (code <= 67) return { label: "Rain", icon: CloudRain };
  if (code <= 77) return { label: "Snow", icon: CloudSnow };
  if (code <= 82) return { label: "Showers", icon: CloudRain };
  if (code <= 86) return { label: "Rain / snow", icon: CloudSnow };
  if (code <= 99) return { label: "Thunderstorm", icon: CloudLightning };
  return { label: "Mixed", icon: Cloud };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { city?: string; locality?: string; principalSubdivision?: string; countryName?: string };
    return [data.city || data.locality, data.countryName].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}

export function WeatherWidget({ compact = false }: { compact?: boolean }) {
  const [coords, setCoords] = useState<GeoResult | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [weather, setWeather] = useState<OpenMeteoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [locState, setLocState] = useState<"idle" | "prompting" | "granted" | "fallback" | "denied">("idle");
  const [error, setError] = useState<string | null>(null);

  const loadWeather = useCallback(async (geo: GeoResult) => {
    setLoading(true);
    setError(null);
    try {
      // Same-origin proxy avoids CORS/mixed-content issues and lets the server
      // resolve IP location when no coords are passed.
      const query = geo.source === "default" ? "" : `?lat=${geo.lat.toFixed(4)}&lon=${geo.lon.toFixed(4)}`;
      const res = await fetch(`/api/weather${query}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error("Weather service unavailable");
      const data = (await res.json()) as OpenMeteoResponse;
      setWeather(data);
      setCoords(geo);
      setLocState(geo.source === "gps" ? "granted" : "fallback");
      if (geo.source === "gps") {
        const name = await reverseGeocode(geo.lat, geo.lon);
        setPlace(name);
      } else {
        setPlace(null);
      }
    } catch {
      setError("Couldn't load weather right now. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  const enableLocation = useCallback(async () => {
    setLocState("prompting");
    const res = await requestGeolocation();
    if (res.status === "granted" && res.coords) {
      await loadWeather({ lat: res.coords.lat, lon: res.coords.lon, source: "gps", accuracy: res.coords.accuracy });
      return;
    }
    // Fall back to IP location, then to the regional default.
    setLocState("fallback");
    const ip = await fetchIpLocation();
    await loadWeather(ip ?? DEFAULT_LOCATION);
  }, [loadWeather]);

  useEffect(() => {
    // Start with IP/default weather instantly (resolved server-side); GPS is
    // opt-in via the button so we never surprise the user with a prompt.
    (async () => {
      const ip = await fetchIpLocation();
      if (ip) {
        await loadWeather(ip);
      } else {
        // No coords -> the API resolves IP (or defaults to Nairobi) itself.
        setLoading(true);
        try {
          const res = await fetch("/api/weather", { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error("Weather service unavailable");
          const data = (await res.json()) as OpenMeteoResponse;
          setWeather(data);
          setCoords(DEFAULT_LOCATION);
          setLocState("fallback");
        } catch {
          setError("Couldn't load weather right now. Try again in a moment.");
        } finally {
          setLoading(false);
        }
      }
    })();
  }, [loadWeather]);

  const current = weather?.current;
  const daily = weather?.daily;
  const cond = current ? describeWeather(current.weather_code) : null;

  if (loading && !current) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-surface-800 bg-surface-900/50 px-4 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-accent-strong" />
        <span className="text-xs text-surface-400">Loading regional weather…</span>
      </div>
    );
  }

  if (error && !current) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-surface-800 bg-surface-900/50 px-4 py-3">
        <span className="text-xs text-surface-400">{error}</span>
        <button onClick={() => coords && loadWeather(coords)} className="text-xs font-medium text-accent-strong">
          Retry
        </button>
      </div>
    );
  }

  const Icon = cond?.icon ?? Sun;

  return (
    <div className="rounded-2xl border border-surface-800 bg-surface-900/50 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-500">
          <Thermometer className="h-3.5 w-3.5 text-accent-strong" />
          Regional Weather
        </div>
        <button
          onClick={enableLocation}
          disabled={locState === "prompting"}
          className={cn(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all",
            locState === "granted"
              ? "border-emerald-500/30 bg-emerald-500/10 text-positive-strong"
              : "border-surface-700 bg-surface-800 text-surface-300 hover:border-brand-500/40 hover:text-accent-strong"
          )}
          title="Use your GPS location for local weather"
        >
          {locState === "prompting" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : locState === "granted" ? (
            <LocateFixed className="h-3 w-3" />
          ) : (
            <MapPin className="h-3 w-3" />
          )}
          {locState === "granted" ? "GPS live" : "Use my location"}
        </button>
      </div>

      <div className="px-4 pb-4">
        {current && cond && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <Icon className={cn("h-10 w-10", current.is_day ? "text-amber-500" : "text-cyan-500")} />
              <div>
                <p className="text-3xl font-bold text-surface-50 leading-none">
                  {Math.round(current.temperature_2m)}°
                </p>
                <p className="mt-1 text-xs text-surface-400">{cond.label}</p>
              </div>
            </div>
            <div className="ml-auto flex flex-col gap-1 text-[11px] text-surface-400">
              <span className="flex items-center gap-1.5">
                <Wind className="h-3 w-3 text-surface-500" />
                {Math.round(current.wind_speed_10m)} km/h
              </span>
              <span className="flex items-center gap-1.5">
                <Droplets className="h-3 w-3 text-surface-500" />
                {current.relative_humidity_2m}% humidity
              </span>
              <span className="flex items-center gap-1.5">
                <Thermometer className="h-3 w-3 text-surface-500" />
                Feels {Math.round(current.apparent_temperature)}°
              </span>
            </div>
          </div>
        )}

        {place && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-surface-500">
            <MapPin className="h-3 w-3 text-accent-strong" />
            {place}
          </p>
        )}

        {daily && daily.time.length > 0 && !compact && (
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-surface-800 pt-3">
            {daily.time.slice(0, 3).map((day, i) => {
              const d = describeWeather(daily.weather_code[i] ?? 0);
              const DayIcon = d.icon;
              const date = new Date(day);
              const high = daily.temperature_2m_max[i] ?? 0;
              const low = daily.temperature_2m_min[i] ?? 0;
              return (
                <div key={day} className="flex flex-col items-center gap-1 rounded-lg bg-surface-800/40 px-2 py-1.5">
                  <span className="text-[10px] font-semibold text-surface-400">
                    {i === 0 ? "Today" : WEEKDAYS[date.getDay()]}
                  </span>
                  <DayIcon className="h-4 w-4 text-accent-strong" />
                  <span className="text-[10px] font-medium text-surface-300">
                    {Math.round(high)}° / {Math.round(low)}°
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}