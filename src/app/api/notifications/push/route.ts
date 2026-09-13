import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { webPushConfigured } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST   /api/notifications/push — register this device
 * DELETE /api/notifications/push — release this device
 * GET    /api/notifications/push — is this device/production able to receive push?
 *
 * Subscriptions are rows now, not an array inside a settings blob, so:
 *   • two devices registering at once cannot clobber one another,
 *   • a rotated endpoint reassigns rather than duplicates (unique on endpoint),
 *   • one device is capped per user, so a shared browser cannot accumulate
 *     registrations forever.
 */

const MAX_ENDPOINTS_PER_USER = 10;
/** Push service URLs are long but bounded; anything huge is not a real endpoint. */
const MAX_ENDPOINT_LENGTH = 1200;

const log = createLogger("push-subscribe");

export async function GET() {
  const session = await auth();
  const configured = webPushConfigured();
  if (!session?.user?.id) return NextResponse.json({ subscribed: false, configured });

  const count = await prisma.pushSubscription
    .count({ where: { userId: session.user.id } })
    .catch(() => 0);
  return NextResponse.json({ subscribed: count > 0, configured, devices: count });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
    | null;

  const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh.trim() : "";
  const auth_ = typeof body?.keys?.auth === "string" ? body.keys.auth.trim() : "";

  if (!endpoint || !p256dh || !auth_) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  if (endpoint.length > MAX_ENDPOINT_LENGTH || !/^https:\/\//.test(endpoint)) {
    return NextResponse.json({ error: "Invalid push endpoint" }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;

  try {
    // `endpoint` is globally unique, so upserting on it both rotates ownership
    // when a device changes hands and refreshes an existing registration.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId: session.user.id,
        p256dh,
        auth: auth_,
        userAgent,
        failures: 0,
        lastSeenAt: new Date(),
      },
      create: { userId: session.user.id, endpoint, p256dh, auth: auth_, userAgent },
    });

    // Keep only the most recent devices for this user, oldest first.
    const extra = await prisma.pushSubscription.findMany({
      where: { userId: session.user.id },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true },
      skip: MAX_ENDPOINTS_PER_USER,
    });
    if (extra.length > 0) {
      await prisma.pushSubscription
        .deleteMany({ where: { id: { in: extra.map((e) => e.id) } } })
        .catch(() => null);
    }

    return NextResponse.json({ ok: true, subscribed: true, configured: webPushConfigured() });
  } catch (error) {
    log.error("failed to save push subscription", { error: String(error) });
    return NextResponse.json({ error: "Failed to save subscription" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Prefer an exact endpoint so turning alerts off on the phone does not also
  // silence the desktop; fall back to "this user, all devices".
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  await prisma.pushSubscription
    .deleteMany({
      where: {
        userId: session.user.id,
        ...(endpoint ? { endpoint } : {}),
      },
    })
    .catch(() => null);

  return NextResponse.json({ ok: true, subscribed: false });
}
