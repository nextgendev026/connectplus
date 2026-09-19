import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  NOTIFICATION_SOUND_KINDS,
  NOTIFICATION_SOUND_LABELS,
  isInsistent,
  isKindAudible,
  notificationSoundLab,
  notificationSoundPrefs,
  playNotificationSound,
  previewNotificationSound,
  setNotificationSoundPrefs,
  vibrateFor,
  vibrationFor,
} from "@/lib/notification-sounds";
import { notificationKind, pushKindForType } from "@/lib/notification-display";

/** A minimal localStorage so the preference layer can be exercised headlessly. */
function installStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    },
    configurable: true,
    writable: true,
  });
  return store;
}

describe("notification sounds", () => {
  beforeEach(() => {
    installStorage();
    setNotificationSoundPrefs({ enabled: true, muted: [] });
  });

  it("gives every kind a label, a description and a vibration pattern", () => {
    for (const kind of NOTIFICATION_SOUND_KINDS) {
      expect(NOTIFICATION_SOUND_LABELS[kind], kind).toBeTruthy();
      expect(vibrationFor(kind).length, kind).toBeGreaterThan(0);
      expect(vibrationFor(kind).every((ms) => ms > 0), kind).toBe(true);
    }
  });

  it("keeps the lab in sync with the kind list", () => {
    const lab = notificationSoundLab();
    expect(lab.map((v) => v.kind)).toEqual([...NOTIFICATION_SOUND_KINDS]);
    expect(new Set(lab.map((v) => v.description)).size).toBe(lab.length);
  });

  it("marks the kinds worth interrupting for as insistent, and only those", () => {
    expect(isInsistent("sports")).toBe(true);
    expect(isInsistent("payment")).toBe(true);
    expect(isInsistent("moderation")).toBe(true);
    expect(isInsistent("follow")).toBe(false);
    expect(isInsistent("comment")).toBe(false);
  });

  it("gives each kind its own vibration pattern", () => {
    const patterns = NOTIFICATION_SOUND_KINDS.map((k) => vibrationFor(k).join(","));
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("plays nothing while audio is locked, and says so", () => {
    // No AudioContext in this environment: the honest answer is "no sound",
    // never a silent success that the caller then reports as delivered.
    expect(playNotificationSound("comment")).toBe(false);
  });

  it("honours the master switch", () => {
    setNotificationSoundPrefs({ enabled: false });
    expect(isKindAudible("comment")).toBe(false);
    expect(playNotificationSound("comment")).toBe(false);
    expect(notificationSoundPrefs().enabled).toBe(false);
  });

  it("honours per-kind mutes", () => {
    setNotificationSoundPrefs({ muted: ["sports"] });
    expect(isKindAudible("sports")).toBe(false);
    expect(isKindAudible("comment")).toBe(true);
  });

  it("drops unknown kinds from stored preferences", () => {
    setNotificationSoundPrefs({ muted: ["sports", "not-a-kind" as never] });
    expect(notificationSoundPrefs().muted).toEqual(["sports"]);
  });

  it("still previews a muted kind, because that is what the button is for", () => {
    setNotificationSoundPrefs({ muted: NOTIFICATION_SOUND_KINDS as never });
    // The preview bypasses the mute, but the mute survives it.
    expect(previewNotificationSound("comment")).toBe(false); // no audio context here
    expect(notificationSoundPrefs().muted).toEqual([...NOTIFICATION_SOUND_KINDS]);
  });

  it("reports no vibration where the platform has none", () => {
    expect(vibrateFor("comment")).toBe(false);
  });

  it("maps a stored notification type to the voice it should arrive with", () => {
    expect(pushKindForType("COMMENT")).toBe("comment");
    expect(pushKindForType("REPLY")).toBe("reply");
    expect(pushKindForType("FOLLOW")).toBe("follow");
    expect(pushKindForType("MODERATION_APPROVED")).toBe("moderation");
    expect(pushKindForType("POST_PUBLISHED")).toBe("publish");
    expect(pushKindForType("SPORTS_GOAL")).toBe("sports");
    expect(pushKindForType("TIP_RECEIVED")).toBe("payment");
    expect(pushKindForType("SOMETHING_ELSE")).toBe("system");
  });

  it("classifies money notifications as payments rather than social chatter", () => {
    for (const type of ["TIP_RECEIVED", "PAYOUT_SENT", "PAYMENT_FAILED", "SUBSCRIPTION_RENEWED"]) {
      expect(notificationKind(type), type).toBe("payment");
    }
  });

  it("survives a storage that throws", () => {
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage: {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => {
            throw new Error("blocked");
          },
        },
      },
      configurable: true,
      writable: true,
    });
    setNotificationSoundPrefs({ enabled: true, muted: [] });
    expect(notificationSoundPrefs().enabled).toBe(true);
    expect(() => playNotificationSound("system")).not.toThrow();
  });

  it("prunes every kind when the master switch is off, whatever is stored", () => {
    const spy = vi.fn();
    setNotificationSoundPrefs({ enabled: false, muted: [] });
    for (const kind of NOTIFICATION_SOUND_KINDS) {
      expect(isKindAudible(kind), kind).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
