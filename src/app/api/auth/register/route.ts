import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";

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
  "Kampala",
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
        { error: "Invalid email format" },
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
        { error: "Username must be alphanumeric (underscores allowed)" },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 30) {
      return NextResponse.json(
        { error: "Username must be between 3 and 30 characters" },
        { status: 400 }
      );
    }

    const randomCity =
      EAST_AFRICAN_CITIES[Math.floor(Math.random() * EAST_AFRICAN_CITIES.length)];

    const hashedPassword = await hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        username: username.toLowerCase(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        node: randomCity,
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

    return NextResponse.json(
      {
        message: "User created successfully",
        user,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error?.code === "P2002") {
      const target = error?.meta?.target;
      if (Array.isArray(target)) {
        if (target.includes("email")) {
          return NextResponse.json(
            { error: "An account with this email already exists" },
            { status: 409 }
          );
        }
        if (target.includes("username")) {
          return NextResponse.json(
            { error: "This username is already taken" },
            { status: 409 }
          );
        }
      }
      return NextResponse.json(
        { error: "A user with these details already exists" },
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
