import NextAuth from "next-auth";
import type { DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "./prisma";

declare module "next-auth" {
  interface User {
    role?: string;
    username?: string;
    avatar?: string | null;
    emailVerified?: Date | null;
  }

  interface Session {
    user: {
      id: string;
      role: string;
      username: string;
      avatar: string | null;
      emailVerified: Date | null;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Invalid credentials");
        }

        const user = await prisma.user.findUnique({
          where: { email: (credentials.email as string).toLowerCase() },
        });

        if (!user) {
          throw new Error("Invalid credentials");
        }

        const isCorrectPassword = await compare(
          credentials.password as string,
          user.password
        );

        if (!isCorrectPassword) {
          throw new Error("Invalid credentials");
        }

        // All accounts are recognised as verified: sign-up emails on this
        // deployment are not live inboxes, so a verification wall would lock
        // people out of publishing. Self-heal any legacy null on sign-in.
        let emailVerified = user.emailVerified;
        if (emailVerified == null) {
          emailVerified = new Date();
          prisma.user
            .update({ where: { id: user.id }, data: { emailVerified } })
            .catch(() => {});
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatar,
          role: user.role,
          username: user.username,
          avatar: user.avatar,
          emailVerified,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.username = user.username;
        token.avatar = user.avatar ?? null;
        token.emailVerified = user.emailVerified ?? null;
        token.roleFetchedAt = Date.now();
      } else if (token.id) {
        // Keep role/username fresh: re-read from the DB at most once every five
        // minutes so promotions (e.g. ADMIN -> SUPER_ADMIN) take effect without
        // re-login. Role changes are rare, so the wider window keeps this at
        // ~1 query per active user per 5 min instead of per min.
        const lastFetch = (token.roleFetchedAt as number | undefined) ?? 0;
        if (Date.now() - lastFetch > 300_000) {
          try {
            const fresh = await prisma.user.findUnique({
              where: { id: token.id as string },
              select: { role: true, username: true, avatar: true, emailVerified: true },
            });
            if (fresh) {
              token.role = fresh.role;
              token.username = fresh.username ?? token.username;
              token.avatar = fresh.avatar ?? token.avatar;
              token.emailVerified = fresh.emailVerified ?? null;
              token.roleFetchedAt = Date.now();
              // All accounts are treated as verified: sign-up emails on this
              // deployment are not live inboxes, so any legacy null is
              // self-healed to now on the session refresh that already hits
              // the DB. No user ever sees a verification wall.
              if (fresh.emailVerified == null) {
                const verifiedAt = new Date();
                prisma.user
                  .update({ where: { id: token.id as string }, data: { emailVerified: verifiedAt } })
                  .catch(() => {});
                token.emailVerified = verifiedAt;
              }
            }
          } catch {
            // DB hiccup — keep the cached token values.
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? token.sub ?? "";
        session.user.role = (token.role as string) ?? "USER";
        session.user.username = (token.username as string) ?? "";
        session.user.avatar = (token.avatar as string | null) ?? null;
        session.user.emailVerified = (token.emailVerified as Date | null) ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name: process.env.NODE_ENV === "production" ? "__Host-next-auth.csrf-token" : "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    callbackUrl: {
      name: process.env.NODE_ENV === "production" ? "__Secure-next-auth.callback-url" : "next-auth.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
});