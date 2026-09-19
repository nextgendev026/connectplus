/**
 * Notification voices.
 *
 * One chime for everything is the same as no chime at all: a reader learns
 * within a day to ignore it, because it carries no information. The point of a
 * notification sound is that a person who is *not looking at the screen* can
 * still tell what happened — a comment is not an approval, a match alert is not
 * a tip payout.
 *
 * So every notification kind gets a DISTINCT motif, synthesised with the Web
 * Audio API rather than shipped as audio files, for the same reasons the sports
 * board does it: nothing to download on a 3G phone, nothing to decode, and the
 * differences can be tuned in code rather than re-cut as assets. Motifs are
 * short (≤ 500ms) and separated by register and contour, not just pitch:
 *
 *   • follow     — one bright rising ping: someone new arrived.
 *   • comment    — two soft blips, conversational: someone spoke to you.
 *   • reply      — three blips that answer back: a thread, not a single voice.
 *   • moderation — a settled major third: decided, nothing to do.
 *   • publish    — a rising triad: your story is live, upward is the message.
 *   • sports     — a fast triple pulse, urgent and repetitious: a match moment.
 *   • payment    — a quick bright coin pair: money moved.
 *   • system     — the app's own chime, kept as the default voice.
 *
 * Browsers refuse to start audio before a user gesture, so a context created
 * outside one is suspended — and a suspended context is exactly the silent
 * failure this module exists to avoid. `unlockNotificationAudio()` is called
 * from the first real interaction; until then playback is skipped rather than
 * queued, because a burst of chimes replaying after a tap is worse than none.
 *
 * The preference is persisted per-device on purpose: the phone on a desk during
 * a match is not the laptop that must stay quiet in an office.
 */

import type { NotificationKind } from "@/lib/notification-display";

/** The kinds a reader can be notified about — the display kinds plus money. */
export type NotificationSoundKind = NotificationKind | "payment";

export const NOTIFICATION_SOUND_KINDS: readonly NotificationSoundKind[] = [
  "comment",
  "reply",
  "follow",
  "moderation",
  "publish",
  "sports",
  "payment",
  "system",
] as const;

interface Tone {
  /** Offset from now, in seconds. */
  at: number;
  hz: number;
  /** Duration in seconds. */
  for: number;
  type?: OscillatorType;
  /** Peak gain, 0..1. Kept low: a notification is not an alarm. */
  gain?: number;
}

interface Voice {
  label: string;
  /** Shown in the settings lab — why this one sounds unlike the others. */
  description: string;
  tones: Tone[];
  /** Vibration pattern in ms, for phones that support it. */
  vibrate: number[];
  /**
   * Whether the OS notification for this kind should stay on screen. Match
   * moments and moderation decisions are worth interrupting for; a follow is
   * not.
   */
  insistent?: boolean;
}

