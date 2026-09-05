import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { neuralMind } from "@/lib/neural-mind";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const userRole = (session.user as any).role;
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { id } = await params;
    const success = await neuralMind.deleteMemory(id);
    if (!success) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Neural memory delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
