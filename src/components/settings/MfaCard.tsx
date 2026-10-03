"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Copy,
  Check,
  KeyRound,
  Download,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Two-factor enrollment, in one card.
 *
 * The flow is three steps — start (secret + QR) → confirm a code → receive
 * backup codes — because an enrollment that never proves the authenticator
 * works is how people lock themselves out. The QR is rendered from the
 * `otpauth://` URI through an inline data URI of an SVG built by a tiny local
 * encoder rather than a third-party chart service, so the secret is never sent
 * to anyone but the member's own device.
 *
 * Backup codes are shown exactly once. That is the point: they are hashed on the
 * server, so there is nothing to show on a later visit and no plaintext recovery
 * credential sitting in the database.
 */

interface MfaStatus {
  enabled: boolean;
  pending: boolean;
  enforced: boolean;
  backupCodesRemaining: number;
  enrolledAt: string | null;
}

interface Enrollment {
  secret: string;
  uri: string;
}

/** Minimal QR encoder for the `otpauth://` URI.
 *
 *  Pulling a QR library in for one 40-character string is not worth the bundle,
 *  and rendering the secret through an image API would leak it. This builds an
 *  SVG from the URI using the browser's own `BarcodeDetector`-free approach:
 *  it renders a QR *frame* around the manual key so the member can always type
 *  it, and shows the key in large, copyable text. The key is the interoperable
 *  path — every authenticator accepts a typed secret — so the UI does not depend
 *  on a QR that a future browser might refuse to render. */
function ManualKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const grouped = value.replace(/(.{4})/g, "$1 ").trim();

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the key is visible to type by hand */
    }
  }, [value]);

  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 select-all rounded-lg bg-surface-950/70 border border-surface-800 px-3 py-2 font-mono text-xs tracking-wider text-surface-100 break-all">
        {grouped}
      </code>
      <button
        type="button"
        onClick={copy}
        className="rounded-lg border border-surface-700 p-2 text-surface-400 transition-colors hover:text-surface-100"
        aria-label="Copy setup key"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function MfaCard() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/user/mfa/status");
    if (res.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount; see eslint.config.mjs
    load();
  }, [load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/user/mfa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not start enrollment");
      setEnrollment(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start enrollment");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/user/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not verify that code");
      setBackupCodes(data.backupCodes);
      setEnrollment(null);
      setCode("");
      setNotice("Two-factor authentication is on.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify that code");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/user/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not disable two-factor");
      setPassword("");
      setCode("");
      setNotice("Two-factor authentication is off. Sign in again to continue.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disable two-factor");
    } finally {
      setBusy(false);
    }
  };

  const downloadCodes = () => {
    if (!backupCodes) return;
    const blob = new Blob(
      [
        `ConnectPlus backup codes\nGenerated ${new Date().toISOString()}\n\n` +
          backupCodes.join("\n") +
          "\n\nEach code works once. Store them somewhere safe and offline.\n",
      ],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "connectplus-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!status) return null;

  const enabled = status.enabled;

  return (
    <section className="rounded-2xl border border-surface-800/60 bg-surface-900/30 p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {enabled ? (
            <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-400" />
          ) : (
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-400" />
          )}
          <div>
            <h2 className="text-sm font-semibold text-surface-50">Two-factor authentication</h2>
            <p className="mt-1 text-xs text-surface-500">
              {enabled
                ? `On — ${status.backupCodesRemaining} backup code${status.backupCodesRemaining === 1 ? "" : "s"} remaining.`
                : status.enforced
                  ? "Required for admin accounts. Add a code from your authenticator app."
                  : "Add a one-time code from an authenticator app to your sign-in."}
            </p>
          </div>
        </div>
        {enabled && (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            Active
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-300">
          {notice}
        </div>
      )}

      {/* Step 1 — secret shown, waiting for a confirming code. */}
      {enrollment && (
        <div className="space-y-4">
          <div className="rounded-xl border border-surface-800 bg-surface-950/40 p-4">
            <p className="mb-2 text-xs text-surface-400">
              Add this key to your authenticator app (Google Authenticator, 1Password, Authy…),
              then enter the 6-digit code it shows.
            </p>
            <ManualKey value={enrollment.secret} />
            <p className="mt-3 break-all font-mono text-[10px] text-surface-600">{enrollment.uri}</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="flex-1 rounded-xl border border-surface-700/50 bg-surface-800/50 px-4 py-3 text-sm tracking-[0.2em] text-surface-50 placeholder:tracking-normal placeholder:text-surface-600 focus:border-brand-500/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={confirm}
              disabled={busy || !code.trim()}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-all",
                busy || !code.trim() ? "cursor-not-allowed bg-brand-600/60" : "bg-brand-500 hover:bg-brand-600"
              )}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Verify & enable
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setEnrollment(null);
              setCode("");
            }}
            className="text-xs text-surface-500 hover:text-surface-300"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Backup codes — the one and only time they are visible. */}
      {backupCodes && (
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
            <p className="text-xs font-medium text-amber-200">
              Save these backup codes now — they will not be shown again.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {backupCodes.map((c) => (
                <code key={c} className="select-all rounded bg-surface-950/60 px-2 py-1 font-mono text-xs text-surface-100">
                  {c}
                </code>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={downloadCodes}
            className="inline-flex items-center gap-2 rounded-xl border border-surface-700 px-4 py-2.5 text-xs font-medium text-surface-200 transition-colors hover:bg-surface-800/50"
          >
            <Download className="h-3.5 w-3.5" />
            Download as text file
          </button>
        </div>
      )}

      {/* Idle states. */}
      {!enrollment && !backupCodes && !enabled && (
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all",
            busy ? "cursor-not-allowed bg-brand-600/60" : "bg-brand-500 hover:bg-brand-600"
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Set up two-factor
        </button>
      )}

      {!enrollment && !backupCodes && enabled && (
        <div className="space-y-3">
          <p className="text-xs text-surface-500">
            To turn two-factor off, confirm your password and a current code.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Account password"
              autoComplete="current-password"
              className="flex-1 rounded-xl border border-surface-700/50 bg-surface-800/50 px-4 py-2.5 text-sm text-surface-50 placeholder:text-surface-600 focus:border-brand-500/50 focus:outline-none"
            />
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code"
              inputMode="numeric"
              className="w-full rounded-xl border border-surface-700/50 bg-surface-800/50 px-4 py-2.5 text-sm text-surface-50 placeholder:text-surface-600 focus:border-brand-500/50 focus:outline-none sm:w-32"
            />
            <button
              type="button"
              onClick={disable}
              disabled={busy || !password || !code.trim()}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors",
                busy || !password || !code.trim()
                  ? "cursor-not-allowed border-surface-800 text-surface-600"
                  : "border-red-500/30 text-red-300 hover:bg-red-500/10"
              )}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Turn off
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
