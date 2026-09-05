"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Search,
  Heart,
  Radio,
  Music,
  Clock,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RadioStation {
  id: string;
  name: string;
  genre: string;
  streamUrl: string;
  color: string;
  icon: string;
}

interface Track {
  title: string;
  artist: string;
}

const STATIONS: RadioStation[] = [
  {
    id: "capital-fm",
    name: "Capital FM Kenya",
    genre: "Top 40 / Pop",
    streamUrl: "https://stream.capitalfm.co.ke/capital",
    color: "#ef4444",
    icon: "C",
  },
  {
    id: "classic-105",
    name: "Classic 105",
    genre: "Classic Hits",
    streamUrl: "https://stream.classic105.com/classic105",
    color: "#f59e0b",
    icon: "1",
  },
  {
    id: "kiss-fm",
    name: "Kiss FM",
    genre: "Urban / R&B",
    streamUrl: "https://stream.kissfm.co.ke/kiss100",
    color: "#ec4899",
    icon: "K",
  },
  {
    id: "radio-jambo",
    name: "Radio Jambo",
    genre: "Benga / vernacular",
    streamUrl: "https://stream.radijambo.co.ke/jambo",
    color: "#22c55e",
    icon: "J",
  },
  {
    id: "nairobi-radio",
    name: "Nairobi Radio",
    genre: "News / Talk",
    streamUrl: "https://stream.nairaboradio.co.ke/nairaradio",
    color: "#3b82f6",
    icon: "N",
  },
  {
    id: "homeboyz",
    name: "Homeboyz Radio",
    genre: "Hip Hop / Dancehall",
    streamUrl: "https://stream.homeboyz.co.ke/homeboyz",
    color: "#a855f7",
    icon: "H",
  },
  {
    id: "east-fm",
    name: "East FM",
    genre: "Asian / Bollywood",
    streamUrl: "https://stream.eastfm.co.ke/eastfm",
    color: "#06b6d4",
    icon: "E",
  },
  {
    id: "metro-fm",
    name: "Metro FM",
    genre: "Gospel / Contemporary",
    streamUrl: "https://stream.metroradio.co.ke/metro",
    color: "#14b8a6",
    icon: "M",
  },
  {
    id: "family-fm",
    name: "Family FM",
    genre: "Gospel / Family",
    streamUrl: "https://stream.familyfm.co.ke/family",
    color: "#f97316",
    icon: "F",
  },
  {
    id: "ramogi-fm",
    name: "Ramogi FM",
    genre: "Luo / vernacular",
    streamUrl: "https://stream.ramogifm.co.ke/ramogi",
    color: "#84cc16",
    icon: "R",
  },
];

