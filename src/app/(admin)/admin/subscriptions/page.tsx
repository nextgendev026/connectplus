"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CreditCard,
  Users,
  Crown,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Star,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Plan {
  id: string;
  name: string;
  displayName: string;
  tier: string;
  audience: string;
  priceMonthly: number;
  priceYearly: number;
  features: string[];
  limits: Record<string, number>;
  sortOrder: number;
}

const TIER_COLORS: Record<string, string> = {
  free: "bg-surface-200/70 text-surface-600 dark:bg-surface-800 dark:text-surface-300",
  pro: "bg-brand-500/15 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400",
  premium: "bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
};

const TIER_ICONS: Record<string, typeof Star> = {
  free: Zap,
  pro: Crown,
  premium: Star,
};

export default function SubscriptionsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<"all" | "reader" | "writer">("all");

  const fetchPlans = useCallback(async () => {
    try {
      setLoading(true);
      const url = audience === "all" ? "/api/subscription/plans" : `/api/subscription/plans?audience=${audience}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load plans (${res.status})`);
      const data = await res.json();
      setPlans(data.plans ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, [audience]);

  useEffect(() => {
    void fetchPlans();
  }, [fetchPlans]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1400px] space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/20">
              <CreditCard className="h-6 w-6 text-brand-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-surface-900 dark:text-surface-50">Subscriptions</h1>
              <p className="text-sm text-surface-500">
                Manage subscription plans for readers and writers. 3 tiers each: Free, Pro, Premium.
              </p>
            </div>
          </div>
          <button
            onClick={() => void fetchPlans()}
            disabled={loading}
            className="rounded-lg border border-surface-200 p-2 text-surface-500 transition hover:border-brand-500/50 dark:border-surface-700"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>

        {/* Audience filter */}
        <div className="flex gap-2">
          {(["all", "reader", "writer"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAudience(a)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all",
                audience === a
                  ? "bg-brand-500 text-white shadow-sm"
                  : "bg-surface-200/70 text-surface-600 hover:bg-surface-300/70 dark:bg-surface-800 dark:text-surface-300"
              )}
            >
              {a === "all" ? "All Plans" : `${a}s`}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm font-medium text-red-600">
            <XCircle className="h-4 w-4 shrink-0" />
            {error}
            <button onClick={() => void fetchPlans()} className="ml-auto text-xs underline hover:text-red-400">
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
          </div>
        ) : (
          <>
            {/* Reader Plans */}
            {(audience === "all" || audience === "reader") && (
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-surface-500">
                  <Users className="mr-1 inline-block h-4 w-4" /> Reader Plans
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {plans
                    .filter((p) => p.audience === "reader")
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((plan) => {
                      const TierIcon = TIER_ICONS[plan.tier] ?? Zap;
                      return (
                        <article
                          key={plan.id}
                          className={cn(
                            "rounded-2xl border p-5 transition-all",
                            plan.tier === "premium"
                              ? "border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent"
                              : plan.tier === "pro"
                                ? "border-brand-500/30 bg-gradient-to-br from-brand-500/5 to-transparent"
                                : "border-surface-200/70 bg-white dark:border-surface-800 dark:bg-surface-900"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", TIER_COLORS[plan.tier])}>
                              <TierIcon className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="font-bold text-surface-900 dark:text-surface-50">{plan.displayName}</h3>
                              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", TIER_COLORS[plan.tier])}>
                                {plan.tier}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3">
                            <span className="text-3xl font-bold text-surface-900 dark:text-surface-50">
                              ${plan.priceMonthly}
                            </span>
                            <span className="text-sm text-surface-500">/mo</span>
                            {plan.priceYearly > 0 && (
                              <span className="ml-2 text-xs text-surface-400">
                                (${(plan.priceYearly / 12).toFixed(2)}/mo yearly)
                              </span>
                            )}
                          </div>
                          <ul className="mt-3 space-y-1.5">
                            {plan.features.map((f, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-surface-600 dark:text-surface-300">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                {f}
                              </li>
                            ))}
                          </ul>
                        </article>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Writer Plans */}
            {(audience === "all" || audience === "writer") && (
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-surface-500">
                  <Zap className="mr-1 inline-block h-4 w-4" /> Writer Plans
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {plans
                    .filter((p) => p.audience === "writer")
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((plan) => {
                      const TierIcon = TIER_ICONS[plan.tier] ?? Zap;
                      return (
                        <article
                          key={plan.id}
                          className={cn(
                            "rounded-2xl border p-5 transition-all",
                            plan.tier === "premium"
                              ? "border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent"
                              : plan.tier === "pro"
                                ? "border-brand-500/30 bg-gradient-to-br from-brand-500/5 to-transparent"
                                : "border-surface-200/70 bg-white dark:border-surface-800 dark:bg-surface-900"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", TIER_COLORS[plan.tier])}>
                              <TierIcon className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="font-bold text-surface-900 dark:text-surface-50">{plan.displayName}</h3>
                              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", TIER_COLORS[plan.tier])}>
                                {plan.tier}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3">
                            <span className="text-3xl font-bold text-surface-900 dark:text-surface-50">
                              ${plan.priceMonthly}
                            </span>
                            <span className="text-sm text-surface-500">/mo</span>
                            {plan.priceYearly > 0 && (
                              <span className="ml-2 text-xs text-surface-400">
                                (${(plan.priceYearly / 12).toFixed(2)}/mo yearly)
                              </span>
                            )}
                          </div>
                          <ul className="mt-3 space-y-1.5">
                            {plan.features.map((f, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-surface-600 dark:text-surface-300">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                {f}
                              </li>
                            ))}
                          </ul>
                        </article>
                      );
                    })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
