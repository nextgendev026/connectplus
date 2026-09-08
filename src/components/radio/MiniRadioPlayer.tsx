"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Play, Pause, X, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRadioPlayer } from "@/components/radio/RadioPlayerContext";

function MiniEqualizer({ playing }: { playing: boolean }) {
  return (
    <div className="flex items-end gap-[2px] h-3.5">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-brand-400",
            playing ? "animate-equalizer" : "h-1"
          )}
          style={{
            animationDelay: `${i * 0.15}s`,
            height: playing ? undefined : "4px",
          }}
        />
      ))}
    </div>
  );
}

export function MiniRadioPlayer() {
  const pathname = usePathname();
  const { station, isPlaying, streamState, togglePlay, stop, nowPlaying, volume } = useRadioPlayer();
  const [showInfo, setShowInfo] = useState(false);

  if (!station || pathname === "/radio") return null;

  const label = nowPlaying.meta && nowPlaying.song ? nowPlaying.song : `${station.name} — ${station.tagline}`;
  const busy = streamState === "connecting";
  const live = isPlaying || streamState === "connecting";

  return (
    <div className="fixed z-[60] bottom-20 md:bottom-5 right-3 md:right-6 animate-slide-up">
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 backdrop-blur-xl shadow-glow",
          busy
            ? "border-brand-500/40 bg-surface-900/90"
            : streamState === "error"
            ? "border-amber-500/40 bg-surface-900/90"
            : "border-surface-700/60 bg-surface-900/90"
        )}
      >
        <button
          onClick={() => setShowInfo((s) => !s)}
          className="flex items-center gap-2 min-w-0 text-left"
          title={station.name}
        >
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white"
            style={{ backgroundColor: station.color }}
          >
            {station.icon}
          </div>
          <div className="min-w-0 w-36 sm:w-48">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
              <p className="truncate text-xs font-semibold text-surface-50">
                {station.name}
              </p>
            </div>
            <div className="overflow-hidden">
              <p className="truncate text-[11px] text-surface-400 animate-marquee">
                {label}
              </p>
            </div>
          </div>
        </button>

        <MiniEqualizer playing={live} />

        <button
          onClick={togglePlay}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white hover:bg-brand-600 transition-all active:scale-95"
          aria-label={live ? "Pause" : "Play"}
        >
          {live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>

        <button
          onClick={stop}
          className="rounded-lg p-1.5 text-surface-500 hover:text-surface-200 transition-colors"
          aria-label="Stop and close player"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {showInfo && (
        <div className="mt-2 rounded-xl border border-surface-800 bg-surface-900/95 p-3 text-xs text-surface-300 backdrop-blur-xl shadow-lg w-56">
          {nowPlaying.meta && nowPlaying.song ? (
            <p className="truncate">Now playing: {nowPlaying.song}</p>
          ) : (
            <p className="truncate">{station.tagline}</p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <span className="inline-flex items-center gap-1 text-brand-400">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse" />
              {streamState === "error" ? "Reconnecting…" : "Live stream"}
            </span>
            {nowPlaying.listeners !== null && (
              <span className="text-surface-400">{nowPlaying.listeners.toLocaleString()} listening</span>
            )}
            <span className="inline-flex items-center gap-1 text-surface-500">
              <Volume2 className="h-3 w-3" />
              {volume}%
            </span>
          </div>
          <a
            href="/radio"
            className="mt-2 inline-block text-brand-400 hover:text-brand-300"
          >
            Open full player →
          </a>
        </div>
      )}
    </div>
  );
}