const MOCK_TRACKS: Record<string, Track[]> = {
  "capital-fm": [
    { title: "Anguka Nayo", artist: "Bien" },
    { title: "Lifestyle", artist: "Sauti Sol" },
    { title: "Tuendelee", artist: "Otile Brown" },
    { title: "Sura Yako", artist: "Avny" },
  ],
  "classic-105": [
    { title: "Billie Jean", artist: "Michael Jackson" },
    { title: "Bohemian Rhapsody", artist: "Queen" },
    { title: "Hotel California", artist: "Eagles" },
    { title: "Stairway to Heaven", artist: "Led Zeppelin" },
  ],
  "kiss-fm": [
    { title: "Blinding Lights", artist: "The Weeknd" },
    { title: "Save Your Tears", artist: "The Weeknd" },
    { title: "Essence", artist: "Wizkid ft. Tems" },
    { title: "Dangerous", artist: "Marius Buck" },
  ],
  "radio-jambo": [
    { title: "Sherehe", artist: "Mr. Nice" },
    { title: "Dunda", artist: "Madini Classic" },
    { title: "Kwangwaru", artist: "Harmonize" },
    { title: "Inatoa Inatoa", artist: "Prince Indah" },
  ],
  "nairobi-radio": [
    { title: "The World Today", artist: "Nairobi Radio News" },
    { title: "Business Hour", artist: "Nairobi Radio" },
    { title: "The Conversation", artist: "Nairobi Radio" },
    { title: "Sports Roundup", artist: "Nairobi Radio" },
  ],
  homeboyz: [
    { title: "Turn Up", artist: "NAIROBI" },
    { title: "Murder", artist: "King Kaka" },
    { title: "Kwaheri", artist: "Nviiri the Storyteller" },
    { title: "Pombe Sigara", artist: "Otile Brown" },
  ],
  "east-fm": [
    { title: "Chaiyya Chaiyya", artist: "Sukhwinder Singh" },
    { title: "Kal Ho Naa Ho", artist: "Sonu Nigam" },
    { title: "Tujhe Dekha Toh", artist: "Kumar Sanu" },
    { title: "Kuch Kuch Hota Hai", artist: "Udit Narayan" },
  ],
  "metro-fm": [
    { title: "Nifunje", artist: "Mercy Masika" },
    { title: "Mungu Mkuu", artist: "Israel Mbonyi" },
    { title: "Umebharikiwa", artist: "Christina Shusho" },
    { title: "Wote Wameuzi", artist: "Emmy Kosgei" },
  ],
  "family-fm": [
    { title: "Sina dhambi", artist: "Reuben Kigame" },
    { title: "Mwamba wa Mlima", artist: "Davis Mkali" },
    { title: "Bwana Umenijenga", artist: "Evelyn Wanjiru" },
    { title: "Njia Niyoo", artist: "Jane Mwangi" },
  ],
  "ramogi-fm": [
    { title: "Koth Gi Rello", artist: "Lija Gemini" },
    { title: "Chuth Olo", artist: "Otieno Aloka" },
    { title: "Nyathi Yoyoo", artist: "Onyi Jaramogi" },
    { title: "Luo Unyalo", artist: "Atem Ochieng" },
  ],
};

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
  onPlayPause,
  isFavorite,
  onToggleFavorite,
}: {
  station: RadioStation;
  isPlaying: boolean;
  onPlayPause: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  const tracks = MOCK_TRACKS[station.id] || [];
  const [trackIdx] = useState(() =>
    Math.floor(Math.random() * tracks.length)
  );
  const currentTrack = tracks[trackIdx] || {
    title: "On Air",
    artist: station.name,
  };

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
              className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white"
              style={{ backgroundColor: station.color }}
            >
              {station.icon}
            </div>
            <div>
              <h3 className="font-semibold text-surface-50 text-sm">
                {station.name}
              </h3>
              <span className="text-xs text-surface-400">{station.genre}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isPlaying && (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">
                  Live
                </span>
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className="rounded-lg p-1.5 text-surface-500 hover:text-red-400 transition-colors"
            >
              <Heart
                className={cn("h-4 w-4", isFavorite && "fill-red-400 text-red-400")}
              />
            </button>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2">
          {isPlaying ? (
            <EqualizerBars isPlaying={true} />
          ) : (
            <Music className="h-4 w-4 text-surface-500" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs text-surface-300 truncate">
              {isPlaying ? currentTrack.title : "Click to listen"}
            </p>
            {isPlaying && (
              <p className="text-[11px] text-surface-500 truncate">
                {currentTrack.artist}
              </p>
            )}
          </div>
        </div>

        <button
          onClick={onPlayPause}
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

function PlayerBar({
  currentStation,
  isPlaying,
  onPlayPause,
  onSkip,
  onPrev,
  volume,
  onVolumeChange,
  currentTime,
  duration,
}: {
  currentStation: RadioStation | null;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSkip: () => void;
  onPrev: () => void;
  volume: number;
  onVolumeChange: (v: number) => void;
  currentTime: number;
  duration: number;
}) {
  const [isMuted, setIsMuted] = useState(false);
  const tracks = currentStation ? MOCK_TRACKS[currentStation.id] || [] : [];
  const [trackIdx, setTrackIdx] = useState(0);

  useEffect(() => {
    if (currentStation) {
      setTrackIdx(Math.floor(Math.random() * (tracks.length || 1)));
    }
  }, [currentStation?.id]);

  const currentTrack = tracks[trackIdx] || {
    title: "On Air",
    artist: currentStation?.name || "",
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!currentStation) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-surface-800/50 bg-surface-950/95 backdrop-blur-xl safe-area-pb">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-center gap-4 h-20">
          <div className="flex items-center gap-3 min-w-0 flex-1 md:flex-none md:w-64">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white"
              style={{ backgroundColor: currentStation.color }}
            >
              {currentStation.icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-surface-50 truncate">
                {currentStation.name}
              </p>
              <div className="overflow-hidden">
                <p className="text-xs text-surface-400 truncate animate-marquee">
                  {currentTrack.title} — {currentTrack.artist}
                </p>
              </div>
            </div>
          </div>

          <div className="hidden md:flex flex-col items-center gap-1 flex-1 max-w-md">
            <div className="flex items-center gap-3">
              <button
                onClick={onPrev}
                className="rounded-full p-1.5 text-surface-400 hover:text-surface-50 transition-colors"
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                onClick={onPlayPause}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black hover:scale-105 transition-transform"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4 ml-0.5" />
                )}
              </button>
              <button
                onClick={onSkip}
                className="rounded-full p-1.5 text-surface-400 hover:text-surface-50 transition-colors"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 w-full">
              <span className="text-[10px] text-surface-500 w-8 text-right">
                {formatTime(currentTime)}
              </span>
              <div className="relative flex-1 h-1 bg-surface-800 rounded-full overflow-hidden group cursor-pointer">
                <div
                  className="absolute inset-y-0 left-0 bg-brand-500 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ left: `calc(${progress}% - 6px)` }}
                />
              </div>
              <span className="text-[10px] text-surface-500 w-8">
                {formatTime(duration)}
              </span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 w-32">
            <button
              onClick={() => {
                setIsMuted(!isMuted);
                onVolumeChange(isMuted ? volume : 0);
              }}
              className="rounded-full p-1.5 text-surface-400 hover:text-surface-50 transition-colors"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                onVolumeChange(v);
                setIsMuted(v === 0);
              }}
              className="w-full accent-brand-500 h-1"
            />
          </div>

          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={onPlayPause}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black"
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5 ml-0.5" />
              )}
            </button>
          </div>
        </div>

        <div className="md:hidden pb-1">
          <div className="relative h-0.5 bg-surface-800 rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-brand-500 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const GENRES = [
  "All",
  "Top 40 / Pop",
  "Classic Hits",
  "Urban / R&B",
  "Benga / vernacular",
  "News / Talk",
  "Hip Hop / Dancehall",
  "Asian / Bollywood",
  "Gospel",
  "Luo / vernacular",
];

