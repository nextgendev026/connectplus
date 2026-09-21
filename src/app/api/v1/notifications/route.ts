import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  NO_STORE,
  apiHandler,
  decodeCursor,
  encodeCursor,
  paginatedResponse,
  readLimit,
  validateResponse,
  withIdentity,
} from "@/lib/contracts";
import { authenticationRequired } from "@/lib/errors";

/**
 * `GET /api/v1/notifications` — the reader's own notification feed.
 *
 * The authenticated counterpart to the posts route, and the place the contract's
 * identity rules become concrete:
 *
 *  • No session → `AUTHENTICATION_REQUIRED` (401) in the shared envelope, thrown
 *    rather than hand-built, so the status, the code and the request id cannot
 *    drift apart.
 *  • The query is scoped to `actorId` from the *session*, never from a query
 *    parameter. A `userId` the client can set is an authorisation hole, not a
 *    filter.
 *  • `NO_STORE` is mandatory: this response is per-reader, and a shared cache
 *    holding it would serve one reader another's rows. That is
 *    indistinguishable from a data leak, so it is not left to the CDN config.
 */

export const dynamic = "force-dynamic";

const NotificationItem = z.object({
  id: z.string().min(1),
  type: z.string(),
  title: z.string().nullable(),
  message: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
  actor: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      username: z.string(),
      avatar: z.string().nullable(),
    })
    .nullable(),
  post: z.object({ id: z.string(), slug: z.string(), title: z.string() }).nullable(),
});

export const GET = apiHandler(async (req, ctx) => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw authenticationRequired();

  const authed = withIdentity(ctx, { actorId: userId });

  const url = new URL(req.url);
  const limit = readLimit(url.searchParams, 20, 50);
  const cursor = decodeCursor(url.searchParams.get("cursor"));

  const args = {
    where: { userId },
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ] as Prisma.NotificationOrderByWithRelationInput[],
    take: limit + 1,
    select: {
      id: true,
      type: true,
      title: true,
      message: true,
      read: true,
      createdAt: true,
      actor: { select: { id: true, name: true, username: true, avatar: true } },
      post: { select: { id: true, slug: true, title: true } },
    } satisfies Prisma.NotificationSelect,
  };

  const [rows, unreadCount] = await Promise.all([
    // Separate call sites, not a union argument: spreading both branches into one
    // object loses the `select` literals Prisma infers from.
    cursor?.id
      ? prisma.notification.findMany({ ...args, cursor: { id: cursor.id }, skip: 1 })
      : prisma.notification.findMany(args),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  const data = validateResponse(
    z.array(NotificationItem),
    page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    "v1.notifications"
  );

  return paginatedResponse(
    data,
    authed,
    {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
    },
    { headers: { ...NO_STORE, "X-Unread-Count": String(unreadCount) } }
  );
});
