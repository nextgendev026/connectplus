import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("push");

/**
 * Background push delivery.
 *
 * In-tab alerts only exist while a page is open, which is the opposite of what a
 * reader wants from a football alert. This is the tier that reaches a closed
 * app, and it is the reason every notification row is worth attempting twice:
 * once in the bell, once on the OS.
 *
 * Two things it must never do: throw into a job that has real work to finish,
 * and keep talking to an endpoint the push service has retired. So sends are
 * concurrency-bounded, errors are classified, and dead endpoints are pruned
 * rather than retried forever.
 */

const VAPID_PUBLIC =
  process.env.NEXT_PUBLIC_VAPID_KEY ??
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
  process.env.VAPID_PUBLIC_KEY ??
  "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? process.env.WEB_PUSH_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:hello@connectplus.co.ke";

let configuredOnce = false;

/**
 * True when a push payload can actually leave the server. Requires BOTH halves
 * of the VAPID pair — a public key with no private key means the browser will
 * happily subscribe and the server can never sign a request, which is the worst
 * of both worlds: it looks configured and delivers nothing.
 */
export function webPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
}

function vapidReady(): boolean {
  if (!webPushConfigured()) return false;
  if (!configuredOnce) {
    try {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
      configuredOnce = true;
    } catch (error) {
      log.error("invalid VAPID configuration — push disabled", { error: String(error) });
      return false;
    }
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  /** Match alerts should stay on screen until acknowledged. */
  important?: boolean;
  /**
   * The notification kind, which the device turns into a distinct vibration
   * pattern and grouping tag. The motif itself is synthesised on the device —
   * a push payload should be small, and shipping audio over it would not be.
   */
  kind?: string;
}

export interface PushSendResult {
  attempted: number;
  delivered: number;
  pruned: number;
  skipped: boolean;
}

const MAX_FAILURES = 5;
const CONCURRENCY = 8;

interface StoredSub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failures: number;
}

/** Push services report a retired endpoint with one of these. */
function isGone(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

async function sendOne(sub: StoredSub, payload: PushPayload): Promise<"ok" | "prune" | "fail"> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url ?? "/",
        tag: payload.tag,
        icon: payload.icon,
        important: payload.important === true,
        kind: payload.kind,
      }),
      { TTL: 60 * 60 }
    );
    await prisma.pushSubscription
      .update({ where: { id: sub.id }, data: { failures: 0, lastSeenAt: new Date() } })
      .catch(() => null);
    return "ok";
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (isGone(status)) return "prune";
    // A 413 means the payload is too large for that push service; it will never
    // succeed, so treat it as dead rather than retrying every alert forever.
    if (status === 413) return "prune";
    const failures = sub.failures + 1;
    if (failures >= MAX_FAILURES) return "prune";
    await prisma.pushSubscription
      .update({ where: { id: sub.id }, data: { failures } })
      .catch(() => null);
    return "fail";
  }
}

/**
 * Deliver one payload to every device registered by these users.
 *
 * Bounded fan-out: failures are counted per endpoint, never surfaced as a throw,
 * and the caller always gets a summary so a job can log what actually happened
 * instead of assuming it worked.
 */
export async function sendPushToUsers(
  userIds: readonly string[],
  payload: PushPayload
): Promise<PushSendResult> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0 || !vapidReady()) {
    return { attempted: 0, delivered: 0, pruned: 0, skipped: true };
  }

  const subs = await prisma.pushSubscription
    .findMany({
      where: { userId: { in: unique } },
      select: { id: true, endpoint: true, p256dh: true, auth: true, failures: true },
      take: 5000,
    })
    .catch(() => [] as StoredSub[]);

  if (subs.length === 0) return { attempted: 0, delivered: 0, pruned: 0, skipped: false };

  const prune: string[] = [];
  let delivered = 0;

  for (let i = 0; i < subs.length; i += CONCURRENCY) {
    const batch = subs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((s) => sendOne(s, payload)));
    results.forEach((r, idx) => {
      if (r === "ok") delivered++;
      else if (r === "prune") prune.push(batch[idx]!.id);
    });
  }

  if (prune.length > 0) {
    await prisma.pushSubscription
      .deleteMany({ where: { id: { in: prune } } })
      .catch(() => null);
  }

  if (delivered > 0 || prune.length > 0) {
    log.info("push delivered", { devices: subs.length, delivered, pruned: prune.length });
  }

  return { attempted: subs.length, delivered, pruned: prune.length, skipped: false };
}

/** Convenience wrapper for the common single-recipient case. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushSendResult> {
  return sendPushToUsers([userId], payload);
}
