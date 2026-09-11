import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(role?: string) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/** GET /api/admin/subscriptions — subscriber counts, MRR and recent activity. */
export async function GET() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [byStatus, byPlan, recent, plans] = await Promise.all([
    prisma.userSubscription.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    prisma.userSubscription.groupBy({
      by: ["planId", "billingCycle"],
      where: { status: "active" },
      _count: { id: true },
    }),
    prisma.userSubscription.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        plan: { select: { displayName: true, tier: true, audience: true } },
        user: { select: { name: true, username: true, email: true } },
      },
    }),
    prisma.subscriptionPlan.findMany({ select: { id: true, displayName: true, audience: true, tier: true, priceMonthly: true, priceYearly: true } }),
  ]);

  const planMap = new Map(plans.map((p) => [p.id, p]));

  // Monthly recurring revenue: monthly subs bill at priceMonthly, yearly at
  // priceYearly/12. Free tiers contribute nothing.
  let mrr = 0;
  const planBreakdown = byPlan.map((row) => {
    const plan = planMap.get(row.planId);
    const count = row._count.id;
    const perMonth = plan
      ? row.billingCycle === "yearly"
        ? plan.priceYearly / 12
        : plan.priceMonthly
      : 0;
    mrr += perMonth * count;
    return {
      planId: row.planId,
      displayName: plan?.displayName ?? "Unknown plan",
      audience: plan?.audience ?? "reader",
      tier: plan?.tier ?? "free",
      billingCycle: row.billingCycle,
      count,
      perMonth,
    };
  });

  const active = byStatus.find((s) => s.status === "active")?._count.id ?? 0;
  const cancelling = await prisma.userSubscription.count({ where: { cancelAtPeriodEnd: true } });

  return NextResponse.json({
    totals: {
      active,
      cancelling,
      mrr: Number(mrr.toFixed(2)),
      arr: Number((mrr * 12).toFixed(2)),
    },
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count.id })),
    byPlan: planBreakdown.sort((a, b) => b.count - a.count),
    recent: recent.map((s) => ({
      id: s.id,
      status: s.status,
      billingCycle: s.billingCycle,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      createdAt: s.createdAt,
      currentPeriodEnd: s.currentPeriodEnd,
      plan: s.plan,
      user: {
        name: s.user.name,
        username: s.user.username,
        email: s.user.email,
      },
    })),
  });
}
