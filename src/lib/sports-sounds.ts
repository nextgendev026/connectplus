/**
 * Sports alert tones.
 *
 * Synthesised with the Web Audio API rather than shipped as audio files, for
 * three reasons that all matter on a sports board: there is nothing to download
 * (a goal alert must not wait on a 40KB mp3), nothing to decode on a mid-range
 * Android phone, and each event gets a DISTINCT voice — a goal cannot sound like
 * a substitution, or the alert stops carrying information.
 *
 * Browsers refuse to start audio before a user gesture, so `unlockSportsAudio()`
 * is called from the enable toggle and the first tap anywhere. Until then every
 * call is a no-op: silently failing is correct here, because the alternative is a
 * console full of autoplay errors in a page that is otherwise fine.
 *
 * The mute preference is persisted, and it is per-device on purpose — the phone
 * that sits on a desk during a match is not the laptop that must stay silent in
 * an office.
 */

export type SportsAlertKind = "goal" | "red-card" | "kickoff" | "fulltime" | "pick-settled";

const MUTE_KEY = "cp:sports:alerts-muted";

let context: AudioContext | null = null;
let muted: boolean | null = null;

function readMuted(): boolean {
  if (muted !== null) return muted;
  if (typeof window === "undefined") return true;
  try {
    // Opt-IN, not opt-out. A sports page that starts making noise on the first
    // goal without being asked is a page people close — and the browser blocks
    // audio before a gesture anyway, so "on by default" would be a promise the
    // page cannot keep. Explicit "0" is the only thing that unmutes.
    muted = window.localStorage.getItem(MUTE_KEY) !== "0";
  } catch {
    muted = true;
  }
  return muted;
}

export function sportsAlertsMuted(): boolean {
  return readMuted();
}

export function setSportsAlertsMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* a preference that cannot be stored still applies for this session */
  }
}

/**
 * Create (or resume) the audio context.
 *
 * Called from a real gesture — the toggle, or any tap on the board — because a
 * context created outside one starts suspended, and a suspended context is
 * exactly the silent failure this exists to avoid.
 */
export function unlockSportsAudio(): boolean {
  if (typeof window === "undefined") return false;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return false;
  try {
    context ??= new Ctor();
    if (context.state === "suspended") void context.resume();
    return true;
  } catch {
    return false;
  }
}

interface Tone {
  /** Offset from now, in seconds. */
  at: number;
  /** Frequency in Hz. */
  hz: number;
  /** Duration in seconds. */
  for: number;
  type?: OscillatorType;
  /** Peak gain, 0..1. */
  gain?: number;
}

/**
 * Each alert's voice.
 *
 * A goal rises (two notes, bright, unmistakable from across a room), a red card
 * drops and buzzes (a sawtooth, deliberately unpleasant — it is bad news for
 * someone), kick-off is a single neutral ping, full time resolves downward, and
 * a settled pick is a short bright pair. None is longer than ~350ms, because an
 * alert that outlasts the moment is a nuisance rather than a notification.
 */
const VOICES: Record<SportsAlertKind, Tone[]> = {
  goal: [
    { at: 0, hz: 660, for: 0.09, type: "triangle", gain: 0.16 },
    { at: 0.1, hz: 990, for: 0.14, type: "triangle", gain: 0.18 },
    { at: 0.24, hz: 1320, for: 0.12, type: "triangle", gain: 0.14 },
  ],
  "red-card": [
    { at: 0, hz: 220, for: 0.18, type: "sawtooth", gain: 0.12 },
    { at: 0.16, hz: 165, for: 0.22, type: "sawtooth", gain: 0.12 },
  ],
  kickoff: [{ at: 0, hz: 880, for: 0.1, type: "sine", gain: 0.12 }],
  fulltime: [
    { at: 0, hz: 660, for: 0.12, type: "sine", gain: 0.13 },
    { at: 0.13, hz: 494, for: 0.18, type: "sine", gain: 0.13 },
  ],
  "pick-settled": [
    { at: 0, hz: 784, for: 0.08, type: "triangle", gain: 0.12 },
    { at: 0.09, hz: 1047, for: 0.12, type: "triangle", gain: 0.12 },
  ],
};

/** Human-readable label, used by the settings toggle and the admin copy. */
export const SPORTS_ALERT_LABELS: Record<SportsAlertKind, string> = {
  goal: "Goal",
  "red-card": "Red card",
  kickoff: "Kick-off",
  fulltime: "Full time",
  "pick-settled": "Pick settled",
};

/** Play one alert. A no-op while muted, unsupported, or still locked by the browser. */
export function playSportsAlert(kind: SportsAlertKind): boolean {
  if (readMuted()) return false;
  const ctx = context;
  if (!ctx || ctx.state !== "running") return false;
  const voice = VOICES[kind];
  if (!voice) return false;

  try {
    const now = ctx.currentTime;
    for (const tone of voice) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type ?? "sine";
      osc.frequency.value = tone.hz;
      // Ramps rather than hard starts/stops: a square-edged gain envelope clicks,
      // and a click on every goal is the first thing a reader notices.
      const start = now + tone.at;
      const end = start + tone.for;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(tone.gain ?? 0.14, start + 0.012);
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
