"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Flame,
  Loader2,
  MessageCircle,
  Pencil,
  Play,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Target,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import {
  AdminBadge,
  AdminEmpty,
  AdminNotice,
  AdminPage,
  AdminPanel,
  AdminStat,
  AdminStatGrid,
  adminBtnGhost,
  adminBtnPrimary,
  adminInput,
} from "@/components/admin/AdminUI";
import { readableSubject, type CampaignRow, type MarketingReport } from "@/lib/marketing";
import { BRAND_HASHTAG } from "@/lib/brand";

/**
 * The marketing console.
 *
 * The engine runs on a schedule whether anyone is watching or not, which is
 * exactly why this page exists: an unattended pipeline that stops looks identical
 * to one that is working. So the page leads with the evidence — what the brain is
 * reading from, what went out, what failed and why — and puts the switches that
 * change its behaviour in the same view as the numbers they change.
 */

const REFRESH_MS = 20_000;

const STATUS_TONE: Record<string, "positive" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "info",
  APPROVED: "warning",
  PUBLISHED: "positive",
  REJECTED: "neutral",
  FAILED: "danger",
};

// lucide has no brand glyphs any more, so each channel borrows the closest
// functional icon: the point is to make the channel scannable in a list, not to
// reproduce a logo.
const CHANNEL_ICON = {
  facebook: Share2,
  whatsapp: MessageCircle,
  story: Sparkles,
  x: Send,
  copy: Copy,
} as const;

function scoreTone(score: number): string {
  if (score >= 80) return "text-emerald-300";
  if (score >= 65) return "text-amber-300";
  return "text-surface-400";
}

