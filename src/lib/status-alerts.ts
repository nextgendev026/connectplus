export { runChecks } from "@/lib/status";

/**
 * Alert routing for the status watchdog. Admin-managed values live in the
 * platform settings store (/admin/settings → Integrations); environment
 * variables act as ops overrides / bootstrap fallbacks:
 *
 *   recipients: STATUS_ALERT_EMAILS env → statusAlertEmails setting → SUPER_ADMIN_EMAIL
 *   webhook:    STATUS_WEBHOOK_URL env  → statusWebhookUrl setting
 *
 * `getSettings` degrades gracefully when the database is unreachable (returns
 * catalog defaults / last-known-good), so alerting still works during the
 * very outages it reports.
 */
export async function alertRecipients(): Promise<string[]> {
  const explicit = process.env.STATUS_ALERT_EMAILS;
  if (explicit) {
    return explicit
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
  }

  try {
    const { getSettings } = await import("@/lib/settings");
    const s = await getSettings(false);
    const fromSettings = (s.statusAlertEmails ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (fromSettings.length > 0) return fromSettings;
  } catch {
    // settings unavailable — fall through
  }

  const fallback = process.env.SUPER_ADMIN_EMAIL;
  return fallback ? [fallback] : [];
}

export async function alertWebhookUrl(): Promise<string | null> {
  if (process.env.STATUS_WEBHOOK_URL) return process.env.STATUS_WEBHOOK_URL;
  try {
    const { getSettings } = await import("@/lib/settings");
    const s = await getSettings(false);
    return s.statusWebhookUrl?.trim() || null;
  } catch {
    return null;
  }
}
