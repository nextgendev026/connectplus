import { prisma } from "@/lib/prisma";
import { cacheIncr } from "@/lib/redis";

/**
 * Subscription quota enforcement.
 *
 * Rules:
 *  - ADMIN / SUPER_ADMIN are exempt from every quota (product decision: staff
 *    accounts must never be throttled by the subscription pipeline).
 *  - A user with NO active subscription is treated exactly like today — no
 *    caps are applied. Enforcing only kicks in once someone is on a plan that
 *    explicitly sets the limit (-1 / 9999+ / absent all mean "unlimited").
 */

export class QuotaError extends Error {
  constructor(
    public code: string,
    message: string,
    public limit?: number,
    public used?: number
  ) {
    super(message);
    this.name = "QuotaError";
  }
}

const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);

export function quotaExempt(role?: string | null): boolean {
  return ADMIN_ROLES.has(role ?? "");
}

type PlanLimits = Record<string, number>;

function parseLimits(raw: string): PlanLimits {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as PlanLimits) : {};
  } catch {
    return {};
  }
}

/** A limit that should actually throttle: null means "no cap". -1 and 9999+
 *  are documented as "unlimited" in the plan schema. */
function finite(limits: PlanLimits, key: string): number | null {
  const v = limits[key];
  if (v === undefined || v === null) return null;
  if (v < 0 || v >= 9999) return null;
  return v;
}

export interface ActiveSubscription {
  plan: {
    id: string;
    name: string;
    tier: string;
    audience: string;
    limits: PlanLimits;
  };
  billingCycle: "monthly" | "yearly";
  windowStart: Date;
}

/** The user's most recent active/trialing subscription, or null. */
export async function activeSubscription(
  userId: string
): Promise<ActiveSubscription | null> {
  const sub = await prisma.userSubscription.findFirst({
    where: { userId, status: { in: ["active", "trialing"] } },
    orderBy: { updatedAt: "desc" },
    include: { plan: true },
  });
  if (!sub) return null;
  return {
    plan: {
      id: sub.plan.id,
      name: sub.plan.name,
      tier: sub.plan.tier,
      audience: sub.plan.audience,
      limits: parseLimits(sub.plan.limits),
    },
    billingCycle: sub.billingCycle === "yearly" ? "yearly" : "monthly",
    windowStart: sub.currentPeriodStart,
  };
}

export interface QuotaStatus {
  enforced: boolean;
  limit: number | null;
  used: number;
}

const quotaError = (e: unknown) =>
  e instanceof QuotaError ? e : new QuotaError("QUOTA_CHECK_FAILED", (e as Error).message);

/** Monthly publishing cap — counts live + scheduled stories created inside the
 *  billing window, so drafts never eat an author's quota. */
export async function checkPostsQuota(
  userId: string,
  role?: string | null
): Promise<QuotaStatus> {
  if (quotaExempt(role)) return { enforced: false, limit: null, used: 0 };
  const sub = await activeSubscription(userId);
  const cap = sub ? finite(sub.plan.limits, "postsPerMonth") : null;
  if (cap === null) return { enforced: false, limit: null, used: 0 };

  const used = await prisma.post.count({
    where: {
      authorId: userId,
      createdAt: { gte: sub!.windowStart },
      OR: [{ status: "PUBLISHED" }, { scheduledAt: { not: null } }],
    },
  });

  if (used >= cap) {
    throw new QuotaError(
      "POST_LIMIT_REACHED",
      `You've used all ${cap} monthly ${cap === 1 ? "post" : "posts"} on this plan. Upgrade to keep publishing.`,
      cap,
      used
    );
  }
  return { enforced: true, limit: cap, used };
}

/** Daily AI request cap — atomic Redis counter per user per UTC day. */
export async function checkAiQuota(
  userId: string,
  role?: string | null
): Promise<QuotaStatus> {
  if (quotaExempt(role)) return { enforced: false, limit: null, used: 0 };
  const sub = await activeSubscription(userId);
  const cap = sub ? finite(sub.plan.limits, "aiRequestsPerDay") : null;
  if (cap === null) return { enforced: false, limit: null, used: 0 };

  const day = new Date().toISOString().slice(0, 10);
  const endOfDay = new Date();
  endOfDay.setUTCHours(23, 59, 59, 999);
  const ttl = Math.max(60, Math.round((endOfDay.getTime() - Date.now()) / 1000));
  const used = await cacheIncr(`ai:usage:${userId}:${day}`, ttl);

  if (used > cap) {
    throw new QuotaError(
      "AI_LIMIT_REACHED",
      `You've hit your daily AI request limit (${cap}). It resets at midnight UTC.`,
      cap,
      used - 1
    );
  }
  return { enforced: true, limit: cap, used };
}

/** Total bytes the user owns in the upload bucket (best-effort). */
async function storageUsedBytes(userId: string): Promise<number> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "uploads";
  if (!url || !key) return 0; // local fallback storage — count hits the DB only

  let total = 0;
  for (const prefix of [`post/${userId}/`, `cover/${userId}/`, `avatar/${userId}/`]) {
    try {
      const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefix, limit: 1001 }),
      });
      if (!res.ok) continue;
      const items = (await res.json()) as { name?: string; id?: string; metadata?: { size?: number } }[];
      for (const it of items) {
        if (it.id) total += it.metadata?.size ?? 0; // objects carry id; folders don't
      }
    } catch {
      /* best-effort — never fail an upload over a quota-meter hiccup */
    }
  }
  return total;
}

/** Storage cap (storageMb from the plan) against the Supabase bucket. */
export async function checkStorageQuota(
  userId: string,
  role?: string | null,
  incomingBytes = 0
): Promise<QuotaStatus> {
  if (quotaExempt(role)) return { enforced: false, limit: null, used: 0 };
  const sub = await activeSubscription(userId);
  const capMb = sub ? finite(sub.plan.limits, "storageMb") : null;
  if (capMb === null) return { enforced: false, limit: null, used: 0 };

  const capBytes = capMb * 1024 * 1024;
  const usedBytes = await storageUsedBytes(userId);
  if (usedBytes + incomingBytes > capBytes) {
    throw new QuotaError(
      "STORAGE_LIMIT_REACHED",
      `You've used ${Math.ceil(usedBytes / 1048576)}MB of ${capMb}MB storage. Upgrade to add more.`,
      capBytes,
      Math.ceil(usedBytes / 1048576)
    );
  }
  return { enforced: true, limit: capBytes, used: Math.ceil(usedBytes / 1048576) };
}

export { quotaError };