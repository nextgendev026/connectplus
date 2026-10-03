import NextAuth from "next-auth";
import type { DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compare, hash } from "bcryptjs";
import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { createLogger } from "./logger";
import { decryptSecret, matchBackupCode, verifyTotp } from "./mfa";

const logger = createLogger("auth");

declare module "next-auth" {
  interface User {
    role?: string;
    username?: string;
    avatar?: string | null;
    emailVerified?: Date | null;
    /** The row's `tokenVersion` at issue time — see the jwt callback below. */
    tokenVersion?: number;
    /** Whether a second factor was presented during this sign-in. */
    mfaVerified?: boolean;
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
        // Optional: required only when the account has TOTP enabled. The sign-in
        // form reveals this field after a first attempt answers MFA_REQUIRED.
        code: { label: "Code", type: "text" },
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

        /*
         * Second factor. Checked *after* the password so an attacker without it
         * learns nothing about whether MFA is enabled for the account.
         *
         * A null return from authorize is a generic credential failure, which
         * would be indistinguishable from a wrong password — so the reason is
         * carried out through a thrown error that the client maps to a distinct
         * message. `MFA_REQUIRED` tells the form to reveal the code field;
         * `MFA_INVALID` means the code was wrong. Neither discloses the secret.
         */
        if (user.mfaEnabled && user.mfaSecret) {
          const submitted = typeof credentials.code === "string" ? credentials.code.trim() : "";
          if (!submitted) throw new Error("MFA_REQUIRED");

          let codeOk = false;
          try {
            codeOk = verifyTotp(decryptSecret(user.mfaSecret, user.id), submitted);
          } catch {
            // Undecryptable secret (key rotation gone wrong) — refuse rather
            // than silently letting the account through with one factor.
            logger.error("mfa secret could not be decrypted", { userId: user.id });
            throw new Error("Invalid credentials");
          }

          if (!codeOk) {
            // A backup code is the recovery path when the phone is lost. On a
            // match it is consumed — single use, rewritten without that entry.
            const backupIndex = await matchBackupCode(user.mfaBackupCodes, submitted);
            if (backupIndex === -1) throw new Error("MFA_INVALID");
            const remaining = user.mfaBackupCodes.filter((_, i) => i !== backupIndex);
            await prisma.user
              .update({ where: { id: user.id }, data: { mfaBackupCodes: remaining, mfaLastUsedAt: new Date() } })
              .catch(() => {});
          } else {
            await prisma.user
              .update({ where: { id: user.id }, data: { mfaLastUsedAt: new Date() } })
              .catch(() => {});
          }
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
          tokenVersion: user.tokenVersion ?? 0,
          mfaVerified: user.mfaEnabled ? true : false,
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

      /*
       * A privileged account that has enrolled TOTP must not be able to sidestep
       * it by signing in with Google: the OAuth flow has no second-factor step, so
       * allowing it would make the stronger sign-in the weaker one. Refused here,
       * before a session is minted, with the remedy named in the log.
       */
      const local = await prisma.user
        .findUnique({ where: { email }, select: { role: true, mfaEnabled: true } })
        .catch(() => null);
      const privileged = local?.role === "ADMIN" || local?.role === "SUPER_ADMIN";
      if (privileged && local?.mfaEnabled) {
        logger.warn("rejected Google sign-in for MFA-protected privileged account", { email });
        return false;
      }
      return true;
    },
    async jwt({ token, user, account }) {
      // Session issuance for a credential sign-in that presented a second factor.
      if (user) {
        // Set before the branch below so both credential and OAuth paths record
        // it. OAuth has no TOTP step here, so an admin who enrolled TOTP and
        // then signs in with Google would otherwise skip the factor — the
        // `signIn` callback refuses that combination for privileged roles.
        token.mfaVerified = (user as { mfaVerified?: boolean }).mfaVerified === true;
      }
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
          token.tokenVersion = dbUser.tokenVersion ?? 0;
          token.roleFetchedAt = Date.now();
          // OAuth cannot satisfy TOTP, so this is false for privileged accounts
          // that have it enrolled — see the signIn callback, which refuses them
          // before reaching here.
          token.mfaVerified = false;
          return token;
        }
      }
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.username = user.username;
        token.avatar = user.avatar ?? null;
        token.emailVerified = user.emailVerified ?? null;
        token.tokenVersion = user.tokenVersion ?? 0;
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
              select: { role: true, username: true, avatar: true, emailVerified: true, tokenVersion: true },
            });
            if (fresh) {
              /*
               * Session revocation. The token carries the tokenVersion it was
               * issued with; a mismatch means the row moved on (password
               * change, "sign out everywhere") and this session is dead.
               * A missing claim reads as 0 — sessions issued before the
               * column existed stay valid until the first real bump, rather
               * than logging every user out on deploy.
               *
               * Checked on the same five-minute cadence as the role refresh,
               * deliberately: a per-request lookup would put a database read
               * on every authenticated request to save at most five minutes
               * of exposure, on the free-tier database this app also has to
               * keep inside its connection budget.
               */
              const claimedVersion = typeof token.tokenVersion === "number" ? token.tokenVersion : 0;
              if (fresh.tokenVersion !== claimedVersion) {
                logger.warn("session revoked: tokenVersion mismatch", {
                  userId: token.id as string,
                  claimed: claimedVersion,
                  current: fresh.tokenVersion,
                });
                return null;
              }
              token.tokenVersion = fresh.tokenVersion;
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
        (session.user as { mfaVerified?: boolean }).mfaVerified = token.mfaVerified === true;
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