const VOICES: Record<NotificationSoundKind, Voice> = {
  follow: {
    label: "Follow",
    description: "One bright rising ping — someone new arrived.",
    tones: [
      { at: 0, hz: 988, for: 0.09, type: "triangle", gain: 0.13 },
      { at: 0.09, hz: 1319, for: 0.13, type: "triangle", gain: 0.13 },
    ],
    vibrate: [18, 40, 24],
  },
  comment: {
    label: "Comment",
    description: "Two soft blips — someone spoke to you.",
    tones: [
      { at: 0, hz: 620, for: 0.09, type: "sine", gain: 0.14 },
      { at: 0.1, hz: 830, for: 0.14, type: "sine", gain: 0.14 },
    ],
    vibrate: [22, 60, 22],
  },
  reply: {
    label: "Reply",
    description: "Three blips that answer back — a thread, not one voice.",
    tones: [
      { at: 0, hz: 740, for: 0.07, type: "triangle", gain: 0.13 },
      { at: 0.08, hz: 620, for: 0.07, type: "triangle", gain: 0.12 },
      { at: 0.16, hz: 880, for: 0.12, type: "triangle", gain: 0.13 },
    ],
    vibrate: [18, 45, 18, 45, 26],
  },
  moderation: {
    label: "Moderation",
    description: "A settled major third — decided, nothing to do.",
    tones: [
      { at: 0, hz: 523, for: 0.16, type: "sine", gain: 0.13 },
      { at: 0.02, hz: 784, for: 0.2, type: "sine", gain: 0.12 },
    ],
    vibrate: [30, 70, 30],
    insistent: true,
  },
  publish: {
    label: "Published",
    description: "A rising triad — your story is live.",
    tones: [
      { at: 0, hz: 659, for: 0.08, type: "sine", gain: 0.13 },
      { at: 0.09, hz: 830, for: 0.08, type: "sine", gain: 0.13 },
      { at: 0.18, hz: 1047, for: 0.16, type: "sine", gain: 0.14 },
    ],
    vibrate: [20, 50, 20, 50, 34],
  },
  sports: {
    label: "Sports",
    description: "A fast triple pulse — a match moment, hard to miss.",
    tones: [
      { at: 0, hz: 880, for: 0.07, type: "square", gain: 0.1 },
      { at: 0.12, hz: 880, for: 0.07, type: "square", gain: 0.1 },
      { at: 0.24, hz: 1174.66, for: 0.16, type: "square", gain: 0.12 },
    ],
    vibrate: [40, 30, 40, 30, 90],
    insistent: true,
  },
  payment: {
    label: "Payment",
    description: "A quick bright coin pair — money moved.",
    tones: [
      { at: 0, hz: 1319, for: 0.06, type: "triangle", gain: 0.13 },
      { at: 0.07, hz: 1760, for: 0.16, type: "triangle", gain: 0.14 },
    ],
    vibrate: [24, 40, 40],
    insistent: true,
  },
  system: {
    label: "System",
    description: "The app's own three-note chime — the default voice.",
    tones: [
      { at: 0, hz: 880, for: 0.12, type: "sine", gain: 0.12 },
      { at: 0.12, hz: 1174.66, for: 0.12, type: "sine", gain: 0.12 },
      { at: 0.24, hz: 1567.98, for: 0.2, type: "sine", gain: 0.12 },
    ],
    vibrate: [20, 60, 20],
  },
};

export const NOTIFICATION_SOUND_LABELS: Record<NotificationSoundKind, string> = Object.fromEntries(
  NOTIFICATION_SOUND_KINDS.map((k) => [k, VOICES[k].label])
) as Record<NotificationSoundKind, string>;

export const NOTIFICATION_SOUND_DESCRIPTIONS: Record<NotificationSoundKind, string> = Object.fromEntries(
  NOTIFICATION_SOUND_KINDS.map((k) => [k, VOICES[k].description])
) as Record<NotificationSoundKind, string>;

/** The whole lab, for a settings screen that lets a reader hear each voice. */
export function notificationSoundLab(): {
  kind: NotificationSoundKind;
  label: string;
  description: string;
  insistent: boolean;
}[] {
  return NOTIFICATION_SOUND_KINDS.map((kind) => ({
    kind,
    label: VOICES[kind].label,
    description: VOICES[kind].description,
    insistent: VOICES[kind].insistent === true,
  }));
}

/** Whether this kind's OS notification should stay on screen until dismissed. */
export function isInsistent(kind: NotificationSoundKind): boolean {
  return VOICES[kind]?.insistent === true;
}

/** The vibration pattern for a kind, in milliseconds. */
export function vibrationFor(kind: NotificationSoundKind): number[] {
  return VOICES[kind]?.vibrate ?? VOICES.system.vibrate;
}

/* ── Preferences ─────────────────────────────────────────────────────────── */

const PREFS_KEY = "cp:notifications:sounds";

export interface NotificationSoundPrefs {
  /** Master switch. On by default — the bell already chimed before this existed. */
  enabled: boolean;
  /** Kinds the reader has silenced individually. */
  muted: NotificationSoundKind[];
}

const DEFAULT_PREFS: NotificationSoundPrefs = { enabled: true, muted: [] };

let cachedPrefs: NotificationSoundPrefs | null = null;

function readPrefs(): NotificationSoundPrefs {
  if (cachedPrefs) return cachedPrefs;
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) {
      cachedPrefs = DEFAULT_PREFS;
      return cachedPrefs;
    }
    const parsed = JSON.parse(raw) as Partial<NotificationSoundPrefs>;
    const muted = Array.isArray(parsed.muted)
      ? parsed.muted.filter((k): k is NotificationSoundKind =>
          (NOTIFICATION_SOUND_KINDS as readonly string[]).includes(String(k))
        )
      : [];
    cachedPrefs = { enabled: parsed.enabled !== false, muted };
  } catch {
    cachedPrefs = DEFAULT_PREFS;
  }
  return cachedPrefs;
}

