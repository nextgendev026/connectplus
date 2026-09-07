"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, BrainCircuit, Loader2, FilePlus2, PenLine, Clipboard } from "lucide-react";
import { cn } from "@/lib/utils";

const CONTENT_INTENTS = new Set([
  "write_content",
  "rewrite_content",
  "summarize_content",
  "headline_suggest",
  "tag_suggest",
  "outline_suggest",
  "expand_content",
  "curate_content",
  "general_chat",
  "unknown",
]);

function titleFromContent(content: string): string {
  const line = content
    .split(/\n/)
    .map((l) => l.trim().replace(/^#+\s*/, "").replace(/^\*+/, "").replace(/\*+$/, "").replace(/^\d+[.)]\s*/, ""))
    .find((l) => l.length > 4 && l.length < 90);
  return (line ?? "Draft from Neural Mind").slice(0, 80);
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  intent?: string;
  enginesUsed?: string[];
  hive?: {
    online: boolean;
    total: number;
    sourceBreakdown: Record<string, number>;
    categoryBreakdown: Record<string, number>;
    topTopics: { topic: string; count: number }[];
    recentLearnings: { source: string; category: string; content: string; tags: string; confidence: number; learnedAt: string }[];
  };
}

interface NeuralChatProps {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
  initialMessages?: ChatMessage[];
}

export default function NeuralChat({ conversationId, onConversationCreated, initialMessages = [] }: NeuralChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sendToStudio = useCallback((content: string) => {
    try {
      localStorage.setItem(
        "connectplus:studio:new",
        JSON.stringify({ title: titleFromContent(content), content, ts: Date.now() })
      );
    } catch {}
    router.push("/studio?new=1");
  }, [router]);

  const saveAsDraft = useCallback(async (index: number, content: string) => {
    setSavingIndex(index);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleFromContent(content), content, status: "DRAFT" }),
      });
      if (res.status === 401) {
        router.push("/auth/signin?callbackUrl=/admin/neural");
        return;
      }
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      const slug = data?.post?.slug;
      if (slug) router.push(`/studio?edit=${data.post.id}`);
    } catch {}
    setSavingIndex(null);
  }, [router]);

  const copyToClipboard = useCallback((content: string) => {
    navigator.clipboard?.writeText(content).catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing) return;

    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    setMessages(prev => [...prev, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setIsProcessing(true);

    try {
      const res = await fetch("/api/admin/neural/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: text.trim(), conversationId }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "chunk") {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last) {
                  updated[updated.length - 1] = { ...last, content: last.content + event.content };
                }
                return updated;
              });
            } else if (event.type === "metadata") {
              onConversationCreated(event.conversationId);
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last) {
                  updated[updated.length - 1] = { ...last, intent: event.intent, enginesUsed: event.enginesUsed };
                }
                return updated;
              });
            } else if (event.type === "hive") {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last) {
                  updated[updated.length - 1] = { ...last, hive: event.status };
                }
                return updated;
              });
            } else if (event.type === "done") {
              setIsProcessing(false);
            } else if (event.type === "error") {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last) {
                  updated[updated.length - 1] = {
                    ...last,
                    content: `Error: ${event.error ?? "Failed to get response from Neural Mind."}`,
                  };
                }
                return updated;
              });
              setIsProcessing(false);
            }
          } catch {}
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last) {
          updated[updated.length - 1] = { ...last, content: "Error: Failed to get response from Neural Mind." };
        }
        return updated;
      });
      setIsProcessing(false);
    }
  }, [conversationId, isProcessing, onConversationCreated]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
            {msg.role === "assistant" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10">
                <BrainCircuit className="h-4 w-4 text-brand-500" />
              </div>
            )}
            <div className={cn(
              "max-w-[80%] rounded-xl px-4 py-3 text-sm font-medium leading-relaxed whitespace-pre-wrap",
              msg.role === "user"
                ? "bg-brand-500/20 text-surface-50 border border-brand-500/30"
                : "bg-surface-800 text-surface-50 border border-surface-700"
            )}>
              {msg.content || (msg.role === "assistant" && isProcessing && i === messages.length - 1 ? (
                <div className="flex gap-1 items-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-surface-400 animate-bounce [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-surface-400 animate-bounce [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-surface-400 animate-bounce [animation-delay:300ms]" />
                </div>
              ) : null)}
              {msg.role === "assistant" && msg.intent && (
                <div className="mt-2 flex gap-1.5 flex-wrap">
                  <span className="rounded-full bg-surface-700 px-2 py-0.5 type-caption text-surface-300">
                    intent: {msg.intent}
                  </span>
                  {msg.enginesUsed?.map(e => (
                    <span key={e} className={cn(
                      "rounded-full px-2 py-0.5 type-caption",
                      e === "hive" ? "bg-amber-500/15 text-warning-strong" : "bg-brand-500/15 text-accent-strong"
                    )}>
                      {e === "hive" ? "🐝 " : ""}{e}
                    </span>
                  ))}
                </div>
              )}
              {msg.role === "assistant" &&
                msg.content &&
                (CONTENT_INTENTS.has(msg.intent ?? "") || msg.enginesUsed?.includes("llm")) && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <button
                      onClick={() => sendToStudio(msg.content)}
                      className="flex items-center gap-1 rounded-lg bg-brand-500/15 border border-brand-500/30 px-2 py-1 type-caption text-accent-strong hover:bg-brand-500/25 transition-colors"
                      title="Load this content into the Story Studio editor"
                    >
                      <PenLine className="h-3 w-3" />
                      Open in Studio
                    </button>
                    <button
                      onClick={() => saveAsDraft(i, msg.content)}
                      disabled={savingIndex === i}
                      className="flex items-center gap-1 rounded-lg bg-surface-700/60 border border-surface-600/60 px-2 py-1 type-caption text-surface-300 hover:bg-surface-700 disabled:opacity-50 transition-colors"
                      title="Save this content as a draft post"
                    >
                      {savingIndex === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <FilePlus2 className="h-3 w-3" />}
                      Save as draft
                    </button>
                    <button
                      onClick={() => copyToClipboard(msg.content)}
                      className="flex items-center gap-1 rounded-lg bg-surface-700/60 border border-surface-600/60 px-2 py-1 type-caption text-surface-300 hover:bg-surface-700 transition-colors"
                      title="Copy to clipboard"
                    >
                      <Clipboard className="h-3 w-3" />
                      Copy
                    </button>
                  </div>
                )}
              {msg.hive && (
                <div className="mt-2 space-y-1.5 rounded-lg border border-surface-700 bg-surface-900/60 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 type-meta text-warning-strong">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                      Hive Brain Snapshot
                    </span>
                    <span className="type-caption text-surface-500">
                      {msg.hive.total} memories · {msg.hive.sourceBreakdown.internal ?? 0} internal / {msg.hive.sourceBreakdown.external ?? 0} external
                    </span>
                  </div>
                  {msg.hive.topTopics.slice(0, 5).map(t => (
                    <div key={t.topic} className="flex items-center justify-between">
                      <span className="type-meta text-surface-300">{t.topic}</span>
                      <span className="type-caption text-surface-500">×{t.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {msg.role === "user" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-700">
                <span className="text-xs font-semibold text-surface-200">You</span>
              </div>
            )}
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      <div className="border-t border-surface-800 p-4">
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
            placeholder="Query the Neural Mind..."
            disabled={isProcessing}
            className="flex-1 rounded-lg bg-surface-800 border border-surface-700 px-4 py-2.5 text-sm text-surface-50 placeholder-surface-500 outline-none transition-colors focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isProcessing}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200",
              input.trim() && !isProcessing
                ? "bg-brand-500 text-white hover:bg-brand-600"
                : "bg-surface-800 text-surface-500 cursor-not-allowed"
            )}
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
