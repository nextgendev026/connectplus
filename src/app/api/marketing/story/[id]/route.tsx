import { ImageResponse } from "next/og";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { BRAND_NAME } from "@/lib/brand";

export const runtime = "nodejs";
// Cards are deterministic for a given campaign, so they are cached at the edge
// rather than re-rendered per viewer. Short enough that an edited campaign shows
// its new copy within the hour.
export const revalidate = 3600;

const WIDTH = 1080;
const HEIGHT = 1920;

/**
 * A 1080×1920 story card — the only thing that makes WhatsApp Status work.
 *
 * WhatsApp has no API for posting a Status on someone's behalf: it is a
 * deliberate, native, two-tap action. So the product of a "story" campaign is
 * the artifact, not the send — a card sized exactly for a phone screen, with the
 * headline legible at thumbnail scale and the brand and link baked in, because a
 * Status gets saved, forwarded and screenshotted far more often than it gets
 * clicked.
 *
 * Public and unauthenticated by design: an operator has to be able to open the
 * URL on the phone that will post it, and the content is marketing copy that is
 * already public. It is not a listing — an unknown id is a 404, not an index.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ImageResponse fetches every <img> itself, so the source has to be absolute.
  // The request's own origin is the right one: it is the deployment currently
  // serving the card, which is also where /brand/mark.png lives.
  const origin = new URL(request.url).origin;

  const campaign = await prisma.marketingCampaign
    .findUnique({ where: { id }, select: { title: true, body: true, channel: true, kind: true } })
    .catch(() => null);

  if (!campaign) return NextResponse.json({ error: "No such card" }, { status: 404 });

  const headline = campaign.title.replace(/^Story card:\s*/i, "").trim();
  // The card carries the opening of the copy — a Status is read for about one
  // second, and only the first sentence survives that.
  const firstLine = campaign.body.split(/\n+/)[0]?.trim() ?? "";
  const support = firstLine.length > 220 ? `${firstLine.slice(0, 217).trimEnd()}…` : firstLine;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 96,
          background: "linear-gradient(160deg, #14110e 0%, #1c1613 42%, #2a1c0f 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${origin}/brand/mark.png`} width={128} height={128} alt="" style={{ borderRadius: 999 }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#f7efe3", fontSize: 54, fontWeight: 800, letterSpacing: -1 }}>{BRAND_NAME}</div>
            <div style={{ color: "#e8a34a", fontSize: 30, letterSpacing: 2, textTransform: "uppercase" }}>
              Breaking it down
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <div style={{ color: "#f7efe3", fontSize: 96, fontWeight: 800, lineHeight: 1.08, letterSpacing: -2 }}>
            {headline.slice(0, 90)}
          </div>
          {support && support !== headline ? (
            <div style={{ color: "#d8cec0", fontSize: 46, lineHeight: 1.35 }}>{support}</div>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ height: 6, width: 180, background: "#e8a34a", borderRadius: 999 }} />
          <div style={{ color: "#f7efe3", fontSize: 42, fontWeight: 700 }}>Read the full story</div>
          <div style={{ color: "#a89e91", fontSize: 34 }}>News · Radio · Live scores · connectPlus</div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    }
  );
}
