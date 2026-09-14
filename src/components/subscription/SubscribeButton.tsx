"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CreditCard, Loader2, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RailOption {
  id: string;
  name: string;
  method: string;
  currency: string;
  configured: boolean;
}

interface IntentState {
  status: string;
  pending: boolean;
  message: string | null;
  receipt: string | null;
  redirectUrl: string | null;
  subscriptionId: string | null;
}

const RAIL_ICON: Record<string, typeof Smartphone> = { daraja: Smartphone, paypal: CreditCard };

/** How long to keep asking before we stop pretending we know the outcome. */
const POLL_MS = 3_000;
const POLL_TIMEOUT_MS = 3 * 60 * 1_000;

/**
 * Subscribe.
 *
 * The flow deliberately differs per rail, because the money does:
 *
 *   • **M-Pesa** — we push a prompt and the member pays *on the handset*. There
 *     is no redirect to come back from, so the button becomes a live status
 *     panel that polls until Safaricom has a verdict.
 *   • **PayPal** — the member leaves for a hosted page and comes back through
 *     `/api/payments/paypal/return`, which captures and settles.
 *
 * In both cases the membership is written by the server from the provider's
 * confirmation, never from anything this component says.
 */
export function SubscribeButton({
  planId,
  planName,
  billingCycle = "monthly",
  signedIn,
  current,
  free,
  rails = [],
  className,
}: {
  planId: string;
  planName: string;
  billingCycle?: "monthly" | "yearly";
  signedIn: boolean;
  current?: boolean;
  free?: boolean;
  /** Rails that are actually configured — the server decides, the button obeys. */
  rails?: RailOption[];
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "awaiting" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number>(0);

  const configured = rails.filter((r) => r.configured);
  const activeProvider = provider || configured[0]?.id || "";

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  /**
   * Ask the server what happened to this payment.
   *
   * Declared as a function (not a `useCallback`) because it schedules itself —
   * a self-referencing const would be read before it is initialised, and the
   * loop is only ever driven from a timer or a click, never from an effect
   * dependency, so there is nothing to memoise.
   */
  async function poll(id: string) {
    try {
        const res = await fetch(`/api/payments/intents/${id}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as Partial<IntentState>;
        if (data?.redirectUrl) {
          window.location.href = data.redirectUrl;
          return;
        }
        if (data?.status === "succeeded") {
          setState("done");
          setMessage(
            data.receipt
              ? `${planName} is active — M-Pesa receipt ${data.receipt}.`
              : `${planName} is active.`
          );
          router.refresh();
          return;
        }
        if (data?.status && !data.pending) {
          setState("error");
          setMessage(data.message ?? "The payment did not complete.");
          return;
        }
      if (data?.message) setMessage(data.message);
    } catch {
      /* a dropped poll is not a dropped payment — keep asking */
    }

    if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
      setState("idle");
      setMessage(
        "Still waiting on Safaricom. If the prompt never arrived, check your balance and try again — nothing has been charged."
      );
      return;
    }
    pollTimer.current = setTimeout(() => void poll(id), POLL_MS);
  }

  async function subscribe() {
    if (!signedIn) {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent("/pricing")}`);
      return;
    }
    setState("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/subscription/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          planId,
          billingCycle,
          ...(activeProvider ? { provider: activeProvider } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setState("error");
        setMessage(data?.error ?? "Could not start the payment.");
        return;
      }

      if (data.checkoutUrl || data.redirectUrl) {
        window.location.href = data.checkoutUrl ?? data.redirectUrl;
        return;
      }

      if (data.free) {
        setState("done");
        setMessage(`${planName} is active.`);
        router.refresh();
        return;
      }

      if (data.provider === "daraja" && data.intentId) {
        setIntentId(data.intentId);
        startedAt.current = Date.now();
        setState("awaiting");
        setMessage(data.message ?? "Enter your M-Pesa PIN on your phone.");
        pollTimer.current = setTimeout(() => void poll(data.intentId), 2_000);
        return;
      }

      setState("done");
      setMessage(`${planName} is active.`);
      router.refresh();
    } catch {
      setState("error");
      setMessage("Network error — please try again.");
    }
  }

  if (current) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-3 text-sm font-semibold text-emerald-300",
          className
        )}
      >
        <Check className="w-4 h-4" />
        Current plan
      </div>
    );
  }

  // Nothing can be bought yet: say why, rather than offering a button that ends
  // in a generic failure. This is the state a fresh deployment is in.
  if (!free && configured.length === 0) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-amber-200">
            Payments are being connected — M-Pesa and PayPal credentials haven&apos;t been added to this deployment
            yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {open && !free ? (
        <div className="space-y-2 rounded-xl border border-surface-800 bg-surface-900/60 p-2.5">
          {configured.length > 1 ? (
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                How would you like to pay?
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {configured.map((rail) => {
                  const Icon = RAIL_ICON[rail.id] ?? CreditCard;
                  const selected = activeProvider === rail.id;
                  return (
                    <button
                      key={rail.id}
                      type="button"
                      onClick={() => setProvider(rail.id)}
                      disabled={state === "awaiting" || state === "loading"}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-semibold transition disabled:opacity-60",
                        selected
                          ? "border-brand-500/60 bg-brand-500/15 text-brand-200"
                          : "border-surface-700 text-surface-400 hover:border-surface-600"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {rail.method}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {activeProvider === "daraja" ? (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                M-Pesa number
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="07XX XXX XXX"
                disabled={state === "awaiting" || state === "loading"}
                className="mt-1 w-full rounded-lg border border-surface-700 bg-surface-950 px-2.5 py-2 text-xs text-surface-100 placeholder:text-surface-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
              />
              <span className="mt-1 block text-[10px] leading-relaxed text-surface-500">
                We&apos;ll send a payment request to this number — you approve it with your M-Pesa PIN. Nothing is
                charged until you do.
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => {
          if (!open && !free) {
            setOpen(true);
            return;
          }
          void subscribe();
        }}
        disabled={state === "loading" || state === "awaiting"}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all",
          state === "loading" || state === "awaiting"
            ? "bg-brand-600 cursor-not-allowed opacity-80 text-white"
            : free
              ? "border border-surface-700 text-surface-200 hover:bg-surface-800/60"
              : "bg-brand-500 text-white hover:bg-brand-600 shadow-glow"
        )}
      >
        {state === "loading" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Starting…
          </>
        ) : state === "awaiting" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Waiting for your PIN…
          </>
        ) : free ? (
          "Start free"
        ) : open ? (
          activeProvider === "daraja" ? (
            "Send M-Pesa request"
          ) : (
            "Continue to PayPal"
          )
        ) : (
          "Subscribe"
        )}
      </button>

      {state === "awaiting" && intentId ? (
        <p className="text-[11px] leading-relaxed text-surface-500">
          A prompt is on its way to {phone || "your phone"}. Enter your M-Pesa PIN to confirm — this page updates by
          itself once it lands.
        </p>
      ) : null}

      {message ? (
        <p
          className={cn(
            "text-[11px] leading-relaxed",
            state === "error"
              ? "text-red-400"
              : state === "done"
                ? "text-emerald-400"
                : "text-surface-400"
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
