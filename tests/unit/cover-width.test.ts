import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

/**
 * The stored-cover route, asked for a width.
 *
 * A stored cover is the one image every page renders and the heaviest asset on
 * each of them. It used to be handed out at a single ceiling width no matter who
 * asked, so a phone painting a 390px card downloaded the 1600px file — several
 * times the pixels it could show, on every card in the feed.
 *
 * The fix is only real if the route actually resizes, so these tests drive the
 * handler with a genuinely oversized image and measure the bytes that come back
 * rather than asserting on a helper's return value.
 *
 * `shrink` refuses to hand back a re-encode that is not smaller than the
 * original, which is why the fixtures are noise: a flat-colour PNG compresses
 * so well that its 1600px form is smaller than any JPEG of it, and the guard
 * would correctly (but uselessly) return the original.
 */

const findUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { post: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

const { GET } = await import("@/app/api/thumb/[...p]/route");

const POST_ID = "cmu89a20y0001ju04qu162nhi";

/**
 * Incompressible content, so a resize genuinely reduces the byte count.
 *
 * An LCG on purpose: a linear formula like `i * 2654435761 % 256` loses its low
 * bits to float precision past 2^53 and collapses into a repeating pattern,
 * which PNG then compresses to almost nothing — and the route's "never hand
 * back a bigger re-encode" guard would correctly return the original, making
 * this test assert nothing.
 */
async function noisyPng(width: number, height: number): Promise<string> {
  const raw = Buffer.alloc(width * height * 3);
  let s = 123456789;
  for (let i = 0; i < raw.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    // The *high* byte. An LCG's low bits have a short period (the low 8 bits
    // cycle every 256 draws), which PNG's row filters then compress away.
    raw[i] = (s >>> 24) & 0xff;
  }
  const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Building a multi-megabyte fixture per test is slow; one per size is enough. */
const fixtures = new Map<string, string>();
async function fixture(width: number, height: number): Promise<string> {
  const key = `${width}x${height}`;
  const cached = fixtures.get(key);
  if (cached) return cached;
  const made = await noisyPng(width, height);
  fixtures.set(key, made);
  return made;
}

function postWith(coverImage: string | null) {
  return {
    coverImage,
    title: "A story",
    category: { name: "News" },
    author: { name: "A Writer", username: "writer" },
  };
}

async function fetchCover(query: string) {
  const res = await GET(new Request(`http://localhost/api/thumb/post/${POST_ID}${query}`), {
    params: Promise.resolve({ p: ["post", POST_ID] }),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  return { res, bytes, width: (await sharp(bytes).metadata()).width };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("asking a stored cover for a width", () => {
  it("returns the requested width, not the stored one", async () => {
    findUnique.mockResolvedValue(postWith(await fixture(1600, 900)));

    const { res, bytes, width } = await fetchCover("?w=400");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(width).toBe(400);
    // The point of the exercise: fewer bytes than the original.
    expect(bytes.byteLength).toBeLessThan(1600 * 900);
  });

  it("keeps the long-lived cache headers on every variant", async () => {
    findUnique.mockResolvedValue(postWith(await fixture(1600, 900)));

    const { res } = await fetchCover("?w=640");

    expect(res.headers.get("cache-control")).toContain("s-maxage");
  });

  it("still caps at the server ceiling when no width is asked for", async () => {
    findUnique.mockResolvedValue(postWith(await fixture(1800, 1000)));

    const { width } = await fetchCover("");

    expect(width).toBe(1600);
  });
});

describe("width values a caller should not be able to abuse", () => {
  it("clamps a tiny width up, so `?w=1` cannot mint near-identical twigs", async () => {
    findUnique.mockResolvedValue(postWith(await fixture(1600, 900)));

    const { width } = await fetchCover("?w=1");

    expect(width).toBe(64);
  });

  it("clamps an oversized width down to the ceiling", async () => {
    findUnique.mockResolvedValue(postWith(await fixture(1800, 1000)));

    const { width } = await fetchCover("?w=99999");

    expect(width).toBe(1600);
  });

  it("treats nonsense as no preference rather than failing the card", async () => {
    findUnique.mockResolvedValue(postWith(await fixture(1800, 1000)));

    const { res, width } = await fetchCover("?w=abc");

    expect(res.status).toBe(200);
    expect(width).toBe(1600);
  });
});

describe("a post that has no cover", () => {
  it("paints the branded thumbnail, which is vector and needs no width", async () => {
    findUnique.mockResolvedValue(postWith(null));

    const { res, bytes } = await fetchCover("?w=400");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("svg");
    expect(bytes.toString("utf-8")).toContain("<svg");
  });
});
