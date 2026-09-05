import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { neuralMind } from "@/lib/neural-mind";
import { isUrl } from "@/lib/neural-intent";
import { hiveBrain } from "@/lib/hive-brain";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const userRole = session.user.role;
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { url } = body as { url?: string };

    if (url && isUrl(url)) {
      const result = await neuralMind.learnFromUrl(url);
      return NextResponse.json({ result: "learned", ...result });
    }

    const batchResult = await neuralMind.learnFromRssArticles();
    const hiveResult = await hiveBrain.sweepInternal();
    return NextResponse.json({ result: "batch_learned", ...batchResult, hive: hiveResult });
  } catch (error) {
    console.error("Neural learn error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
