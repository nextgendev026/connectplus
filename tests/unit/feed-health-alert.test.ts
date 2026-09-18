import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The alerting half of feed health: when a feed breaks it must reach a human,
 * and it must not reach them every hour for the same outage.
 */

interface MailOpts {
  to: string;
  subject: string;
  text: string;
}

const checkFeedHealth = vi.fn();
const redisGetRaw = vi.fn();
const redisSetEx = vi.fn();
const sendEmail = vi.fn(async (_opts: MailOpts) => ({}));
const alertRecipients = vi.fn(async () => ["ops@connectplus.test"]);
const alertWebhookUrl = vi.fn(async () => null);

vi.mock("@/lib/feed-health", () => ({
  checkFeedHealth: () => checkFeedHealth(),
}));

vi.mock("@/lib/redis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/redis")>()),
  redisGetRaw: (key: string) => redisGetRaw(key),
  redisSetEx: (key: string, ttl: number, value: string) => redisSetEx(key, ttl, value),
}));

vi.mock("@/lib/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mailer")>()),
  sendEmail: (opts: MailOpts) => sendEmail(opts),
}));

vi.mock("@/lib/status-alerts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/status-alerts")>()),
  alertRecipients: () => alertRecipients(),
  alertWebhookUrl: () => alertWebhookUrl(),
}));

const { runFeedHealth } = await import("@/lib/cron-jobs");

function report(state: "ok" | "warn" | "critical") {
  return {
    generatedAt: new Date().toISOString(),
    overall: state,
    checks: [
      {
        id: "rss" as const,
        label: "RSS feed",
        url: "https://connectplus.test/feed.xml",
        state,
        itemCount: state === "ok" ? 50 : 0,
        linksChecked: 0,
        brokenLinks: 0,
        errors: state === "ok" ? [] : ["HTTP 500"],
        detail: state === "ok" ? "50 items" : "The RSS feed answered 500.",
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  redisGetRaw.mockResolvedValue(null);
  redisSetEx.mockResolvedValue(true);
  alertRecipients.mockResolvedValue(["ops@connectplus.test"]);
  alertWebhookUrl.mockResolvedValue(null);
});

describe("runFeedHealth", () => {
  it("stays silent while every feed is healthy", async () => {
    checkFeedHealth.mockResolvedValue(report("ok"));
    const result = await runFeedHealth();
    expect(result.overall).toBe("ok");
    expect(result.alerted).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails when a feed breaks", async () => {
    checkFeedHealth.mockResolvedValue(report("critical"));
    const result = await runFeedHealth();
    expect(result.alerted).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0]![0];
    expect(call.to).toBe("ops@connectplus.test");
    expect(call.subject).toMatch(/feed/i);
    expect(call.text).toContain("RSS feed");
  });

  it("records the episode so the same outage does not re-alert", async () => {
    checkFeedHealth.mockResolvedValue(report("critical"));
    await runFeedHealth();
    expect(redisSetEx).toHaveBeenCalledWith("status:alert:feed:rss", 6 * 60 * 60, "critical");
  });

  it("does not alert again when the same state was already sent", async () => {
    checkFeedHealth.mockResolvedValue(report("critical"));
    redisGetRaw.mockResolvedValue("critical");
    const result = await runFeedHealth();
    expect(result.alerted).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("alerts again when the state escalates from warn to critical", async () => {
    checkFeedHealth.mockResolvedValue(report("critical"));
    redisGetRaw.mockResolvedValue("warn");
    const result = await runFeedHealth();
    expect(result.alerted).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
