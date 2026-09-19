import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { appBrain } from "@/lib/app-brain";

/**
 * The ConnectPlus Brain's own console endpoint.
 *
 * `GET` is what the health page polls: the mind's shape (subsystems, memory
 * counts, cache tier) plus the last stored self-diagnosis. Reading it is a
 * normal admin action.
 *
 * `POST` runs the diagnosis and, when asked, reports it — which may email the
 * alert recipients and write a memory into the hive. That is a mutation of the
 * platform's own records and an outbound side effect, so it is SUPER_ADMIN only,
 * the same bar the settings that can inject scripts are held to.
 */
export async function GET() {
  try {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const [status, lastDiagnosis] = await Promise.all([
      appBrain.status(),
      appBrain.lastDiagnosis(),
    ]);
    return NextResponse.json({ status, lastDiagnosis });
  } catch (error) {
    console.error("Brain status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Super-admin access required to run a diagnosis" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    // `live` adds the outbound feed checks. Off by default because a diagnosis
    // that reaches the public internet is a different (slower) operation than
    // one that only reads our own subsystems.
    const live = body?.live === true;
    const alert = body?.alert !== false;

    const diagnosis = await appBrain.diagnose({ live });
    const reported = await appBrain.report(diagnosis, { alert });

    return NextResponse.json({ ...reported, status: await appBrain.status() });
  } catch (error) {
    console.error("Brain diagnosis error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
