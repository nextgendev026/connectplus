export { runChecks } from "@/lib/status";

/**
 * Alert recipients: STATUS_ALERT_EMAILS (comma-separated) wins; falls back to
 * the platform SUPER_ADMIN's email so seeded deployments get alerts without
 * extra configuration.
 */
export function alertRecipients(): string[] {
  const explicit = process.env.STATUS_ALERT_EMAILS;
  if (explicit) {
    return explicit
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
  }
  const fallback = process.env.SUPER_ADMIN_EMAIL;
  return fallback ? [fallback] : [];
}
