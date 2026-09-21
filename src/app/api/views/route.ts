import { NextRequest, NextResponse } from "next/server";
import { convexRecordView, convexViewCount } from "@/lib/convex";
import { prisma } from "@/lib/prisma";
import { validateBody } from "@/lib/api-validation";
import { PostViewSchema } from "@/lib/schemas/validators";

/**
 * The view beacon.
 *
 * View counting is a write, and a write can't ride along with a page that is
 * served from the CDN — the HTML is generated once per revalidation window, not
 * once per reader. So the article page renders its best-known total and the
 * browser reports the view here, which is both what makes the page cacheable
 * and a correctness fix in its own right: the old in-render write counted every
 * crawler, every link prefetch and every bfcache restore as a reader, and it ran
 * against a shared free-tier Postgres on the single busiest route in the app.
 *
 * Convex stays the buffer (one row per post per day, folded back into
 * `Post.viewCount` nightly). Postgres is the fallback when Convex is not
 * configured or is unreachable, exactly as before.
 *
 * The response carries the live total so the reader's own badge updates from
 * the number they were served to the number that includes them; `null` means
 * "counted, but I don't have a better number than the one you already have".
 */
export async function POST(request: NextRequest) {
  try {
    const body = await validateBody(request, PostViewSchema);
    if (body instanceof NextResponse) return body;
    const { postId } = body;

    const counted = await convexRecordView(postId);
    if (!counted) {
      await prisma.post
        .update({ where: { id: postId }, data: { viewCount: { increment: 1 } } })
        .catch(() => {});
      return NextResponse.json({ viewCount: null });
    }

    const live = await convexViewCount(postId);
    return NextResponse.json({ viewCount: live });
  } catch (error) {
    console.error("Error recording view:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
