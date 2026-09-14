import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { redisDel } from "@/lib/redis";
import {
  getSportsStats,
  lastSportsSources,
  providerInfo,
  sportsCoverage,
  sportsEngineCounters,
  REFERRAL_PLACEMENTS,
  slugify,
  sportsDbKeyState,
} from "@/lib/sports";
import { runSportsIntelligence, sportsTrends } from "@/lib/sports-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("admin-sports");

async function requireAdmin(): Promise<{ id: string; role: string } | null> {
  const session = await auth();
  const role = session?.user?.role;
  const id = session?.user?.id;
  if (!id || (role !== "ADMIN" && role !== "SUPER_ADMIN")) return null;
  return { id, role };
}

const DAY_MS = 86_400_000;

/** GET /api/admin/sports — the console's whole world in one response. */
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const since = new Date(Date.now() - 14 * DAY_MS);
    const [stats, trends, referrals, predictions, activity, provider, coverage] = await Promise.all([
      getSportsStats(),
      sportsTrends(),
      prisma.bettingReferral.findMany({ orderBy: [{ weight: "desc" }, { createdAt: "desc" }] }).catch(() => []),
      prisma.sportsPrediction
        .findMany({
          orderBy: { createdAt: "desc" },
          take: 25,
          include: {
            match: { select: { homeTeam: true, awayTeam: true, competition: true, status: true } },
          },
        })
        .catch(() => []),
      prisma.sportsActivity
        .findMany({
          where: { createdAt: { gte: since } },
          select: { type: true, createdAt: true, referralId: true },
          orderBy: { createdAt: "desc" },
          take: 2000,
        })
        .catch(() => []),
      Promise.resolve(providerInfo()),
      // What the model could actually see on today's board, and what the odds
      // backfill and deep-data resolver have done since this process started.
      sportsCoverage().catch(() => null),
    ]);

    // Source health + notification activity: what the merged board actually
    // pulled, and whether the favourite-alert pipeline is keeping up.
    const [sent24h, reminderCount, lastLog] = await Promise.all([
      prisma.sportsNotificationLog
        .count({ where: { createdAt: { gte: new Date(Date.now() - DAY_MS) } } })
        .catch(() => 0),
      prisma.sportsMatchReminder.count().catch(() => 0),
      prisma.sportsNotificationLog
        .findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } })
        .catch(() => null),
    ]);

    const series: Record<string, number> = {};
    const dayBuckets: { date: string; impressions: number; clicks: number; views: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      dayBuckets.push({ date: new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10), impressions: 0, clicks: 0, views: 0 });
    }
    const index = new Map(dayBuckets.map((d) => [d.date, d]));
    for (const row of activity) {
      const day = row.createdAt.toISOString().slice(0, 10);
      series[row.type] = (series[row.type] ?? 0) + 1;
      const bucket = index.get(day);
      if (!bucket) continue;
      if (row.type === "referral_impression") bucket.impressions++;
      else if (row.type === "referral_click") bucket.clicks++;
      else if (row.type === "match_view" || row.type === "prediction_view") bucket.views++;
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      stats,
      trends,
      provider,
      sources: lastSportsSources(),
      sportsDbKey: sportsDbKeyState(),
      coverage,
      engine: sportsEngineCounters(),
      notifications: {
        sent24h,
        reminders: reminderCount,
        lastSentAt: lastLog?.createdAt ?? null,
      },
      placements: REFERRAL_PLACEMENTS,
      referrals,
      predictions,
      activity: { series, days: dayBuckets },
    });
  } catch (error) {
    log.error("admin sports overview failed", { error: String(error) });
    return NextResponse.json({ error: "Failed to load sports console" }, { status: 500 });
  }
}

