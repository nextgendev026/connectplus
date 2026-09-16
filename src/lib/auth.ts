import NextAuth from "next-auth";
import type { DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compare, hash } from "bcryptjs";
import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { createLogger } from "./logger";

const logger = createLogger("auth");

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

/** Google sign-in is wired only when its credentials are present, so a fork
 *  without them still builds and the button simply stays hidden. */
export const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

/** Turn a Google profile into a local user row.
 *
 * Existing accounts are matched by email and LINKED rather than duplicated, so
 * someone who signed up with a password can later use Google (and vice-versa)
 * without ending up with two accounts and a split history. */
async function provisionOAuthUser(profile: {
  email?: string | null;
  name?: string | null;
  image?: string | null;
}) {
  const email = profile.email?.toLowerCase();
  if (!email) return null;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const data: Record<string, unknown> = {};
    // All accounts are treated as verified on this deployment; also backfill
    // the Google avatar/name when the local row has none.
    if (!existing.emailVerified) data.emailVerified = new Date();
    if (!existing.avatar && profile.image) data.avatar = profile.image;
    if (!existing.name && profile.name) data.name = profile.name;
    if (Object.keys(data).length) {
      return prisma.user.update({ where: { id: existing.id }, data });
    }
    return existing;
  }

  // Derive a unique username from the email local part. Three candidates, the
  // last UUID-suffixed: a fixed number of random retries can still collide when
  // several people with similar addresses sign up at once, and that must not
  // leave the account unnamed or fail the sign-in.
  const base =
    (email.split("@")[0] || "reader").replace(/[^a-z0-9_]/gi, "").slice(0, 20) ||
    "reader";
  let username = base;
  const candidates = [
    base,
    `${base}${Math.floor(Math.random() * 9000) + 1000}`,
    `${base}-${randomUUID().slice(0, 8)}`,
  ];
  for (const candidate of candidates) {
    username = candidate;
    const clash = await prisma.user.findUnique({ where: { username: candidate } });
    if (!clash) break;
  }

  try {
    return await prisma.user.create({
      data: {
        email,
        username,
        name: profile.name ?? base,
        avatar: profile.image ?? null,
        // OAuth-only account: store an unguessable hash so credentials sign-in
        // can never match, while the non-null password invariant holds.
        password: await hash(randomUUID(), 12),
        role: "USER",
        emailVerified: new Date(),
      },
    });
  } catch (err) {
    // A concurrent first sign-in (the provider can deliver the same callback
    // twice) can win the race for either unique column between the lookup above
    // and this insert. Re-resolve by email so the same person is linked to the
    // row that already exists instead of the sign-in failing.
    const raced = await prisma.user.findUnique({ where: { email } });
    if (raced) return raced;
    logger.warn("google provisioning failed", {
      email,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Always behind a proxy (Vercel, or the Cloudflare edge in front of it), so the
  // forwarded host header is the only correct source of the external origin.
  // Set here rather than relying on AUTH_TRUST_HOST alone so a missing env var
  // cannot turn every OAuth round trip into a redirect_uri_mismatch.
  trustHost: true,
  providers: [
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // Accounts are already linked by email in provisionOAuthUser.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
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

        // OAuth-only rows carry a random hash that can never match; guard before
        // compare so a missing/blank hash can never throw or be bypassed.
        if (!user.password || !user.password.startsWith("$2")) {
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
    /**
     * Google's email claim has to be trusted before it can be used as an
     * identity — and this is the one place where that matters.
     *
     * `allowDangerousEmailAccountLinking` links an OAuth identity to an existing
     * local account *by email*. Without this check, an attacker who controls a
     * Google account that merely claims `victim@example.com` could sign in with
     * Google and land inside the victim's password account. Google verifies
     * gmail.com addresses, but a Google Workspace account on a customer domain
     * can carry any address the administrator has not proved, so the claim is
     * checked explicitly instead of assumed.
     *
     * Anthropic-style provider mismatch is not a concern here: credential
     * sign-in never reaches this callback.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;

      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified;
      const email = user.email?.trim().toLowerCase();
      if (!email || verified !== true) {
        logger.warn("rejected Google sign-in: unverified email claim", { email });
        return false;
      }
      return true;
    },
    async jwt({ token, user, account }) {
      // OAuth first sign-in: resolve (or create) the local row and key the JWT
      // to ITS id, never the raw provider profile id.
      if (account?.provider === "google" && user) {
        // One retry for a transient database blip: without it a single dropped
        // connection turns a first Google sign-in into a session keyed to the
        // provider id, which every local query would then miss.
        const dbUser =
          (await provisionOAuthUser({
            email: user.email,
            name: user.name,
            image: (user as { image?: string | null }).image ?? null,
          }).catch(() => null)) ??
          (await provisionOAuthUser({
            email: user.email,
            name: user.name,
            image: (user as { image?: string | null }).image ?? null,
          }).catch(() => null));
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.username = dbUser.username;
          token.avatar = dbUser.avatar ?? null;
          token.emailVerified = dbUser.emailVerified ?? null;
          token.roleFetchedAt = Date.now();
          return token;
        }
      }
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