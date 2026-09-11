import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redisDel } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return {};
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Browse content for editorial selection. Returns a lean projection — no post
 * bodies — so the console stays cheap to load and light on egress.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const source = searchParams.get("source") ?? "all";
  const categoryId = searchParams.get("categoryId") ?? "";
  const featuredOnly = searchParams.get("featured") === "true";
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "40", 10) || 40, 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

  const where: Record<string, unknown> = {};
  if (q) where.title = { contains: q, mode: "insensitive" };
  // RSS-sourced posts carry the origin feed name + article URL on the Post row.
  if (source === "rss") where.sourceUrl = { not: null };
  if (source === "native") where.sourceUrl = null;
  if (categoryId) where.categoryId = categoryId;
  if (featuredOnly) where.featured = true;

  try {
    const [posts, total, categories] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          featured: true,
          coverImage: true,
          createdAt: true,
          publishedAt: true,
          source: true,
          sourceUrl: true,
          category: { select: { id: true, name: true, slug: true } },
          author: { select: { username: true, name: true } },
          _count: { select: { likes: true, comments: true } },
        },
      }),
      prisma.post.count({ where }),
      prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, icon: true } }),
    ]);

    return NextResponse.json({
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        status: p.status,
        featured: p.featured,
        coverImage: p.coverImage ? `/api/thumb/${p.id}?v=150&h=100` : null,
        createdAt: p.createdAt,
        publishedAt: p.publishedAt,
        category: p.category,
        author: p.author,
        source: p.source,
        sourceUrl: p.sourceUrl,
        likes: p._count.likes,
        comments: p._count.comments,
      })),
      total,
      categories,
    });
  } catch {
    return NextResponse.json({ error: "Could not load content" }, { status: 500 });
  }
}

/**
 * Bulk editorial actions. `ids` lets a whole selection be featured/unfeatured
 * or moved to a category in one round trip.
 */
export async function PATCH(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const ids: string[] = Array.isArray(body.ids)
    ? body.ids.filter((v: unknown): v is string => typeof v === "string")
    : typeof body.id === "string"
      ? [body.id]
      : [];
  if (ids.length === 0) return NextResponse.json({ error: "No posts selected" }, { status: 400 });
  if (ids.length > 200) return NextResponse.json({ error: "Too many posts in one request" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.featured === "boolean") data.featured = body.featured;
  if (body.categoryId !== undefined) data.categoryId = body.categoryId ? String(body.categoryId) : null;
  if (body.status === "PUBLISHED" || body.status === "DRAFT" || body.status === "ARCHIVED") data.status = body.status;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const result = await prisma.post.updateMany({ where: { id: { in: ids } }, data });

  // The home/feed caches embed featured flags and categories.
  await Promise.all([
    redisDel("feed:home:fallback").catch(() => {}),
    redisDel("feed:version").catch(() => {}),
  ]);

  return NextResponse.json({ updated: result.count });
}

/** Create a category from the console. */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Category name is required" }, { status: 400 });

  const slug = slugify(name);
  if (!slug) return NextResponse.json({ error: "Category name must contain letters or numbers" }, { status: 400 });

  const existing = await prisma.category.findFirst({ where: { OR: [{ name }, { slug }] } });
  if (existing) return NextResponse.json({ error: "That category already exists" }, { status: 409 });

  const category = await prisma.category.create({
    data: { name, slug, icon: typeof body.icon === "string" && body.icon.trim() ? body.icon.trim() : null },
  });

  return NextResponse.json({ category }, { status: 201 });
}

/** Delete a category and detach its posts. */
export async function DELETE(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Category id required" }, { status: 400 });

  await prisma.post.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
  await prisma.category.delete({ where: { id } }).catch(() => null);

  return NextResponse.json({ ok: true });
}
