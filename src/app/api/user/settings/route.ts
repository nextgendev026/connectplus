import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BIO = 500;
const MAX_NAME = 80;

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        avatar: true,
        coverImage: true,
        bio: true,
        node: true,
        role: true,
        isVerified: true,
        createdAt: true,
        _count: { select: { posts: true, followersLinks: true, followingLinks: true } },
      },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ user });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (typeof body?.name === "string") {
      const name = body.name.trim();
      if (name.length > MAX_NAME) {
        return NextResponse.json({ error: `Name cannot exceed ${MAX_NAME} characters` }, { status: 400 });
      }
      data.name = name || null;
    }

    if (typeof body?.bio === "string") {
      const bio = body.bio.trim();
      if (bio.length > MAX_BIO) {
        return NextResponse.json({ error: `Bio cannot exceed ${MAX_BIO} characters` }, { status: 400 });
      }
      data.bio = bio || null;
    }

    if (typeof body?.node === "string") {
      data.node = body.node.trim() || null;
    }

    if (typeof body?.username === "string") {
      const username = body.username.trim().toLowerCase();
      if (!USERNAME_RE.test(username)) {
        return NextResponse.json({ error: "Username must be 3-30 characters (letters, numbers, underscores)" }, { status: 400 });
      }
      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing && existing.id !== session.user.id) {
        return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
      }
      data.username = username;
    }

    for (const field of ["avatar", "coverImage"] as const) {
      if (typeof body?.[field] === "string") {
        const url = (body[field] as string).trim();
        if (url && !/^https?:\/\//i.test(url)) {
          return NextResponse.json({ error: "Image URLs must start with http(s)" }, { status: 400 });
        }
        data[field] = url || null;
      }
    }

    if (typeof body?.email === "string") {
      const email = body.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
      }
      const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
      const user = await prisma.user.findUnique({ where: { id: session.user.id } });
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      const ok = await compare(currentPassword, user.password);
      if (!ok) {
        return NextResponse.json({ error: "Enter your current password to change the email" }, { status: 400 });
      }
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== session.user.id) {
        return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
      }
      data.email = email;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        avatar: true,
        coverImage: true,
        bio: true,
        node: true,
      },
    });
    return NextResponse.json({ user });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}