import { createLogger } from "@/lib/logger";

const log = createLogger("oauth");

/**
 * Why Google sign-in does or does not work — answered by Google, not by us.
 *
 * `redirect_uri_mismatch` is the single most common OAuth failure and it is
 * completely invisible from inside the app: the env vars are set, the provider
 * is registered, `/api/auth/providers` lists Google, and the sign-in POST happily
 * builds an authorize URL. None of that means Google will accept it, because the
 * allow-list lives in the Google Cloud console where nothing in the codebase can
 * see it.
 *
 * So this asks Google directly. Opening the authorize endpoint with our own
 * client id and the exact redirect URI the app will send is a read-only request
 * — no client secret, no user consent, no token — and Google answers either by
 * starting the consent flow (registered) or by bouncing to its error page with a
 * decoded reason (not registered). That turns a console hunt into a copy-paste.
 *
 * `redirect_uri_mismatch` can ONLY be fixed in the console. No amount of code
 * change makes Google accept an unregistered URI, which is why this reports the
 * exact string to add rather than attempting a workaround.
 */

export type GoogleSignInStatus =
  | "ok"
  | "unconfigured"
  | "redirect_uri_mismatch"
  | "invalid_client"
  | "deleted_client"
  | "unknown";

export interface GoogleSignInDiagnosis {
  status: GoogleSignInStatus;
  configured: boolean;
  /** A Google client id is public; the secret is never read here. */
  clientId: string | null;
  /** Google client ids end in `.apps.googleusercontent.com`; a truncated one fails. */
  clientIdShapeOk: boolean;
  /** Exactly what the app sends as `redirect_uri`. */
  redirectUri: string;
  /** Exactly what to paste into Authorized redirect URIs. */
  register: string;
  hint: string;
  /** Google's own words, when it gave any. */
  detail: string | null;
}

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";
/** The diagnosis is environment-level, so it is reused rather than re-asked. */
const MEMO_MS = 10 * 60 * 1000;

const memo = new Map<string, { at: number; value: GoogleSignInDiagnosis }>();

/** Auth.js serves the provider callback at `<origin>/api/auth/callback/<provider>`. */
export function googleRedirectUri(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/api/auth/callback/google`;
}

/**
 * Google's error page carries a base64 protobuf blob. The readable parts are
 * good enough to classify on, so it is decoded rather than parsed.
 */
function decodeAuthError(value: string | null): string {
  if (!value) return "";
  try {
    if (typeof Buffer === "undefined") return "";
    return Buffer.from(value, "base64").toString("utf8").replace(/[^\x20-\x7e]+/g, " ").trim();
  } catch {
    return "";
  }
}

function classify(detail: string): GoogleSignInStatus {
  if (detail.includes("redirect_uri_mismatch")) return "redirect_uri_mismatch";
  if (detail.includes("deleted_client")) return "deleted_client";
  if (detail.includes("invalid_client")) return "invalid_client";
  if (detail.includes("access_blocked") || detail.includes("does not comply")) return "invalid_client";
  return "unknown";
}

function hintFor(status: GoogleSignInStatus, register: string): string {
  switch (status) {
    case "ok":
      return "Google accepted this redirect URI — sign-in is wired correctly.";
    case "unconfigured":
      return "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not both set in this environment, so the Google button is hidden.";
    case "redirect_uri_mismatch":
      return `Google does not recognise this redirect URI. Add it to the OAuth client's Authorized redirect URIs, exactly as written: ${register}`;
    case "invalid_client":
      return "Google rejected the client id. Check GOOGLE_CLIENT_ID — it must be the full id ending in .apps.googleusercontent.com.";
    case "deleted_client":
      return "This OAuth client has been deleted. Create a new one (or reuse a live client) and update GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.";
    default:
      return "Google returned an unrecognised response; see the detail below.";
  }
}

async function probe(clientId: string, redirectUri: string): Promise<{ status: GoogleSignInStatus; detail: string | null }> {
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "openid profile email");

  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  }).catch((error) => {
    log.warn("google authorize probe failed", { error: String(error) });
    return null;
  });

  if (!response) return { status: "unknown", detail: "Google could not be reached from this server." };

  const location = response.headers.get("location") ?? "";
  if (location.includes("/signin/oauth/error")) {
    const detail = decodeAuthError(new URL(location).searchParams.get("authError")) || null;
    return { status: classify(detail ?? ""), detail };
  }

  return { status: "ok", detail: null };
}

/**
 * Diagnose Google sign-in for a given origin.
 *
 * `origin` is the external origin the browser is on, so the answer is about the
 * deployment the reader is actually using rather than about whatever AUTH_URL
 * happens to say.
 */
export async function diagnoseGoogleSignIn(origin: string): Promise<GoogleSignInDiagnosis> {
  const redirectUri = googleRedirectUri(origin);
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim() || null;
  const hasSecret = Boolean((process.env.GOOGLE_CLIENT_SECRET ?? "").trim());

  const base = {
    redirectUri,
    register: redirectUri,
    clientId,
    clientIdShapeOk: Boolean(clientId?.endsWith(CLIENT_ID_SUFFIX)),
  };

  if (!clientId || !hasSecret) {
    return {
      ...base,
      status: "unconfigured",
      configured: false,
      hint: hintFor("unconfigured", redirectUri),
      detail: null,
    };
  }

  const cached = memo.get(redirectUri);
  if (cached && Date.now() - cached.at < MEMO_MS) return cached.value;

  const { status, detail } = base.clientIdShapeOk
    ? await probe(clientId, redirectUri)
    : { status: "invalid_client" as GoogleSignInStatus, detail: "Client id is missing the .apps.googleusercontent.com suffix." };

  const value: GoogleSignInDiagnosis = {
    ...base,
    status,
    configured: true,
    hint: hintFor(status, redirectUri),
    detail,
  };

  memo.set(redirectUri, { at: Date.now(), value });
  return value;
}
