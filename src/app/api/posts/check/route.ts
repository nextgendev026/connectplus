import { NextResponse } from "next/server";
import { redisGetRaw } from "@/lib/redis";

export const dynamic = "force-dynamic";

/**
 * GET /api/posts/check
 *
 * Ultra-lightweight endpoint — returns only the feed version counter from
 * Redis. Zero Prisma queries, zero Supabase egress. The client polls this
 * every 60s; when the version changes, it triggers a full SSR refresh.
 */
export async function GET() {
  try {
    const raw = await redisGetRaw("feed:version");
    const version = raw ? parseInt(raw, 10) || 0 : 0;
    return NextResponse.json({ version });
  } catch {
    return NextResponse.json({ version: 0 });
  }
}
