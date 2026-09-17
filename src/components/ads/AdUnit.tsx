"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  capKey,
  deviceFromWidth,
  reservedHeightForSizes,
  selectCreative,
  slotAllowsDevice,
  slotHint,
  type AdDevice,
} from "@/lib/ad-selection";
import type { AdCreative, AdResolution } from "@/lib/ads";
import { getCookieConsent } from "@/components/pwa/CookieConsent";
import ThirdPartyAdSlot from "./ThirdPartyAdSlot";
import { reportAdMetric, useViewable } from "./viewability";

/**
 * A placement, from the browser's side: which creative to show, how often, and
 * whether it was actually seen.
 *
 * Selection lives here rather than on the server for one reason — a server pick
 * cannot be per-reader on pages that are prerendered and edge-cached (`/sports`,
 * `/radio`), and making those dynamic to buy a per-reader pick would cost the
 * cache tier the whole codebase works to keep. The server decides what a slot
 * *may* show; the browser decides which, for this reader.
 *
 * The three things that make it honest:
 *
 *   1. A VISITOR KEY in a first-party cookie (`cp_ak`), so the rotation is stable
 *      for a session instead of re-dealt on every render.
 *   2. A FREQUENCY LEDGER in localStorage, so the same campaign is not shown to
 *      the same reader over and over. Deliberately client-side: the cap protects
 *      the reading experience, it does not bill anyone, so it does not need to
 *      survive a cleared cache or justify a database write.
 *   3. A VIEWABILITY OBSERVER on the slot box. Nothing is reported until half the
 *      creative has been on screen for a second.
 *
 * Everything browser-only is read through `useSyncExternalStore` with a server
 * snapshot, which is what keeps the server render and the first client render
 * identical without a "mounted yet?" flag — the pool travels from the server, and
 * the reader-specific choice is made once the browser can answer.
 *
 * First-party creatives are served without asking for a cookie permission: they
 * are our own content and load no third-party script. Only the network tier is
 * consent-gated, from the same banner the rest of the site uses.
 */

const VISITOR_COOKIE = "cp_ak";
const LEDGER_KEY = "connectplus:ad-caps";
const ANCHOR_KEY = "connectplus:ad-anchor-dismissed";

/** Cookies and localStorage do not need a subscription: neither changes mid-view. */
const neverChanges = () => () => {};

/**
 * Creatives already chosen somewhere on this page.
 *
 * One page can hold several placements, and two of them serving the same
 * campaign is the clearest possible signal to a reader that they are being sold
 * to. Module-scoped because each placement is its own component instance with no
 * parent to coordinate through. Adding an id to a `Set` is idempotent, so the
 * worst a repeated render can do is make a sibling placement pick a different
 * campaign than it otherwise would — never a wrong or broken render.
 */
const shownOnPage = new Set<string>();

/** Read once per page load, so `getSnapshot` stays pure and referentially stable. */
let cachedVisitorKey: string | null = null;

function readAdVisitorKey(): string {
  if (cachedVisitorKey !== null) return cachedVisitorKey;
  let key = "anonymous";
  try {
    const match = document.cookie.match(/(?:^|;\s*)cp_ak=([^;]+)/);
    if (match?.[1]) {
      key = decodeURIComponent(match[1]);
    } else {
      key = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2))
        .replace(/-/g, "")
        .slice(0, 24);
      const secure = window.location.protocol === "https:" ? "; secure" : "";
      document.cookie = `${VISITOR_COOKIE}=${key}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax${secure}`;
    }
  } catch {
    // Cookies refused: the rotation still works for this page view, it just
    // cannot be remembered. No cap, no crash.
  }
  cachedVisitorKey = key;
  return key;
}

type Ledger = Record<string, { count: number; day: string }>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readLedger(): Ledger {
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Ledger) : {};
  } catch {
    return {};
  }
}

/** How many times each candidate has already been shown today. */
function countsFor(slot: string, creatives: AdCreative[]): Record<string, number> {
  const day = today();
  const ledger = readLedger();
  const counts: Record<string, number> = {};
  for (const creative of creatives) {
    const entry = ledger[capKey(slot, creative.id)];
    counts[creative.id] = entry && entry.day === day ? entry.count : 0;
  }
  return counts;
}

function recordShown(slot: string, adId: string): void {
  try {
    const day = today();
    const next: Ledger = {};
    // Sweep out yesterday's tallies on every write, so the ledger is bounded by
    // the number of live campaigns rather than by how long the browser has been
    // in use.
    for (const [key, entry] of Object.entries(readLedger())) {
      if (entry?.day === day) next[key] = entry;
    }
    const key = capKey(slot, adId);
    next[key] = { count: (next[key]?.count ?? 0) + 1, day };
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next));
  } catch {
    // Private mode. Capping degrades to not capping, which is the safe direction.
  }
}

function readAnchorDismissed(): boolean {
  try {
    return window.localStorage.getItem(ANCHOR_KEY) === "1";
  } catch {
    return false;
  }
}

