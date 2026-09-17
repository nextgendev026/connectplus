import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleRedirectUri } from "@/lib/oauth-diagnostic";

/**
 * The diagnosis exists because `redirect_uri_mismatch` is invisible from inside
 * the app: the env vars are set, `/api/auth/providers` lists Google, the sign-in
 * POST builds a perfectly good authorize URL — and Google still refuses, because
 * the allow-list lives in a console the codebase cannot read.
 *
 * The fixtures below are the REAL responses Google gave this app's own client id
 * while the bug was live, captured from the authorize endpoint. Google answers
 * with a 302 to `/signin/oauth/error` carrying a base64 protobuf in `authError`;
 * classifying that blob correctly is the entire value of this module, so it is
 * tested against the bytes rather than a paraphrase.
 */

const REDIRECT_URI = "https://connectplusapp.vercel.app/api/auth/callback/google";

/** `authError` for redirect_uri_mismatch, exactly as Google sent it. */
const MISMATCH_BLOB =
  "ChVyZWRpcmVjdF91cmlfbWlzbWF0Y2gSsAEKWW91IGNhbid0IHNpZ24gaW4gdG8gdGhpcyBhcHAgYmVjYXVzZSBpdCBkb2Vzbid0IGNvbXBseSB3aXRoIEdvb2dsZSdzIE9BdXRoIDIuMCBwb2xpY3kuCgpJZiB5b3UncmUgdGhlIGFwcCBkZXZlbG9wZXIsIHJlZ2lzdGVyIHRoZSByZWRpcmVjdCBVUkksIGluIHRoZSBHb29nbGUgQ2xvdWQgQ29uc29sZS4gIBptaHR0cHM6Ly9kZXZlbG9wZXJzLmdvb2dsZS5jb20vaWRlbnRpdHkvcHJvdG9jb2xzL29hdXRoMi93ZWItc2VydmVyI2F1dGhvcml6YXRpb24tZXJyb3JzLXJlZGlyZWN0LXVyaS1taXNtYXRjaCCQAw";

function googleErrorRedirect(blob: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: `https://accounts.google.com/signin/oauth/error?authError=${blob}&flowName=GeneralOAuthFlow`,
    },
  });
}

/** A consent screen: Google accepts the redirect URI and serves the flow. */
function consentScreen(): Response {
  return new Response("<html>consent</html>", { status: 200, headers: { "content-type": "text/html" } });
}

const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
const saved = new Map<string, string | undefined>();

/**
 * A fresh module per call.
 *
 * The diagnosis memoises by redirect URI for ten minutes — a real property, and
 * exactly the one that would make these tests pass or fail depending on the order
 * they ran in. Re-importing gives each case its own memo.
 */
async function diagnose(origin: string) {
  vi.resetModules();
  const mod = await import("@/lib/oauth-diagnostic");
  return mod.diagnoseGoogleSignIn(origin);
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  process.env.GOOGLE_CLIENT_ID =
    "563980906887-01ec87c9hhslrjch1ec4rkm7gs9ct8q8.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-test";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("google redirect uri", () => {
  it("is the provider callback Auth.js serves, not the bare /callback", () => {
    // This is the whole bug in one line: the console had `.../callback`, the app
    // sends `.../api/auth/callback/google`, and Google compares them exactly.
    expect(googleRedirectUri("https://connectplusapp.vercel.app")).toBe(REDIRECT_URI);
    expect(googleRedirectUri("https://connectplusapp.vercel.app/")).toBe(REDIRECT_URI);
  });
});

describe("diagnoseGoogleSignIn", () => {
  it("classifies a mismatch and names the exact string to register", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => googleErrorRedirect(MISMATCH_BLOB)));

    const diagnosis = await diagnose("https://connectplusapp.vercel.app");

    expect(diagnosis.status).toBe("redirect_uri_mismatch");
    expect(diagnosis.configured).toBe(true);
    expect(diagnosis.redirectUri).toBe(REDIRECT_URI);
    // The hint has to carry the string, because that is what gets pasted into the
    // console — a message that says "check your redirect URIs" is a treasure map.
    expect(diagnosis.hint).toContain(REDIRECT_URI);
    expect(diagnosis.hint).toMatch(/Authorized redirect URIs/i);
    expect(diagnosis.detail).toContain("redirect_uri_mismatch");
    expect(diagnosis.clientIdShapeOk).toBe(true);
  });

  it("reports a working flow as working", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => consentScreen()));

    const diagnosis = await diagnose("https://connectplusapp.vercel.app");

    expect(diagnosis.status).toBe("ok");
    expect(diagnosis.hint).toMatch(/wired correctly/i);
  });

  it("asks Google with the app's own client id and the app's own redirect uri", async () => {
    const fetchMock = vi.fn(async (_url: string | URL) => consentScreen());
    vi.stubGlobal("fetch", fetchMock);
    await diagnose("https://connectplusapp.vercel.app");

    const asked = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(asked.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(asked.searchParams.get("client_id")).toBe(process.env.GOOGLE_CLIENT_ID);
    // A read-only probe: no secret, no consent, no token exchange.
    expect(asked.searchParams.get("client_secret")).toBeNull();
    expect(asked.searchParams.get("response_type")).toBe("code");
  });

  it("catches a client id that is missing its Google suffix without asking", async () => {
    // The shape the local environment actually had: an id with no
    // `.apps.googleusercontent.com`, which Google answers invalid_client for.
    process.env.GOOGLE_CLIENT_ID = "563980906887-qmdikc7upc4k4kl3e53mtuk7424av99p";
    const fetchMock = vi.fn(async () => consentScreen());
    vi.stubGlobal("fetch", fetchMock);

    const diagnosis = await diagnose("https://connectplusapp.vercel.app");

    expect(diagnosis.status).toBe("invalid_client");
    expect(diagnosis.clientIdShapeOk).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says unconfigured when the secret is missing, because the button is hidden", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const fetchMock = vi.fn(async () => consentScreen());
    vi.stubGlobal("fetch", fetchMock);

    const diagnosis = await diagnose("https://connectplusapp.vercel.app");

    expect(diagnosis.status).toBe("unconfigured");
    expect(diagnosis.configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an unreachable Google as unknown, never as success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    const diagnosis = await diagnose("https://connectplusapp.vercel.app");

    expect(diagnosis.status).toBe("unknown");
    expect(diagnosis.detail).toMatch(/could not be reached/i);
  });

  it("answers per origin, so localhost and production are not confused", async () => {
    const fetchMock = vi.fn(async () => consentScreen());
    vi.stubGlobal("fetch", fetchMock);

    const local = await diagnose("http://localhost:3000");
    expect(local.redirectUri).toBe("http://localhost:3000/api/auth/callback/google");
  });
});
