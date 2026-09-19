import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { operate, overview, priorityOrder } from "@/lib/admin-intelligence";
import { validateBody } from "@/lib/api-validation";
import { AdminOperateSchema } from "@/lib/schemas/validators";

/**
 * The virtual admin assistant's endpoint.
 *
 * `GET` is the whole console dashboard in one round trip: the live readings,
 * how well calibrated the mind is per domain, the combined mind's collaboration
 * trace, the tracked issues, the standing calibration moves, what is awaiting
 * approval, and the self-heal envelope. All of it is a **read** — which is why
 * an ordinary ADMIN may see it.
 *
 * `POST` is a conversation turn. It reads everything again, answers fluently,
 * and turns a change request into a *filed proposal*. It never executes: the
 * only endpoint that runs an approved tool is the approvals one, and it runs it
 * with the name of the admin who clicked.
 */

export async function GET() {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const data = await overview();
    return NextResponse.json({
      ...data,
      /** Urgency-ordered, so the console can render "do this first" directly. */
      moves: priorityOrder(data.moves),
    });
  } catch (error) {
    console.error("Admin overview error:", error);
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

    const body = await validateBody(request, AdminOperateSchema);
    if (body instanceof NextResponse) return body;

    const turn = await operate(body.message.trim(), body.history ?? [], {
      actorId: session.user.id,
      live: body.live,
    });

    return NextResponse.json({
      ...turn,
      moves: priorityOrder(turn.moves),
    });
  } catch (error) {
    console.error("Admin operate error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