/** Viewport width, `null` until the browser can answer. */
function useViewportWidth(): number | null {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    () => null
  );
}

export default function AdUnit({
  slot,
  resolution,
  className,
  label = "Sponsored",
}: {
  slot: string;
  resolution: AdResolution;
  className?: string;
  label?: string | null;
}) {
  const hint = slotHint(slot);
  const restricted = Boolean(hint.device);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const reported = useRef(false);

  const width = useViewportWidth();
  const device: AdDevice | null = width === null ? null : deviceFromWidth(width);
  // Server snapshot is `""`, so the first client render matches the server's and
  // the reader-specific pick only happens once the browser has a key.
  const visitorKey = useSyncExternalStore(neverChanges, readAdVisitorKey, () => "");
  const advertisingAllowed = useSyncExternalStore(
    neverChanges,
    () => getCookieConsent()?.advertising === true,
    () => false
  );
  const storedDismissed = useSyncExternalStore(neverChanges, readAnchorDismissed, () => false);
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = storedDismissed || dismissedNow;

  const deviceAllowed = !restricted || (device !== null && slotAllowsDevice(slot, device));

  const chosen = useMemo(() => {
    if (!visitorKey || !deviceAllowed || resolution.creatives.length === 0) return null;
    const picked = selectCreative(resolution.creatives, {
      visitorKey,
      device: device ?? undefined,
      seenCounts: countsFor(slot, resolution.creatives),
      excludeIds: Array.from(shownOnPage),
    });
    if (picked) shownOnPage.add(picked.id);
    return picked;
  }, [visitorKey, deviceAllowed, resolution.creatives, slot, device]);

  // The network tier is the second choice, not a parallel one: it fills the slot
  // when there is no first-party creative left to show, and only with consent.
  const network = !chosen && advertisingAllowed ? resolution.network : null;
  const filling = Boolean(chosen || network);

  const handleViewable = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    if (chosen) {
      reportAdMetric({ kind: "impression", adId: chosen.id });
      recordShown(slot, chosen.id);
    } else if (network) {
      reportAdMetric({ kind: "impression", networkSlotId: network.id });
    }
  }, [chosen, network, slot]);

  useViewable(boxRef, handleViewable, filling);

  if (!resolution.reserve) return null;
  // A device-restricted format is decided in the browser, so it holds no space
  // until the browser has answered — reserving a sticky rail for a phone would be
  // a gap, not a slot.
  if (restricted && !deviceAllowed) return null;
  if (hint.anchor && dismissed) return null;

  const reserved = Math.max(
    hint.minHeight,
    network ? reservedHeightForSizes(network.sizes) ?? 0 : 0
  );

  const dismiss = () => {
    setDismissedNow(true);
    try {
      window.localStorage.setItem(ANCHOR_KEY, "1");
    } catch {
      /* nothing to remember */
    }
  };

  return (
    <div
      ref={boxRef}
      data-ad-slot={slot}
      aria-label={label ? `${label}${chosen ? ` — ${chosen.name}` : ""}` : undefined}
      style={{ minHeight: reserved }}
      className={cn(
        "group relative overflow-hidden",
        hint.anchor
          ? "fixed inset-x-0 bottom-0 z-[60] border-t border-surface-700 bg-surface-900/95 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-2 backdrop-blur-xl"
          : "rounded-2xl border border-surface-200/70 bg-surface-100/60 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-brand-500/40",
        hint.sticky && "sticky top-24",
        className
      )}
    >
      {label ? (
        <span
          className={cn(
            "absolute right-2 top-2 z-10 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
            hint.anchor
              ? "bg-surface-800 text-surface-400"
              : "bg-surface-900/70 text-white backdrop-blur"
          )}
        >
          {label}
        </span>
      ) : null}

      {hint.anchor ? (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss this advertisement"
          className="absolute left-2 top-2 z-10 rounded-full bg-surface-800 p-1 text-surface-400 transition-colors hover:text-surface-100"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}

      {chosen ? (
        chosen.format === "html" ? (
          // An embed an admin published as their own creative. It goes through the
          // same injector as a network tag so its scripts actually run.
          <ThirdPartyAdSlot
            slot={slot}
            config={{ id: chosen.id, provider: "custom", scriptTag: chosen.html, adUnitId: null, sizes: null }}
          />
        ) : (
          <HouseCreative creative={chosen} />
        )
      ) : network ? (
        <ThirdPartyAdSlot slot={slot} config={network} />
      ) : null}

      {chosen?.sponsor ? (
        <p className="px-3 py-2 text-[11px] font-medium text-surface-500">
          Sponsored by <span className="text-surface-700">{chosen.sponsor}</span>
        </p>
      ) : null}
    </div>
  );
}

function HouseCreative({ creative }: { creative: AdCreative }) {
  return (
    <Link
      href={`/api/ads/click/${creative.id}`}
      target="_blank"
      rel="noopener sponsored"
      className="block"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={creative.imageUrl ?? ""}
        alt={creative.name}
        loading="lazy"
        decoding="async"
        className="h-auto w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
      />
    </Link>
  );
}
