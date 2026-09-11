import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { SubscribeButton } from "@/components/subscription/SubscribeButton";
import { Check, Sparkles, BookOpen, PenLine, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — connectPlus",
  description:
    "Support independent East African journalism. Choose a reader or writer plan that fits how you read and publish.",
  alternates: { canonical: "/pricing" },
};

interface PlanView {
  id: string;
  name: string;
  displayName: string;
  tier: string;
  audience: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  features: string[];
  limits: Record<string, number>;
}

function parsePlan(p: {
  id: string;
  name: string;
  displayName: string;
  tier: string;
  audience: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  features: string;
  limits: string;
}): PlanView {
  let features: string[] = [];
  let limits: Record<string, number> = {};
  try {
    features = JSON.parse(p.features);
  } catch {
    features = [];
  }
  try {
    limits = JSON.parse(p.limits);
  } catch {
    limits = {};
  }
  return { ...p, features, limits };
}

function PlanCard({
  plan,
  signedIn,
  activePlanIds,
  billingCycle,
}: {
  plan: PlanView;
  signedIn: boolean;
  activePlanIds: Set<string>;
  billingCycle: "monthly" | "yearly";
}) {
  const free = plan.priceMonthly === 0 && plan.priceYearly === 0;
  const price = billingCycle === "yearly" ? plan.priceYearly : plan.priceMonthly;
  const popular = plan.tier === "pro";
  const current = activePlanIds.has(plan.id);

  const limitEntries = Object.entries(plan.limits).filter(
    ([, v]) => typeof v === "number" && !Number.isNaN(v)
  );

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border p-6 transition-all",
        popular
          ? "border-brand-500/40 bg-gradient-to-b from-brand-500/10 to-surface-900/60 shadow-glow"
          : "border-surface-800/60 bg-surface-900/50 hover:border-surface-700"
      )}
    >
      {popular && (
        <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-brand-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
          <Sparkles className="w-3 h-3" />
          Most popular
        </span>
      )}

      <h3 className="text-lg font-display font-bold text-surface-50">{plan.displayName}</h3>
      <p className="mt-1 text-[11px] uppercase tracking-wider text-surface-500">{plan.tier}</p>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold text-surface-50">
          {price === 0 ? "Free" : `$${price}`}
        </span>
        {price > 0 && (
          <span className="text-xs text-surface-500">
            /{billingCycle === "yearly" ? "year" : "month"}
          </span>
        )}
      </div>

      <ul className="mt-6 space-y-2.5 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-xs text-surface-300 leading-relaxed">
            <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
            <span>{f}</span>
          </li>
        ))}
        {limitEntries.map(([k, v]) => {
          // -1 and 9999+ both mean "no cap" in the plan limits schema.
          const unlimited = v < 0 || v >= 9999;
          return (
            <li key={k} className="flex items-start gap-2 text-xs text-surface-400 leading-relaxed">
              <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-surface-600" />
              <span>
                {unlimited ? "Unlimited" : v} {k.replace(/([A-Z])/g, " $1").toLowerCase()}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-6">
        <SubscribeButton
          planId={plan.id}
          planName={plan.displayName}
          billingCycle={billingCycle}
          signedIn={signedIn}
          current={current}
          free={free}
        />
      </div>
    </div>
  );
}

export default async function PricingPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [plans, subscriptions] = await Promise.all([
    prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: [{ audience: "asc" }, { sortOrder: "asc" }],
    }),
    userId
      ? prisma.userSubscription.findMany({
          where: { userId, status: "active" },
          select: { planId: true },
        })
      : Promise.resolve([]),
  ]);

  const activePlanIds = new Set(subscriptions.map((s) => s.planId));
  const parsed = plans.map(parsePlan);
  const readerPlans = parsed.filter((p) => p.audience === "reader");
  const writerPlans = parsed.filter((p) => p.audience === "writer");

  return (
    <div className="min-h-screen bg-surface-950 text-surface-50">
      <div className="relative overflow-hidden border-b border-surface-800/50">
        <div className="absolute inset-0 bg-mesh-gradient" />
        <div className="relative max-w-5xl mx-auto px-6 py-16 md:py-20 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-300">
            <Sparkles className="w-3 h-3" />
            Membership
          </span>
          <h1 className="mt-5 text-3xl md:text-5xl font-display font-bold leading-tight">
            Support the stories that matter
          </h1>
          <p className="mt-4 max-w-2xl mx-auto text-sm md:text-base text-surface-400 leading-relaxed">
            Every plan funds independent reporting from across East Africa. Readers get an
            ad-light, personalised experience; writers get the tools to publish, grow and get
            paid.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-14 space-y-14">
        {[
          {
            title: "For readers",
            subtitle: "Read deeper, with fewer interruptions.",
            icon: BookOpen,
            plans: readerPlans,
          },
          {
            title: "For writers",
            subtitle: "Publish, grow your audience and monetise your work.",
            icon: PenLine,
            plans: writerPlans,
          },
        ].map((group) => (
          <section key={group.title}>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                <group.icon className="w-4 h-4 text-brand-400" />
              </div>
              <div>
                <h2 className="text-lg font-display font-bold text-surface-50">{group.title}</h2>
                <p className="text-xs text-surface-500">{group.subtitle}</p>
              </div>
            </div>

            {group.plans.length === 0 ? (
              <p className="text-sm text-surface-500">
                Plans are being finalised — check back shortly.
              </p>
            ) : (
              <div className="grid gap-6 md:grid-cols-3">
                {group.plans.map((p) => (
                  <PlanCard
                    key={p.id}
                    plan={p}
                    signedIn={signedIn}
                    activePlanIds={activePlanIds}
                    billingCycle="monthly"
                  />
                ))}
              </div>
            )}
          </section>
        ))}

        <div className="rounded-2xl border border-surface-800/60 bg-surface-900/50 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-surface-100">Manage your membership</h3>
            <p className="text-xs text-surface-500 mt-1">
              Change plans, switch to yearly billing or cancel — any time, from your settings.
            </p>
          </div>
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 rounded-xl border border-surface-700 px-4 py-2.5 text-xs font-semibold text-surface-200 hover:bg-surface-800/60 transition-colors shrink-0"
          >
            Go to settings
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
