import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

export interface CreateNotificationInput {
  userId: string;
  actorId?: string | null;
  type: string;
  title?: string | null;
  message?: string | null;
  postId?: string | null;
  /** Skip the OS notification (e.g. a bulk backfill that should stay quiet). */
  silent?: boolean;
  /** Where tapping the push should land. Defaults to the notifications list. */
  url?: string;
}

export async function createNotification(input: CreateNotificationInput) {
  if (!input.userId) return;
  let created;
  try {
    // Only the persisted columns are written: `silent` and `url` are delivery
    // hints for the push tier below, not fields on the row.
    created = await prisma.notification.create({
      data: {
        userId: input.userId,
        actorId: input.actorId ?? null,
        type: input.type,
        title: input.title ?? null,
        message: input.message ?? null,
        postId: input.postId ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to create notification:", error);
    return null;
  }

  // The stored row is what the bell reads; this is what reaches a closed app.
  // Best-effort by design — a push service outage must never fail the social
  // action that produced the notification.
  if (!input.silent) {
    void sendPushToUser(input.userId, {
      title: input.title?.trim() || "connectPlus",
      body: input.message?.trim() || "You have a new notification.",
      url: input.url ?? "/notifications",
      tag: `cp-${input.type.toLowerCase()}`,
    }).catch(() => null);
  }

  return created;
}

export async function createCommentNotification(params: {
  recipientId: string;
  actorId: string;
  postId: string;
}) {
  if (params.recipientId === params.actorId) return;
  return createNotification({
    userId: params.recipientId,
    actorId: params.actorId,
    type: "COMMENT",
    title: "New comment",
    message: "Someone commented on your story.",
    postId: params.postId,
  });
}

export async function createReplyNotification(params: {
  recipientId: string;
  actorId: string;
  postId: string;
}) {
  if (params.recipientId === params.actorId) return;
  return createNotification({
    userId: params.recipientId,
    actorId: params.actorId,
    type: "REPLY",
    title: "New reply",
    message: "Someone replied to your comment.",
    postId: params.postId,
  });
}

export async function createFollowNotification(params: {
  recipientId: string;
  actorId: string;
}) {
  if (params.recipientId === params.actorId) return;
  return createNotification({
    userId: params.recipientId,
    actorId: params.actorId,
    type: "FOLLOW",
    title: "New follower",
    message: "Someone started following you.",
  });
}

export async function createApprovalNotification(params: {
  recipientId: string;
  actorId: string;
  postId: string;
}) {
  if (params.recipientId === params.actorId) return;
  return createNotification({
    userId: params.recipientId,
    actorId: params.actorId,
    type: "MODERATION_APPROVED",
    title: "Story approved ✅",
    message: "Your story has been approved and published.",
    postId: params.postId,
  });
}

/**
 * Notify all followers of the author that a new story has been published.
 * Batched best-effort; safe to run in background jobs.
 */
export async function createPublishNotifications(params: {
  authorId: string;
  authorName: string;
  postId: string;
  postTitle: string;
}) {
  try {
    const followers = await prisma.user.findMany({
      where: { followingLinks: { some: { followingId: params.authorId } } },
      select: { id: true },
    });
    await prisma.notification.createMany({
      data: followers.map((f) => ({
        userId: f.id,
        actorId: params.authorId,
        type: "POST_PUBLISHED",
        title: "New story",
        message: `${params.authorName} published a new story: ${params.postTitle}`,
        postId: params.postId,
      })),
    });

    // One push per follower, tagged by post so a prolific author cannot stack
    // ten identical banners on a reader's lock screen.
    const { sendPushToUsers } = await import("@/lib/push");
    void sendPushToUsers(
      followers.map((f) => f.id),
      {
        title: `${params.authorName} published a new story`,
        body: params.postTitle,
        url: "/notifications",
        tag: `cp-post-${params.postId}`,
      }
    ).catch(() => null);

    return followers.length;
  } catch (error) {
    console.error("Failed to create publish notifications:", error);
    return 0;
  }
}