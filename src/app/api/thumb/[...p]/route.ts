import { NextResponse } from "next/server";
import { paintThumb, THUMB_HEADERS } from "@/lib/thumb-svg";

interface ThumbCode {
  t?: string;
  c?: string;
  a?: string;
  s?: string;
}

function decodeCode(code: string): ThumbCode | null {
  try {
    const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as ThumbCode;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Query-free branded thumbnail: /api/thumb/<code> where <code> is
 * base64url(JSON {t, c, a, s}) minted by coverSrc().
 *
 * The path carries no "?" so the URL sails through the Next.js image
 * optimizer, the CDN, and the PWA image cache exactly like an uploaded
 * JPEG/PNG cover — which is why generated covers now render everywhere
 * instead of only where raw <img> tags were used.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ p: string[] }> }
) {
  const { p } = await params;
  const data = p.length > 0 ? decodeCode(p[0] ?? "") : null;
  if (!data) {
    return NextResponse.json({ error: "Invalid thumbnail code" }, { status: 400 });
  }

  const svg = paintThumb({
    title: typeof data.t === "string" ? data.t.slice(0, 120) : "connectPlus",
    category: typeof data.c === "string" ? data.c.slice(0, 32) : "Story",
    author: typeof data.a === "string" ? data.a.slice(0, 32) : "",
    seed: typeof data.s === "string" ? data.s : (typeof data.t === "string" ? data.t : "connectPlus"),
  });

  return new NextResponse(svg, { status: 200, headers: { ...THUMB_HEADERS } });
}
