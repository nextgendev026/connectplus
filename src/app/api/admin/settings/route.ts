import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAllSettings,
  updateSettings,
  settingDef,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await getAllSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    console.error("Error loading settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const updates = (body?.updates ?? {}) as Record<string, string>;

    // Guard: only allow catalog keys (prevents arbitrary row creation).
    const validUpdates: Record<string, string> = {};
    for (const [key, value] of Object.entries(updates)) {
      const def = settingDef(key);
      if (!def) continue;
      validUpdates[key] = typeof value === "string" ? value : String(value ?? "");
    }

    const count = await updateSettings(validUpdates);
    const settings = await getAllSettings();
    return NextResponse.json({
      ok: true,
      updated: count,
      settings,
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}