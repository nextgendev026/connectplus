import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { paintThumb, THUMB_HEADERS } from "@/lib/thumb-svg";
import { isInlineImage } from "@/lib/thumb";

interface ThumbCode {
  t?: string;
  c?: string;
  a?: string;
  s?: string;
}

export const dynamic = "force-dynamic";

/** Long-lived CDN caching: covers are immutable in practice and change rarely,
 *  and this route is what keeps multi-megabyte rows OUT of feed payloads. */
const COVER_HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
} as const;

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

/** Max width we hand out: covers are stored at full upload size (some are
 *  3–4 MB), which is wasteful for a card, a hero and an og:image alike. */
const MAX_WIDTH = Number(process.env.COVER_MAX_WIDTH ?? 1600);
const JPEG_QUALITY = Number(process.env.COVER_JPEG_QUALITY ?? 78);

/**
 * Shrink an oversized cover in-flight. Resizing here (rather than shipping the
 * multi-MB original to every card, hero, social crawler and PWA cache) is what
 * keeps image egress, mobile data use and TTI down. Falls back to the original
 * bytes when sharp isn't available or refuses the image.
 */
async function shrink(bytes: Uint8Array, mime: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (bytes.byteLength < 300 * 1024) return { bytes, mime };
  try {
    const sharp = (await import("sharp")).default;
    const pipeline = sharp(bytes, { failOn: "none" }).rotate().resize({
      width: MAX_WIDTH,
      withoutEnlargement: true,
    });
    const out = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    if (out.byteLength === 0 || out.byteLength >= bytes.byteLength) return { bytes, mime };
    return { bytes: new Uint8Array(out), mime: "image/jpeg" };
  } catch {
    return { bytes, mime };
  }
}

/** Fetch a remote cover with a hard timeout. Returns null when the upstream
 *  is unreachable or does not answer with an image. */
async function fetchRemoteCover(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) return null;
    return { bytes, mime };
  } catch {
    return null;
  }
}

/** Decode an inline `data:` image into its mime type + bytes. */
function decodeDataUri(value: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(value);
  if (!match) return null;
  const mime = match[1] || "image/jpeg";
  const payload = match[3] ?? "";
  try {
    const bytes = match[2]
      ? new Uint8Array(Buffer.from(payload, "base64"))
      : new Uint8Array(Buffer.from(decodeURIComponent(payload), "utf-8"));
    if (bytes.byteLength === 0) return null;
    return { mime, bytes };
  } catch {
    return null;
  }
}

/**
 * GET /api/thumb/post/<postId>
 *
 * Streams a post's stored cover. Covers saved as base64 data URIs (some are
 * 2–4 MB rows) are decoded here and cached at the edge instead of being inlined
 * into HTML, RSC payloads and og:image tags. When a post has no cover we paint
 * the branded fallback from its title/category/author.
 */
async function postCover(id: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) {
    return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
  }

  const post = await prisma.post
    .findUnique({
      where: { id },
      select: {
        coverImage: true,
        title: true,
        category: { select: { name: true } },
        author: { select: { name: true, username: true } },
      },
    })
    .catch(() => null);

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const cover = post.coverImage;
  if (cover && isInlineImage(cover)) {
    const decoded = decodeDataUri(cover);
    if (decoded) {
      const shrunk = await shrink(decoded.bytes, decoded.mime);
      return new Response(shrunk.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": shrunk.mime,
          "Content-Length": String(shrunk.bytes.byteLength),
          ...COVER_HEADERS,
        },
      });
    }
  } else if (cover && /^https?:\/\//i.test(cover)) {
    // Remote (RSS-imported) cover: PROXY it rather than redirecting. The
    // Next.js image optimizer rejects a redirect response (it renders as a
    // broken card), and proxying lets us cache, resize and stay same-origin.
    const remote = await fetchRemoteCover(cover);
    if (remote) {
      const shrunk = await shrink(remote.bytes, remote.mime);
      return new Response(shrunk.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": shrunk.mime,
          "Content-Length": String(shrunk.bytes.byteLength),
          ...COVER_HEADERS,
        },
      });
    }
    // Dead upstream: fall through to the painted thumbnail rather than a
    // broken image on the card.
  }

  // No usable cover — paint the branded thumbnail instead of a broken image.
  const svg = paintThumb({
    title: post.title,
    category: post.category?.name ?? "Story",
    author: post.author?.name ?? post.author?.username ?? "",
    seed: id,
  });
  return new NextResponse(svg, { status: 200, headers: { ...THUMB_HEADERS, ...COVER_HEADERS } });
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

  if (p[0] === "post" && p[1]) {
    return postCover(p[1]);
  }

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
