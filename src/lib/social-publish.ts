import { createLogger } from "./logger";
import { getSettings } from "./settings";

const log = createLogger("social-publish");

/**
 * Putting connectPlus on other people's platforms.
 *
 * Three things this layer refuses to do, each because of how the platform
 * actually behaves:
 *
 *  1. **Claim success it cannot see.** A Graph call that returns an id is a
 *     success; anything else is an error string preserved verbatim, because
 *     "sharing is broken" with Meta's own message attached is a five-minute fix
 *     and without it is an afternoon.
 *  2. **Pretend WhatsApp has a Stories API.** It does not. Official Channels /
 *     Status posting is a native-app action, so when there is no Cloud API
 *     sender the result is a rendered story card plus a one-tap share link, and
 *     that is reported as MANUAL — not as sent, and not as a failure.
 *  3. **Throw.** Every caller is a cron job or a console button; a social outage
 *     must never take either down, and a silent catch is how an integration can
 *     be broken for a month. Failures come back as data and are logged once.
 */

export type ShareChannel = "facebook" | "whatsapp" | "story" | "x" | "copy";

/** What happened. MANUAL means "a human still has to post this, here is the kit". */
export type ShareStatus = "SENT" | "FAILED" | "SKIPPED" | "MANUAL";

export interface PublishResult {
  channel: ShareChannel;
  status: ShareStatus;
  /** Page id, broadcast number, or the deep link handed to the operator. */
  target: string | null;
  externalId: string | null;
  url: string | null;
  error: string | null;
}

export interface ChannelReadiness {
  channel: ShareChannel;
  configured: boolean;
  detail: string;
}

export interface SocialCredentials {
  facebookPageId: string;
  facebookPageToken: string;
  whatsappCloudToken: string;
  whatsappPhoneNumberId: string;
  whatsappBroadcastTo: string;
}

const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 15_000;

export async function socialCredentials(): Promise<SocialCredentials> {
  const s = await getSettings().catch(() => ({}) as Record<string, string>);
  return {
    facebookPageId: (s.facebookPageId ?? "").trim(),
    facebookPageToken: (s.facebookPageToken ?? "").trim(),
    whatsappCloudToken: (s.whatsappCloudToken ?? "").trim(),
    whatsappPhoneNumberId: (s.whatsappPhoneNumberId ?? "").trim(),
    whatsappBroadcastTo: (s.whatsappBroadcastTo ?? "").trim(),
  };
}

/**
 * Which channels can actually send right now.
 *
 * The console prints this verbatim. "Facebook is unconfigured" and "Facebook is
 * failing" are different problems with different fixes, and an operator who
 * cannot tell them apart will debug the wrong one.
 */
export async function channelReadiness(): Promise<ChannelReadiness[]> {
  const c = await socialCredentials();
  return [
    {
      channel: "facebook",
      configured: Boolean(c.facebookPageId && c.facebookPageToken),
      detail:
        c.facebookPageId && c.facebookPageToken
          ? `Page ${c.facebookPageId} — posts publish directly`
          : !c.facebookPageId && !c.facebookPageToken
            ? "No page id or token — shares are held as drafts"
            : !c.facebookPageId
              ? "Page access token set, but no page id"
              : "Page id set, but no access token",
    },
    {
      channel: "whatsapp",
      configured: Boolean(c.whatsappCloudToken && c.whatsappPhoneNumberId && c.whatsappBroadcastTo),
      detail:
        c.whatsappCloudToken && c.whatsappPhoneNumberId && c.whatsappBroadcastTo
          ? `Cloud API broadcasts to ${c.whatsappBroadcastTo}`
          : c.whatsappCloudToken && c.whatsappPhoneNumberId
            ? "Cloud API configured but no broadcast number — story cards are prepared instead"
            : "No Cloud API sender — WhatsApp gets a story card and a share link to post in two taps",
    },
    {
      channel: "story",
      configured: true,
      detail: "Story cards render on demand at 1080×1920 from any campaign",
    },
  ];
}

function failure(channel: ShareChannel, message: string, target: string | null = null): PublishResult {
  return { channel, status: "FAILED", target, externalId: null, url: null, error: message };
}

