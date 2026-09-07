"use client";

import { useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRadioPlayer } from "@/components/radio/RadioPlayerContext";

export function RadioPlayerBar() {
  const { station, isPlaying, streamState, nowPlaying, togglePlay, stop, setVolume, volume, skip } = useRadioPlayer();
  const [isMuted, setIsMuted] = useState(false);

  if (!station) return null;

  const songLine = nowPlaying.meta && nowPlaying.song ? nowPlaying.song : station.tagline;
  const busy = streamState === "connecting";

  return (
    <div className="fixed bottom-[64px] left-0 right-0 z-50 border-t border-surface-800/50 bg-surface-950/95 backdrop-blur-xl safe-area-pb md:bottom-0">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-center gap-3 md:gap-4 h-16 md:h-20">
          {/* Station */}
          <div className="flex items-center gap-3 min-w-0 flex-1 md:flex-none md:w-72">
            <div
              className="relative flex h-11 w-11 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: station.color }}
            >
              {busy && (
                <span className="absolute -inset-1 rounded-2xl bg-brand-500/20 animate-ping" />
              )}
              {station.icon}
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse ring-2 ring-surface-950" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-surface-50">
                {station.name}
              </p>
              <div className="overflow-hidden">
                <p className="truncate text-xs text-surface-400 animate-marquee">
                  {streamState === "error" ? "Stream reconnecting…" : songLine}
                </p>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="hidden md:flex flex-col items-center gap-1 flex-1 max-w-md">
            <div className="flex items-center gap-3">
              <button
                onClick={() => skip(-1)}
                className="rounded-full p-1.5 text-surface-400 hover:text-surface-50 transition-colors"
                aria-label="Previous station"
              >
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                onClick={togglePlay}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black hover:scale-105 transition-transform"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </button>
              <button
                onClick={() => skip(1)}
                className="rounded-full p-1.5 text-surface-400 hover:text-surface-50 transition-colors"
                aria-label="Next station"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            </div>
            <span className="text-[10px] text-surface-500">
              {streamState === "error" ? (
                <span className="text-amber-400">Can’t reach stream — trying again</span>
              ) : nowPlaying.meta ? (
                <span className="inline-flex items-center gap-1.5 text-brand-400">
                  <Radio className="h-3 w-3" />
                  Live on air
                  {nowPlaying.listeners !== null && (
                    <span className="text-surface-500">
                      · {nowPlaying.listeners.toLocaleString()} listening
                    </span>
                  )}
                </span>
              ) : (
                "REALTIME"
              )}
            </span>
          </div>

          {/* Volume */}
          <div className="hidden md:flex items-center gap-2 w-36">
            <button
              onClick={() => {
                setIsMuted(!isMuted);
                setVolume(isMuted ? volume : 0);
              }}
              className="rounded-full p-1.5 text-surface-400 hover:text-surface-50 transition-colors"
              aria-label="Mute"
            >
              {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                setIsMuted(v === 0);
              }}
              className="w-full accent-brand-500 h-1"
            />
          </div>

          {/* Mobile controls */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              onClick={togglePlay}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
            </button>
            <button
              onClick={stop}
              className="rounded-lg p-2 text-surface-500 hover:text-surface-200 transition-colors"
              aria-label="Close player"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <button
            onClick={stop}
            className="hidden md:block rounded-lg p-2 text-surface-500 hover:text-surface-200 transition-colors"
            aria-label="Close player"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}