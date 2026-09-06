import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { neuralMind } from "@/lib/neural-mind";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const userRole = (session.user as { role?: string }).role;
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source") || undefined;
    const category = searchParams.get("category") || undefined;
    const search = searchParams.get("search") || undefined;
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = parseInt(searchParams.get("offset") || "0");

    const result = await neuralMind.getMemoryBank({ source, category, search, limit, offset });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Neural memory error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
