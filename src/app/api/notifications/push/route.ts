import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/push — Subscribe to push notifications
 * DELETE /api/notifications/push — Unsubscribe
 * GET /api/notifications/push — Check subscription status
 *
 * Stores push subscription in a simple JSON field on User (via a
 * PlatformSetting for now — avoids schema migration). In production you'd
 * use a PushSubscription table.
 */

// In-memory store (backed by Redis in prod) for push subscriptions
// Format: { endpoint: { userId, subscription, createdAt } }
// We store this in PlatformSetting as a JSON array for zero-migration.

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userId: string;
  createdAt: string;
}

async function getSubscriptions(): Promise<PushSub[]> {
  try {
    const raw = await prisma.platformSetting.findUnique({
      where: { key: "push_subscriptions" },
      select: { value: true },
    });
    if (!raw?.value) return [];
    return JSON.parse(raw.value) as PushSub[];
  } catch {
    return [];
  }
}

async function saveSubscriptions(subs: PushSub[]): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: "push_subscriptions" },
    update: { value: JSON.stringify(subs) },
    create: {
      key: "push_subscriptions",
      value: JSON.stringify(subs),
      group: "plugins",
      label: "Push subscriptions",
      type: "textarea",
      isSecret: true,
    },
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ subscribed: false });
  }

  const subs = await getSubscriptions();
  const hasSub = subs.some((s) => s.userId === session.user!.id);
  return NextResponse.json({ subscribed: hasSub });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { endpoint, keys } = body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    const subs = await getSubscriptions();
    // Remove any existing sub for this user or endpoint
    const filtered = subs.filter(
      (s) => s.userId !== session.user!.id && s.endpoint !== endpoint
    );

    filtered.push({
      endpoint,
      keys,
      userId: session.user!.id,
      createdAt: new Date().toISOString(),
    });

    await saveSubscriptions(filtered);
    return NextResponse.json({ ok: true, subscribed: true });
  } catch {
    return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const subs = await getSubscriptions();
  const filtered = subs.filter((s) => s.userId !== session.user!.id);
  await saveSubscriptions(filtered);

  return NextResponse.json({ ok: true, subscribed: false });
}
