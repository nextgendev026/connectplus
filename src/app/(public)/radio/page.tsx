"use client";

import { useMemo, useState } from "react";
import {
  Play,
  Pause,
  Search,
  Heart,
  Radio,
  Music,
  Clock,
  X,
  Users,
  MapPin,
  Globe,
  Mic2,
  CalendarClock,
  Headphones,
  Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STATIONS, RADIO_GENRES, RADIO_COUNTRIES, STATION_REGIONS } from "@/lib/radio-stations";
import type { RadioStation } from "@/lib/radio-stations";
import { useRadioPlayer } from "@/components/radio/RadioPlayerContext";
import { RadioPlayerBar } from "@/components/radio/RadioPlayerBar";
import { StationThumb } from "@/components/radio/StationThumb";
import { WeatherWidget } from "@/components/weather/WeatherWidget";

function EqualizerBars({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className="flex items-end gap-[2px] h-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-accent-strong",
            isPlaying ? "animate-equalizer" : "h-1"
          )}
          style={{
            animationDelay: `${i * 0.15}s`,
            height: isPlaying ? undefined : "4px",
          }}
        />
      ))}
    </div>
  );
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 border border-red-500/30 px-2.5 py-1">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
      <span className="text-[10px] font-bold text-danger-strong uppercase tracking-wider">Live</span>
    </span>
  );
}

