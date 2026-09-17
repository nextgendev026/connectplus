import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPipelineHealth } from "@/lib/pipeline-health";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = createLogger("admin-health");

/**
 * Pipeline health for the console.
 *
 * Read-only by design: this endpoint answers "when did each pipeline last do its
 * job". Acting on a stalled pipeline belongs to the Integrations console (which
 * can run a single job by id) rather than to a monitoring surface that happens
 * to be able to mutate state.
 */
export async function GET() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await getPipelineHealth());
  } catch (error) {
    log.error("failed to build pipeline health report", { error: String(error) });
    return NextResponse.json({ error: "Failed to load pipeline health" }, { status: 500 });
  }
}
