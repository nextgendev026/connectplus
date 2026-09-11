import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { resolveVisitor, visitorCookieOptions, VISITOR_COOKIE, normalizePath } from "@/lib/visitor";
import { cacheIncr } from "@/lib/redis";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("track");

interface TrackBody {
  path?: string;
  postId?: string | null;
  postSlug?: string | null;
  referrer?: string | null;
}

/**
 * POST /api/track — first-party page-view beacon.
 *
 * Deliberately cheap: one insert, one counter bump, no joins. The neural mind
 * reads these rows for "unique visitors" and "most-visited posts/pages", and
 * the counters in Redis keep hot reads off the database.
 */
export async function POST(request: NextRequest) {
  let body: TrackBody = {};
  try {
    body = (await request.json()) as TrackBody;
  } catch {
    // Beacons are fire-and-forget; an empty body still counts as a view.
  }

  const path = normalizePath(body.path ?? "/");
  const visitor = resolveVisitor(request);

  // Resolve the post from the slug when the client only knows the URL, so the
  // brain can rank posts without the client having to query first.
  let postId = body.postId ?? null;
  if (!postId && body.postSlug) {
    try {
      const post = await prisma.post.findUnique({
        where: { slug: body.postSlug },
        select: { id: true },
      });
      postId = post?.id ?? null;
    } catch {
      postId = null;
    }
  }

  let userId: string | null = null;
  try {
    const session = await auth();
    userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  } catch {
    userId = null;
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const country =
    request.headers.get("x-vercel-ip-country") ?? request.headers.get("cf-ipcountry");
  const city = request.headers.get("x-vercel-ip-city");

  try {
    await prisma.pageView.create({
      data: {
        path,
        postId,
        userId,
        visitorHash: visitor.visitorHash,
        sessionKey: visitor.sessionKey,
        // Store only coarse geo; never the raw IP after this call.
        country: country ?? null,
        city: city ? decodeURIComponent(city) : null,
        referrer: body.referrer?.slice(0, 300) ?? null,
        userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    log.warn("page view insert failed", { error: String(err) });
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  // Hot counters so analytics dashboards never scan the table.
  const day = new Date().toISOString().slice(0, 10);
  void Promise.all([
    cacheIncr(`visits:day:${day}`, 60 * 60 * 24 * 14).catch(() => {}),
    cacheIncr(`visits:path:${day}:${path}`, 60 * 60 * 24 * 14).catch(() => {}),
    postId ? cacheIncr(`visits:post:${postId}`, 60 * 60 * 24 * 30).catch(() => {}) : Promise.resolve(),
  ]).catch(() => {});

  // A resolved cookie means this browser had none — mint one now.
  const res = NextResponse.json({ ok: true });
  if (visitor.newVisitorId) {
    res.cookies.set(VISITOR_COOKIE, visitor.newVisitorId, visitorCookieOptions);
  }
  return res;
}