function StationCard({
  station,
  isPlaying,
  isActive,
  owner,
}: {
  station: RadioStation;
  isPlaying: boolean;
  isActive: boolean;
  owner?: { nowPlaying: { song: string | null; meta: boolean; listeners: number | null }; streamState: string };
}) {
  const { playStation, toggleFavorite, favorites } = useRadioPlayer();
  const isFavorite = favorites.includes(station.id);

  return (
    <div
      className={cn(
        "group relative rounded-2xl border backdrop-blur-xl transition-all duration-300 overflow-hidden",
        isPlaying
          ? "border-brand-500/50 bg-surface-900/80 shadow-glow"
          : "border-surface-800/50 bg-surface-900/50 hover:border-surface-700 hover:shadow-card-hover"
      )}
    >
      <div className="relative p-4">
        <div className="flex items-start gap-3">
          <StationThumb station={station} size="lg" className="ring-2 ring-white/5" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate font-semibold text-surface-50 text-sm">{station.name}</h3>
              <button
                onClick={() => toggleFavorite(station.id)}
                className="shrink-0 rounded-lg p-1 text-surface-500 hover:text-red-500 transition-colors"
                aria-label="Toggle favorite"
              >
                <Heart className={cn("h-4 w-4", isFavorite && "fill-red-500 text-red-500")} />
              </button>
            </div>
            <p className="truncate text-xs text-surface-400">{station.genre}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-surface-500">
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-3 w-3" />
                {station.city}, {station.country}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <Globe className="h-3 w-3" />
                {station.language}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <Mic2 className="h-3 w-3" />
                {station.frequency}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {isPlaying ? (
            <EqualizerBars isPlaying={true} />
          ) : (
            <Music className="h-4 w-4 text-surface-500" />
          )}
          <div className="min-w-0 flex-1">
            {isPlaying && owner?.nowPlaying.meta && owner.nowPlaying.song ? (
              <p className="truncate text-xs text-surface-200">{owner.nowPlaying.song}</p>
            ) : (
              <p className="truncate text-xs text-surface-300">{station.tagline}</p>
            )}
          </div>
          {isPlaying && (
            <span className="shrink-0">
              <LiveBadge />
            </span>
          )}
        </div>

        {station.programming.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {station.programming.slice(0, 3).map((p) => (
              <span
                key={p}
                className="rounded-full bg-surface-800/60 border border-surface-800 px-2 py-0.5 text-[9px] font-medium text-surface-300"
              >
                {p}
              </span>
            ))}
          </div>
        )}

        {isActive && owner?.nowPlaying.listeners !== null && owner && (
          <p className="mt-2 flex items-center gap-1 text-[10px] text-surface-500">
            <Users className="h-3 w-3 text-accent-strong" />
            {owner.nowPlaying.listeners!.toLocaleString()} listening now
          </p>
        )}

        <button
          onClick={() => playStation(station.id)}
          className={cn(
            "mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all duration-200",
            isPlaying
              ? "bg-brand-500 text-white shadow-glow"
              : "bg-surface-800 text-surface-200 hover:bg-brand-500/15 hover:text-accent-strong hover:border hover:border-brand-500/30"
          )}
        >
          {isPlaying ? (
            <>
              <Pause className="h-4 w-4" />
              Pause
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Listen Now
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function RadioPage() {
  const player = useRadioPlayer();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState<string>("All");
  const [activeCountry, setActiveCountry] = useState<string>("All");
  const [activeRegion, setActiveRegion] = useState<string>("All");

  const currentStation = player.station;
  const nowPlaying = player.nowPlaying;

  const filteredStations = useMemo(
    () =>
      STATIONS.filter((station) => {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          !q ||
          station.name.toLowerCase().includes(q) ||
          station.genre.toLowerCase().includes(q) ||
          station.city.toLowerCase().includes(q) ||
          station.language.toLowerCase().includes(q) ||
          station.region.toLowerCase().includes(q);
        const matchesGenre = activeGenre === "All" || station.genre.toLowerCase().includes(activeGenre.toLowerCase());
        const matchesCountry = activeCountry === "All" || station.country === activeCountry;
        const matchesRegion = activeRegion === "All" || station.region === activeRegion;
        return matchesSearch && matchesGenre && matchesCountry && matchesRegion;
      }),
    [searchQuery, activeGenre, activeCountry, activeRegion]
  );

  const recentStations = player.recentlyPlayed
    .map((id) => STATIONS.find((s) => s.id === id))
    .filter((s): s is RadioStation => Boolean(s));

  const favoriteStations = player.favorites
    .map((id) => STATIONS.find((s) => s.id === id))
    .filter((s): s is RadioStation => Boolean(s));

  const stationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of STATIONS) counts[s.country] = (counts[s.country] ?? 0) + 1;
    return counts;
  }, []);

  const featured = (favoriteStations[0] ?? STATIONS[0])!;
  const featuredActive = currentStation?.id === featured.id;
  const genresCount = useMemo(() => new Set(STATIONS.map((s) => s.genre)).size, []);

  return (
    <div className="min-h-screen bg-surface-950 md:pb-24 scroll-smooth">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/15 border border-brand-500/25">
              <Radio className="h-5 w-5 text-accent-strong" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-50">East African Radio</h1>
              <p className="text-xs text-surface-400">
                Live stations from Kenya, Uganda, Tanzania & Rwanda
              </p>
            </div>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-3 gap-2 sm:max-w-md">
            {[
              { label: "Stations", value: STATIONS.length },
              { label: "Countries", value: RADIO_COUNTRIES.length - 1 },
              { label: "Genres", value: genresCount },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-surface-800 bg-surface-900/50 px-3 py-2 text-center">
                <p className="text-lg font-bold text-surface-50 leading-none">{s.value}</p>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-surface-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Hero: featured station + weather */}
        <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div
            className="relative overflow-hidden rounded-2xl border border-surface-800/60 p-5 lg:col-span-2"
            style={{
              background:
                "radial-gradient(ellipse 70% 60% at 20% 0%, rgba(255,107,0,0.16), transparent 60%), radial-gradient(ellipse 50% 50% at 90% 90%, rgba(255,138,51,0.08), transparent 55%)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-4">
                <StationThumb station={featured} size="lg" className="h-20 w-20 rounded-2xl text-xl" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-lg font-bold text-surface-50">{featured.name}</h2>
                    {featured.verified && (
                      <span className="rounded-full bg-brand-500/15 border border-brand-500/30 px-2 py-0.5 text-[9px] font-bold text-accent-strong uppercase tracking-wider">
                        Verified
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-surface-400">{featured.tagline}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-surface-500">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {featured.city}, {featured.country}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Mic2 className="h-3 w-3" /> {featured.frequency}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Languages className="h-3 w-3" /> {featured.language}
                    </span>
                  </div>
                </div>
              </div>
              {featuredActive && player.isPlaying && <LiveBadge />}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => player.playStation(featured.id)}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all",
                  featuredActive && player.isPlaying
                    ? "bg-surface-800 text-surface-100 hover:bg-surface-700"
                    : "btn-gradient text-white shadow-glow"
                )}
              >
                {featuredActive && player.isPlaying ? (
                  <>
                    <Pause className="h-4 w-4" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> {featuredActive ? "Resume" : "Play"} {featured.name}
                  </>
                )}
              </button>
              <div className="flex items-center gap-2 text-xs text-surface-400">
                {featuredActive && player.nowPlaying.meta && player.nowPlaying.song ? (
                  <>
                    <Music className="h-3.5 w-3.5 text-accent-strong" />
                    <span className="max-w-[220px] truncate text-surface-200">{player.nowPlaying.song}</span>
                  </>
                ) : (
                  <>
                    <Headphones className="h-3.5 w-3.5" />
                    Free · No sign-up · Real-time metadata
                  </>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {featured.programming.slice(0, 4).map((p) => (
                <span key={p} className="inline-flex items-center gap-1 rounded-full bg-surface-800/70 border border-surface-800 px-2.5 py-0.5 text-[10px] font-medium text-surface-300">
                  <CalendarClock className="h-3 w-3 text-accent-strong" />
                  {p}
                </span>
              ))}
            </div>
          </div>

          <WeatherWidget />
        </div>

        {/* Recently played */}
        {recentStations.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-surface-500" />
              <h2 className="text-sm font-medium text-surface-400">Recently Played</h2>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {recentStations.map((station) => (
                <button
                  key={station.id}
                  onClick={() => player.playStation(station.id)}
                  className={cn(
                    "flex items-center gap-3 shrink-0 rounded-xl border px-3 py-2 transition-all",
                    currentStation?.id === station.id && player.isPlaying
                      ? "border-brand-500/50 bg-brand-500/10"
                      : "border-surface-800 bg-surface-900/50 hover:border-surface-700"
                  )}
                >
                  <StationThumb station={station} size="sm" />
                  <span className="text-sm text-surface-200 whitespace-nowrap">{station.name}</span>
                  {currentStation?.id === station.id && player.isPlaying && <EqualizerBars isPlaying={true} />}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-5 space-y-3">
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-500" />
            <input
              type="text"
              placeholder="Search stations, cities, languages or genres..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-surface-800 bg-surface-900/50 pl-10 pr-8 py-2.5 text-sm text-surface-50 placeholder-surface-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-50"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {RADIO_COUNTRIES.map((country) => (
              <button
                key={country}
                onClick={() => setActiveCountry(country)}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all border",
                  activeCountry === country
                    ? "border-brand-500 bg-brand-500/10 text-accent-strong"
                    : "border-surface-800 bg-surface-900/50 text-surface-400 hover:border-surface-700 hover:text-surface-200"
                )}
              >
                {country}
                {country !== "All" && <span className="ml-1.5 text-surface-500">{stationCounts[country] ?? 0}</span>}
              </button>
            ))}
            <select
              value={activeRegion}
              onChange={(e) => setActiveRegion(e.target.value)}
              className="shrink-0 rounded-full border border-surface-800 bg-surface-900/50 px-3 py-1.5 text-xs font-medium text-surface-300 outline-none focus:border-brand-500/50"
              aria-label="Filter by region"
            >
              {STATION_REGIONS.map((region) => (
                <option key={region} value={region}>
                  {region === "All" ? "All regions" : region}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {RADIO_GENRES.map((genre) => (
              <button
                key={genre}
                onClick={() => setActiveGenre(genre)}
                className={cn(
                  "shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-all border",
                  activeGenre === genre
                    ? "border-brand-500 bg-brand-500/10 text-accent-strong"
                    : "border-surface-800 bg-surface-900/50 text-surface-400 hover:border-surface-700 hover:text-surface-200"
                )}
              >
                {genre}
              </button>
            ))}
          </div>
        </div>

        {/* Station grid */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-300">
            {filteredStations.length} station{filteredStations.length === 1 ? "" : "s"}
            {activeCountry !== "All" ? ` in ${activeCountry}` : ""}
          </h2>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-surface-500">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            All streams live
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredStations.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              isPlaying={currentStation?.id === station.id && player.isPlaying}
              isActive={currentStation?.id === station.id}
              owner={
                currentStation?.id === station.id
                  ? { nowPlaying, streamState: player.streamState }
                  : undefined
              }
            />
          ))}
        </div>

        {filteredStations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Radio className="h-12 w-12 text-surface-700 mb-4" />
            <p className="text-lg font-medium text-surface-300">No stations found</p>
            <p className="text-sm text-surface-500 mt-1">Try a different search or filter</p>
          </div>
        )}

        {/* Favorites */}
        {favoriteStations.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <Heart className="h-4 w-4 text-red-500 fill-red-500" />
              <h2 className="text-sm font-medium text-surface-400">Your Favorites</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {favoriteStations.map((station) => (
                <StationCard
                  key={station.id}
                  station={station}
                  isPlaying={currentStation?.id === station.id && player.isPlaying}
                  isActive={currentStation?.id === station.id}
                  owner={
                    currentStation?.id === station.id
                      ? { nowPlaying, streamState: player.streamState }
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Why regional radio */}
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              icon: Languages,
              title: "Listen in your language",
              body: "Swahili, Kikuyu, Luganda, Sheng, Kinyarwanda and more — regional stations broadcast the voices you grew up with.",
            },
            {
              icon: Mic2,
              title: "Local news & culture",
              body: "From Arusha mornings to Kampala nights, get news, music and talk that mainstream global streams miss.",
            },
            {
              icon: Headphones,
              title: "Real-time, anywhere",
              body: "Streams play through our proxy with auto-reconnect and live now-playing metadata — right in your browser.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-surface-800/60 bg-surface-900/40 p-5">
              <f.icon className="h-6 w-6 text-accent-strong mb-2" />
              <h3 className="text-sm font-semibold text-surface-100">{f.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-surface-400">{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      <RadioPlayerBar />
    </div>
  );
}