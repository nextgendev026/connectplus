import { z } from "zod";
import {
  apiHandler,
  decodeCursor,
  encodeCursor,
  paginatedResponse,
  readLimit,
  validateResponse,
} from "@/lib/contracts";
import { validationError } from "@/lib/errors";
import { listPublishedPosts } from "@/lib/queries/posts";

/**
 * `GET /api/v1/posts` — the published feed, for clients that page.
 *
 * This is the reference implementation of the versioned contract: the handler
 * never builds a status code or an error body by hand, it validates what it is
 * about to send, and its cursor is opaque.
 *
 * `force-dynamic` because the route reads query parameters and a session-aware
 * filter may be added; the CDN story for v1 is Phase F's cache table, and until
 * then `next.config.mjs` answers `/api/*` with `no-store`, which is the safe
 * direction (a reader may re-fetch rather than be handed a stale page).
 */

export const dynamic = "force-dynamic";

/** The wire shape of one item. A response is a contract, so it is declared. */
const PostItem = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string(),
  excerpt: z.string().nullable(),
  coverImage: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  viewCount: z.number().int().nonnegative(),
  featured: z.boolean(),
  category: z.object({ name: z.string(), slug: z.string() }).nullable(),
  tags: z.array(z.object({ name: z.string(), slug: z.string() })),
  author: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      username: z.string(),
      avatar: z.string().nullable(),
    })
    .nullable(),
});

/** Long enough for a phrase, short enough that the scan stays bounded. */
const MAX_SEARCH = 100;

export const GET = apiHandler(async (req, ctx) => {
  const url = new URL(req.url);
  const searchParams = url.searchParams;

  const limit = readLimit(searchParams, 20, 50);
  const cursor = decodeCursor(searchParams.get("cursor"));
  const search = searchParams.get("search")?.trim() ?? "";
  const category = searchParams.get("category")?.trim() ?? "";
  const tag = searchParams.get("tag")?.trim() ?? "";

  if (search.length > MAX_SEARCH) {
    throw validationError(
      [
        {
          path: ["search"],
          message: `Search must be ${MAX_SEARCH} characters or fewer`,
          code: "too_big",
        },
      ],
      "The query parameters are invalid"
    );
  }

  const { items, nextCursorId } = await listPublishedPosts({
    limit,
    cursorId: cursor?.id ?? null,
    category: category || null,
    tag: tag || null,
    search: search || null,
  });

  // Validate before sending: a widened `select` or a renamed field becomes a 500
  // with a log line naming it, rather than an `undefined` on a client we cannot
  // see. This is the only place the DTO is guaranteed to match its own schema.
  const data = validateResponse(z.array(PostItem), items, "v1.posts");

  return paginatedResponse(data, ctx, {
    limit,
    hasMore: nextCursorId !== null,
    nextCursor: nextCursorId ? encodeCursor({ id: nextCursorId }) : null,
  });
});
