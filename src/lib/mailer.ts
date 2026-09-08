import { randomBytes } from "node:crypto";

/**
 * Transactional email with zero hard dependencies: if `RESEND_API_KEY` is set
 * it sends via the Resend HTTP API; otherwise (local dev, no provider yet) the
 * message is logged to the server console and returned to the caller so the
 * verification flow stays testable end-to-end. Add more providers by extending
 * `sendEmail` behind this one entry point.
 */

export function createEmailVerificationToken(): {
  token: string;
  expiresAt: Date;
} {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  return { token, expiresAt };
}

export function appBaseUrl(): string {
  return (
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://connectplusapp.vercel.app"
      : "http://localhost:3000")
  );
}

const MAIL_FROM =
  process.env.MAIL_FROM ??
  process.env.RESEND_FROM ??
  "connectPlus <noreply@connectplusapp.com>";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: SendEmailInput): Promise<{ ok: boolean; delivered: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text, html }),
      });
      if (!res.ok) {
        console.error("Resend send failed:", res.status, await res.text().catch(() => ""));
        return { ok: true, delivered: false, error: `resend:${res.status}` };
      }
      return { ok: true, delivered: true };
    } catch (e) {
      console.error("Resend error:", e);
      return { ok: false, delivered: false, error: "resend-exception" };
    }
  }

  // Dev fallback — print the message so the full verify flow works locally and
  // the link can be surfaced in the UI.
  console.log(`\n[connectPlus mailer (dev)] → ${to}\nSubject: ${subject}\n\n${text}\n${"-".repeat(60)}\n`);
  return { ok: true, delivered: false };
}

export async function sendVerificationEmail(input: {
  to: string;
  name: string;
  verificationUrl: string;
}) {
  const { to, name, verificationUrl } = input;
  const text = [
    `Hi ${name},`,
    "",
    "Welcome to connectPlus! Please confirm your email address to unlock publishing.",
    "",
    `Confirm your email: ${verificationUrl}`,
    "",
    "This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.",
    "",
    "— The connectPlus team",
  ].join("\n");

  const html = [
    `<div style="font-family:Inter,system-ui,sans-serif;background:#0a0a0d;color:#fcfcfd;padding:32px">`,
    `  <div style="max-width:480px;margin:0 auto">`,
    `    <p style="font-size:22px;font-weight:800;margin:0 0 16px;color:#ff6b00">connect<span style="color:#fff">Plus</span></p>`,
    `    <h1 style="font-size:18px;margin:0 0 12px">Confirm your email address</h1>`,
    `    <p style="font-size:14px;line-height:1.6;color:#aeaeb8">Hi ${name}, welcome to connectPlus. Confirm your email to unlock publishing and apply to become a verified writer.</p>`,
    `    <a href="${verificationUrl}" style="display:inline-block;margin:16px 0;padding:12px 20px;border-radius:10px;background:linear-gradient(120deg,#ff8a33,#ff6b00);color:#fff;font-size:14px;font-weight:700;text-decoration:none">Confirm email</a>`,
    `    <p style="font-size:13px;color:#7c7c86;line-height:1.6">If the button doesn't work, paste this link into your browser: ${verificationUrl}</p>`,
    `    <p style="font-size:13px;color:#7c7c86">This link expires in 24 hours.</p>`,
    `  </div>`,
    `</div>`,
  ].join("\n");

  return sendEmail({ to, subject: "Confirm your connectPlus email", text, html });
}