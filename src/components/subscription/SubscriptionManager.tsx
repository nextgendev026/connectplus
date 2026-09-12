"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Loader2, Check, AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";

interface SubView {
  id: string;
  status: string;
  billingCycle: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  usageThisPeriod: number;
  plan: {
    id: string;
    displayName: string;
    tier: string;
    audience: string;
    priceMonthly: number;
    priceYearly: number;
    features: string[];
    limits: Record<string, number>;
  };
  managedByStripe?: boolean;
}

/**
 * Self-service membership control: shows every active/cancelled subscription
 * and lets the member cancel (at period end) or reactivate it. Billing state is
 * always re-read from the API after a mutation so the UI can't drift.
 */
export function SubscriptionManager() {
  const [subs, setSubs] = useState<SubView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/subscription/manage", { cache: "no-store" });
      if (!res.ok) {
        setError("Could not load your memberships.");
        setSubs([]);
        return;
      }
      const data = await res.json();
      setSubs(data.subscriptions ?? []);
    } catch {
      setError("Network error — could not load memberships.");
      setSubs([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: "cancel" | "reactivate", subscriptionId: string) {
    setBusy(subscriptionId);
    setError(null);
    try {
      const res = await fetch("/api/subscription/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, subscriptionId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "That action could not be completed.");
      } else {
        await load();
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function openBillingPortal(subscriptionId: string) {
    setBusy(subscriptionId);
    setError(null);
    try {
      const res = await fetch("/api/subscription/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "portal", subscriptionId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.portalUrl) {
        setError(d?.error ?? "Could not open the billing portal.");
        return;
      }
      window.location.assign(d.portalUrl);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!subs) {
    return (
      <div className="flex items-center gap-2 text-xs text-surface-500 py-6">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading your memberships…
      </div>
    );
  }

  const freePlanNames = ["reader-free", "writer-free"];

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-300 leading-relaxed">{error}</p>
        </div>
      )}

      {subs.length === 0 ? (
        <div className="rounded-xl border border-surface-800/60 bg-surface-900/40 p-5">
          <p className="text-sm text-surface-200 font-medium">No active membership</p>
          <p className="text-xs text-surface-500 mt-1 leading-relaxed">
            You&apos;re on the free experience. Compare the reader and writer tiers to unlock
            ad-light reading, analytics and publishing tools.
          </p>
          <Link
            href="/pricing"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-brand-600 transition-colors"
          >
            Browse plans
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        subs.map((s) => {
          const cancelling = s.cancelAtPeriodEnd;
          const ends = new Date(s.currentPeriodEnd).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
          const isFree = freePlanNames.includes(s.plan.tier === "free" ? "x" : "x") || s.plan.priceMonthly === 0;
          return (
            <div
              key={s.id}
              className="rounded-xl border border-surface-800/60 bg-surface-900/40 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-surface-50">
                      {s.plan.displayName}
                    </h4>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        cancelling
                          ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                          : s.status === "active"
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : "bg-surface-800 text-surface-400 border border-surface-700"
                      )}
                    >
                      {cancelling ? "Ends soon" : s.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-surface-500 capitalize">
                    {s.plan.audience} · {s.billingCycle} billing
                    {!isFree && s.plan.priceMonthly > 0
                      ? ` · $${s.billingCycle === "yearly" ? s.plan.priceYearly : s.plan.priceMonthly}`
                      : ""}
                  </p>
                  {!isFree && (
                    <p className="mt-0.5 text-[11px] text-surface-500">
                      {cancelling ? "Access until" : "Renews"} {ends}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {s.managedByStripe && (
                    <button
                      type="button"
                      disabled={busy === s.id}
                      onClick={() => openBillingPortal(s.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-[11px] font-semibold text-brand-300 hover:bg-brand-500/20 transition-colors disabled:opacity-60"
                    >
                      {busy === s.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ArrowRight className="w-3.5 h-3.5" />
                      )}
                      Manage billing
                    </button>
                  )}
                  {cancelling ? (
                    <button
                      type="button"
                      disabled={busy === s.id}
                      onClick={() => act("reactivate", s.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-[11px] font-semibold text-brand-300 hover:bg-brand-500/20 transition-colors disabled:opacity-60"
                    >
                      {busy === s.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      Reactivate
                    </button>
                  ) : (
                    !isFree && (
                      <button
                        type="button"
                        disabled={busy === s.id}
                        onClick={() => act("cancel", s.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 px-3 py-2 text-[11px] font-medium text-surface-300 hover:bg-surface-800/60 transition-colors disabled:opacity-60"
                      >
                        {busy === s.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Cancel
                      </button>
                    )
                  )}
                </div>
              </div>

              {s.plan.features.length > 0 && (
                <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {s.plan.features.slice(0, 6).map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-1.5 text-[11px] text-surface-400 leading-relaxed"
                    >
                      <Check className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