interface ReferralPayload {
  id?: string;
  name?: string;
  region?: string;
  urlTemplate?: string;
  referralCode?: string;
  bonus?: string;
  description?: string;
  logoUrl?: string;
  placement?: string;
  ctaText?: string;
  weight?: number;
  isActive?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

/** POST /api/admin/sports — referral CRUD plus an on-demand analyser run. */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    referral?: ReferralPayload;
    limit?: number;
  };
  const action = body.action ?? "";

  try {
    if (action === "sync") {
      const result = await runSportsIntelligence({ limit: body.limit ?? 40, teach: true });
      await invalidateReferralCache();
      return NextResponse.json({ ok: true, action, result });
    }

    if (action === "create-referral") {
      const payload = body.referral ?? {};
      const name = (payload.name ?? "").trim();
      const urlTemplate = (payload.urlTemplate ?? "").trim();
      if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
      if (!/^https?:\/\//i.test(urlTemplate)) {
        return NextResponse.json({ error: "Destination must be an http(s) URL template" }, { status: 400 });
      }

      let slug = slugify(name);
      const clash = await prisma.bettingReferral.findUnique({ where: { slug } });
      if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

      const created = await prisma.bettingReferral.create({
        data: {
          name: name.slice(0, 120),
          slug,
          region: emptyToNull(payload.region),
          urlTemplate,
          referralCode: emptyToNull(payload.referralCode),
          bonus: emptyToNull(payload.bonus),
          description: emptyToNull(payload.description),
          logoUrl: emptyToNull(payload.logoUrl),
          placement: validPlacement(payload.placement),
          ctaText: (payload.ctaText ?? "Join & claim").slice(0, 60),
          weight: clampWeight(payload.weight),
          isActive: payload.isActive ?? true,
          startsAt: parseDate(payload.startsAt),
          endsAt: parseDate(payload.endsAt),
          createdBy: admin.id,
        },
      });
      await invalidateReferralCache();
      return NextResponse.json({ ok: true, action, referral: created });
    }

    if (action === "update-referral") {
      const payload = body.referral ?? {};
      if (!payload.id) return NextResponse.json({ error: "Referral id is required" }, { status: 400 });
      const updated = await prisma.bettingReferral.update({
        where: { id: payload.id },
        data: {
          ...(payload.name != null ? { name: payload.name.slice(0, 120) } : {}),
          ...(payload.region !== undefined ? { region: emptyToNull(payload.region) } : {}),
          ...(payload.urlTemplate != null ? { urlTemplate: payload.urlTemplate } : {}),
          ...(payload.referralCode !== undefined ? { referralCode: emptyToNull(payload.referralCode) } : {}),
          ...(payload.bonus !== undefined ? { bonus: emptyToNull(payload.bonus) } : {}),
          ...(payload.description !== undefined ? { description: emptyToNull(payload.description) } : {}),
          ...(payload.logoUrl !== undefined ? { logoUrl: emptyToNull(payload.logoUrl) } : {}),
          ...(payload.placement != null ? { placement: validPlacement(payload.placement) } : {}),
          ...(payload.ctaText != null ? { ctaText: payload.ctaText.slice(0, 60) } : {}),
          ...(payload.weight != null ? { weight: clampWeight(payload.weight) } : {}),
          ...(payload.isActive != null ? { isActive: payload.isActive } : {}),
          ...(payload.startsAt !== undefined ? { startsAt: parseDate(payload.startsAt) } : {}),
          ...(payload.endsAt !== undefined ? { endsAt: parseDate(payload.endsAt) } : {}),
        },
      });
      await invalidateReferralCache();
      return NextResponse.json({ ok: true, action, referral: updated });
    }

    if (action === "toggle-referral") {
      const payload = body.referral ?? {};
      if (!payload.id) return NextResponse.json({ error: "Referral id is required" }, { status: 400 });
      const current = await prisma.bettingReferral.findUnique({ where: { id: payload.id } });
      if (!current) return NextResponse.json({ error: "Referral not found" }, { status: 404 });
      const updated = await prisma.bettingReferral.update({
        where: { id: payload.id },
        data: { isActive: !current.isActive },
      });
      await invalidateReferralCache();
      return NextResponse.json({ ok: true, action, referral: updated });
    }

    if (action === "delete-referral") {
      const payload = body.referral ?? {};
      if (!payload.id) return NextResponse.json({ error: "Referral id is required" }, { status: 400 });
      await prisma.bettingReferral.delete({ where: { id: payload.id } });
      await invalidateReferralCache();
      return NextResponse.json({ ok: true, action });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    log.error("admin sports action failed", { action, error: String(error) });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Action failed" }, { status: 500 });
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampWeight(value: number | undefined): number {
  const n = Number(value ?? 1);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 100) : 1;
}

function validPlacement(value: string | undefined): string {
  return value && (REFERRAL_PLACEMENTS as readonly string[]).includes(value)
    ? value
    : "sports-sidebar";
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function invalidateReferralCache(): Promise<void> {
  await Promise.all(
    ["sports:referrals:all", ...REFERRAL_PLACEMENTS.map((p) => `sports:referrals:${p}`)].map((k) =>
      redisDel(k).catch(() => {})
    )
  );
}
