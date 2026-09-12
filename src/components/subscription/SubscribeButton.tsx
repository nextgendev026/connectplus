"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Subscribes the signed-in user to a plan. Anonymous visitors are routed to
 *  sign-in with a callback back to the pricing page so they land where they
 *  left off. */
export function SubscribeButton({
  planId,
  planName,
  billingCycle = "monthly",
  signedIn,
  current,
  free,
  className,
}: {
  planId: string;
  planName: string;
  billingCycle?: "monthly" | "yearly";
  signedIn: boolean;
  current?: boolean;
  free?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

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
        body: JSON.stringify({ action: "subscribe", planId, billingCycle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setMessage(data?.error ?? "Could not start the subscription.");
        return;
      }
      // Paid plans bounce to Stripe's hosted Checkout; free grants apply here.
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
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

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={subscribe}
        disabled={state === "loading"}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all",
          state === "loading"
            ? "bg-brand-600 cursor-not-allowed opacity-70 text-white"
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
        ) : free ? (
          "Start free"
        ) : (
          "Subscribe"
        )}
      </button>
      {message && (
        <p
          className={cn(
            "text-[11px] leading-relaxed",
            state === "error" ? "text-red-400" : "text-emerald-400"
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}