export default function AdminMarketingPage() {
  const [report, setReport] = useState<MarketingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "DRAFT" | "APPROVED" | "PUBLISHED" | "FAILED">("all");
  const [editing, setEditing] = useState<{ id: string; title: string; body: string } | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch("/api/admin/marketing", { cache: "no-store" });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as MarketingReport;
      if (mounted.current) {
        setReport(data);
        setError(null);
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- the initial read is the point of the page */
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /*
   * Self-refreshing, for the same reason the health console is: the engine runs
   * on a schedule nobody is watching, so the numbers that prove it ran have to
   * arrive on their own. Polling rather than a socket because the actions on this
   * page already return the whole report — the poll only has to catch what the
   * scheduler did.
   */
  useEffect(() => {
    const timer = setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const act = useCallback(
    async (action: string, payload: Record<string, unknown> = {}, label?: string) => {
      setBusy(label ?? action);
      setNotice(null);
      try {
        const res = await fetch("/api/admin/marketing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });
        const data = (await res.json().catch(() => ({}))) as MarketingReport & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `Action failed (${res.status})`);
        setReport(data);
        setError(null);
        setNotice(successNote(action, data));
        setEditing(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const saveSetting = useCallback(async (key: string, value: string) => {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: { [key]: value } }),
      });
      if (!res.ok) throw new Error(`Could not save ${key}`);
      await load(true);
      setNotice(`${key} saved`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [load]);

  const campaigns = useMemo(
    () => (report?.campaigns ?? []).filter((c) => filter === "all" || c.status === filter),
    [report, filter]
  );

  const voice = report?.voice;

  return (
    <AdminPage
      title="Marketing"
      description="The hive mind and the model write the platform's own marketing from live trends. Approve what goes out, watch what it earned, and switch the automation on when you trust it."
      actions={
        <>
          <button
            type="button"
            className={adminBtnGhost}
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
          </button>
          <button
            type="button"
            className={adminBtnGhost}
            onClick={() => void act("sweep", {}, "sweep")}
            disabled={busy !== null}
          >
            {busy === "sweep" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run sweep
          </button>
          <button
            type="button"
            className={adminBtnPrimary}
            onClick={() => void act("generate", { count: 5 }, "generate")}
            disabled={busy !== null}
          >
            {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Generate campaigns
          </button>
        </>
      }
    >
      {error ? <AdminNotice tone="danger">{error}</AdminNotice> : null}
      {notice ? <AdminNotice tone="info">{notice}</AdminNotice> : null}

      {!report ? (
        <AdminEmpty
          title={loading ? "Loading the marketing engine" : "No report available"}
          {...(loading ? { icon: Loader2 } : {})}
        />
      ) : (
        <>
          <AdminStatGrid>
            <AdminStat label="Drafts waiting" value={report.analytics.byStatus.DRAFT ?? 0} sub="need a decision" />
            <AdminStat label="Sent (7 days)" value={report.analytics.sentLast7d} sub="published to a channel" />
            <AdminStat
              label="Failed (7 days)"
              value={report.analytics.failedLast7d}
              tone={report.analytics.failedLast7d > 0 ? "danger" : "neutral"}
              sub={report.analytics.failedLast7d > 0 ? "check the ledger below" : "no failures"}
            />
            <AdminStat
              label="Average score"
              value={report.analytics.averageScore}
              sub={`best ${report.analytics.topScore}/100`}
            />
            <AdminStat
              label="Manual kits"
              value={report.analytics.manualWaiting}
              sub="story cards waiting to be posted"
            />
          </AdminStatGrid>

          {/* Switches */}
          <AdminPanel
            title="Automation"
            description="Both switches default to off. Nothing is sent to a network until one of them is on, or you press send yourself."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <SwitchRow
                label="Autopilot"
                hint="Draft campaigns and topics from live trends when the queue runs low."
                on={voice?.autopilot ?? false}
                busy={busy === "marketingAutopilot"}
                onToggle={(next) => void saveSetting("marketingAutopilot", String(next))}
              />
              <SwitchRow
                label="Auto-share new stories"
                hint="Send stories published in the last day to the enabled channels below."
                on={voice?.autoShare ?? false}
                busy={busy === "marketingAutoShare"}
                onToggle={(next) => void saveSetting("marketingAutoShare", String(next))}
              />
              <SwitchRow
                label="Share to the Facebook Page"
                hint="Needs a page id and token in Settings → Integrations."
                on={voice?.shareFacebook ?? false}
                busy={busy === "marketingShareFacebook"}
                onToggle={(next) => void saveSetting("marketingShareFacebook", String(next))}
              />
              <SwitchRow
                label="Share to WhatsApp"
                hint="Sends over the Cloud API when configured, otherwise hands you a story card."
                on={voice?.shareWhatsapp ?? false}
                busy={busy === "marketingShareWhatsapp"}
                onToggle={(next) => void saveSetting("marketingShareWhatsapp", String(next))}
              />
              <SwitchRow
                label="Auto-publish above threshold"
                hint={`Send drafts scoring ${voice?.threshold ?? 78}+ without approval. Drafts still wait when this is off.`}
                on={voice?.autoPublish ?? false}
                busy={busy === "marketingAutoPublish"}
                onToggle={(next) => void saveSetting("marketingAutoPublish", String(next))}
              />
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-sm font-semibold text-surface-100">Auto-publish score</div>
                <p className="mt-1 text-xs text-surface-400">
                  0-100. The scorer rewards a number in the copy, a clear next step and a sane length.
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={voice?.threshold ?? 78}
                    className={cn(adminInput, "w-24")}
                    onBlur={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next) && next !== voice?.threshold) {
                        void saveSetting("marketingPublishThreshold", String(next));
                      }
                    }}
                  />
                  <span className="text-xs text-surface-400">minimum score</span>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-surface-100">Voice</div>
                <span className="text-[11px] text-surface-500">
                  The model is told this verbatim. Hashtags: {(voice?.hashtags ?? []).map((t) => `#${t}`).join(" ") || "none"}
                </span>
              </div>
              <textarea
                defaultValue={voice?.tone ?? ""}
                rows={3}
                className={cn(adminInput, "mt-2 w-full")}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next && next !== voice?.tone) void saveSetting("marketingTone", next);
                }}
              />
            </div>
          </AdminPanel>

          {/* Channels */}
          <AdminPanel
            title="Channels"
            description="Configured means the credentials are present — the ledger below is what proves a channel is actually delivering."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {report.channels.map((channel) => {
                const Icon = CHANNEL_ICON[channel.channel as keyof typeof CHANNEL_ICON] ?? Send;
                return (
                  <div key={channel.channel} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-2 text-sm font-semibold capitalize text-surface-100">
                        <Icon className="h-4 w-4 text-brand-400" />
                        {channel.channel}
                      </span>
                      <AdminBadge tone={channel.configured ? "positive" : "info"}>
                        {channel.configured ? "ready" : "manual"}
                      </AdminBadge>
                    </div>
                    <p className="mt-2 text-xs text-surface-400">{channel.detail}</p>
                  </div>
                );
              })}
            </div>
          </AdminPanel>

          {/* What the brain is working from */}
          <AdminPanel
            title="What the brain is working from"
            description="The exact signals the next batch of campaigns will be written from — the same numbers the public marketing page shows."
          >
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <p className="text-sm text-surface-300">{report.brief.summary}</p>
                <ul className="mt-3 grid gap-1.5 text-xs text-surface-400 sm:grid-cols-2">
                  {report.brief.proofPoints.map((point) => (
                    <li key={point} className="flex gap-1.5">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-400" />
                      {point}
                    </li>
                  ))}
                </ul>
                {report.brief.hooks.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-xs text-surface-400">
                    {report.brief.hooks.map((hook) => (
                      <li key={hook} className="flex gap-1.5">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-400" />
                        {hook}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-surface-500">Live trends</div>
                {report.signals.trends.slice(0, 5).map((trend) => (
                  <div
                    key={trend.subject}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs"
                  >
                    <span className="inline-flex items-center gap-1.5 text-surface-200">
                      <Flame className="h-3.5 w-3.5 text-brand-400" />
                      {readableSubject(trend.subject)}
                    </span>
                    <span className="text-surface-500">{trend.velocity}/100</span>
                  </div>
                ))}
                {report.signals.trends.length === 0 ? (
                  <p className="text-xs text-surface-500">No platform heat detected yet.</p>
                ) : null}
                <div className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-surface-500">
                  Hive mind
                </div>
                <div className="text-xs text-surface-400">
                  {report.signals.hive.online
                    ? `${report.signals.hive.memories.toLocaleString()} memories · ${report.signals.hive.topTopics
                        .slice(0, 3)
                        .map((t) => t.topic)
                        .join(", ") || "no top topics"}`
                    : "Offline — campaigns fall back to templates written from the counts alone."}
                </div>
              </div>
            </div>
          </AdminPanel>

          {/* Queue */}
          <AdminPanel
            title="Campaigns"
            description="Approve and send, edit the copy, or throw it away. Every send records its own row in the ledger."
            action={
              <div className="flex flex-wrap gap-1.5">
                {(["all", "DRAFT", "APPROVED", "PUBLISHED", "FAILED"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setFilter(option)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                      filter === option ? "bg-brand-500/20 text-brand-200" : "text-surface-400 hover:text-surface-200"
                    )}
                  >
                    {option === "all" ? "All" : option.toLowerCase()}
                    <span className="ml-1 text-surface-500">
                      {option === "all"
                        ? report.campaigns.length
                        : report.campaigns.filter((c) => c.status === option).length}
                    </span>
                  </button>
                ))}
              </div>
            }
          >
            {campaigns.length === 0 ? (
              <AdminEmpty
                title="Nothing here yet"
                description={
                  filter === "all"
                    ? "Turn on autopilot, or generate a batch now."
                    : `No ${filter.toLowerCase()} campaigns.`
                }
              />
            ) : (
              <ul className="space-y-3">
                {campaigns.map((campaign) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    busy={busy}
                    editing={editing?.id === campaign.id}
                    onEdit={() => setEditing({ id: campaign.id, title: campaign.title, body: campaign.body })}
                    onCancelEdit={() => setEditing(null)}
                    onDraftChange={(next) => setEditing((prev) => (prev ? { ...prev, ...next } : prev))}
                    draft={editing?.id === campaign.id ? editing : null}
                    onAct={act}
                  />
                ))}
              </ul>
            )}
          </AdminPanel>

          {/* Ledger */}
          <AdminPanel
            title="Delivery ledger"
            description="One row per attempt. A channel that is configured but never sends shows up here, which is the failure a single status field hides."
          >
            {report.recentShares.length === 0 ? (
              <AdminEmpty title="Nothing has been sent yet" description="The first share will appear here with its result." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] uppercase tracking-wider text-surface-500">
                    <tr>
                      <th className="pb-2 pr-3 font-semibold">When</th>
                      <th className="pb-2 pr-3 font-semibold">Campaign</th>
                      <th className="pb-2 pr-3 font-semibold">Channel</th>
                      <th className="pb-2 pr-3 font-semibold">Status</th>
                      <th className="pb-2 font-semibold">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {report.recentShares.map((share) => (
                      <tr key={share.id} className="align-top">
                        <td className="py-2 pr-3 whitespace-nowrap text-surface-400">{timeAgo(share.createdAt)}</td>
                        <td className="py-2 pr-3 text-surface-200">{share.campaignTitle}</td>
                        <td className="py-2 pr-3 capitalize text-surface-300">{share.channel}</td>
                        <td className="py-2 pr-3">
                          <AdminBadge
                            tone={
                              share.status === "SENT"
                                ? "positive"
                                : share.status === "FAILED"
                                  ? "danger"
                                  : share.status === "MANUAL"
                                    ? "warning"
                                    : "info"
                            }
                          >
                            {share.status.toLowerCase()}
                          </AdminBadge>
                        </td>
                        <td className="py-2 text-surface-400">
                          {share.error ? (
                            <span className="inline-flex items-start gap-1.5 text-danger-strong">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              {share.error}
                            </span>
                          ) : share.url ? (
                            <a
                              href={share.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-brand-300 hover:text-brand-200"
                            >
                              open <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminPanel>

          <p className="px-1 text-[11px] text-surface-500">
            Tag on every share: <span className="text-brand-300">#{BRAND_HASHTAG}</span> · last report{" "}
            {timeAgo(report.generatedAt)} · refresh every {REFRESH_MS / 1000}s
          </p>
        </>
      )}
    </AdminPage>
  );
}

function successNote(action: string, report: MarketingReport & { result?: unknown }): string {
  const result = report.result as Record<string, unknown> | undefined;
  switch (action) {
    case "generate":
      return `Drafted ${Number(result?.created ?? 0)} campaigns from live signals.`;
    case "sweep": {
      const sweep = result as { generated?: number; shared?: number; dispatched?: number } | undefined;
      return `Sweep complete — ${sweep?.generated ?? 0} drafted, ${sweep?.shared ?? 0} stories queued, ${sweep?.dispatched ?? 0} dispatched.`;
    }
    case "approve":
      return "Approved. It will send on the next sweep, or press send now.";
    case "reject":
      return "Rejected.";
    case "delete":
      return "Deleted.";
    case "update":
      return `Saved. New score: ${Number(result?.score ?? 0)}/100.`;
    case "share-story":
      return result?.campaignId ? "Story queued for sharing." : "Nothing to share.";
    default:
      return "Done.";
  }
}

function SwitchRow({
  label,
  hint,
  on,
  busy,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div>
        <div className="text-sm font-semibold text-surface-100">{label}</div>
        <p className="mt-1 text-xs text-surface-400">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={busy}
        onClick={() => onToggle(!on)}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
          on ? "bg-brand-500" : "bg-white/15",
          busy && "opacity-60"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
            on ? "left-[22px]" : "left-0.5"
          )}
        />
      </button>
    </div>
  );
}

function CampaignCard({
  campaign,
  busy,
  editing,
  draft,
  onEdit,
  onCancelEdit,
  onDraftChange,
  onAct,
}: {
  campaign: CampaignRow;
  busy: string | null;
  editing: boolean;
  draft: { title: string; body: string } | null;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (next: { title?: string; body?: string }) => void;
  onAct: (action: string, payload?: Record<string, unknown>, label?: string) => Promise<void>;
}) {
  const working = busy !== null;
  const ChannelIcon = CHANNEL_ICON[campaign.channel as keyof typeof CHANNEL_ICON] ?? Send;

  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <AdminBadge tone={STATUS_TONE[campaign.status] ?? "neutral"}>{campaign.status.toLowerCase()}</AdminBadge>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-400">
              <ChannelIcon className="h-3.5 w-3.5 text-brand-400" />
              {campaign.channel} · {campaign.kind}
            </span>
            <span className="text-[11px] text-surface-500">{timeAgo(campaign.createdAt)}</span>
            <span className="text-[11px] text-surface-500">· {campaign.source}</span>
          </div>
          <div className="mt-2 text-sm font-semibold text-surface-100">{campaign.title}</div>
        </div>
        <div className={cn("shrink-0 text-right", scoreTone(campaign.score))}>
          <div className="text-xl font-bold leading-none">{campaign.score}</div>
          <div className="text-[10px] uppercase tracking-wider text-surface-500">score</div>
        </div>
      </div>

      {editing && draft ? (
        <div className="mt-3 space-y-2">
          <input
            className={cn(adminInput, "w-full")}
            value={draft.title}
            onChange={(event) => onDraftChange({ title: event.target.value })}
          />
          <textarea
            className={cn(adminInput, "w-full")}
            rows={5}
            value={draft.body}
            onChange={(event) => onDraftChange({ body: event.target.value })}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={adminBtnPrimary}
              disabled={working}
              onClick={() =>
                void onAct("update", { id: campaign.id, title: draft.title, body: draft.body }, `update-${campaign.id}`)
              }
            >
              <Check className="h-4 w-4" /> Save & rescore
            </button>
            <button type="button" className={adminBtnGhost} onClick={onCancelEdit} disabled={working}>
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-surface-300">{campaign.body}</p>
          {campaign.hashtags && campaign.hashtags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {campaign.hashtags.map((tag) => (
                <span key={tag} className="text-xs text-brand-300">
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
          {campaign.rationale ? (
            <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-surface-500">
              <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-400" />
              {campaign.rationale}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {campaign.status === "DRAFT" || campaign.status === "FAILED" ? (
              <button
                type="button"
                className={adminBtnPrimary}
                disabled={working}
                onClick={() => void onAct("approve", { id: campaign.id }, `approve-${campaign.id}`)}
              >
                {busy === `approve-${campaign.id}` ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Approve
              </button>
            ) : null}
            <button
              type="button"
              className={adminBtnGhost}
              disabled={working}
              onClick={() => void onAct("dispatch", { id: campaign.id }, `dispatch-${campaign.id}`)}
            >
              {busy === `dispatch-${campaign.id}` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send now
            </button>
            <button type="button" className={adminBtnGhost} disabled={working} onClick={onEdit}>
              <Pencil className="h-4 w-4" /> Edit
            </button>
            {campaign.channel === "story" ? (
              <a
                className={adminBtnGhost}
                href={`/api/marketing/story/${campaign.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <Target className="h-4 w-4" /> Story card
              </a>
            ) : null}
            <button
              type="button"
              className={adminBtnGhost}
              disabled={working}
              onClick={() => void navigator.clipboard.writeText(campaign.body)}
            >
              <Copy className="h-4 w-4" /> Copy
            </button>
            {campaign.status !== "PUBLISHED" ? (
              <button
                type="button"
                className={adminBtnGhost}
                disabled={working}
                onClick={() => void onAct("reject", { id: campaign.id }, `reject-${campaign.id}`)}
              >
                <X className="h-4 w-4" /> Reject
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl border border-danger/30 px-3 py-2 text-xs font-semibold text-danger-strong transition-colors hover:bg-danger/10"
              disabled={working}
              onClick={() => void onAct("delete", { id: campaign.id }, `delete-${campaign.id}`)}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
            {campaign.url ? (
              <a
                className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200"
                href={campaign.url}
                target="_blank"
                rel="noreferrer"
              >
                source <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            {campaign.shareCount > 0 ? (
              <span className="text-[11px] text-surface-500">{campaign.shareCount} attempts</span>
            ) : null}
          </div>
        </>
      )}
    </li>
  );
}
