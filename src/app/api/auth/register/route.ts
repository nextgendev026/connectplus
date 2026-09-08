import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  appBaseUrl,
  createEmailVerificationToken,
  sendVerificationEmail,
} from "@/lib/mailer";

const EAST_AFRICAN_CITIES = [
  "Nairobi",
  "Mombasa",
  "Kisumu",
  "Nakuru",
  "Dar es Salaam",
  "Arusha",
  "Mwanza",
  "Kampala",
  "Jinja",
  "Addis Ababa",
  "Kigali",
  "Bujumbura",
  "Mogadishu",
  "Hargeisa",
  "Djibouti City",
  "Lilongwe",
  "Blantyre",
  "Lusaka",
  "Harare",
];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, username, email, password } = body;

    if (!name || !username || !email || !password) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    if (typeof username !== "string" || !/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 30) {
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    const randomCity =
      EAST_AFRICAN_CITIES[Math.floor(Math.random() * EAST_AFRICAN_CITIES.length)];

    const { token, expiresAt } = createEmailVerificationToken();
    const hashedPassword = await hash(password, 12);

    // All accounts are recognised as verified from the start — sign-up emails
    // on this deployment are not live inboxes, so a verification wall would
    // permanently lock people out of publishing. The token is still stored
    // (and the email still attempted) so the flow exists if ever needed.
    const user = await prisma.user.create({
      data: {
        name: name.trim().slice(0, 100),
        username: username.toLowerCase().slice(0, 30),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        node: randomCity,
        emailVerified: new Date(),
        emailToken: token,
        emailTokenExpires: expiresAt,
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        node: true,
        role: true,
        createdAt: true,
      },
    });

    const verificationUrl = `${appBaseUrl()}/auth/verify-email?token=${token}`;
    const emailResult = await sendVerificationEmail({
      to: user.email,
      name: user.name ?? user.username,
      verificationUrl,
    }).catch(() => ({ ok: false as const, delivered: false as const }));

    return NextResponse.json(
      {
        message: "Account created successfully",
        user,
        emailVerification: {
          sent: emailResult?.delivered ?? false,
          devUrl: emailResult?.delivered ? undefined : verificationUrl,
          expiresInHours: 24,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { error: "An account with these details already exists" },
        { status: 409 }
      );
    }

    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
