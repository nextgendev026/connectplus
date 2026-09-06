import { prisma } from "@/lib/prisma";

export interface CreateNotificationInput {
  userId: string;
  actorId?: string | null;
  type: string;
  title?: string | null;
  message?: string | null;
  postId?: string | null;
}

export async function createNotification(input: CreateNotificationInput) {
  if (!input.userId) return;
  try {
    return await prisma.notification.create({ data: input });
  } catch (error) {
    console.error("Failed to create notification:", error);
    return null;
  }
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