export function notificationSoundPrefs(): NotificationSoundPrefs {
  const prefs = readPrefs();
  return { enabled: prefs.enabled, muted: [...prefs.muted] };
}

export function setNotificationSoundPrefs(next: Partial<NotificationSoundPrefs>): NotificationSoundPrefs {
  const current = readPrefs();
  const merged: NotificationSoundPrefs = {
    enabled: next.enabled ?? current.enabled,
    muted: next.muted
      ? next.muted.filter((k) => (NOTIFICATION_SOUND_KINDS as readonly string[]).includes(k))
      : [...current.muted],
  };
  cachedPrefs = merged;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
  } catch {
    /* a preference that cannot be stored still applies for this session */
  }
  return { enabled: merged.enabled, muted: [...merged.muted] };
}

export function isKindAudible(kind: NotificationSoundKind): boolean {
  const prefs = readPrefs();
  return prefs.enabled && !prefs.muted.includes(kind);
}

/* ── Playback ────────────────────────────────────────────────────────────── */

let context: AudioContext | null = null;

/**
 * Create (or resume) the shared audio context from a real gesture.
 *
 * A context made outside a user gesture starts suspended and never plays, so
 * this returns false rather than pretending a sound happened. The context is
 * kept alive between notifications — creating and closing one per chime is what
 * makes iOS play the first note and drop the rest.
 */
export function unlockNotificationAudio(): boolean {
  if (typeof window === "undefined") return false;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return false;
  try {
    context ??= new Ctor();
    if (context.state === "suspended") void context.resume();
    return true;
  } catch {
    return false;
  }
}

/** True when a chime could actually be heard right now. */
export function notificationAudioReady(): boolean {
  return context !== null && context.state === "running";
}

/**
 * Play a kind's motif.
 *
 * Returns whether audio actually left the device, so a caller can decide to
 * fall back to vibration rather than silently assuming the reader was told.
 * Muted, unsupported, or still-locked all return false without throwing.
 */
export function playNotificationSound(kind: NotificationSoundKind = "system"): boolean {
  if (!isKindAudible(kind)) return false;
  const voice = VOICES[kind] ?? VOICES.system;
  const ctx = context;
  if (!ctx || ctx.state !== "running") return false;

  try {
    const now = ctx.currentTime;
    for (const tone of voice.tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type ?? "sine";
      osc.frequency.value = tone.hz;
      // Ramped rather than hard-edged: a square gain envelope clicks, and a
      // click on every notification is the first thing a reader notices.
      const start = now + tone.at;
      const end = start + tone.for;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(tone.gain ?? 0.13, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/** Buzz the device in the kind's pattern. No-op where unsupported. */
export function vibrateFor(kind: NotificationSoundKind): boolean {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  if (!isKindAudible(kind)) return false;
  try {
    return navigator.vibrate(vibrationFor(kind));
  } catch {
    return false;
  }
}

/**
 * Tell the reader about one notification, whichever channel is available.
 *
 * Audio first, vibration as the fallback: on iOS Safari in a PWA the audio
 * context is frequently still suspended, and a silent notification is a
 * notification nobody received. Returns which channels actually fired so the
 * caller (and the admin diagnostics) can see the pipeline working.
 */
export function announceNotification(kind: NotificationSoundKind): { sound: boolean; vibration: boolean } {
  const sound = playNotificationSound(kind);
  const vibration = vibrateFor(kind);
  return { sound, vibration };
}

/** Play a motif even while that kind is muted — the settings lab's preview. */
export function previewNotificationSound(kind: NotificationSoundKind): boolean {
  const wasMuted = readPrefs();
  const restored = { enabled: wasMuted.enabled, muted: [...wasMuted.muted] };
  cachedPrefs = { enabled: true, muted: restored.muted.filter((k) => k !== kind) };
  unlockNotificationAudio();
  const played = playNotificationSound(kind);
  cachedPrefs = restored;
  return played;
}
