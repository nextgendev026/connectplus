"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Smartphone,
  UserPlus,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProviderView {
  id: string;
  name: string;
  method: string;
  description: string;
  currency: string;
  configured: boolean;
  missing: string[];
  docs: { label: string; href: string }[];
}

interface IntentView {
  id: string;
  reference: string;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  listAmount: number | null;
  listCurrency: string | null;
  billingCycle: string;
  createdAt: string;
  settledAt: string | null;
  providerReceipt: string | null;
  payerPhone: string | null;
  failureReason: string | null;
  plan: string;
  user: { id: string; name: string | null; username: string | null; email: string | null };
}

interface PaymentsReport {
  generatedAt: string;
  providers: ProviderView[];
  health: { stalePending: number; failedToday: number; succeededToday: number };
  revenue: Record<string, { total: number; count: number; byProvider: Record<string, number> }>;
  subscriptionsByProvider: { provider: string; status: string; count: number }[];
  pricing: {
    planId: string;
    displayName: string;
    audience: string;
    priceMonthly: number;
    priceYearly: number;
    paypalPlanMonthlyId: string | null;
    paypalPlanYearlyId: string | null;
    settlement: Record<string, { amount: number; currency: string; converted: boolean }>;
  }[];
  intents: IntentView[];
  events: { id: string; eventId: string; provider: string; type: string; handledAt: string }[];
}

const STATUS_STYLES: Record<string, string> = {
  succeeded: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  processing: "bg-brand-500/15 text-brand-600 dark:text-brand-400 border-brand-500/30",
  pending: "bg-surface-300/40 text-surface-600 dark:bg-surface-800 dark:text-surface-300 border-surface-400/30",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  cancelled: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  expired: "bg-surface-300/40 text-surface-500 dark:bg-surface-800 dark:text-surface-400 border-surface-400/30",
};

const PROVIDER_ICON: Record<string, typeof Smartphone> = {
  daraja: Smartphone,
  paypal: CreditCard,
};