export default function RadioPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState("All");
  const [currentStationId, setCurrentStationId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<string[]>([]);
  const [volume, setVolume] = useState(75);
  const [currentTime, setCurrentTime] = useState(0);
  const [streamState, setStreamState] = useState<
    "idle" | "connecting" | "playing" | "error"
  >("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("radio-favorites");
    if (stored) setFavorites(JSON.parse(stored));
    const recent = localStorage.getItem("radio-recently-played");
    if (recent) setRecentlyPlayed(JSON.parse(recent));
  }, []);

  const saveFavorites = useCallback((favs: string[]) => {
    setFavorites(favs);
    localStorage.setItem("radio-favorites", JSON.stringify(favs));
  }, []);

  const saveRecentlyPlayed = useCallback((recent: string[]) => {
    setRecentlyPlayed(recent);
    localStorage.setItem("radio-recently-played", JSON.stringify(recent));
  }, []);

  const toggleFavorite = useCallback(
    (stationId: string) => {
      const next = favorites.includes(stationId)
        ? favorites.filter((id) => id !== stationId)
        : [...favorites, stationId];
      saveFavorites(next);
    },
    [favorites, saveFavorites]
  );

  const currentStation = STATIONS.find((s) => s.id === currentStationId) || null;

  const stopProgressTimer = useCallback(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
  }, []);

  const startProgressTimer = useCallback(() => {
    stopProgressTimer();
    progressInterval.current = setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + 1;
        if (next >= 300) {
          return 0;
        }
        return next;
      });
    }, 1000);
  }, [stopProgressTimer]);

  const playStation = useCallback(
    (stationId: string) => {
      const station = STATIONS.find((s) => s.id === stationId);
      if (!station) return;

      if (currentStationId === stationId && isPlaying) {
        setIsPlaying(false);
        stopProgressTimer();
        if (audioRef.current) {
          audioRef.current.pause();
        }
        return;
      }

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      setCurrentStationId(stationId);
      setIsPlaying(true);
      setCurrentTime(0);
      setStreamState("connecting");

      const recent = [stationId, ...recentlyPlayed.filter((id) => id !== stationId)].slice(0, 5);
      saveRecentlyPlayed(recent);

      const audio = new Audio();
      audio.crossOrigin = "anonymous";
      audio.volume = volume / 100;

      const timeout = setTimeout(() => {
        if (streamState === "connecting") {
          setStreamState("error");
          setIsPlaying(false);
          startProgressTimer();
        }
      }, 8000);

      audio.onplaying = () => {
        clearTimeout(timeout);
        setStreamState("playing");
        startProgressTimer();
      };

      audio.onerror = () => {
        clearTimeout(timeout);
        setStreamState("error");
        setIsPlaying(false);
        startProgressTimer();
      };

      audio.onwaiting = () => {
        setStreamState("connecting");
      };

      audio.src = station.streamUrl;
      audio.play().catch(() => {
        clearTimeout(timeout);
        setStreamState("error");
        startProgressTimer();
      });

      audioRef.current = audio;
    },
    [
      currentStationId,
      isPlaying,
      volume,
      recentlyPlayed,
      saveRecentlyPlayed,
      startProgressTimer,
      stopProgressTimer,
      streamState,
    ]
  );

  useEffect(() => {
    return () => {
      stopProgressTimer();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [stopProgressTimer]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  const handlePlayPause = useCallback(() => {
    if (!currentStationId) return;
    playStation(currentStationId);
  }, [currentStationId, playStation]);

  const handleSkip = useCallback(() => {
    if (!currentStationId) return;
    const idx = STATIONS.findIndex((s) => s.id === currentStationId);
    const next = STATIONS[(idx + 1) % STATIONS.length];
    if (next) playStation(next.id);
  }, [currentStationId, playStation]);

  const handlePrev = useCallback(() => {
    if (!currentStationId) return;
    const idx = STATIONS.findIndex((s) => s.id === currentStationId);
    const prev = STATIONS[(idx - 1 + STATIONS.length) % STATIONS.length];
    if (prev) playStation(prev.id);
  }, [currentStationId, playStation]);

  const filteredStations = STATIONS.filter((station) => {
    const matchesSearch =
      station.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      station.genre.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGenre =
      activeGenre === "All" ||
      station.genre.toLowerCase().includes(activeGenre.toLowerCase());
    return matchesSearch && matchesGenre;
  });

  const recentStations = recentlyPlayed
    .map((id) => STATIONS.find((s) => s.id === id))
    .filter(Boolean) as RadioStation[];

  return (
    <div className="min-h-screen bg-surface-950 pb-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/20">
              <Radio className="h-5 w-5 text-brand-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-50">Kenyan Radio</h1>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs text-surface-400">
                  Live streams from Kenya
                </span>
              </div>
            </div>
          </div>
        </div>

        {recentStations.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-surface-500" />
              <h2 className="text-sm font-medium text-surface-400">
                Recently Played
              </h2>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
              {recentStations.map((station) => (
                <button
                  key={station.id}
                  onClick={() => playStation(station.id)}
                  className={cn(
                    "flex items-center gap-3 shrink-0 rounded-xl border px-4 py-2.5 transition-all",
                    currentStationId === station.id && isPlaying
                      ? "border-brand-500/50 bg-brand-500/10"
                      : "border-surface-800 bg-surface-900/50 hover:border-surface-700"
                  )}
                >
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
                    style={{ backgroundColor: station.color }}
                  >
                    {station.icon}
                  </div>
                  <span className="text-sm text-surface-300 whitespace-nowrap">
                    {station.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-surface-500" />
            <input
              type="text"
              placeholder="Search stations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-surface-800 bg-surface-900/50 pl-10 pr-4 py-2.5 text-sm text-surface-50 placeholder-surface-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-50"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide mb-6">
          {GENRES.map((genre) => (
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

        {streamState === "error" && currentStation && (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20">
              <Radio className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-amber-400">
                Stream connecting...
              </p>
              <p className="text-xs text-surface-400">
                {currentStation.name} is buffering. Playing simulated audio.
              </p>
            </div>
          </div>
        )}

        {streamState === "connecting" && currentStation && (
          <div className="mb-6 rounded-xl border border-brand-500/30 bg-brand-500/10 p-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/20">
              <div className="h-4 w-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
            </div>
            <div>
              <p className="text-sm font-medium text-brand-400">
                Connecting to {currentStation.name}...
              </p>
              <p className="text-xs text-surface-400">
                Establishing stream connection
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredStations.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              isPlaying={currentStationId === station.id && isPlaying}
              onPlayPause={() => playStation(station.id)}
              isFavorite={favorites.includes(station.id)}
              onToggleFavorite={() => toggleFavorite(station.id)}
            />
          ))}
        </div>

        {filteredStations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Radio className="h-12 w-12 text-surface-700 mb-4" />
            <p className="text-lg font-medium text-surface-400">
              No stations found
            </p>
            <p className="text-sm text-surface-500 mt-1">
              Try a different search or genre filter
            </p>
          </div>
        )}

        {favorites.length > 0 && (
          <div className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <Heart className="h-4 w-4 text-red-400 fill-red-400" />
              <h2 className="text-sm font-medium text-surface-400">
                Your Favorites
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {favorites
                .map((id) => STATIONS.find((s) => s.id === id))
                .filter(Boolean)
                .map((station) => (
                  <StationCard
                    key={station!.id}
                    station={station!}
                    isPlaying={currentStationId === station!.id && isPlaying}
                    onPlayPause={() => playStation(station!.id)}
                    isFavorite={true}
                    onToggleFavorite={() => toggleFavorite(station!.id)}
                  />
                ))}
            </div>
          </div>
        )}
      </div>

      <PlayerBar
        currentStation={currentStation}
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onSkip={handleSkip}
        onPrev={handlePrev}
        volume={volume}
        onVolumeChange={setVolume}
        currentTime={currentTime}
        duration={300}
      />
    </div>
  );
}
