import { NextRequest, NextResponse } from "next/server";
import { paintThumb, THUMB_HEADERS } from "@/lib/thumb-svg";

/**
 * Legacy query-string thumbnail endpoint — kept for backward compatibility
 * (older cached pages, PWA caches, and shared links). New code emits the
 * query-free /api/thumb/<code> form via coverSrc(), which passes the
 * Next.js image optimizer (it rejects local URLs carrying a query string).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const svg = paintThumb({
    title: searchParams.get("t")?.slice(0, 120) ?? "connectPlus",
    category: searchParams.get("c")?.slice(0, 32) ?? "Story",
    author: searchParams.get("a")?.slice(0, 32) ?? "",
    seed: searchParams.get("s") ?? searchParams.get("t") ?? "connectPlus",
  });

  return new NextResponse(svg, { status: 200, headers: { ...THUMB_HEADERS } });
}