export default function PaymentsPage() {
  const [report, setReport] = useState<PaymentsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantPlan, setGrantPlan] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/payments", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load payments (${res.status})`);
      setReport(await res.json());
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Failed to load payments" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      setMessage({
        ok: res.ok,
        text: data?.detail ?? data?.error ?? (res.ok ? "Done." : "That action failed."),
      });
      if (res.ok) await load();
    } catch {
      setMessage({ ok: false, text: "Network error — please try again." });
    } finally {
      setBusy(null);
    }
  }

  async function testProvider(provider: string) {
    setBusy(`test-${provider}`);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json().catch(() => ({}));
      setMessage({ ok: res.ok && data?.ok !== false, text: data?.detail ?? "No verdict returned." });
    } catch {
      setMessage({ ok: false, text: "Network error — please try again." });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !report) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </div>
    );
  }

  const currencies = Object.entries(report?.revenue ?? {});
  const anyConfigured = report?.providers.some((p) => p.configured) ?? false;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10">
            <Banknote className="h-6 w-6 text-brand-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-surface-900 dark:text-surface-50">Payments</h1>
            <p className="text-sm text-surface-500">
              Safaricom Daraja (M-Pesa) and PayPal — credentials, settlements and repairs.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void act({ action: "expire-lapsed" }, "expire")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-semibold text-surface-600 transition hover:border-brand-500/50 disabled:opacity-60 dark:border-surface-700 dark:text-surface-300"
          >
            {busy === "expire" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDownToLine className="h-3.5 w-3.5" />}
            Expire lapsed
          </button>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-surface-200 p-2 text-surface-500 transition hover:border-brand-500/50 dark:border-surface-700"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {message && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-medium",
            message.ok
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400"
          )}
        >
          {message.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="leading-relaxed">{message.text}</span>
        </div>
      )}

      {!anyConfigured && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="leading-relaxed">
            No payment rail is configured, so every paid plan currently returns{" "}
            <code className="rounded bg-black/10 px-1 dark:bg-white/10">PAYMENTS_NOT_CONFIGURED</code>. Inject the
            credentials below (Vercel → Settings → Environment Variables, or <code>.env</code> locally) and the pricing
            page enables itself — no redeploy of the app logic required.
          </span>
        </div>
      )}

      {/* Rails */}
      <div className="grid gap-4 lg:grid-cols-2">
        {(report?.providers ?? []).map((p) => {
          const Icon = PROVIDER_ICON[p.id] ?? CreditCard;
          return (
            <article
              key={p.id}
              className={cn(
                "rounded-2xl border p-5",
                p.configured
                  ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent"
                  : "border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/60 dark:bg-surface-800">
                    <Icon className="h-5 w-5 text-brand-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-surface-900 dark:text-surface-50">{p.name}</h3>
                    <p className="text-[11px] uppercase tracking-wider text-surface-500">
                      {p.method} · settles in {p.currency}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase",
                    p.configured
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  )}
                >
                  {p.configured ? "live" : "not configured"}
                </span>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-surface-600 dark:text-surface-400">{p.description}</p>

              <div className="mt-4 space-y-2">
                {p.missing.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                      Credentials to inject
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {p.missing.map((name) => (
                        <code
                          key={name}
                          className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                        >
                          {name}
                        </code>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> All credentials present
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={() => void testProvider(p.id)}
                    disabled={!p.configured || busy !== null}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-500/20 disabled:opacity-50 dark:text-brand-400"
                  >
                    {busy === `test-${p.id}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    )}
                    Verify credentials
                  </button>
                  {p.docs.map((d) => (
                    <a
                      key={d.href}
                      href={d.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] font-medium text-surface-500 underline hover:text-brand-500"
                    >
                      {d.label}
                    </a>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Revenue + health */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {currencies.length === 0 ? (
          <div className="rounded-2xl border border-surface-200/70 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
            <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Settled (30d)</p>
            <p className="mt-2 text-2xl font-bold text-surface-900 dark:text-surface-50">—</p>
            <p className="mt-0.5 text-[11px] text-surface-500">No settled payments yet</p>
          </div>
        ) : (
          currencies.map(([currency, bucket]) => (
            <div
              key={currency}
              className="rounded-2xl border border-surface-200/70 bg-white p-4 dark:border-surface-800 dark:bg-surface-900"
            >
              <p className="text-xs font-medium uppercase tracking-wider text-surface-500">
                Settled 30d ({currency})
              </p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-surface-900 dark:text-surface-50">
                {currency === "KES" ? "KSh " : currency === "USD" ? "$" : ""}
                {bucket.total.toLocaleString()}
              </p>
              <p className="mt-0.5 text-[11px] text-surface-500">
                {bucket.count} payment{bucket.count === 1 ? "" : "s"} ·{" "}
                {Object.entries(bucket.byProvider)
                  .map(([k, v]) => `${k} ${Math.round(v).toLocaleString()}`)
                  .join(" · ")}
              </p>
            </div>
          ))
        )}
        <div className="rounded-2xl border border-surface-200/70 bg-white p-4 dark:border-surface-800 dark:bg-surface-900">
          <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Settled (24h)</p>
          <p className="mt-2 text-2xl font-bold text-surface-900 dark:text-surface-50">
            {report?.health.succeededToday ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-surface-500">{report?.health.failedToday ?? 0} failed</p>
        </div>
        <div
          className={cn(
            "rounded-2xl border p-4",
            (report?.health.stalePending ?? 0) > 0
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-surface-200/70 bg-white dark:border-surface-800 dark:bg-surface-900"
          )}
        >
          <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Stuck &gt;30m</p>
          <p className="mt-2 text-2xl font-bold text-surface-900 dark:text-surface-50">
            {report?.health.stalePending ?? 0}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-surface-500">
            {(report?.health.stalePending ?? 0) > 0 ? (
              <>
                <AlertTriangle className="h-3 w-3 text-amber-500" /> prompts that never resolved
              </>
            ) : (
              "nothing waiting on a provider"
            )}
          </p>
        </div>
      </div>

      {/* What each rail charges */}
      {report && report.pricing.length > 0 && (
        <section className="rounded-2xl border border-surface-200/70 bg-white dark:border-surface-800 dark:bg-surface-900">
          <header className="border-b border-surface-200/70 px-5 py-3 dark:border-surface-800">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Settlement prices</h2>
            <p className="text-[11px] text-surface-500">
              What a member is actually charged per rail. M-Pesa settles in whole shillings, so USD plans are converted
              at the configured rate.
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-surface-500">
                <tr>
                  <th className="px-5 py-2 font-semibold">Plan</th>
                  <th className="px-3 py-2 font-semibold">Listed</th>
                  <th className="px-3 py-2 font-semibold">M-Pesa /mo</th>
                  <th className="px-3 py-2 font-semibold">M-Pesa /yr</th>
                  <th className="px-3 py-2 font-semibold">PayPal /mo</th>
                  <th className="px-3 py-2 font-semibold">PayPal plan id</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200/70 dark:divide-surface-800">
                {report.pricing.map((p) => (
                  <tr key={p.planId}>
                    <td className="px-5 py-2 font-medium text-surface-800 dark:text-surface-100">
                      {p.displayName}
                      <span className="ml-1.5 text-[10px] uppercase text-surface-500">{p.audience}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-surface-600 dark:text-surface-300">
                      {p.priceMonthly} / {p.priceYearly}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-surface-600 dark:text-surface-300">
                      {p.settlement.daraja?.amount?.toLocaleString() ?? "—"} {p.settlement.daraja?.currency}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-surface-600 dark:text-surface-300">
                      {p.settlement.daraja_yearly?.amount?.toLocaleString() ?? "—"} {p.settlement.daraja_yearly?.currency}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-surface-600 dark:text-surface-300">
                      {p.settlement.paypal?.amount ?? "—"} {p.settlement.paypal?.currency}
                    </td>
                    <td className="px-3 py-2">
                      {p.paypalPlanMonthlyId ? (
                        <code className="text-[10px] text-surface-600 dark:text-surface-300">{p.paypalPlanMonthlyId}</code>
                      ) : (
                        <span className="text-[10px] text-surface-500">one-off period</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Manual grant */}
      <section className="rounded-2xl border border-surface-200/70 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-surface-50">
          <UserPlus className="h-4 w-4 text-brand-500" />
          Grant a membership
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-surface-500">
          For payments taken outside the app (bank transfer, cash, a partner code). The grant is recorded as a manual
          payment with your admin id as the reference, so it is always auditable.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={grantEmail}
            onChange={(e) => setGrantEmail(e.target.value)}
            placeholder="member@example.com"
            className="min-w-[220px] flex-1 rounded-lg border border-surface-200 bg-white px-3 py-2 text-xs text-surface-800 placeholder:text-surface-400 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100"
          />
          <select
            value={grantPlan}
            onChange={(e) => setGrantPlan(e.target.value)}
            className="rounded-lg border border-surface-200 bg-white px-3 py-2 text-xs text-surface-800 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-surface-700 dark:bg-surface-950 dark:text-surface-100"
          >
            <option value="">Choose a plan…</option>
            {(report?.pricing ?? []).map((p) => (
              <option key={p.planId} value={p.planId}>
                {p.displayName}
              </option>
            ))}
          </select>
          <button
            onClick={() => void act({ action: "grant", email: grantEmail, planId: grantPlan, billingCycle: "monthly" }, "grant")}
            disabled={!grantEmail || !grantPlan || busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
          >
            {busy === "grant" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
            Grant
          </button>
        </div>
      </section>

      {/* Intents */}
      <section className="rounded-2xl border border-surface-200/70 bg-white dark:border-surface-800 dark:bg-surface-900">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-200/70 px-5 py-3 dark:border-surface-800">
          <div>
            <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Payment attempts</h2>
            <p className="text-[11px] text-surface-500">
              Newest first. A failed row carries the provider&apos;s own reason — that is the first thing to read when a
              member says they paid.
            </p>
          </div>
        </header>
        {!report || report.intents.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-surface-500">No payment attempts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-surface-500">
                <tr>
                  <th className="px-5 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Member</th>
                  <th className="px-3 py-2 font-semibold">Plan</th>
                  <th className="px-3 py-2 font-semibold">Rail</th>
                  <th className="px-3 py-2 font-semibold">Amount</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Reference</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200/70 dark:divide-surface-800">
                {report.intents.map((i) => (
                  <tr key={i.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2 text-surface-500">
                      {new Date(i.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2 text-surface-700 dark:text-surface-200">
                      <span className="block">{i.user.name ?? i.user.username ?? "—"}</span>
                      <span className="block text-[10px] text-surface-500">{i.user.email}</span>
                    </td>
                    <td className="px-3 py-2 text-surface-700 dark:text-surface-200">
                      {i.plan}
                      <span className="block text-[10px] text-surface-500">{i.billingCycle}</span>
                    </td>
                    <td className="px-3 py-2 text-surface-700 dark:text-surface-200">
                      {i.provider}
                      {i.payerPhone ? <span className="block text-[10px] text-surface-500">{i.payerPhone}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-surface-700 dark:text-surface-200">
                      {i.currency === "KES" ? "KSh " : i.currency === "USD" ? "$" : ""}
                      {i.amount.toLocaleString()}
                      {i.listCurrency && i.listCurrency !== i.currency ? (
                        <span className="block text-[10px] text-surface-500">
                          listed {i.listAmount} {i.listCurrency}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase",
                          STATUS_STYLES[i.status] ?? STATUS_STYLES.pending
                        )}
                      >
                        {i.status}
                      </span>
                      {i.failureReason ? (
                        <span className="mt-1 block max-w-[220px] text-[10px] leading-snug text-red-600 dark:text-red-400">
                          {i.failureReason}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-[10px] text-surface-600 dark:text-surface-300">{i.reference}</code>
                      {i.providerReceipt ? (
                        <span className="block text-[10px] text-surface-500">receipt {i.providerReceipt}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {i.status === "succeeded" ? (
                        <button
                          onClick={() => void act({ action: "mark-refunded", intentId: i.id }, `refund-${i.id}`)}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-1 rounded-md border border-surface-200 px-2 py-1 text-[10px] font-semibold text-surface-600 transition hover:border-red-500/50 hover:text-red-600 disabled:opacity-50 dark:border-surface-700 dark:text-surface-300"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Mark refunded
                        </button>
                      ) : (
                        <span className="text-[10px] text-surface-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Events */}
      <section className="rounded-2xl border border-surface-200/70 bg-white dark:border-surface-800 dark:bg-surface-900">
        <header className="border-b border-surface-200/70 px-5 py-3 dark:border-surface-800">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-50">Provider notifications</h2>
          <p className="text-[11px] text-surface-500">
            Every inbound callback and webhook we accepted. The ledger is what makes a replayed delivery harmless, so a
            gap here is how a dropped notification shows itself.
          </p>
        </header>
        {!report || report.events.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-surface-500">No notifications received yet.</p>
        ) : (
          <ul className="divide-y divide-surface-200/70 dark:divide-surface-800">
            {report.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 px-5 py-2 text-[11px]">
                <span className="rounded border border-surface-200 px-1.5 py-0.5 font-semibold uppercase text-surface-500 dark:border-surface-700">
                  {e.provider}
                </span>
                <span className="font-medium text-surface-700 dark:text-surface-200">{e.type}</span>
                <code className="text-[10px] text-surface-500">{e.eventId}</code>
                <span className="ml-auto text-surface-500">{new Date(e.handledAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
