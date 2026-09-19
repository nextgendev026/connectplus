import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { appBrain } from "@/lib/app-brain";
import { closeIssue, openIssues, resolvedIssues } from "@/lib/brain-issues";
import { lastRepairRun, repairMode, repairCatalog, MAX_REPAIRS_PER_RUN, type RepairMode } from "@/lib/brain-repair";

/**
 * The ConnectPlus Brain's own console endpoint.
 *
 * `GET` is what the health page polls: the mind's shape, the last stored
 * self-diagnosis, the issue register and what the self-healing envelope did with
 * the last run. Reading it is a normal admin action.
 *
 * `POST` is the mutating half — running a diagnosis (which may email, file
 * issues and, in `enforce` mode, repair), closing an issue, and moving the
 * envelope. Those are SUPER_ADMIN-only for the same reason the settings that can
 * inject scripts are: they change the platform's own records and can act on
 * production without a human in the loop.
 */
export async function GET() {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const [status, lastDiagnosis, open, resolved, repairs, mode] = await Promise.all([
      appBrain.status(),
      appBrain.lastDiagnosis(),
      openIssues().catch(() => []),
      resolvedIssues(8).catch(() => []),
      lastRepairRun().catch(() => null),
      repairMode(),
    ]);

    return NextResponse.json({
      status,
      lastDiagnosis,
      issues: { open, resolved },
      repairs,
      envelope: {
        mode,
        /** The full list, so the console can show what *would* be permitted. */
        catalog: repairCatalog().map((r) => ({
          id: r.id,
          findingId: r.findingId,
          title: r.title,
          why: r.why,
        })),
        maxPerRun: MAX_REPAIRS_PER_RUN,
      },
    });
  } catch (error) {
    console.error("Brain status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Super-admin access required" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "diagnose";

    if (action === "close-issue") {
      const id = typeof body?.id === "string" ? body.id : "";
      if (!id) return NextResponse.json({ error: "An issue id is required" }, { status: 400 });
      const closed = await closeIssue(id, typeof body?.reason === "string" ? body.reason : undefined);
      if (!closed) return NextResponse.json({ error: "Issue not found" }, { status: 404 });
      return NextResponse.json({ ok: true, issues: { open: await openIssues(), resolved: await resolvedIssues(8) } });
    }

    if (action === "set-mode") {
      const requested = String(body?.mode ?? "").trim().toLowerCase();
      if (!["off", "observe", "enforce"].includes(requested)) {
        return NextResponse.json({ error: "Mode must be one of: off, observe, enforce" }, { status: 400 });
      }
      // Written through the settings path so the admin settings page and this
      // control can never disagree about the envelope.
      const { updateSettings } = await import("@/lib/settings");
      await updateSettings({ brainSelfHeal: requested });
      return NextResponse.json({ ok: true, envelope: { mode: requested as RepairMode } });
    }

    // Default: run the diagnosis.
    // `live` adds the outbound feed checks. Off by default because a diagnosis
    // that reaches the public internet is a different (slower) operation than
    // one that only reads our own subsystems.
    const live = body?.live === true;
    const alert = body?.alert !== false;

    const diagnosis = await appBrain.diagnose({ live });
    const reported = await appBrain.report(diagnosis, { alert });

    return NextResponse.json({
      ...reported,
      status: await appBrain.status(),
      issues: { open: await openIssues().catch(() => []), resolved: await resolvedIssues(8).catch(() => []) },
      envelope: { mode: await repairMode(), catalog: [], maxPerRun: MAX_REPAIRS_PER_RUN },
    });
  } catch (error) {
    console.error("Brain diagnosis error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
