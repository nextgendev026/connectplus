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
import {
  STATIONS,
  canPlayDirect,
  getStationById,
  preferredSourceIndex,
  sourceAdRisk,
  stationSources,
} from "@/lib/radio-stations";
import type { RadioStation } from "@/lib/radio-stations";
import { reconnectDelayMs, shouldRetry } from "@/lib/radio-reconnect";

export type StreamState =
  | "idle"
  | "connecting"
  | "playing"
  /** A failure we are still working on. The UI may say "reconnecting". */
  | "error"
  /**
   * A failure we have stopped working on.
   *
   * Separate from `error` because the two demand opposite things of the
   * listener. `error` means a retry is already in flight and there is nothing to
   * do but wait; `failed` means nothing is happening and nothing will, until
   * they act. Before this existed the UI said "Reconnecting…" for both — which is
   * a lie in the second case, and the reason a dead station could sit there
   * claiming to reconnect forever while the platform quietly re-opened a session
   * against a third party every sixty seconds.
   */
  | "failed";

/**
 * How the current channel reaches the browser.
 *
 * `direct` is the station's own mount handed straight to the audio element:
 * the listener gets the bitrate the station actually serves, and the station —
 * or an ad-inserting relay in front of it — geolocates the listener rather than
 * this app's function region. `proxy` is our same-origin relay, which is what
 * makes http-only mounts playable from an https page at all, and is the
 * automatic fallback whenever a direct channel will not open.
 */
export type StreamTransport = "direct" | "proxy";

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
  /** Which route the audio is taking right now. */
  transport: StreamTransport;
  /**
   * Whether this channel COULD be direct (it is https). When `transport` is
   * `proxy` and this is true, the fallback is why; when it is false the mount is
   * http-only and the proxy is the only route there is. The two read very
   * differently to a listener deciding whether to retry.
   */
  directCapable: boolean;
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
  /**
   * True when a stall looks like the upstream playing a spot rather than a
   * broken stream: the station is on a relay known to sell listener time, the
   * audio was fine a moment ago, and nothing has come back for a while. The UI
   * owes the listener an explanation and a way out (skip), because a silent
   * "reconnecting…" over an advert is the worst of both.
   */
  adBreakSuspected: boolean;
  playStation: (stationId: string, source?: number) => void;
  playSource: (source: number) => void;
  togglePlay: () => void;
  stop: () => void;
  /**
   * Try again after the player has given up.
   *
   * The counterpart to the attempt cap: bounding the retries would be a dead end
   * on its own, because a listener staring at "stream unavailable" needs a way to
   * ask again — a station that was down for two minutes is often back. Resets the
   * counters so the new set of attempts gets the full backoff budget rather than
   * inheriting an exhausted one.
   */
  retry: () => void;
  setVolume: (v: number) => void;
  toggleFavorite: (stationId: string) => void;
  skip: (dir: 1 | -1) => void;
}

function proxyUrl(stationId: string, source: number): string {
  return `/api/radio/stream?stationId=${encodeURIComponent(stationId)}&source=${source}`;
}

