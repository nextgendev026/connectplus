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
import { STATIONS, getStationById, stationSources } from "@/lib/radio-stations";
import type { RadioStation } from "@/lib/radio-stations";

export type StreamState = "idle" | "connecting" | "playing" | "error";

export interface NowPlaying {
  song: string | null;
  listeners: number | null;
  meta: boolean;
}

/** Live signal chain readout — which channel is tuned and at what quality. */
export interface SignalState {
  source: number;
  channels: number;
  bitrateKbps: number | null;
  channelName: string | null;
  probed: boolean;
}

interface RadioPlayerContextValue {
  station: RadioStation | null;
  isPlaying: boolean;
  streamState: StreamState;
  volume: number;
  favorites: string[];
  recentlyPlayed: string[];
  nowPlaying: NowPlaying;
  signal: SignalState;
  playStation: (stationId: string, source?: number) => void;
  playSource: (source: number) => void;
  togglePlay: () => void;
  stop: () => void;
  setVolume: (v: number) => void;
  toggleFavorite: (stationId: string) => void;
  skip: (dir: 1 | -1) => void;
}

function proxyUrl(stationId: string, source: number): string {
  return `/api/radio/stream?stationId=${encodeURIComponent(stationId)}&source=${source}`;
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
  const [signal, setSignal] = useState<SignalState>({ source: 0, channels: 1, bitrateKbps: null, channelName: null, probed: false });

  const volumeRef = useRef(volume);
  const stationRef = useRef(station);
  const pausedByUser = useRef(false);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamFailed = useRef(false);
  const sourceRef = useRef(0);

  useEffect(() => {
    volumeRef.current = volume;
    stationRef.current = station;
  });

  // Indirection so the reconnect callback can reschedule itself without a
  // self-reference (which React Compiler rejects as a forward access).
  const scheduleReconnectRef = useRef<() => void>(() => {});
  // Same indirection for channel failover: the tune callback steps to the
  // next channel on error without referencing itself.
  const tuneSourceRef = useRef<(station: RadioStation, source: number) => void>(() => {});

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
      // Re-arm from the head of the failover chain so a recovered primary
      // channel is picked up again instead of camping on a backup.
      sourceRef.current = 0;
      audio.src = proxyUrl(current.id, 0);
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
          audio.src = proxyUrl(st.id, 0);
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
    setSignal({ source: 0, channels: 1, bitrateKbps: null, channelName: null, probed: false });
    sourceRef.current = 0;
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

  // Walk the station's channels in the background and surface the signal
  // readout (bitrate, upstream name, best channel). Never blocks playback.
  const probeSignal = useCallback(async (stationId: string, channels: number) => {
    try {
      const res = await fetch(`/api/radio/probe?stationId=${encodeURIComponent(stationId)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        best: number;
        channels: Array<{ index: number; ok: boolean; bitrateKbps: number | null; stationName: string | null }>;
      };
      const best = data.channels?.[data.best];
      setSignal({
        source: data.best ?? 0,
        channels,
        bitrateKbps: best?.bitrateKbps ?? null,
        channelName: best?.stationName ?? null,
        probed: true,
      });
    } catch {
      // probe is progressive enhancement — playback never depends on it
    }
  }, []);

  const tuneSource = useCallback(
    (next: RadioStation, source: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const channels = stationSources(next).length;
      sourceRef.current = source;
      setSignal((prev) => ({ ...prev, source, channels, probed: false }));
      retryCount.current = 0;
      streamFailed.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      audio.src = proxyUrl(next.id, source);
      audio.volume = volumeRef.current / 100;
      setStreamState("connecting");
      audio.play().catch(() => {
        // Channel failed — step to the next channel in the chain instead of
        // dying. Only when every channel fails do we surface the error.
        const following = source + 1;
        if (following < channels) {
          tuneSourceRef.current(next, following);
        } else {
          setStreamState("error");
          setIsPlaying(false);
          streamFailed.current = true;
          scheduleReconnect();
        }
      });
      void probeSignal(next.id, channels);
    },
    [probeSignal, scheduleReconnect]
  );

  const playStation = useCallback(
    (stationId: string, source?: number) => {
      const next = getStationById(stationId);
      if (!next) return;
      const audio = audioRef.current;
      if (!audio) return;

      pausedByUser.current = false;

      // Same station already live (playing or still connecting/buffering) →
      // treat the tap as pause so the button never gets stuck on Play.
      if (stationRef.current?.id === stationId && (isPlaying || streamState === "connecting") && source === undefined) {
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

      tuneSource(next, source ?? 0);
    },
    [isPlaying, streamState, recentlyPlayed, tuneSource]
  );

  // Manually tune a specific channel (signal panel / retry button).
  const playSource = useCallback(
    (source: number) => {
      const current = stationRef.current;
      if (!current) return;
      const channels = stationSources(current).length;
      if (source < 0 || source >= channels) return;
      pausedByUser.current = false;
      setStreamState("connecting");
      tuneSource(current, source);
    },
    [tuneSource]
  );

  useEffect(() => {
    tuneSourceRef.current = tuneSource;
  }, [tuneSource]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    const current = stationRef.current;
    if (!audio || !current) return;
    // Make sure the element actually carries the current station's source
    // (covers restore-from-localStorage and any cleared src).
    const expectedPath = proxyUrl(current.id, sourceRef.current);
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

  // Lock-screen / OS media controls carry the live station + song, so the
  // stream behaves like a real radio channel on mobile.
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
    if (!station) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: nowPlaying.meta && nowPlaying.song ? nowPlaying.song : station.name,
        artist: station.tagline,
        album: `${station.city} · ${station.frequency}`,
      });
      navigator.mediaSession.setActionHandler("play", () => togglePlay());
      navigator.mediaSession.setActionHandler("pause", () => togglePlay());
      navigator.mediaSession.setActionHandler("previoustrack", () => skip(-1));
      navigator.mediaSession.setActionHandler("nexttrack", () => skip(1));
    } catch {
      // MediaSession is progressive enhancement
    }
  }, [station, nowPlaying, togglePlay, skip]);

  const value = useMemo(
    () => ({
      station,
      isPlaying,
      streamState,
      volume,
      favorites,
      recentlyPlayed,
      nowPlaying,
      signal,
      playStation,
      playSource,
      togglePlay,
      stop,
      setVolume,
      toggleFavorite,
      skip,
    }),
    [station, isPlaying, streamState, volume, favorites, recentlyPlayed, nowPlaying, signal, playStation, playSource, togglePlay, stop, setVolume, toggleFavorite, skip]
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