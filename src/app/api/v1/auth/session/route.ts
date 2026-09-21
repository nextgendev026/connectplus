import { z } from "zod";
import { auth } from "@/lib/auth";
import { NO_STORE, apiHandler, okResponse, validateResponse, withIdentity } from "@/lib/contracts";
import { principalFromSession, requireUser, scopesForRole } from "@/lib/policies";

/**
 * `GET /api/v1/auth/session` — who the caller is, as far as this API is concerned.
 *
 * A native client has no session cookie and no server-rendered page to read its
 * own identity from, so it needs one endpoint that answers "am I signed in, as
 * whom, and what may I do".
 *
 * The `scopes` list is **derived** from the role (`scopesForRole`), never sent by
 * the client and never stored on the token. A client uses it to decide which
 * controls to show; the server re-derives it on every protected call, so hiding a
 * button and being unable to press it are the same thing here rather than two
 * separate mechanisms that agree by habit.
 *
 * The role itself comes from the session token, which `auth.ts` refreshes from the
 * database at most every five minutes — so a demoted admin loses their scopes
 * shortly rather than at token expiry.
 */

export const dynamic = "force-dynamic";

const SessionPayload = z.object({
  user: z.object({
    id: z.string().min(1),
    username: z.string(),
    name: z.string().nullable(),
    avatar: z.string().nullable(),
    role: z.string(),
    emailVerified: z.boolean(),
  }),
  scopes: z.array(z.string()),
  /** Which client the server thinks is asking; useful when a user agent lies. */
  platform: z.string(),
});

export const GET = apiHandler(async (_req, ctx) => {
  const session = await auth();
  // Throws AUTHENTICATION_REQUIRED (401) in the shared envelope when anonymous —
  // the route no longer builds that status itself.
  const principal = requireUser(principalFromSession(session));
  const user = session?.user;

  const payload = validateResponse(
    SessionPayload,
    {
      user: {
        id: principal.actorId,
        username: user?.username ?? "",
        name: user?.name ?? null,
        avatar: user?.avatar ?? null,
        role: principal.role ?? "USER",
        emailVerified: principal.emailVerified,
      },
      scopes: scopesForRole(principal.role),
      platform: ctx.platform,
    },
    "v1.auth.session"
  );

  return okResponse(payload, withIdentity(ctx, { actorId: principal.actorId }), {
    headers: NO_STORE,
  });
});
