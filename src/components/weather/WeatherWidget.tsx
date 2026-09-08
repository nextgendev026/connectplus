"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import {
  MapPin,
  Loader2,
  Sun,
  Moon,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Wind,
  Droplets,
  Thermometer,
  LocateFixed,
  Eye,
  Sunrise,
  Sunset,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { requestGeolocation, DEFAULT_LOCATION, type GeoResult } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CurrentWeather {
  temperature_2m: number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  weather_code: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  is_day: number;
  uv_index: number;
}

interface DailyWeather {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  sunrise: string[];
  sunset: string[];
  precipitation_probability_max: number[];
  uv_index_max: number[];
}

interface HourlyWeather {
  time: string[];
  temperature_2m: number[];
  weather_code: number[];
  precipitation_probability: number[];
  wind_speed_10m: number[];
}

interface OpenMeteoResponse {
  current?: CurrentWeather;
  daily?: DailyWeather;
  hourly?: HourlyWeather;
  coords?: { lat: number; lon: number };
  place?: string | null;
  cached?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Weather helpers                                                    */
/* ------------------------------------------------------------------ */

function describeWeather(code: number): { label: string; icon: typeof Sun; animation: string } {
  // all branches return animation explicitly
  if (code === 0) return { label: "Clear sky", icon: Sun, animation: "weather-sunny" };
  if (code <= 2) return { label: "Partly cloudy", icon: Cloud, animation: "weather-cloudy" };
  if (code <= 3) return { label: "Overcast", icon: Cloud, animation: "weather-cloudy" };
  if (code <= 48) return { label: "Fog", icon: Cloud, animation: "weather-fog" };
  if (code <= 57) return { label: "Drizzle", icon: CloudRain, animation: "weather-drizzle" };
  if (code <= 67) return { label: "Rain", icon: CloudRain, animation: "weather-rain" };
  if (code <= 77) return { label: "Snow", icon: CloudSnow, animation: "weather-snow" };
  if (code <= 82) return { label: "Showers", icon: CloudRain, animation: "weather-rain" };
  if (code <= 86) return { label: "Heavy snow", icon: CloudSnow, animation: "weather-snow" };
  if (code <= 99) return { label: "Thunderstorm", icon: CloudLightning, animation: "weather-storm" };
  return { label: "Mixed", icon: Cloud, animation: "weather-cloudy" };
}

function windDirection(degrees: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(degrees / 45) % 8] ?? "N";
}

function uvLevel(uv: number): { label: string; color: string } {
  if (uv <= 2) return { label: "Low", color: "text-emerald-400" };
  if (uv <= 5) return { label: "Moderate", color: "text-amber-400" };
  if (uv <= 7) return { label: "High", color: "text-orange-400" };
  if (uv <= 10) return { label: "Very High", color: "text-red-400" };
  return { label: "Extreme", color: "text-purple-400" };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { city?: string; locality?: string; countryName?: string };
    return [data.city || data.locality, data.countryName].filter(Boolean).join(", ") || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Weather animations CSS                                             */
/* ------------------------------------------------------------------ */

function WeatherAnimation({ animation, isDay }: { animation: string; isDay: boolean }) {
  if (animation === "weather-sunny" && isDay) {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="weather-sun-rays absolute top-1/4 left-1/2 -translate-x-1/2 w-32 h-32">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="absolute top-1/2 left-1/2 w-0.5 h-12 bg-amber-400/60 origin-bottom"
              style={{ transform: `translate(-50%, -100%) rotate(${i * 45}deg)` }}
            />
          ))}
        </div>
      </div>
    );
  }
  if (animation === "weather-rain" || animation === "weather-drizzle") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="weather-raindrop absolute w-px h-4 bg-blue-400/60"
            style={{
              left: `${8 + i * 8}%`,
              animationDelay: `${i * 0.2}s`,
              animationDuration: `${0.6 + Math.random() * 0.4}s`,
            }}
          />
        ))}
      </div>
    );
  }
  if (animation === "weather-snow") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
        {[...Array(10)].map((_, i) => (
          <div
            key={i}
            className="weather-snowflake absolute w-1.5 h-1.5 rounded-full bg-white/60"
            style={{
              left: `${5 + i * 10}%`,
              animationDelay: `${i * 0.3}s`,
              animationDuration: `${2 + Math.random() * 1.5}s`,
            }}
          />
        ))}
      </div>
    );
  }
  if (animation === "weather-storm") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="weather-lightning absolute inset-0 bg-white/5" />
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="weather-raindrop absolute w-px h-5 bg-blue-300/50"
            style={{
              left: `${10 + i * 11}%`,
              animationDelay: `${i * 0.15}s`,
              animationDuration: `${0.4 + Math.random() * 0.3}s`,
            }}
          />
        ))}
      </div>
    );
  }
  if (animation === "weather-cloudy") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-10">
        <div className="weather-cloud-drift absolute top-1/3 -left-8 w-24 h-8 rounded-full bg-white/30" />
        <div className="weather-cloud-drift-reverse absolute top-1/2 -right-8 w-20 h-6 rounded-full bg-white/20" style={{ animationDelay: "2s" }} />
      </div>
    );
  }
  if (animation === "weather-fog") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="weather-fog-layer absolute h-3 bg-white/5 rounded-full"
            style={{
              top: `${30 + i * 20}%`,
              left: "-10%",
              width: "120%",
              animationDelay: `${i * 1.5}s`,
            }}
          />
        ))}
      </div>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Main widget                                                        */
