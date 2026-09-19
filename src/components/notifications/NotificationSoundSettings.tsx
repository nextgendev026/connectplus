"use client";

import { useEffect, useState } from "react";
import { BellRing, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  notificationSoundLab,
  notificationSoundPrefs,
  previewNotificationSound,
  setNotificationSoundPrefs,
  unlockNotificationAudio,
  type NotificationSoundKind,
} from "@/lib/notification-sounds";

/**
 * The notification sound lab.
 *
 * A preference a reader cannot hear is a preference they cannot trust, so every
 * kind has a Play button that fires *that* voice rather than describing it. The
 * toggle is per kind because the useful setting is not "sounds on/off" but
 * "buzz me for a goal, never for a follow" — the whole reason the voices differ.
 *
 * Previews ignore the mute state (otherwise a muted kind's Play button would do
 * nothing, which reads as broken) and unlock the audio context from the click,
 * which is the only place a browser will let one start.
 */
export function NotificationSoundSettings() {
  const [enabled, setEnabled] = useState(true);
  const [muted, setMuted] = useState<NotificationSoundKind[]>([]);
  const [playing, setPlaying] = useState<NotificationSoundKind | null>(null);
  const lab = notificationSoundLab();

  useEffect(() => {
    // Read the stored preferences after mount, not during render: the server has
    // no localStorage, so a lazy initialiser would hydrate a different value than
    // it rendered and React would warn on every load.
    const prefs = notificationSoundPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration of a device-local preference
    setEnabled(prefs.enabled);
    setMuted(prefs.muted);
  }, []);

  const persist = (next: { enabled?: boolean; muted?: NotificationSoundKind[] }) => {
    const saved = setNotificationSoundPrefs(next);
    setEnabled(saved.enabled);
    setMuted(saved.muted);
  };

  const toggleKind = (kind: NotificationSoundKind) => {
    const next = muted.includes(kind) ? muted.filter((k) => k !== kind) : [...muted, kind];
    persist({ muted: next });
  };

  const play = (kind: NotificationSoundKind) => {
    unlockNotificationAudio();
    const played = previewNotificationSound(kind);
    setPlaying(kind);
    // The badge is cleared on a timer rather than by the audio callback: the
    // motif's length is data, and a state update must not depend on it.
    window.setTimeout(() => setPlaying((current) => (current === kind ? null : current)), 700);
    if (!played) {
      // Nothing left the device — the browser still has audio locked, or the
      // platform has no Web Audio. Saying so beats a button that seems dead.
      setPlaying(null);
    }
  };

  return (
    <section className="rounded-2xl border border-surface-800/60 bg-surface-900/30 p-6 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-50">
            <BellRing className="h-4 w-4 text-brand-400" />
            Notification sounds
          </h2>
          <p className="mt-1 max-w-xl text-xs text-surface-500">
            Each kind of notification has its own voice, so you can tell what happened without looking —
            a comment, an approval and a match alert never sound alike.
          </p>
        </div>
        <button
          type="button"
          onClick={() => persist({ enabled: !enabled })}
          aria-pressed={enabled}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            enabled
              ? "border-brand-500/40 bg-brand-500/10 text-brand-300"
              : "border-surface-700 bg-surface-800/60 text-surface-400 hover:text-surface-200"
          )}
        >
          {enabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          {enabled ? "Sounds on" : "Sounds off"}
        </button>
      </div>

      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {lab.map((voice) => {
          const audible = enabled && !muted.includes(voice.kind);
          return (
            <li
              key={voice.kind}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                audible ? "border-surface-800 bg-surface-900/60" : "border-surface-800/60 bg-surface-900/20 opacity-70"
              )}
            >
              <button
                type="button"
                onClick={() => play(voice.kind)}
                aria-label={`Play the ${voice.label} sound`}
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
                  playing === voice.kind
                    ? "border-brand-500 bg-brand-500/20 text-brand-300"
                    : "border-surface-700 bg-surface-800 text-surface-300 hover:border-brand-500/50 hover:text-brand-300"
                )}
              >
                <Play className="h-3.5 w-3.5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-surface-100">
                  {voice.label}
                  {voice.insistent ? (
                    <span className="ml-2 rounded-full border border-surface-700 px-1.5 py-0.5 text-[10px] font-normal text-surface-400">
                      stays on screen
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-surface-500">{voice.description}</p>
              </div>
              <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-[11px] text-surface-400">
                <input
                  type="checkbox"
                  checked={!muted.includes(voice.kind)}
                  onChange={() => toggleKind(voice.kind)}
                  className="h-3.5 w-3.5 rounded border-surface-600 bg-surface-800 accent-brand-500"
                />
                Sound
              </label>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-[11px] text-surface-500">
        Saved on this device only — the phone on your desk during a match is not the laptop in a quiet office.
        A browser only allows sound after you have interacted with the page, so the first tap after opening the
        app is what arms it.
      </p>
    </section>
  );
}
