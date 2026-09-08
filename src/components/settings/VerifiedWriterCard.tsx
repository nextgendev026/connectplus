"use client";

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Loader2,
  Mail,
  PenLine,
  ShieldCheck,
  ClipboardCheck,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WriterCardProps {
  email: string;
  role: string;
  isVerified: boolean;
  emailVerified: string | null;
}

interface ApplicationState {
  role: string;
  isVerified: boolean;
  emailVerified: string | null;
  application: {
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    motivation: string;
    portfolio: string | null;
    reviewedNote: string | null;
    reviewedAt: string | null;
  } | null;
}

export function VerifiedWriterCard({ email, role, emailVerified }: WriterCardProps) {
  const [data, setData] = useState<ApplicationState | null>(null);
  const [motivation, setMotivation] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [notify, setNotify] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [resendDevUrl, setResendDevUrl] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/writer-applications", { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
      if (json.application?.status === "REJECTED") {
        setMotivation(json.application.motivation ?? "");
        setPortfolio(json.application.portfolio ?? "");
      }
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: idempotent loading flag
    load();
  }, []);

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotify(null);
    setBusy(true);
    try {
      const res = await fetch("/api/writer-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivation, portfolio }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotify({ kind: "err", text: json.error ?? "Couldn't submit your application." });
        return;
      }
      setNotify({ kind: "ok", text: "Application submitted — we'll review it shortly." });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setNotify(null);
    setSending(true);
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotify({ kind: "err", text: json.error ?? "Couldn't send the email." });
        return;
      }
      if (json?.emailVerification?.devUrl) {
        setResendDevUrl(json.emailVerification.devUrl);
      }
      setNotify({ kind: "ok", text: "Verification email sent — check your inbox." });
    } finally {
      setSending(false);
    }
  };

  const alreadyVerified =
    role === "CREATOR" || role === "ADMIN" || role === "SUPER_ADMIN";
  const application = data?.application;

  return (
    <div className="rounded-2xl border border-surface-800 bg-surface-900/40 p-6">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-xl border",
            alreadyVerified
              ? "bg-emerald-500/10 border-emerald-500/25"
              : "bg-brand-500/10 border-brand-500/25"
          )}
        >
          {alreadyVerified ? (
            <BadgeCheck className="h-5 w-5 text-emerald-400" />
          ) : (
            <PenLine className="h-5 w-5 text-accent-strong" />
          )}
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-surface-50">
            {alreadyVerified ? "Verified Writer" : "Become a Verified Writer"}
          </h2>
          <p className="text-sm text-surface-400">
            {alreadyVerified
              ? "You publish straight through — no review needed on your stories."
              : "Get a badge and publish without admin review."}
          </p>
        </div>
      </div>

      {notify && (
        <div
          className={cn(
            "mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
            notify.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          )}
        >
          {notify.kind === "ok" ? (
            <ClipboardCheck className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <span>{notify.text}</span>
        </div>
      )}

      {resendDevUrl && (
        <div className="mt-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-3">
          <p className="type-caption text-emerald-300 leading-relaxed">
            Dev mode — verification link:{" "}
            <a href={resendDevUrl} className="underline break-all">{resendDevUrl}</a>
          </p>
        </div>
      )}

      {!emailVerified ? (
        <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-amber-400">
            <Mail className="h-4 w-4" />
            <p className="type-caption font-medium">Email not verified</p>
          </div>
          <p className="mt-2 text-sm text-surface-300">
            Confirm <span className="text-surface-100">{email}</span> first — publishing
            and verified-writer applications are locked until then.
          </p>
          <button
            onClick={resend}
            disabled={sending}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-500/10 border border-brand-500/25 px-4 py-2 text-xs font-medium text-accent-strong hover:bg-brand-500/20 transition-colors disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Resend verification email
          </button>
        </div>
      ) : alreadyVerified ? (
        <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-sm text-surface-300">
            Your stories go straight to the feed. The{" "}
            <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
              <BadgeCheck className="h-3.5 w-3.5" /> verified badge
            </span>{" "}
            appears on your profile.
          </p>
        </div>
      ) : application?.status === "APPROVED" ? (
        <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-sm text-surface-300">
            Your application was approved — the badge is live on your profile.
            Sign out and back in if it doesn&apos;t show immediately.
          </p>
        </div>
      ) : application?.status === "PENDING" ? (
        <div className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-amber-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="type-caption font-medium">Application under review</p>
          </div>
          <p className="mt-2 text-sm text-surface-300">
            We&apos;ll notify you here once a decision is made.
          </p>
        </div>
      ) : (
        <form onSubmit={apply} className="mt-5 space-y-4">
          {application?.status === "REJECTED" && application?.reviewedNote && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <p className="type-caption text-red-400 font-medium mb-1">Previous application feedback</p>
              <p className="text-sm text-surface-300">{application.reviewedNote}</p>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-surface-400">
              Why do you want to write on connectPlus?
            </label>
            <textarea
              value={motivation}
              onChange={(e) => setMotivation(e.target.value)}
              placeholder="Tell us about your writing, your audience, and what you'd publish…"
              className="w-full rounded-xl border border-surface-800 bg-surface-900/60 px-4 py-3 text-sm text-surface-100 placeholder-surface-500 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 min-h-24 resize-y"
              maxLength={2000}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-surface-400">
              Portfolio / links <span className="text-surface-600">(optional)</span>
            </label>
            <textarea
              value={portfolio}
              onChange={(e) => setPortfolio(e.target.value)}
              placeholder="Medium, blog, LinkedIn, or sample story links…"
              className="w-full rounded-xl border border-surface-800 bg-surface-900/60 px-4 py-3 text-sm text-surface-100 placeholder-surface-500 outline-none transition-colors focus:border-brand-500 focus:ring-1 focus:ring-brand-500/40 min-h-20 resize-y"
              maxLength={2000}
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-all"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Submit application
          </button>
        </form>
      )}
    </div>
  );
}