/* ------------------------------------------------------------------ */

export function WeatherWidget({ compact = false }: { compact?: boolean }) {
  const [coords, setCoords] = useState<GeoResult | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [weather, setWeather] = useState<OpenMeteoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [locState, setLocState] = useState<"idle" | "prompting" | "granted" | "fallback" | "denied">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hourScrollIdx, setHourScrollIdx] = useState(0);

  const loadWeather = useCallback(async (geo: GeoResult) => {
    setLoading(true);
    setError(null);
    try {
      const query = geo.source === "default" ? "" : `?lat=${geo.lat.toFixed(4)}&lon=${geo.lon.toFixed(4)}`;
      const res = await fetch(`/api/weather${query}`, {
        signal: AbortSignal.timeout(10_000),
        headers: { "Cache-Control": "max-age=600" },
      });
      if (!res.ok) throw new Error("Weather service unavailable");
      const data = (await res.json()) as OpenMeteoResponse;
      setWeather(data);
      setCoords(geo);
      setLocState(geo.source === "gps" ? "granted" : "fallback");
      if (geo.source === "gps") {
        const cached = localStorage.getItem("weather-place");
        if (cached) {
          setPlace(cached);
        } else {
          const name = await reverseGeocode(geo.lat, geo.lon);
          if (name) { setPlace(name); try { localStorage.setItem("weather-place", name); } catch {} }
        }
      } else {
        setPlace(null);
      }
    } catch {
      setError("Couldn't load weather. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const enableLocation = useCallback(async () => {
    setLocState("prompting");
    const res = await requestGeolocation();
    if (res.status === "granted" && res.coords) {
      try {
        localStorage.setItem("weather-gps", JSON.stringify({ lat: res.coords.lat, lon: res.coords.lon, ts: Date.now() }));
      } catch {}
      await loadWeather({ lat: res.coords.lat, lon: res.coords.lon, source: "gps", accuracy: res.coords.accuracy });
      return;
    }
    setLocState("fallback");
    setLoading(true);
    try {
      const apiRes = await fetch("/api/weather", { signal: AbortSignal.timeout(10_000) });
      if (!apiRes.ok) throw new Error("Weather service unavailable");
      const data = (await apiRes.json()) as OpenMeteoResponse;
      setWeather(data);
      setCoords(data.coords ? { lat: data.coords.lat, lon: data.coords.lon, source: "ip" } : DEFAULT_LOCATION);
    } catch {
      setError("Couldn't load weather. Try again.");
    } finally {
      setLoading(false);
    }
  }, [loadWeather]);

  useEffect(() => {
    (async () => {
      try {
        const saved = localStorage.getItem("weather-gps");
        if (saved) {
          const parsed = JSON.parse(saved) as { lat: number; lon: number; ts: number };
          if (Date.now() - parsed.ts < 30 * 60_000) {
            await loadWeather({ lat: parsed.lat, lon: parsed.lon, source: "gps" });
            return;
          }
        }
      } catch {}
      setLoading(true);
      try {
        const res = await fetch("/api/weather", { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error("Weather service unavailable");
        const data = (await res.json()) as OpenMeteoResponse;
        setWeather(data);
        setCoords(data.coords ? { lat: data.coords.lat, lon: data.coords.lon, source: "ip" } : DEFAULT_LOCATION);
        setLocState("fallback");
      } catch {
        setError("Couldn't load weather. Try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadWeather]);

  const current = weather?.current;
  const daily = weather?.daily;
  const hourly = weather?.hourly;
  const cond = current ? describeWeather(current.weather_code) : null;

  // Get next 24 hours from hourly data
  const nextHours = useMemo(() => {
    if (!hourly) return [];
    const now = new Date();
    const results: { time: string; temp: number; code: number; precip: number }[] = [];
    for (let i = 0; i < hourly.time.length && results.length < 24; i++) {
      const timeStr = hourly.time[i];
      if (!timeStr) continue;
      const h = new Date(timeStr);
      if (h >= now) {
        results.push({
          time: new Date(h).toLocaleTimeString("en-US", { hour: "numeric", hour12: true }),
          temp: hourly.temperature_2m[i] ?? 0,
          code: hourly.weather_code[i] ?? 0,
          precip: hourly.precipitation_probability[i] ?? 0,
        });
      }
    }
    return results;
  }, [hourly]);

  if (loading && !current) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-surface-800 bg-surface-900/50 px-4 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-accent-strong" />
        <span className="text-xs text-surface-400">Loading weather…</span>
      </div>
    );
  }

  if (error && !current) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-surface-800 bg-surface-900/50 px-4 py-3">
        <span className="text-xs text-surface-400">{error}</span>
        <button onClick={() => coords && loadWeather(coords)} className="text-xs font-medium text-accent-strong">Retry</button>
      </div>
    );
  }

  const Icon = cond?.icon ?? Sun;
  const isDay = current?.is_day === 1;
  const windDir = current ? windDirection(current.wind_direction_10m ?? 0) : "";

  return (
    <div className="rounded-2xl border border-surface-800 bg-surface-900/50 overflow-hidden relative">
      {/* Weather animation background */}
      {cond && <WeatherAnimation animation={cond.animation} isDay={isDay} />}

      {/* Header */}
      <div className="relative flex items-start justify-between gap-3 px-4 pt-3.5 pb-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-500">
          <Thermometer className="h-3.5 w-3.5 text-accent-strong" />
          Weather
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
        >
          {locState === "prompting" ? <Loader2 className="h-3 w-3 animate-spin" /> : locState === "granted" ? <LocateFixed className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
          {locState === "granted" ? "GPS" : "Location"}
        </button>
      </div>

      {/* Current weather */}
      <div className="relative px-4 pb-3">
        {current && cond && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Icon className={cn("h-10 w-10", isDay ? "text-amber-500" : "text-indigo-400")} />
              </div>
              <div>
                <p className="text-3xl font-bold text-surface-50 leading-none">{Math.round(current.temperature_2m)}°</p>
                <p className="mt-1 text-xs text-surface-400">{cond.label}</p>
              </div>
            </div>
            <div className="ml-auto flex flex-col gap-1 text-[11px] text-surface-400">
              <span className="flex items-center gap-1.5">
                <Thermometer className="h-3 w-3 text-surface-500" />
                Feels {Math.round(current.apparent_temperature)}°
              </span>
              <span className="flex items-center gap-1.5">
                <Droplets className="h-3 w-3 text-surface-500" />
                {current.relative_humidity_2m}%
              </span>
              <span className="flex items-center gap-1.5">
                <Wind className="h-3 w-3 text-surface-500" />
                {Math.round(current.wind_speed_10m)} km/h {windDir}
              </span>
              {current.uv_index !== undefined && (
                <span className={cn("flex items-center gap-1.5", uvLevel(current.uv_index).color)}>
                  <Eye className="h-3 w-3" />
                  UV {current.uv_index.toFixed(1)} · {uvLevel(current.uv_index).label}
                </span>
              )}
            </div>
          </div>
        )}

        {place && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-surface-500">
            <MapPin className="h-3 w-3 text-accent-strong" />
            {place}
          </p>
        )}

        {/* Sunrise / Sunset */}
        {daily && daily.sunrise?.[0] && daily.sunset?.[0] && (
          <div className="mt-2 flex items-center gap-4 text-[10px] text-surface-500">
            <span className="flex items-center gap-1">
              <Sunrise className="h-3 w-3 text-amber-400" />
              {new Date(daily.sunrise[0]).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
            </span>
            <span className="flex items-center gap-1">
              <Sunset className="h-3 w-3 text-orange-400" />
              {new Date(daily.sunset[0]).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
            </span>
          </div>
        )}

        {/* Hourly forecast — scrollable */}
        {!compact && nextHours.length > 0 && (
          <div className="mt-3 border-t border-surface-800 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">Hourly</span>
              <div className="flex gap-1">
                <button onClick={() => setHourScrollIdx(Math.max(0, hourScrollIdx - 4))} className="p-0.5 rounded text-surface-500 hover:text-surface-300"><ChevronLeft className="h-3 w-3" /></button>
                <button onClick={() => setHourScrollIdx(Math.min(Math.max(0, nextHours.length - 8), hourScrollIdx + 4))} className="p-0.5 rounded text-surface-500 hover:text-surface-300"><ChevronRight className="h-3 w-3" /></button>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {nextHours.slice(hourScrollIdx, hourScrollIdx + 8).map((h, i) => {
                const hCond = describeWeather(h.code);
                const HIcon = hCond.icon;
                return (
                  <div key={i} className="flex flex-col items-center gap-1 min-w-[52px] rounded-lg bg-surface-800/40 px-2 py-1.5">
                    <span className="text-[9px] font-medium text-surface-400">{h.time}</span>
                    <HIcon className="h-4 w-4 text-accent-strong" />
                    <span className="text-[10px] font-semibold text-surface-200">{Math.round(h.temp)}°</span>
                    {h.precip > 0 && (
                      <span className="flex items-center gap-0.5 text-[8px] text-blue-400">
                        <Droplets className="h-2 w-2" />{h.precip}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 7-day forecast */}
        {daily && daily.time.length > 0 && !compact && (
          <div className="mt-3 border-t border-surface-800 pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">7-Day</span>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {daily.time.slice(0, 7).map((day, i) => {
                const d = describeWeather(daily.weather_code[i] ?? 0);
                const DayIcon = d.icon;
                const date = new Date(day);
                const high = daily.temperature_2m_max[i] ?? 0;
                const low = daily.temperature_2m_min[i] ?? 0;
                const precip = daily.precipitation_probability_max?.[i] ?? 0;
                const uvMax = daily.uv_index_max?.[i] ?? 0;
                return (
                  <div key={day} className="flex flex-col items-center gap-0.5 rounded-lg bg-surface-800/40 px-1 py-1.5">
                    <span className="text-[9px] font-semibold text-surface-400">
                      {i === 0 ? "Today" : WEEKDAYS[date.getDay()]}
                    </span>
                    <DayIcon className="h-3.5 w-3.5 text-accent-strong" />
                    <span className="text-[9px] font-bold text-surface-200">{Math.round(high)}°</span>
                    <span className="text-[8px] text-surface-500">{Math.round(low)}°</span>
                    {precip > 0 && (
                      <span className="text-[7px] text-blue-400">{precip}%</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
