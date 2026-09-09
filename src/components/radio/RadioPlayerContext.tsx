"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { STATIONS, getStationById } from "@/lib/radio-stations";
import type { RadioStation } from "@/lib/radio-stations";

export type StreamState = "idle" | "connecting" | "playing" | "error";

export interface NowPlaying {
  song: string | null;
  listeners: number | null;
  meta: boolean;
}

interface RadioPlayerContextValue {
  station: RadioStation | null;
  isPlaying: boolean;
  streamState: StreamState;
  volume: number;
  favorites: string[];
  recentlyPlayed: string[];
  nowPlaying: NowPlaying;
  playStation: (stationId: string) => void;
  togglePlay: () => void;
  stop: () => void;
  setVolume: (v: number) => void;
  toggleFavorite: (stationId: string) => void;
  skip: (dir: 1 | -1) => void;
}

const RadioPlayerContext = createContext<RadioPlayerContextValue | null>(null);

function safeGetStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore quota/private-mode errors
  }
}

export function RadioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [station, setStation] = useState<RadioStation | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [volume, setVolumeState] = useState(75);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<string[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>({ song: null, listeners: null, meta: false });

  const volumeRef = useRef(volume);
  const stationRef = useRef(station);
  const pausedByUser = useRef(false);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamFailed = useRef(false);

  useEffect(() => {
    volumeRef.current = volume;
    stationRef.current = station;
  });

  // Indirection so the reconnect callback can reschedule itself without a
  // self-reference (which React Compiler rejects as a forward access).
  const scheduleReconnectRef = useRef<() => void>(() => {});

  // Auto-reconnect with exponential backoff when a live stream drops.
  const scheduleReconnect = useCallback(() => {
    const base = 3000;
    const delay = Math.min(base * 2 ** retryCount.current, 30_000);
    retryCount.current += 1;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      const audio = audioRef.current;
      const current = stationRef.current;
      if (!audio || !current || pausedByUser.current) return;
      setStreamState("connecting");
      streamFailed.current = false;
      audio.play().catch(() => scheduleReconnectRef.current());
    }, delay);
  }, []);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  // Drop pending reconnect work on unmount / manual stop.
  useEffect(() => {
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  // Restore persisted prefs + last station (stay paused until user plays).
  /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from localStorage; runs once on mount, no cascading renders */
  useEffect(() => {
    const vol = safeGetStorage("radio-volume");
    if (vol) {
      const n = Number(vol);
      if (!Number.isNaN(n)) setVolumeState(n);
    }
    const favs = safeGetStorage("radio-favorites");
    if (favs) {
      try {
        setFavorites(JSON.parse(favs));
      } catch {
        // ignore
      }
    }
    const recent = safeGetStorage("radio-recently");
    if (recent) {
      try {
        setRecentlyPlayed(JSON.parse(recent));
      } catch {
        // ignore
      }
    }
    const last = safeGetStorage("radio-station");
    if (last) {
      const st = getStationById(last);
      if (st) {
        setStation(st);
        // Preload the source WITHOUT playing (autoplay is blocked by
        // browsers). Without this the play button ran audio.play() on an
        // empty element → instant error → endless "reconnecting" loop.
        const audio = audioRef.current;
        if (audio && !audio.src) {
          audio.src = `/api/radio/stream?stationId=${encodeURIComponent(st.id)}`;
          audio.volume = volumeRef.current / 100;
        }
      }
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateNowPlaying = useCallback(
    async (stationId: string, force = false) => {
      try {
        const res = await fetch(`/api/radio/status?stationId=${encodeURIComponent(stationId)}${force ? "&force=1" : ""}`, {
          signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) return;
        const data = (await res.json()) as NowPlaying & { song: string | null; listeners: number | null; meta: boolean };
        setNowPlaying({ song: data.song ?? null, listeners: data.listeners ?? null, meta: Boolean(data.meta) });
      } catch {
        // transient fetch failure - keep previous value
      }
    },
    []
  );

  const stop = useCallback(() => {
    setNowPlaying({ song: null, listeners: null, meta: false });
    setStation(null);
    setIsPlaying(false);
    setStreamState("idle");
    // Mark as user-paused so the async error event from clearing the src
    // doesn't flip us into the "reconnecting" state.
    pausedByUser.current = true;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryCount.current = 0;
    streamFailed.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    if (typeof window !== "undefined") window.localStorage.removeItem("radio-station");
  }, []);

  const playStation = useCallback(
    (stationId: string) => {
      const next = getStationById(stationId);
      if (!next) return;
      const audio = audioRef.current;
      if (!audio) return;

      pausedByUser.current = false;

      // Same station already live (playing or still connecting/buffering) →
      // treat the tap as pause so the button never gets stuck on Play.
      if (stationRef.current?.id === stationId && (isPlaying || streamState === "connecting")) {
        audio.pause();
        setIsPlaying(false);
        setStreamState("idle");
        pausedByUser.current = true;
        return;
      }

      setStation(next);
      setStreamState("connecting");
      setNowPlaying({ song: null, listeners: null, meta: false });
      if (typeof window !== "undefined") window.localStorage.setItem("radio-station", next.id);

      const recent = [next.id, ...recentlyPlayed.filter((id) => id !== next.id)].slice(0, 5);
      setRecentlyPlayed(recent);
      safeSetStorage("radio-recently", JSON.stringify(recent));

      retryCount.current = 0;
      streamFailed.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      audio.src = `/api/radio/stream?stationId=${encodeURIComponent(next.id)}`;
      setStreamState("connecting");
      audio.play().catch(() => {
        setStreamState("error");
        setIsPlaying(false);
        streamFailed.current = true;
        scheduleReconnect();
      });
    },
    [isPlaying, streamState, recentlyPlayed, scheduleReconnect]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    const current = stationRef.current;
    if (!audio || !current) return;
    // Make sure the element actually carries the current station's source
    // (covers restore-from-localStorage and any cleared src).
    const expectedPath = `/api/radio/stream?stationId=${encodeURIComponent(current.id)}`;
    if (!audio.src || !audio.src.endsWith(expectedPath)) {
      audio.src = expectedPath;
      audio.volume = volumeRef.current / 100;
    }
    // While the stream is still connecting/buffering the element is paused,
    // so treat that as live too — tapping should pause, not re-play.
    const live = !audio.paused || streamState === "connecting";
    if (live) {
      pausedByUser.current = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      audio.pause();
      setStreamState("idle");
      setIsPlaying(false);
    } else {
      pausedByUser.current = false;
      retryCount.current = 0;
      streamFailed.current = false;
      // A pause on a live stream typically exhausts the proxy's serverless
      // window, so the buffered source is a dead end — re-arm a fresh
      // connection before attempting playback.
      if (audio.src) {
        audio.removeAttribute("src");
        audio.src = expectedPath;
        audio.load();
      }
      setStreamState("connecting");
      audio.play().catch(() => {
        setStreamState("error");
        setIsPlaying(false);
        streamFailed.current = true;
        scheduleReconnect();
      });
    }
  }, [scheduleReconnect, streamState]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    safeSetStorage("radio-volume", String(v));
    if (audioRef.current) audioRef.current.volume = v / 100;
  }, []);

  const toggleFavorite = useCallback(
    (stationId: string) => {
      setFavorites((prev) => {
        const next = prev.includes(stationId) ? prev.filter((id) => id !== stationId) : [...prev, stationId];
        safeSetStorage("radio-favorites", JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const skip = useCallback(
    (dir: 1 | -1) => {
      if (!stationRef.current) return;
      const idx = STATIONS.findIndex((s) => s.id === stationRef.current!.id);
      if (idx === -1) return;
      const next = STATIONS[(idx + dir + STATIONS.length) % STATIONS.length];
      if (next) playStation(next.id);
    },
    [playStation]
  );

  // Realtime metadata polling while a station is active and the tab is visible.
  useEffect(() => {
    if (!station) return;
    let cancelled = false;

    const tick = async (force = false) => {
      if (document.visibilityState === "visible" && !cancelled) {
        await updateNowPlaying(station.id, force);
      }
    };

    tick(true);
    const interval = setInterval(() => tick(false), 20_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        tick(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [station, updateNowPlaying]);

  // Apply volume to the element anytime it changes.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  const value = useMemo(
    () => ({
      station,
      isPlaying,
      streamState,
      volume,
      favorites,
      recentlyPlayed,
      nowPlaying,
      playStation,
      togglePlay,
      stop,
      setVolume,
      toggleFavorite,
      skip,
    }),
    [station, isPlaying, streamState, volume, favorites, recentlyPlayed, nowPlaying, playStation, togglePlay, stop, setVolume, toggleFavorite, skip]
  );

  return (
    <RadioPlayerContext.Provider value={value}>
      {children}
      {/* The audio element lives here, above the page tree, so playback survives route
          changes. Hidden via fixed positioning to avoid layout/display quirks. */}
      <audio
        ref={audioRef}
        preload="none"
        className="fixed top-0 left-0 w-0 h-0 opacity-0 pointer-events-none"
        onPlaying={() => {
          setStreamState("playing");
          setIsPlaying(true);
          pausedByUser.current = false;
          streamFailed.current = false;
          retryCount.current = 0;
        }}
        onWaiting={() => {
          if (!pausedByUser.current && !streamFailed.current) setStreamState("connecting");
        }}
        onStalled={() => {
          if (!pausedByUser.current && !streamFailed.current) setStreamState("connecting");
        }}
        onEnded={() => {
          // Live streams never "end" naturally — this fires when the proxy
          // window closed (serverless timeout) or the upstream dropped.
          // Re-arm the same source and resume without user action.
          if (pausedByUser.current || !stationRef.current) return;
          scheduleReconnect();
        }}
        onError={() => {
          // Ignore errors while stopped/paused (clearing src fires one) or
          // when a reconnect is already scheduled — otherwise the UI shows
          // a fake "Stream reconnecting…" forever.
          if (pausedByUser.current) return;
          setStreamState("error");
          setIsPlaying(false);
          streamFailed.current = true;
          scheduleReconnect();
        }}
      />
    </RadioPlayerContext.Provider>
  );
}

export function useRadioPlayer(): RadioPlayerContextValue {
  const ctx = useContext(RadioPlayerContext);
  if (!ctx) {
    throw new Error("useRadioPlayer must be used within RadioPlayerProvider");
  }
  return ctx;
}