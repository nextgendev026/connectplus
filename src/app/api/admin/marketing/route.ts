import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import {
  createCampaigns,
  dispatchCampaign,
  gatherMarketingSignals,
  generateCampaigns,
  marketingReport,
  rescoreCampaign,
  runMarketingSweep,
  setCampaignStatus,
  shareNewStory,
} from "@/lib/marketing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const log = createLogger("admin-marketing");

async function requireAdmin() {
  const session = await auth();
  const role = session?.user?.role;
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * The marketing console's API.
 *
 * Every action returns the FULL report rather than just the thing it changed.
 * That is deliberate: the console's controls rearrange the same numbers the page
 * displays (a dispatch changes the channel counts, an approve changes the queue
 * depth), so returning the mutation alone would leave an operator reading a
 * screen that is already out of date.
 */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await marketingReport());
  } catch (error) {
    log.error("failed to build marketing report", { error: String(error) });
    return NextResponse.json({ error: "Failed to load the marketing console" }, { status: 500 });
  }
}

type Action =
  | "generate"
  | "sweep"
  | "approve"
  | "reject"
  | "dispatch"
  | "delete"
  | "update"
  | "share-story";

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "") as Action;
  const id = typeof body.id === "string" ? body.id : "";

  try {
    let result: unknown = null;

    switch (action) {
      case "generate": {
        const count = typeof body.count === "number" ? body.count : 5;
        const signals = await gatherMarketingSignals();
        const { campaigns, source, brief } = await generateCampaigns({ count, signals });
        const created = await createCampaigns(campaigns, { source, signals, brief });
        result = { created: created.length, source };
        break;
      }

      case "sweep":
        result = await runMarketingSweep();
        break;

      case "approve":
        result = await setCampaignStatus(id, "APPROVED");
        break;

      case "reject":
        result = await setCampaignStatus(id, "REJECTED");
        break;

      case "dispatch":
        result = await dispatchCampaign(id);
        break;

      case "delete":
        await prisma.marketingCampaign.delete({ where: { id } }).catch(() => null);
        result = { deleted: id };
        break;

      case "update": {
        // An operator editing copy is the normal case, so the score is recomputed
        // from the edited text rather than left at whatever the model's draft got.
        const title = typeof body.title === "string" ? body.title.slice(0, 200) : undefined;
        const text = typeof body.body === "string" ? body.body : undefined;
        const hashtags = Array.isArray(body.hashtags)
          ? JSON.stringify(body.hashtags.filter((t): t is string => typeof t === "string"))
          : undefined;
        await prisma.marketingCampaign
          .update({
            where: { id },
            data: { ...(title ? { title } : {}), ...(text ? { body: text } : {}), ...(hashtags ? { hashtags } : {}) },
          })
          .catch(() => null);
        result = { score: await rescoreCampaign(id) };
        break;
      }

      case "share-story": {
        const postId = typeof body.postId === "string" ? body.postId : "";
        const post = await prisma.post.findUnique({
          where: { id: postId },
          select: { id: true, title: true, slug: true, excerpt: true, category: { select: { name: true } } },
        });
        if (!post) return NextResponse.json({ error: "No such story" }, { status: 404 });
        result = {
          campaignId: await shareNewStory({
            id: post.id,
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt,
            categoryName: post.category?.name ?? null,
          }),
        };
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action || "(none)"}` }, { status: 400 });
    }

    const report = await marketingReport();
    return NextResponse.json({ success: true, action, result, ...report });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("marketing action failed", { action, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
