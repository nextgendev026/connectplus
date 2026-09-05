"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, BrainCircuit, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
              "max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
              msg.role === "user"
                ? "bg-brand-500/20 text-surface-50 border border-brand-500/30"
                : "bg-surface-800 text-surface-200 border border-surface-700"
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
                  <span className="rounded-full bg-surface-700 px-2 py-0.5 text-[10px] text-surface-400">
                    intent: {msg.intent}
                  </span>
                  {msg.enginesUsed?.map(e => (
                    <span key={e} className={cn(
                      "rounded-full px-2 py-0.5 text-[10px]",
                      e === "hive" ? "bg-amber-500/10 text-amber-400" : "bg-brand-500/10 text-brand-400"
                    )}>
                      {e === "hive" ? "🐝 " : ""}{e}
                    </span>
                  ))}
                </div>
              )}
              {msg.hive && (
                <div className="mt-2 space-y-1.5 rounded-lg border border-surface-700 bg-surface-900/60 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Hive Brain Snapshot
                    </span>
                    <span className="text-[9px] text-surface-500">
                      {msg.hive.total} memories · {msg.hive.sourceBreakdown.internal ?? 0} internal / {msg.hive.sourceBreakdown.external ?? 0} external
                    </span>
                  </div>
                  {msg.hive.topTopics.slice(0, 5).map(t => (
                    <div key={t.topic} className="flex items-center justify-between">
                      <span className="text-[10px] text-surface-400">{t.topic}</span>
                      <span className="text-[9px] text-surface-600">×{t.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {msg.role === "user" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-700">
                <span className="text-xs text-surface-300 font-medium">You</span>
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