/** Bookkeeping key for "this channel already tried the direct path and failed". */
function channelKey(stationId: string, source: number): string {
  return `${stationId}#${source}`;
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

export function RadioPlayerProvider({
  children,
  directEnabled = true,
}: {
  children: ReactNode;
  /**
   * Whether direct playback is allowed at all.
   *
   * This is the admin's "Direct radio streams (HD)" switch, read server-side in
   * the root layout and handed down so the choice is made before the first
   * channel is tuned. With it off, every station goes through this origin: lower
   * fidelity and the listener stays anonymous to the station, which is the
   * trade-off the setting's own hint describes.
   */
  directEnabled?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [station, setStation] = useState<RadioStation | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [volume, setVolumeState] = useState(75);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<string[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>({ song: null, listeners: null, meta: false });
  const [signal, setSignal] = useState<SignalState>({
    source: 0,
    channels: 1,
    bitrateKbps: null,
    channelName: null,
    probed: false,
    transport: "proxy",
    directCapable: false,
  });

  /**
   * Channels that have already failed on the direct path, keyed
   * `stationId#source`.
   *
   * A direct mount can refuse a second connection, present a certificate a given
   * network rejects, or simply be unreachable from where the listener is sitting
   * — and none of those mean the station is down. Each channel therefore gets
   * exactly one direct attempt per listening session and then settles on the
   * proxy: the failure is remembered rather than retried, so a listener never
   * lands in a loop that alternates between a mount that will not open and a
   * relay that will.
   */
  const directFailedRef = useRef<Set<string>>(new Set());
  /** The transport the element is currently pointed at (read by onError). */
  const transportRef = useRef<StreamTransport>("proxy");

  const volumeRef = useRef(volume);
  const stationRef = useRef(station);
  const pausedByUser = useRef(false);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamFailed = useRef(false);
  const sourceRef = useRef(0);
  /** The last channel that actually produced audio — the one worth returning to. */
  const playedSourceRef = useRef<number | null>(null);
  /**
   * True while the current channel is suspected of playing a spot rather than
   * its programme. Surfaced to the UI so a stall reads as "ad break" instead of
   * a broken stream — and so the player does not reconnect through it.
   */
  const [adBreakSuspected, setAdBreakSuspected] = useState(false);

  useEffect(() => {
    volumeRef.current = volume;
    stationRef.current = station;
  });

  // Indirection so the reconnect callback can reschedule itself without a
  // self-reference (which React Compiler rejects as a forward access).
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Decide whether a stall is a fault or an advert.
   *
   * The distinction matters because the right response is opposite: a fault
   * wants a reconnect, an advert wants patience (reconnecting replays it). The
   * signal used here is deliberately conservative — only a station sitting on a
   * relay known to sell listener time, that was playing seconds ago, is ever
   * described as being on a break. Everything else keeps the plain reconnect
   * behaviour.
   */
  /**
   * Where the element should point for one channel, and which route that is.
   *
   * Direct is preferred whenever the mount is https and the channel has not
   * already burnt its one direct attempt. Everything else — http-only mounts, an
   * operator who turned direct playback off, a mount that refused us earlier —
   * goes through the same-origin proxy.
   */
  const resolveStream = useCallback(
    (station: RadioStation, source: number): { url: string; transport: StreamTransport; directCapable: boolean } => {
      const upstream = stationSources(station)[source] ?? null;
      const directCapable = upstream ? canPlayDirect(upstream) : false;
      const direct = directEnabled && directCapable && !directFailedRef.current.has(channelKey(station.id, source));
      return direct && upstream
        ? { url: upstream, transport: "direct", directCapable }
        : { url: proxyUrl(station.id, source), transport: "proxy", directCapable };
    },
    [directEnabled]
  );

  const noteStall = useCallback(() => {
    if (pausedByUser.current || streamFailed.current) return;
    if (stallTimer.current) clearTimeout(stallTimer.current);
    stallTimer.current = setTimeout(() => {
      const current = stationRef.current;
      if (!current || pausedByUser.current) return;
      if (sourceAdRisk(current, sourceRef.current) > 0 && playedSourceRef.current !== null) {
        setAdBreakSuspected(true);
      }
    }, 12_000);
  }, []);

  const scheduleReconnectRef = useRef<() => void>(() => {});
  // Same indirection for channel failover: the tune callback steps to the
  // next channel on error without referencing itself.
  const tuneSourceRef = useRef<(station: RadioStation, source: number, forceProxy?: boolean) => void>(() => {});

  // Auto-reconnect with exponential backoff when a live stream drops.
  //
  // The floor is deliberately not 3s any more. A live re-connect opens a NEW
  // upstream session, and the free relays several stations sit behind sell a
  // pre-roll spot at the start of each one — so a fast reconnect loop did not
  // merely retry, it replayed the same advert over and over and buried the
  // music. Backing off also stops a flapping mount from being hammered.
  const scheduleReconnect = useCallback(() => {
    // Give up after a bounded number of attempts, rather than retrying until the
    // tab closes.
    //
    // Backing off was already right; not stopping was the bug. The delay curve
    // reached its 60s ceiling on attempt four and then stayed there forever, so a
    // station that was simply off the air was re-opened every minute for as long
    // as the page stayed up — worst on exactly the hosts this player otherwise
    // treats carefully, since a relay that sells listener time plays a pre-roll
    // at the start of every new session.
    //
    // The policy itself lives in `@/lib/radio-reconnect` so the curve and the
    // terminus are testable as functions rather than only observable by leaving a
    // tab open. This is the wiring; that module is the rule.
    if (!shouldRetry(retryCount.current)) {
      streamFailed.current = true;
      setIsPlaying(false);
      setStreamState("failed");
      return;
    }
    const delay = reconnectDelayMs(retryCount.current);
    retryCount.current += 1;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      const audio = audioRef.current;
      const current = stationRef.current;
      if (!audio || !current || pausedByUser.current) return;
      setStreamState("connecting");
      streamFailed.current = false;
      // Re-arm the LAST CHANNEL THAT PLAYED, not blindly channel 0. Resetting to
      // 0 undid the failover the moment anything hiccuped: a listener who had
      // escaped an ad-heavy mount was dragged straight back onto it on the next
      // reconnect. Only a station with no known-good channel starts at the
      // preferred (cleanest) one.
      const resumeSource = playedSourceRef.current ?? preferredSourceIndex(current);
      sourceRef.current = resumeSource;
      const target = resolveStream(current, resumeSource);
      transportRef.current = target.transport;
      setSignal((prev) => ({ ...prev, source: resumeSource, transport: target.transport, directCapable: target.directCapable }));
      audio.src = target.url;
      audio.play().catch(() => scheduleReconnectRef.current());
    }, delay);
  }, [resolveStream]);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  /**
   * Try the current station again, on demand.
   *
   * Fired from the player bar once the attempts are spent. It tunes immediately
   * rather than going through `scheduleReconnect`, because the listener has
   * already waited out the backoff and asked — making them sit through another
   * eight seconds to reach the same request would be a worse answer than the
   * automatic path it replaces.
   */
  const retry = useCallback(() => {
    const current = stationRef.current;
    const audio = audioRef.current;
    if (!current || !audio) return;
    // An explicit request to play, so the paused flag the reconnect path checks
    // before acting is cleared first — otherwise nothing below would run.
    pausedByUser.current = false;
    retryCount.current = 0;
    streamFailed.current = false;
    setAdBreakSuspected(false);
    setIsPlaying(true);
    setStreamState("connecting");
    const resumeSource = playedSourceRef.current ?? preferredSourceIndex(current);
    sourceRef.current = resumeSource;
    const target = resolveStream(current, resumeSource);
    transportRef.current = target.transport;
    setSignal((prev) => ({
      ...prev,
      source: resumeSource,
      transport: target.transport,
      directCapable: target.directCapable,
    }));
    audio.src = target.url;
    audio.play().catch(() => scheduleReconnectRef.current());
  }, [resolveStream]);

  // Drop pending reconnect work on unmount / manual stop.
  useEffect(() => {
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (stallTimer.current) clearTimeout(stallTimer.current);
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
          // Preload the channel the player would have chosen anyway (cleanest,
          // then most direct) rather than channel 0: the restored station used to
          // buffer an ad-prone relay first and only reach the good mount after
          // the listener pressed play.
          const source = preferredSourceIndex(st);
          const target = resolveStream(st, source);
          sourceRef.current = source;
          transportRef.current = target.transport;
          audio.src = target.url;
          audio.volume = volumeRef.current / 100;
        }
      }
    }
    // `resolveStream` is listed because the restored channel's ROUTE is resolved
    // here too, not just its index; `directEnabled` is a server-rendered prop
    // that cannot change mid-session, so this still runs once in practice.
  }, [resolveStream]);
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
    setAdBreakSuspected(false);
    playedSourceRef.current = null;
    if (stallTimer.current) clearTimeout(stallTimer.current);
    setNowPlaying({ song: null, listeners: null, meta: false });
    setSignal({
      source: 0,
      channels: 1,
      bitrateKbps: null,
      channelName: null,
      probed: false,
      transport: "proxy",
      directCapable: false,
    });
    sourceRef.current = 0;
    transportRef.current = "proxy";
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
      // Read the CHANNEL WE ARE ON, not the one the probe liked best: the badge
      // describes what the listener is hearing, and those are different channels
      // whenever the best available mount is not the one playing.
      const playing = data.channels?.find((c) => c.index === sourceRef.current) ?? data.channels?.[data.best];
      // Merged, not replaced: the probe knows the station's quality but it has no
      // idea which route the audio is taking, and replacing the signal wholesale
      // would make the badge lie the moment a probe landed.
      setSignal((prev) => ({
        ...prev,
        channels,
        bitrateKbps: playing?.bitrateKbps ?? null,
        channelName: playing?.stationName ?? null,
        probed: true,
      }));
    } catch {
      // probe is progressive enhancement — playback never depends on it
    }
  }, []);

  /**
   * Point the element at one channel.
   *
   * `forceProxy` is the fallback path: the channel is remembered as having burnt
   * its direct attempt, so `resolveStream` will not hand out the mount again for
   * the rest of the session. Failover order is unchanged — a channel that fails
   * on BOTH routes steps to the next one — but a direct failure costs a proxy
   * retry of the same channel first, because for an https mount the two failures
   * have nothing to do with each other.
   */
  const tuneSource = useCallback(
    (next: RadioStation, source: number, forceProxy = false) => {
      const audio = audioRef.current;
      if (!audio) return;
      const channels = stationSources(next).length;
      if (forceProxy) directFailedRef.current.add(channelKey(next.id, source));
      const target = resolveStream(next, source);
      sourceRef.current = source;
      transportRef.current = target.transport;
      setSignal((prev) => ({
        ...prev,
        source,
        channels,
        probed: false,
        transport: target.transport,
        directCapable: target.directCapable,
      }));
      retryCount.current = 0;
      streamFailed.current = false;
      setAdBreakSuspected(false);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      audio.src = target.url;
      audio.volume = volumeRef.current / 100;
      setStreamState("connecting");
      audio.play().catch(() => {
        // A direct channel that will not start is a transport failure, not a dead
        // mount — the same channel is still worth trying through the proxy.
        if (target.transport === "direct") {
          tuneSourceRef.current(next, source, true);
          return;
        }
        // Otherwise step to the next channel in the chain instead of dying. Only
        // when every channel fails do we surface the error.
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
    [probeSignal, resolveStream, scheduleReconnect]
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

      // A deliberate tap is a fresh start: a channel that refused direct playback
      // earlier in the session gets one more chance, because the earlier failure
      // may have been the network the listener has since left.
      directFailedRef.current.clear();

      // Open the CLEANEST channel available rather than whatever happens to be
      // first: several stations list an ad-injecting relay ahead of a direct
      // broadcaster mount, so "channel 0" was quietly the worst choice.
      tuneSource(next, source ?? preferredSourceIndex(next));
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
      // Choosing a channel by hand (the signal panel, a retry) also clears the
      // failure memory, so "try this one again" means what it says.
      directFailedRef.current.delete(channelKey(current.id, source));
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
    // (covers restore-from-localStorage and any cleared src), resolved through
    // the same transport decision the rest of the player uses — a resumed
    // station must not silently change route.
    const expected = resolveStream(current, sourceRef.current);
    const expectedPath = expected.url;
    if (!audio.src || !audio.src.endsWith(expectedPath)) {
      audio.src = expectedPath;
      transportRef.current = expected.transport;
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
        // Same asymmetry as a channel change: a direct resume that will not start
        // is retried through the proxy before the station is called broken.
        if (transportRef.current === "direct") {
          tuneSourceRef.current(current, sourceRef.current, true);
          return;
        }
        setStreamState("error");
        setIsPlaying(false);
        streamFailed.current = true;
        scheduleReconnect();
      });
    }
  }, [resolveStream, scheduleReconnect, streamState]);

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
      adBreakSuspected,
      playStation,
      playSource,
      togglePlay,
      stop,
      setVolume,
      toggleFavorite,
      skip,
      retry,
    }),
    [station, isPlaying, streamState, volume, favorites, recentlyPlayed, nowPlaying, signal, adBreakSuspected, playStation, playSource, togglePlay, stop, setVolume, toggleFavorite, skip, retry]
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
          // Remember the channel that actually worked, and stand down any
          // ad-break suspicion — audio is back.
          playedSourceRef.current = sourceRef.current;
          setAdBreakSuspected(false);
          if (stallTimer.current) clearTimeout(stallTimer.current);
        }}
        onWaiting={() => {
          if (!pausedByUser.current && !streamFailed.current) setStreamState("connecting");
          noteStall();
        }}
        onStalled={() => {
          if (!pausedByUser.current && !streamFailed.current) setStreamState("connecting");
          noteStall();
        }}
        onEnded={() => {
          // Live streams never "end" naturally — this fires when the proxy
          // window closed (serverless timeout) or the upstream dropped.
          // Re-arm the same source and resume without user action.
          if (pausedByUser.current || !stationRef.current) return;
          scheduleReconnect();
        }}
        onError={() => {
          // Ignore errors while stopped/paused — clearing src fires one, and
          // otherwise the UI shows a fake "Stream reconnecting…" forever.
          if (pausedByUser.current) return;

          // A DIRECT stream that breaks mid-play is retried through the proxy
          // before the station is called broken, because for an https mount the
          // two failures have nothing to do with each other: a mount can refuse
          // a second connection, or a middlebox can drop a TLS session, while the
          // station is perfectly live. Only the first such failure per channel is
          // treated this way — see `directFailedRef`.
          const current = stationRef.current;
          if (current && transportRef.current === "direct") {
            const key = channelKey(current.id, sourceRef.current);
            if (!directFailedRef.current.has(key)) {
              // Armed first, then cleared by `tuneSource` when it runs: if the
              // tuning callback has not been wired yet (a preload that failed
              // before the first effect ran), the reconnect is the safety net
              // instead of an error state with no way back.
              scheduleReconnect();
              tuneSourceRef.current(current, sourceRef.current, true);
              return;
            }
          }

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