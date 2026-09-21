import type { Metadata } from "next";
import Link from "next/link";
import { BrainCircuit, Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * A shared transcript, read-only.
 *
 * The page is deliberately narrower than the console it came from. The console
 * shows, under every reply, the platform readings the answer was grounded in —
 * revenue, traffic, moderation counts, account figures. Those are the right thing
 * for an operator to see and the wrong thing to publish behind a link, so the
 * share view renders what was *said* and drops the metadata entirely rather than
 * trying to filter it field by field. A filter is a promise to keep up with every
 * future field; not selecting it is not.
 *
 * Server-rendered from the token, so there is no public API endpoint to secure
 * and no chance of the transcript being fetched by a route that forgot its checks.
 *
 * `noindex` on purpose: a share link is for a person, not for search engines to
 * discover and cache.
 */
export const metadata: Metadata = {
  title: "Shared conversation",
  robots: { index: false, follow: false },
};

function formatWhen(iso: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(iso);
}

export default async function SharedConversationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // A token is 24 random bytes in base64url. Anything outside that shape cannot
  // match a row, so the database is never asked about obvious junk.
  const wellFormed = /^[A-Za-z0-9_-]{16,64}$/.test(token);

  const conversation = wellFormed
    ? await prisma.neuralConversation
        .findUnique({
          where: { shareToken: token },
          select: {
            title: true,
            createdAt: true,
            messages: {
              orderBy: { createdAt: "asc" },
              select: { id: true, role: true, content: true, createdAt: true },
            },
          },
        })
        .catch(() => null)
    : null;

  if (!conversation) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-surface-700 bg-surface-900">
          <BrainCircuit className="h-5 w-5 text-surface-400" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-surface-50">This link is no longer active</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-surface-400">
          The conversation was either never shared, or sharing was switched off. Ask whoever sent it to share it again —
          links are revoked rather than hidden, so an old one will not start working.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-xl border border-surface-700 px-4 py-2 text-sm font-medium text-surface-300 transition hover:border-brand-500/40 hover:text-surface-50"
        >
          Back to ConnectPlus
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="border-b border-surface-800 pb-5">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-surface-500">
          <BrainCircuit className="h-3.5 w-3.5" />
          Shared conversation · read-only
        </p>
        <h1 className="mt-2 text-xl font-semibold text-surface-50 sm:text-2xl">{conversation.title}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-surface-500">
          <Clock className="h-3 w-3" />
          Started {formatWhen(conversation.createdAt)} UTC · {conversation.messages.length} messages
        </p>
      </header>

      <ol className="mt-6 space-y-5">
        {conversation.messages.map((message) => (
          <li key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className="w-fit max-w-[92%]">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                {message.role === "user" ? "Operator" : "NeuroHive"}
              </p>
              <div
                className={
                  message.role === "user"
                    ? "rounded-2xl rounded-br-sm bg-brand-500/15 px-4 py-2.5 text-sm leading-relaxed text-surface-100 ring-1 ring-brand-500/25"
                    : "whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-surface-800 bg-surface-900/70 px-4 py-3 text-sm leading-relaxed text-surface-200"
                }
              >
                {message.content}
              </div>
              <p className="mt-1 text-[10px] text-surface-500">{formatWhen(message.createdAt)}</p>
            </div>
          </li>
        ))}
      </ol>

      <footer className="mt-10 border-t border-surface-800 pt-5">
        <p className="text-xs text-surface-500">
          Shared from the ConnectPlus operations console. Replies are generated by the platform&apos;s own assistant and
          may be incomplete; the evidence behind them is visible only in the console.
        </p>
      </footer>
    </div>
  );
}
