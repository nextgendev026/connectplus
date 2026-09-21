import { prisma } from "@/lib/prisma";

/**
 * What deleting a post actually has to do.
 *
 * Most of it is the database's job, and it does it correctly: Comment, Like,
 * Bookmark, PostEmbedding and SeoMetadata cascade on the post relation, and
 * ModerationLog, Notification, Tip and ModelFeedback are set to null. Those
 * rules are declared in the schema and need no help here.
 *
 * Three models hold a `postId` that is **not a foreign key** — a plain string
 * the database has no opinion about:
 *
 *   • `PageView` — the analytics rows attributing reads to this story.
 *   • `RssArticle` — the fetched item a post was imported from.
 *   • `StudioSaveClaim` — the studio's draft-creation idempotency ledger.
 *
 * Deleting the post left all three behind still naming it. The visible symptom
 * was small and confusing: an imported RSS item kept showing as "Imported" with
 * a link to a story that no longer existed, and a deleted post went on
 * contributing to the totals its own analytics reported.
 *
 * This lives in one module rather than inlined in a route because there are now
 * two callers — the author's own delete, and the admin console's bulk delete —
 * and a cleanup rule that exists in two places is a cleanup rule that will
 * diverge. Autocleanup that only runs on one of the two paths is worse than
 * none, because it makes the orphans depend on *how* the post was removed.
 *
 * Deliberately not wrapped in `revalidatePath` or cache work: those depend on
 * the caller knowing the slug and on which surfaces it invalidates, and mixing
 * them in would make this function do three unrelated things.
 */

export interface PostDeletionSummary {
  /** RSS items that had pointed at this post; now detached. */
  rssArticlesDetached: number;
  /** Analytics rows kept, but no longer attributed to a post. */
  pageViewsDetached: number;
  /** Idempotency claims removed — meaningless once the draft is gone. */
  saveClaimsRemoved: number;
}

export async function deletePostWithCleanup(id: string): Promise<PostDeletionSummary> {
  const [rss, views, claims] = await prisma.$transaction([
    prisma.rssArticle.updateMany({ where: { postId: id }, data: { postId: null } }),
    // Detached, not deleted. The visit really happened; removing the rows would
    // quietly rewrite the platform's own traffic history to make a delete look
    // tidier than it was. Clearing the id keeps the aggregate honest and drops
    // the dangling reference.
    prisma.pageView.updateMany({ where: { postId: id }, data: { postId: null } }),
    // Removed rather than detached: a claim exists to stop one save becoming two
    // drafts, and with the draft gone it guards nothing. The expiry sweep would
    // collect it eventually; this just does it now.
    prisma.studioSaveClaim.deleteMany({ where: { postId: id } }),
    prisma.post.delete({ where: { id } }),
  ]);

  return {
    rssArticlesDetached: rss.count,
    pageViewsDetached: views.count,
    saveClaimsRemoved: claims.count,
  };
}
