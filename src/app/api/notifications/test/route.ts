import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/test — write one real notification for the caller.
 *
 * Deliberately creates a genuine row rather than returning a canned response.
 * The pipeline spans four independently-failable stages — the database write,
 * the number badge, the list render, and the desktop notification — so a button
 * that only *looks* like it worked teaches the reader nothing. Running the real
 * path means "I pressed it and nothing happened" is now a diagnosable signal
 * instead of a mystery.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const notification = await createNotification({
    userId: session.user.id,
    type: "SYSTEM_TEST",
    title: "Alerts are working",
    message:
      "This is a test alert. You'll get one of these when someone replies to you, or when a match you follow kicks off or scores.",
  });

  if (!notification) {
    return NextResponse.json(
      { ok: false, error: "The notification could not be saved — check the database connection." },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, id: notification.id });
}
