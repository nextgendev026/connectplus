import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listDirectives, parseDirective, saveDirective, setDirectiveActive } from "@/lib/mind-directives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/neural/directives?all=1
 * POST /api/admin/neural/directives   { text }        → parse and save
 * PATCH /api/admin/neural/directives  { id, active }  → revoke or reinstate
 *
 * The management surface for operator instructions. POST runs the same parser the
 * chat uses, so a directive typed here and one typed in the chat behave
 * identically — and the endpoint reports *why* it refused so the operator is not
 * left guessing which phrasing the parser accepts.
 */
async function requireAdmin() {
  const session = await auth();
  const role = session?.user?.role;
  if (!session?.user || (role !== "ADMIN" && role !== "SUPER_ADMIN")) return null;
  return session;
}

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const includeInactive = new URL(request.url).searchParams.get("all") === "1";
  const directives = await listDirectives(includeInactive);
  return NextResponse.json({ directives });
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Instruction text is required" }, { status: 400 });

  const parsed = parseDirective(text);
  if (!parsed) {
    return NextResponse.json(
      {
        error: "Not recognised as a standing instruction",
        hint: "Name a side or a scoring direction, e.g. \"favour home teams in La Liga\" or \"avoid high scoring in Serie A\". Use a `directive:` prefix to force it through.",
      },
      { status: 422 }
    );
  }

  const saved = await saveDirective({ text, parsed, createdBy: session.user.id });
  if (!saved) return NextResponse.json({ error: "Failed to store the directive" }, { status: 500 });

  return NextResponse.json({ directive: saved, note: saved.note }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { id?: string; active?: boolean };
  if (!body.id || typeof body.active !== "boolean") {
    return NextResponse.json({ error: "id and active are required" }, { status: 400 });
  }

  const ok = await setDirectiveActive(body.id, body.active);
  if (!ok) return NextResponse.json({ error: "Directive not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
