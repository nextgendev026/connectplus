import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hiveBrain } from "@/lib/hive-brain";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get("postId");

    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 });
    }

    const comments = await prisma.comment.findMany({
      where: { postId, parentId: null },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
        replies: {
          include: { author: { select: { id: true, name: true, username: true, avatar: true } }, _count: { select: { likes: true } } },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { likes: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ comments });
  } catch (error) {
    console.error("Error fetching comments:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { postId, content, parentId } = body;

    if (!postId || typeof postId !== "string") {
      return NextResponse.json({ error: "postId is required" }, { status: 400 });
    }

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    if (content.length > 5000) {
      return NextResponse.json({ error: "Comment must be 5000 characters or less" }, { status: 400 });
    }

    const post = await prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (parentId) {
      const parentComment = await prisma.comment.findUnique({ where: { id: parentId }, select: { id: true, postId: true } });
      if (!parentComment || parentComment.postId !== postId) {
        return NextResponse.json({ error: "Invalid parent comment" }, { status: 400 });
      }
    }

    const comment = await prisma.comment.create({
      data: {
        content: content.trim().slice(0, 5000),
        authorId: userId,
        postId,
        parentId: parentId || null,
      },
      include: {
        author: { select: { id: true, name: true, username: true, avatar: true } },
        _count: { select: { likes: true } },
      },
    });

    await hiveBrain.ingestComment(comment).catch(() => {});

    // Notify the post author (and comment parent on replies)
    const postAuthor = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    });
    if (parentId) {
      const parent = await prisma.comment.findUnique({
        where: { id: parentId },
        select: { authorId: true },
      });
      if (parent && parent.authorId !== userId) {
        await import("@/lib/notifications").then(({ createReplyNotification }) =>
          createReplyNotification({
            recipientId: parent.authorId,
            actorId: userId,
            postId,
          })
        );
      }
    } else if (postAuthor && postAuthor.authorId !== userId) {
      await import("@/lib/notifications").then(({ createCommentNotification }) =>
        createCommentNotification({
          recipientId: postAuthor.authorId,
          actorId: userId,
          postId,
        })
      );
    }

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    console.error("Error creating comment:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
