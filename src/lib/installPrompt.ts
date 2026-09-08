"use client";

import { useEffect, useState } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "connectplus-install-dismissed";

interface InstallState {
  deferred: BeforeInstallPromptEvent | null;
  installed: boolean;
  standalone: boolean;
  dismissed: boolean;
  isIOS: boolean;
  iosHint: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();

const state: InstallState = {
  deferred: null,
  installed: false,
  standalone: false,
  dismissed: false,
  isIOS: false,
  iosHint: false,
};

function emit() {
  for (const fn of listeners) fn();
}

function detectBrowser() {
  if (typeof window === "undefined") return;
  state.standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.navigator as any).standalone === true;
  state.isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !(window as any).MSStream;
  try {
    state.dismissed = Boolean(window.localStorage.getItem(DISMISS_KEY));
  } catch {
    state.dismissed = false;
  }
  emit();
}

let initialized = false;

/** Attach the global install events exactly once (module is a singleton). */
export function initInstallListeners() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;
  detectBrowser();

  const onPrompt = (e: Event) => {
    e.preventDefault();
    state.deferred = e as BeforeInstallPromptEvent;
    state.iosHint = false;
    emit();
  };
  const onInstalled = () => {
    state.installed = true;
    state.deferred = null;
    state.standalone = true;
    state.iosHint = false;
    emit();
  };

  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
}

export function getInstallState(): InstallState {
  return state;
}

export function subscribeInstall(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dismissInstall() {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* private mode — ignore */
  }
  state.dismissed = true;
  state.iosHint = false;
  emit();
}

export function requestIosHint() {
  state.iosHint = true;
  emit();
}

export function clearIosHint() {
  state.iosHint = false;
  emit();
}

/**
 * Show the native install dialog (Android/Chrome) when available. On iOS there
 * is no programmatic prompt, so we surface the share-sheet instructions instead.
 */
export async function promptInstall(): Promise<"prompted" | "ios" | "unavailable"> {
  if (state.deferred) {
    const deferred = state.deferred;
    state.deferred = null;
    emit();
    await deferred.prompt();
    await deferred.userChoice;
    return "prompted";
  }
  if (state.isIOS) {
    requestIosHint();
    return "ios";
  }
  return "unavailable";
}

/** True when we can/should bother the user with an install affordance. */
export function installAvailable(): boolean {
  return (
    !state.standalone &&
    !state.dismissed &&
    (Boolean(state.deferred) || state.isIOS)
  );
}

/** React hook — re-renders the component whenever install state changes. */
export function useInstallPrompt(): InstallState & { available: boolean } {
  const [, setTick] = useState(0);

  useEffect(() => {
    initInstallListeners();
    return subscribeInstall(() => setTick((n) => n + 1));
  }, []);

  return { ...getInstallState(), available: installAvailable() };
}