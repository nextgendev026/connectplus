import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redisIncr } from "@/lib/redis";
import { deletePostWithCleanup } from "@/lib/post-lifecycle";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("admin-posts");

/**
 * Delete posts from the console.
 *
 * `DELETE /api/posts/<id>` already allowed a moderator to remove any post, but
 * nothing in the admin console called it — the console could feature a story,
 * re-file it into a category and change its status, and had no way to take one
 * down. An operation that exists only as an API call is not one an operator can
 * use, and "the admin should be able to delete any post" is a statement about
 * the console, not the route.
 *
 * Removal here is unconditional by design: an admin can delete another author's
 * story, a scheduled one, a rejected one, an imported one. That is the point of
 * a moderation console, and the alternative — refusing because the row is not
 * in the right state — is how a console ends up unable to remove the one post
 * that most needs removing. The role is re-read from the database rather than
 * taken from the session, because a JWT carries a role snapshot that can be up
 * to a few minutes stale, and a destructive permission is the wrong one to
 * accept from cache.
 */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (user?.role !== "ADMIN" && user?.role !== "SUPER_ADMIN") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { actorId: session.user.id };
}

/** Bounded so one request cannot try to delete an unbounded set. */
const MAX_PER_REQUEST = 100;

export async function DELETE(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((v): v is string => typeof v === "string" && v.trim().length > 0).slice(0, MAX_PER_REQUEST)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "No posts selected." }, { status: 400 });
  }

  // Slugs first, because the cache revalidation below needs them and the
  // deletion removes the only place they are recorded.
  const posts = await prisma.post.findMany({
    where: { id: { in: ids } },
    select: { id: true, slug: true, title: true },
  });

  const deleted: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  const totals = { rssArticlesDetached: 0, pageViewsDetached: 0, saveClaimsRemoved: 0 };

  // Sequential rather than concurrent: this runs against the same small free-tier
  // connection pool everything else uses, and a hundred parallel deletes is how a
  // bulk action takes the site down with it.
  for (const post of posts) {
    try {
      const cleaned = await deletePostWithCleanup(post.id);
      totals.rssArticlesDetached += cleaned.rssArticlesDetached;
      totals.pageViewsDetached += cleaned.pageViewsDetached;
      totals.saveClaimsRemoved += cleaned.saveClaimsRemoved;
      deleted.push(post.id);
      revalidatePath(`/article/${post.slug}`);
    } catch (error) {
      // One failure must not abandon the rest of the selection: the operator
      // asked for a set to go, and half of it going with a reason for each
      // holdout is more useful than an all-or-nothing error.
      failed.push({ id: post.id, reason: error instanceof Error ? error.message.slice(0, 120) : "Delete failed" });
    }
  }

  // Any id that matched no row is reported, so a stale selection cannot look
  // like a successful delete.
  const missing = ids.filter((id) => !posts.some((p) => p.id === id));
  for (const id of missing) failed.push({ id, reason: "No such post" });

  if (deleted.length > 0) {
    redisIncr("feed:version").catch(() => {});
    revalidatePath("/");
  }

  log.info("admin deleted posts", {
    actorId: guard.actorId,
    requested: ids.length,
    deleted: deleted.length,
    failed: failed.length,
    ...totals,
  });

  return NextResponse.json({
    deleted: deleted.length,
    failed,
    cleaned: totals,
    // Stated explicitly rather than left to arithmetic, because the number that
    // matters to an operator is how many of what they selected are actually gone.
    message:
      deleted.length === 0
        ? "Nothing was deleted."
        : `${deleted.length} post${deleted.length === 1 ? "" : "s"} deleted${failed.length ? `, ${failed.length} could not be` : ""}.`,
  });
}
