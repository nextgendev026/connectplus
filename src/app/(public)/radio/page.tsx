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
  Wifi,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { STATIONS, RADIO_GENRES, RADIO_COUNTRIES } from "@/lib/radio-stations";
import type { RadioStation } from "@/lib/radio-stations";
import { useRadioPlayer } from "@/components/radio/RadioPlayerContext";
import { RadioPlayerBar } from "@/components/radio/RadioPlayerBar";

function EqualizerBars({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className="flex items-end gap-[2px] h-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-brand-400",
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
          : "border-surface-800/50 bg-surface-900/50 hover:border-surface-700"
      )}
    >
      <div
        className="absolute inset-0 opacity-10"
        style={{
          background: `linear-gradient(135deg, ${station.color}40 0%, transparent 60%)`,
        }}
      />

      <div className="relative p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="relative flex h-12 w-12 items-center justify-center rounded-xl text-xs font-bold text-white"
              style={{ backgroundColor: station.color }}
            >
              {station.icon}
              {isPlaying && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse ring-2 ring-surface-950" />
              )}
            </div>
            <div>
              <h3 className="font-semibold text-surface-50 text-sm">{station.name}</h3>
              <span className="text-xs text-surface-400">{station.genre}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isPlaying && (
              <div className="flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
                  Live
                </span>
              </div>
            )}
            <button
              onClick={() => toggleFavorite(station.id)}
              className="rounded-lg p-1.5 text-surface-500 hover:text-red-400 transition-colors"
              aria-label="Toggle favorite"
            >
              <Heart className={cn("h-4 w-4", isFavorite && "fill-red-400 text-red-400")} />
            </button>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2">
          {isPlaying ? (
            <EqualizerBars isPlaying={true} />
          ) : (
            <Music className="h-4 w-4 text-surface-500" />
          )}
          <div className="min-w-0 flex-1">
            {isPlaying && owner?.nowPlaying.meta && owner.nowPlaying.song ? (
              <>
                <p className="text-xs text-surface-300 truncate">{owner.nowPlaying.song}</p>
                <p className="text-[11px] text-brand-400 truncate">Now playing live</p>
              </>
            ) : isPlaying ? (
              <>
                <p className="text-xs text-brand-300 truncate">{station.tagline}</p>
                <p className="text-[11px] text-surface-500 truncate">Streaming live</p>
              </>
            ) : (
              <>
                <p className="text-xs text-surface-300 truncate">{station.tagline}</p>
                <p className="text-[11px] text-surface-500 truncate">Click to listen</p>
              </>
            )}
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2 text-[11px] text-surface-500">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-800/60 border border-surface-800 px-2 py-0.5">
            <Wifi className="h-3 w-3 text-brand-400" />
            {station.country}
          </span>
          {isActive && owner?.nowPlaying.listeners !== null && owner && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-800/60 border border-surface-800 px-2 py-0.5">
              <Users className="h-3 w-3 text-brand-400" />
              {owner.nowPlaying.listeners!.toLocaleString()} listening
            </span>
          )}
        </div>

        <button
          onClick={() => playStation(station.id)}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-all duration-200",
            isPlaying
              ? "bg-brand-500 text-white shadow-glow"
              : "bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-surface-50"
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

  const currentStation = player.station;
  const nowPlaying = player.nowPlaying;

  const filteredStations = useMemo(
    () =>
      STATIONS.filter((station) => {
        const matchesSearch =
          station.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          station.genre.toLowerCase().includes(searchQuery.toLowerCase()) ||
          station.city.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesGenre =
          activeGenre === "All" ||
          station.genre.toLowerCase().includes(activeGenre.toLowerCase());
        const matchesCountry =
          activeCountry === "All" || station.country === activeCountry;
        return matchesSearch && matchesGenre && matchesCountry;
      }),
    [searchQuery, activeGenre, activeCountry]
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

  return (
    <div className="min-h-screen bg-surface-950 md:pb-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/20">
              <Radio className="h-5 w-5 text-brand-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-50">East African Radio</h1>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs text-surface-400">
                  {STATIONS.length} live stations · Kenya · Uganda · Tanzania · Rwanda
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {RADIO_COUNTRIES.map((country) => (
              <button
                key={country}
                onClick={() => setActiveCountry(country)}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all border",
                  activeCountry === country
                    ? "border-brand-500 bg-brand-500/10 text-brand-400"
                    : "border-surface-800 bg-surface-900/50 text-surface-400 hover:border-surface-700 hover:text-surface-300"
                )}
              >
                {country}
                {country !== "All" && (
                  <span className="ml-1.5 text-surface-600">{stationCounts[country] ?? 0}</span>
                )}
              </button>
            ))}
          </div>
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
                    "flex items-center gap-3 shrink-0 rounded-xl border px-4 py-2.5 transition-all",
                    currentStation?.id === station.id && player.isPlaying
                      ? "border-brand-500/50 bg-brand-500/10"
                      : "border-surface-800 bg-surface-900/50 hover:border-surface-700"
                  )}
                >
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                    style={{ backgroundColor: station.color }}
                  >
                    {station.icon}
                  </div>
                  <span className="text-sm text-surface-300 whitespace-nowrap">{station.name}</span>
                  {currentStation?.id === station.id && player.isPlaying && (
                    <EqualizerBars isPlaying={true} />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-4 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-500" />
          <input
            type="text"
            placeholder="Search stations, cities or genres..."
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

        {/* Genre chips */}
        <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide mb-6">
          {RADIO_GENRES.map((genre) => (
            <button
              key={genre}
              onClick={() => setActiveGenre(genre)}
              className={cn(
                "shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-all border",
                activeGenre === genre
                  ? "border-brand-500 bg-brand-500/10 text-brand-400"
                  : "border-surface-800 bg-surface-900/50 text-surface-400 hover:border-surface-700 hover:text-surface-300"
              )}
            >
              {genre}
            </button>
          ))}
        </div>

        {/* Station grid */}
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
            <p className="text-lg font-medium text-surface-400">No stations found</p>
            <p className="text-sm text-surface-500 mt-1">
              Try a different search or filter
            </p>
          </div>
        )}

        {/* Favorites */}
        {favoriteStations.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <Heart className="h-4 w-4 text-red-400 fill-red-400" />
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
      </div>

      <RadioPlayerBar />
    </div>
  );
}