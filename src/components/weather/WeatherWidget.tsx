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
import { useTrackedLocation, setTrackedLocation, getTrackedLocation } from "@/lib/use-location";
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

/** Meteored-style scene gradient for the card background. */
function sceneGradient(animation: string, isDay: boolean): string {
  if (animation === "weather-storm") return "bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950";
  if (animation === "weather-rain" || animation === "weather-drizzle") {
    return isDay
      ? "bg-gradient-to-br from-slate-600 via-slate-700 to-slate-800"
      : "bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950";
  }
  if (animation === "weather-snow") {
    return isDay
      ? "bg-gradient-to-br from-sky-200 via-slate-300 to-slate-400"
      : "bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950";
  }
  if (animation === "weather-fog") return "bg-gradient-to-br from-slate-500 via-slate-600 to-slate-700";
  if (animation === "weather-cloudy") {
    return isDay
      ? "bg-gradient-to-br from-sky-500/90 via-sky-600/90 to-indigo-700/90"
      : "bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950";
  }
  // sunny / clear
  return isDay
    ? "bg-gradient-to-br from-sky-400 via-sky-500 to-indigo-600"
    : "bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950";
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
  /* All animations use inline SVG for realistic, launcher-style weather effects */
  if (animation === "weather-sunny" && isDay) {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <svg className="absolute top-0 right-0 w-32 h-32 opacity-20 weather-sun-rays" viewBox="0 0 120 120">
          <defs>
            <radialGradient id="sun-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.8"/>
              <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.3"/>
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0"/>
            </radialGradient>
          </defs>
          <circle cx="60" cy="60" r="50" fill="url(#sun-glow)"/>
          <circle cx="60" cy="60" r="18" fill="#fbbf24" opacity="0.6"/>
          {[0,45,90,135,180,225,270,315].map(a => (
            <line key={a} x1="60" y1="60" x2={60+28*Math.cos(a*Math.PI/180)} y2={60+28*Math.sin(a*Math.PI/180)}
              stroke="#fbbf24" strokeWidth="1.5" opacity="0.4" strokeLinecap="round"/>
          ))}
        </svg>
      </div>
    );
  }
  if (animation === "weather-sunny" && !isDay) {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <svg className="absolute top-2 right-2 w-20 h-20 opacity-15" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="14" fill="#c4b5fd" opacity="0.5"/>
          <circle cx="50" cy="36" r="16" fill="#ddd6fe" opacity="0.3"/>
          {[0,60,120,180,240,300].map(a => (
            <circle key={a} cx={40+20*Math.cos(a*Math.PI/180)} cy={40+20*Math.sin(a*Math.PI/180)} r="1.5" fill="#e0e7ff" opacity="0.4"/>
          ))}
        </svg>
      </div>
    );
  }
  if (animation === "weather-rain" || animation === "weather-drizzle") {
    const dropCount = animation === "weather-rain" ? 20 : 14;
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Rain clouds SVG */}
        <svg className="absolute -top-4 left-1/2 -translate-x-1/2 w-48 h-16 opacity-20" viewBox="0 0 200 60">
          <ellipse cx="100" cy="30" rx="70" ry="22" fill="#64748b" opacity="0.5"/>
          <ellipse cx="70" cy="28" rx="40" ry="18" fill="#94a3b8" opacity="0.4"/>
          <ellipse cx="130" cy="32" rx="35" ry="16" fill="#94a3b8" opacity="0.35"/>
        </svg>
        {/* Animated rain drops */}
        {[...Array(dropCount)].map((_, i) => (
          <div key={i} className="weather-raindrop absolute opacity-40" style={{ left: `${5 + (i * 95 / dropCount)}%`, animationDelay: `${i * 0.12}s`, animationDuration: `${0.5 + (i % 3) * 0.2}s` }}>
            <svg width="3" height="14" viewBox="0 0 3 14">
              <path d="M1.5 0 Q3 5 1.5 14 Q0 5 1.5 0Z" fill="#60a5fa" opacity="0.6"/>
            </svg>
          </div>
        ))}
        {/* Splash effects at bottom */}
        {[...Array(6)].map((_, i) => (
          <div key={`splash-${i}`} className="absolute bottom-2 opacity-20" style={{ left: `${10 + i * 16}%`, animationDelay: `${0.3 + i * 0.2}s` }}>
            <svg width="8" height="3" viewBox="0 0 8 3"><path d="M0 1.5 Q2 0 4 1.5 Q6 0 8 1.5" fill="none" stroke="#60a5fa" strokeWidth="0.8" opacity="0.5"/></svg>
          </div>
        ))}
      </div>
    );
  }
  if (animation === "weather-snow") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <svg className="absolute -top-2 left-1/2 -translate-x-1/2 w-44 h-14 opacity-15" viewBox="0 0 180 50">
          <ellipse cx="90" cy="25" rx="65" ry="20" fill="#94a3b8" opacity="0.5"/>
          <ellipse cx="60" cy="22" rx="35" ry="15" fill="#cbd5e1" opacity="0.4"/>
        </svg>
        {[...Array(14)].map((_, i) => (
          <div key={i} className="weather-snowflake absolute" style={{ left: `${3 + i * 7}%`, animationDelay: `${i * 0.25}s`, animationDuration: `${2 + (i % 4) * 0.5}s` }}>
            <svg width="6" height="6" viewBox="0 0 6 6" className="opacity-50">
              <circle cx="3" cy="3" r="2.5" fill="white" opacity="0.7"/>
              <circle cx="3" cy="3" r="1" fill="white"/>
            </svg>
          </div>
        ))}
      </div>
    );
  }
  if (animation === "weather-storm") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Dark storm cloud */}
        <svg className="absolute -top-4 left-1/2 -translate-x-1/2 w-52 h-20 opacity-25" viewBox="0 0 220 70">
          <ellipse cx="110" cy="35" rx="80" ry="25" fill="#374151" opacity="0.7"/>
          <ellipse cx="75" cy="30" rx="45" ry="20" fill="#4b5563" opacity="0.6"/>
          <ellipse cx="145" cy="38" rx="40" ry="18" fill="#374151" opacity="0.5"/>
          {/* Lightning bolt */}
          <path d="M105 30 L112 48 L106 48 L115 70" fill="none" stroke="#fbbf24" strokeWidth="2" opacity="0.6" className="weather-lightning"/>
        </svg>
        {[...Array(14)].map((_, i) => (
          <div key={i} className="weather-raindrop absolute opacity-30" style={{ left: `${5 + (i * 90 / 14)}%`, animationDelay: `${i * 0.1}s`, animationDuration: `${0.3 + (i % 3) * 0.15}s` }}>
            <svg width="2" height="16" viewBox="0 0 2 16"><path d="M1 0 Q2 6 1 16 Q0 6 1 0Z" fill="#93c5fd" opacity="0.5"/></svg>
          </div>
        ))}
      </div>
    );
  }
  if (animation === "weather-cloudy") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <svg className="absolute top-1/4 -left-4 w-28 h-12 opacity-12 weather-cloud-drift" viewBox="0 0 120 45">
          <ellipse cx="60" cy="25" rx="50" ry="16" fill="#94a3b8" opacity="0.4"/>
          <ellipse cx="40" cy="22" rx="28" ry="12" fill="#cbd5e1" opacity="0.3"/>
          <ellipse cx="80" cy="28" rx="25" ry="11" fill="#94a3b8" opacity="0.3"/>
        </svg>
        <svg className="absolute top-1/2 -right-6 w-24 h-10 opacity-10 weather-cloud-drift-reverse" viewBox="0 0 100 40" style={{ animationDelay: "3s" }}>
          <ellipse cx="50" cy="20" rx="42" ry="14" fill="#94a3b8" opacity="0.4"/>
          <ellipse cx="35" cy="18" rx="22" ry="10" fill="#cbd5e1" opacity="0.3"/>
        </svg>
      </div>
    );
  }
  if (animation === "weather-fog") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="weather-fog-layer absolute" style={{ top: `${25 + i * 18}%`, left: "-10%", width: "120%" }}>
            <svg width="100%" height="12" viewBox="0 0 400 12" preserveAspectRatio="none">
              <ellipse cx="200" cy="6" rx="200" ry="4" fill="#94a3b8" opacity={0.06 - i * 0.01} />
            </svg>
          </div>
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
  const [dayScrollIdx, setDayScrollIdx] = useState(0);

  // Hardened shared GPS tracking — persists to localStorage and dispatches
  // `connectplus:location` so the home hero chip stays in sync.
  const { location: trackedLoc } = useTrackedLocation({ watch: true });

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
        // Persist to the shared tracker so the home page chip reflects it.
        setTrackedLocation({ lat: geo.lat, lon: geo.lon, accuracy: geo.accuracy, source: "gps", ts: Date.now() });
        const cached = localStorage.getItem("weather-place");
        if (cached) {
          setPlace(cached);
        } else {
          const name = await reverseGeocode(geo.lat, geo.lon);
          if (name) { setPlace(name); try { localStorage.setItem("weather-place", name); } catch {} }
        }
      } else {
        setPlace(data.place ?? null);
      }
    } catch {
      setError("Couldn't load weather. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch when the shared tracker reports a GPS fix (e.g. user taps the
  // hero chip or grants permission elsewhere on the page).
  useEffect(() => {
    if (trackedLoc && trackedLoc.source === "gps" && (coords?.lat !== trackedLoc.lat || coords?.lon !== trackedLoc.lon)) {
      loadWeather({ lat: trackedLoc.lat, lon: trackedLoc.lon, source: "gps", accuracy: trackedLoc.accuracy });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedLoc?.lat, trackedLoc?.lon, trackedLoc?.source]);

  const enableLocation = useCallback(async () => {
    setLocState("prompting");
    const res = await requestGeolocation();
    if (res.status === "granted" && res.coords) {
      try {
        localStorage.setItem("weather-gps", JSON.stringify({ lat: res.coords.lat, lon: res.coords.lon, ts: Date.now() }));
      } catch {}
      setTrackedLocation({ lat: res.coords.lat, lon: res.coords.lon, accuracy: res.coords.accuracy, source: "gps", ts: Date.now() });
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
      setPlace(data.place ?? null);
      if (data.coords) {
        setTrackedLocation({ lat: data.coords.lat, lon: data.coords.lon, source: "ip", place: data.place ?? null, ts: Date.now() });
      }
    } catch {
      setError("Couldn't load weather. Try again.");
    } finally {
      setLoading(false);
    }
  }, [loadWeather]);

  useEffect(() => {
    (async () => {
      // Prefer the shared tracked location (GPS from any component) first.
      const shared = getTrackedLocation();
      if (shared && shared.source === "gps" && Date.now() - shared.ts < 60 * 60_000) {
        await loadWeather({ lat: shared.lat, lon: shared.lon, source: "gps", accuracy: shared.accuracy });
        return;
      }
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
        setPlace(data.place ?? null);
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
    <div className={cn("rounded-2xl border overflow-hidden relative text-white", isDay ? "border-white/20" : "border-white/10")}>
      {/* Meteored-style scene gradient */}
      <div className={cn("absolute inset-0 transition-colors duration-700", cond ? sceneGradient(cond.animation, isDay) : "bg-surface-900")} />
      {/* Weather animation layer (sun rays, drifting clouds, rain, lightning…) */}
      {cond && <WeatherAnimation animation={cond.animation} isDay={isDay} />}
      {/* Frosted content layer so text stays readable over the scene */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-black/25" />

      {/* Header */}
      <div className="relative flex items-start justify-between gap-3 px-4 pt-3.5 pb-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/70">
          <Thermometer className="h-3.5 w-3.5 text-amber-300" />
          Weather
        </div>
        <button
          onClick={enableLocation}
          disabled={locState === "prompting"}
          className={cn(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm transition-all",
            locState === "granted"
              ? "border-emerald-300/40 bg-emerald-500/20 text-emerald-100"
              : "border-white/30 bg-white/10 text-white/90 hover:border-brand-400/60 hover:text-white"
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
                <Icon className={cn("h-11 w-11 drop-shadow-lg", isDay ? "text-amber-300" : "text-indigo-300")} />
              </div>
              <div>
                <p className="text-4xl font-bold text-white leading-none drop-shadow-md">{Math.round(current.temperature_2m)}°</p>
                <p className="mt-1 text-xs text-white/85">{cond.label}</p>
              </div>
            </div>
            <div className="ml-auto flex flex-col gap-1 text-[11px] text-white/85">
              <span className="flex items-center gap-1.5">
                <Thermometer className="h-3 w-3 text-white/60" />
                Feels {Math.round(current.apparent_temperature)}°
              </span>
              <span className="flex items-center gap-1.5">
                <Droplets className="h-3 w-3 text-white/60" />
                {current.relative_humidity_2m}%
              </span>
              <span className="flex items-center gap-1.5">
                <Wind className="h-3 w-3 text-white/60" />
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
          <p className="mt-2 flex items-center gap-1 text-[11px] text-white/75">
            <MapPin className="h-3 w-3 text-amber-300" />
            {place}
          </p>
        )}

        {/* Sunrise / Sunset */}
        {daily && daily.sunrise?.[0] && daily.sunset?.[0] && (
          <div className="mt-2 flex items-center gap-4 text-[10px] text-white/70">
            <span className="flex items-center gap-1">
              <Sunrise className="h-3 w-3 text-amber-300" />
              {new Date(daily.sunrise[0]).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
            </span>
            <span className="flex items-center gap-1">
              <Sunset className="h-3 w-3 text-orange-300" />
              {new Date(daily.sunset[0]).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
            </span>
          </div>
        )}

        {/* Hourly forecast — scrollable */}
        {!compact && nextHours.length > 0 && (
          <div className="mt-3 border-t border-white/15 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Hourly</span>
              <div className="flex gap-1">
                <button onClick={() => setHourScrollIdx(Math.max(0, hourScrollIdx - 4))} className="p-0.5 rounded text-white/60 hover:text-white"><ChevronLeft className="h-3 w-3" /></button>
                <button onClick={() => setHourScrollIdx(Math.min(Math.max(0, nextHours.length - 8), hourScrollIdx + 4))} className="p-0.5 rounded text-white/60 hover:text-white"><ChevronRight className="h-3 w-3" /></button>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {nextHours.slice(hourScrollIdx, hourScrollIdx + 8).map((h, i) => {
                const hCond = describeWeather(h.code);
                const HIcon = hCond.icon;
                return (
                  <div key={i} className="flex flex-col items-center gap-1 min-w-[52px] rounded-lg bg-white/10 backdrop-blur-sm px-2 py-1.5 border border-white/10">
                    <span className="text-[9px] font-medium text-white/70">{h.time}</span>
                    <HIcon className="h-4 w-4 text-white/90" />
                    <span className="text-[10px] font-semibold text-white">{Math.round(h.temp)}°</span>
                    {h.precip > 0 && (
                      <span className="flex items-center gap-0.5 text-[8px] text-sky-200">
                        <Droplets className="h-2 w-2" />{h.precip}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 14-day forecast — meteored style with temp bar + scroll */}
        {daily && daily.time.length > 0 && !compact && (
          <div className="mt-3 border-t border-white/15 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                14-Day Forecast
              </span>
              <div className="flex gap-1">
                <button onClick={() => setDayScrollIdx(Math.max(0, dayScrollIdx - 7))} className="p-0.5 rounded text-white/60 hover:text-white"><ChevronLeft className="h-3 w-3" /></button>
                <button onClick={() => setDayScrollIdx(Math.min(Math.max(0, daily.time.length - 7), dayScrollIdx + 7))} className="p-0.5 rounded text-white/60 hover:text-white"><ChevronRight className="h-3 w-3" /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {daily.time.slice(dayScrollIdx, dayScrollIdx + 7).map((day, i) => {
                const idx = dayScrollIdx + i;
                const d = describeWeather(daily.weather_code[idx] ?? 0);
                const DayIcon = d.icon;
                const date = new Date(day);
                const high = daily.temperature_2m_max[idx] ?? 0;
                const low = daily.temperature_2m_min[idx] ?? 0;
                const precip = daily.precipitation_probability_max?.[idx] ?? 0;
                // Temp range bar (meteored style) — scale against the visible week
                const weekHigh = Math.max(...daily.temperature_2m_max.slice(dayScrollIdx, dayScrollIdx + 7));
                const weekLow = Math.min(...daily.temperature_2m_min.slice(dayScrollIdx, dayScrollIdx + 7));
                const span = Math.max(weekHigh - weekLow, 1);
                const lowPos = ((low - weekLow) / span) * 100;
                const barWidth = Math.max(((high - low) / span) * 100, 12);
                return (
                  <div key={day} className="flex flex-col items-center gap-0.5 rounded-lg bg-white/10 backdrop-blur-sm px-1 py-1.5 border border-white/10">
                    <span className="text-[9px] font-semibold text-white/75">
                      {idx === 0 ? "Today" : WEEKDAYS[date.getDay()]}
                    </span>
                    <DayIcon className="h-3.5 w-3.5 text-white/90" />
                    <span className="text-[9px] font-bold text-white">{Math.round(high)}°</span>
                    <div className="relative h-1 w-full rounded-full bg-white/20">
                      <div
                        className="absolute top-0 h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-400"
                        style={{ left: `${lowPos}%`, width: `${barWidth}%` }}
                      />
                    </div>
                    <span className="text-[8px] text-white/70">{Math.round(low)}°</span>
                    {precip > 0 && (
                      <span className="text-[7px] text-sky-200">{precip}%</span>
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