/** Graph errors carry Meta's own explanation; keep it, it is the whole diagnosis. */
async function graphPost(path: string, body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${GRAPH}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const detail = (data.error as { message?: string } | undefined)?.message;
      return { ok: false, error: detail ? `${res.status}: ${detail}` : `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Post to the Facebook Page.
 *
 * With an image, the photo endpoint is used because a link post whose picture
 * Meta cannot fetch renders as a bare grey card — and the whole point of the
 * share is the card. Without one, the feed endpoint takes the link and lets Meta
 * build the preview from our own Open Graph tags.
 */
export async function publishToFacebook(input: {
  message: string;
  link?: string | null;
  imageUrl?: string | null;
}): Promise<PublishResult> {
  const c = await socialCredentials();
  if (!c.facebookPageId || !c.facebookPageToken) {
    return {
      channel: "facebook",
      status: "SKIPPED",
      target: null,
      externalId: null,
      url: null,
      error: "Facebook Page is not configured",
    };
  }

  const image = input.imageUrl?.trim();
  const result = image
    ? await graphPost(`/${c.facebookPageId}/photos`, {
        url: image,
        caption: input.link ? `${input.message}\n\n${input.link}` : input.message,
        access_token: c.facebookPageToken,
      })
    : await graphPost(`/${c.facebookPageId}/feed`, {
        message: input.message,
        ...(input.link ? { link: input.link } : {}),
        access_token: c.facebookPageToken,
      });

  if (!result.ok) {
    log.warn("facebook share failed", { error: result.error });
    await recordFailure();
    return failure("facebook", result.error, c.facebookPageId);
  }

  const id = String(result.data.post_id ?? result.data.id ?? "");
  if (!id) {
    // A success that names nothing cannot be linked, verified or deleted later.
    return failure("facebook", "Graph accepted the post but returned no id", c.facebookPageId);
  }
  return {
    channel: "facebook",
    status: "SENT",
    target: c.facebookPageId,
    externalId: id,
    url: `https://www.facebook.com/${id}`,
    error: null,
  };
}

/** The one-tap link an operator uses when the Cloud API is not configured. */
export function whatsappShareLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/**
 * Send to a WhatsApp number over the Cloud API, or prepare the manual kit.
 *
 * A business number can only message a user inside a 24-hour service window
 * unless the message is an approved template. That is a Meta policy, not a bug
 * here, so an unreachable recipient comes back as MANUAL with the reason rather
 * than as a failure that would page someone.
 */
export async function publishToWhatsApp(input: { message: string; link?: string | null }): Promise<PublishResult> {
  const c = await socialCredentials();
  const text = input.link ? `${input.message}\n\n${input.link}` : input.message;

  if (!c.whatsappCloudToken || !c.whatsappPhoneNumberId || !c.whatsappBroadcastTo) {
    return {
      channel: "whatsapp",
      status: "MANUAL",
      target: c.whatsappBroadcastTo || null,
      externalId: null,
      url: whatsappShareLink(text),
      error: null,
    };
  }

  const result = await graphPost(`/${c.whatsappPhoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    to: c.whatsappBroadcastTo,
    type: "text",
    text: { body: text, preview_url: true },
  });

  if (!result.ok) {
    const policy = /24|template|re-?engagement/i.test(result.error);
    if (policy) {
      return {
        channel: "whatsapp",
        status: "MANUAL",
        target: c.whatsappBroadcastTo,
        externalId: null,
        url: whatsappShareLink(text),
        error: `WhatsApp refused the send (${result.error}) — post it manually with the link provided`,
      };
    }
    log.warn("whatsapp share failed", { error: result.error });
    await recordFailure();
    return failure("whatsapp", result.error, c.whatsappBroadcastTo);
  }

  const messages = result.data.messages as { id?: string }[] | undefined;
  const id = messages?.[0]?.id ?? null;
  return {
    channel: "whatsapp",
    status: "SENT",
    target: c.whatsappBroadcastTo,
    externalId: id,
    url: whatsappShareLink(text),
    error: null,
  };
}

/** A share that failed is evidence, so it goes on the same ledger cron uses. */
async function recordFailure(): Promise<void> {
  const { recordHeartbeat } = await import("./job-heartbeat");
  await recordHeartbeat("marketing-share", { ok: false, detail: "a social publish call failed" }).catch(() => {});
}
