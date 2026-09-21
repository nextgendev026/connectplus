import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

/**
 * The published-post read used by the versioned API.
 *
 * Everything here is chosen for a client that does not exist yet — an Android or
 * iOS build that pages through a feed — which is why the shape is explicit
 * rather than "whatever the row had":
 *
 *  • **A `select`, never a spread.** A response is a contract, and spreading a
 *    row means every future schema migration silently changes the API. It also
 *    keeps `validateResponse` meaningful: a field that is not in the select
 *    cannot leak into the DTO.
 *  • **Keyset pagination, not `skip`.** `skip: (page-1)*limit` gets slower as the
 *    page deepens (the database still walks the skipped rows) and, worse, it
 *    shifts: a story published between two requests pushes one row across the
 *    boundary and a reader sees it twice. A cursor on `id` cannot do either.
 *  • **One extra row decides `hasMore`.** Counting the whole collection for a
 *    boolean would turn every page into a second full scan.
 *
 * The public feed is the same visibility rule the unversioned route applies:
 * `PUBLISHED` and `APPROVED`. Anything else — a draft, a submission awaiting
 * moderation, a flagged post — is not in public reads.
 */

const log = createLogger("queries:posts");

export interface PostListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImage: string | null;
  /** ISO-8601, or null for a post that has never been published. */
  publishedAt: string | null;
  createdAt: string;
  viewCount: number;
  featured: boolean;
  category: { name: string; slug: string } | null;
  tags: { name: string; slug: string }[];
  author: { id: string; name: string | null; username: string; avatar: string | null } | null;
}

export interface ListPublishedPostsInput {
  /** Rows per page. The caller clamps it; this trusts its own input contract. */
  limit: number;
  /** `Post.id` of the last row of the previous page. */
  cursorId?: string | null;
  category?: string | null;
  tag?: string | null;
  search?: string | null;
  authorId?: string | null;
}

export interface ListPublishedPostsResult {
  items: PostListItem[];
  /** `null` when this is the last page. */
  nextCursorId: string | null;
}

const POST_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImage: true,
  publishedAt: true,
  createdAt: true,
  viewCount: true,
  featured: true,
  category: { select: { name: true, slug: true } },
  tags: { select: { name: true, slug: true } },
  author: { select: { id: true, name: true, username: true, avatar: true } },
} satisfies Prisma.PostSelect;

/**
 * The row type is *derived from the select*, not written out beside it.
 *
 * A hand-written interface is a second declaration of the same thing, and the
 * failure mode is silent: widen the select and the extra column flows into the
 * DTO, where `validateResponse` catches it as a 500 in production instead of as
 * a compile error here.
 */
type PostRow = Prisma.PostGetPayload<{ select: typeof POST_SELECT }>;

function toListItem(row: PostRow): PostListItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    coverImage: row.coverImage,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    viewCount: row.viewCount,
    featured: row.featured,
    category: row.category,
    tags: row.tags,
    author: row.author,
  };
}

/**
 * A cursor whose row has since been deleted.
 *
 * Prisma raises `P2025` when the cursor cannot be found, and a cursor is valid
 * for as long as a client holds it — during which the row it names may be
 * unpublished (moderation) or removed. A 500 there would break a reader's
 * infinite scroll for a reason that has nothing to do with their request, so a
 * missing cursor is treated as "no cursor": the client gets the first page and a
 * fresh cursor instead of an error.
 */
function isMissingCursor(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2025"
  );
}

export async function listPublishedPosts(
  input: ListPublishedPostsInput
): Promise<ListPublishedPostsResult> {
  const where: Prisma.PostWhereInput = {
    status: "PUBLISHED",
    moderationStatus: "APPROVED",
    ...(input.authorId ? { authorId: input.authorId } : {}),
    ...(input.category ? { category: { slug: input.category } } : {}),
    ...(input.tag ? { tags: { some: { slug: input.tag } } } : {}),
    // A `contains` scan across three text columns. It is bounded by the caller's
    // length cap and the published/approved filter, but it is still a scan —
    // Phase F is where this becomes a real text index or a bounded window.
    ...(input.search
      ? {
          OR: [
            { title: { contains: input.search, mode: "insensitive" as const } },
            { excerpt: { contains: input.search, mode: "insensitive" as const } },
            { content: { contains: input.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  // `as Prisma...[]` rather than `as const`: Prisma's argument types are mutable
  // arrays, so a readonly tuple is rejected. `createdAt` then `id` — the id breaks
  // ties, which matters because a bulk publish stamps many rows with the same
  // timestamp and an unstable sort would duplicate or skip rows across pages.
  const args = {
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }] as Prisma.PostOrderByWithRelationInput[],
    take: input.limit + 1,
    select: POST_SELECT,
  };

  // Two explicit calls rather than one ternary. Spreading both branches into a
  // single union argument defeats Prisma's generic inference on `select` — the
  // literals widen and the call stops compiling — so the branches are kept apart.
  let rows: PostRow[];
  if (input.cursorId) {
    try {
      rows = await prisma.post.findMany({ ...args, cursor: { id: input.cursorId }, skip: 1 });
    } catch (error) {
      if (!isMissingCursor(error)) throw error;
      log.info("cursor row is gone — serving the first page instead", { cursorId: input.cursorId });
      rows = await prisma.post.findMany(args);
    }
  } else {
    rows = await prisma.post.findMany(args);
  }

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toListItem),
    nextCursorId: hasMore && last ? last.id : null,
  };
}
