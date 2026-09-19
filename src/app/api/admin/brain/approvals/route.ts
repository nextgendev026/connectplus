import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { decideProposal, pendingProposals, recentProposals, PROPOSAL_TTL_HOURS } from "@/lib/brain-approvals";

/**
 * The approval queue's endpoint.
 *
 * Reading the queue is admin work — it is what the console polls — and so is
 * deciding it. The gate that matters is not the role check, it is that a human
 * has to be the one who decides: the brain can file here, but it can never
 * approve its own request, and no chat phrase can stand in for a decision.
 */
export async function GET() {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const [pending, recent] = await Promise.all([
      pendingProposals().catch(() => []),
      recentProposals(12).catch(() => []),
    ]);

    return NextResponse.json({ pending, recent, ttlHours: PROPOSAL_TTL_HOURS });
  } catch (error) {
    console.error("Approval queue read error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id : "";
    const decision = body?.decision === "reject" ? "reject" : body?.decision === "approve" ? "approve" : null;
    if (!id) return NextResponse.json({ error: "A proposal id is required" }, { status: 400 });
    if (!decision) return NextResponse.json({ error: "Decision must be approve or reject" }, { status: 400 });

    const outcome = await decideProposal(
      id,
      decision,
      session.user.id,
      typeof body?.note === "string" ? body.note : undefined
    );

    const [pending, recent] = await Promise.all([
      pendingProposals().catch(() => []),
      recentProposals(12).catch(() => []),
    ]);

    // A refused decision (already decided, expired) is a 409 rather than an
    // error: the console should refresh, not apologise.
    return NextResponse.json(
      { ...outcome, pending, recent },
      { status: outcome.ok || outcome.status === "FAILED" ? 200 : 409 }
    );
  } catch (error) {
    console.error("Approval decision error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
