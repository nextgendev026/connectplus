import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { compare, hash } from "bcryptjs";
import { validateBody } from "@/lib/api-validation";
import { ChangePasswordSchema } from "@/lib/schemas/validators";

const MIN_LEN = 8;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const body = await validateBody(request, ChangePasswordSchema);
    if (body instanceof NextResponse) return body;
    const { currentPassword, newPassword } = body;

    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const ok = await compare(currentPassword, user.password);
    if (!ok) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
    }
    if (await compare(newPassword, user.password)) {
      return NextResponse.json({ error: "New password must be different from the current one" }, { status: 400 });
    }

    const password = await hash(newPassword, 10);
    await prisma.user.update({
      where: { id: session.user.id },
      data: { password },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error changing password:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}