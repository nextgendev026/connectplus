import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateBody } from "@/lib/api-validation";
import { NotificationsReadSchema } from "@/lib/schemas/validators";

/**
 * Mark notifications as read.
 *
 * Three things were wrong here, and together they made "marked as read" look
 * like a lie:
 *
 *   1. **The write often did not happen.** This route reads `ids` and `all`,
 *      and the bell sent `{ id }` while the "Mark all read" button sent `{}`.
 *      Zod strips unknown keys instead of rejecting them, so both bodies
 *      validated to `{}` — a 200 saying nothing had changed, which the UI
 *      ignored because it had already updated itself optimistically. The row
 *      then came back unread on the next fetch. `id` and `all` are both
 *      accepted now, and a body that asks for neither is answered honestly
 *      rather than with a fabricated zero.
 *
 *   2. **Only the first id was marked.** `body.ids` was sliced to `ids[0]`, so
 *      a batch of ids marked exactly one. Every id is now marked in one
 *      scoped `updateMany`.
 *
 *   3. **The reply could zero the badge.** The no-op branches returned
 *      `unreadCount: 0`, so a no-op told the client it had nothing unread. The
 *      count is now always the real one, read after the write.
 *
 * Both writes are scoped to the session's own id, so an id belonging to someone
 * else is not an error to report — it just is not in the result.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await validateBody(request, NotificationsReadSchema);
    if (body instanceof NextResponse) return body;

    // `id` is the legacy singular key; fold it into the list so there is one
    // write path rather than two that can drift.
    const ids = [...(body.ids ?? []), ...(body.id ? [body.id] : [])];

    let updated = 0;
    if (body.all) {
      const result = await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
      updated = result.count;
    } else if (ids.length > 0) {
      const result = await prisma.notification.updateMany({
        where: { id: { in: ids }, userId, read: false },
        data: { read: true },
      });
      updated = result.count;
    }

    // Read after the write, so the badge the caller renders matches the rows
    // it will fetch next — a count computed before would report the state the
    // reader just changed.
    const unreadCount = await prisma.notification.count({
      where: { userId, read: false },
    });

    return NextResponse.json({ updated: updated > 0, updatedCount: updated, unreadCount });
  } catch (error) {
    console.error("Error marking notifications read:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
