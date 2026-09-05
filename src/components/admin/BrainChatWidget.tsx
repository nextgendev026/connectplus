"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrainCircuit, Send, Loader2, X, MessageSquareText, Zap, Database, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface HiveData {
  online: boolean;
  total: number;
  sourceBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  topTopics: { topic: string; count: number }[];
  recentLearnings: { source: string; category: string; content: string; confidence: number }[];
}

interface ChamberMessage {
  role: "user" | "assistant";
  content: string;
  intent?: string;
  enginesUsed?: string[];
  hive?: HiveData;
}

interface NeuralInsight {
  title: string;
  summary: string;
  severity: "info" | "warning" | "critical";
  action?: string;
}

const QUICK_QUERIES = [
  { label: "System health", query: "How is the platform health?" },
  { label: "Hive report", query: "Give me the hive mind report" },
  { label: "Recommend", query: "What should I read next?" },
  { label: "Trends", query: "What's trending right now?" },
];

function EngineBadges({ intent, enginesUsed: engines, hive }: ChamberMessage) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {intent && (
        <span className="rounded-full bg-surface-700 px-2 py-0.5 text-[9px] text-surface-400">
          intent: {intent}
        </span>
      )}
      {engines?.map(e => (
        <span
          key={e}
          className={cn(
            "rounded-full px-2 py-0.5 text-[9px]",
            e === "hive" ? "bg-amber-500/10 text-amber-400" : "bg-brand-500/10 text-brand-400"
          )}
        >
          {e === "hive" ? "🐝 " : ""}
          {e}
        </span>
      ))}
      {hive && (
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] text-emerald-400">
          {hive.total} memories
        </span>
      )}
    </div>
  );
}

export default function BrainChatWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"ask" | "brains">("ask");
  const [messages, setMessages] = useState<ChamberMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [hive, setHive] = useState<HiveData | null>(null);
  const [insights, setInsights] = useState<NeuralInsight[]>([]);
  const [learning, setLearning] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToEnd = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadBrains = useCallback(async () => {
    const [hiveRes, insightRes] = await Promise.all([
      fetch("/api/admin/neural/hive", { credentials: "include" }),
      fetch("/api/admin/neural/insights", { credentials: "include" }),
    ]);
    if (hiveRes.ok) {
      const d = await hiveRes.json();
      setHive(d.status);
    }
    if (insightRes.ok) {
      const d = await insightRes.json();
      setInsights(d.insights ?? []);
    }
  }, []);

  useEffect(() => {
    if (open && tab === "brains") {
      const t = setTimeout(loadBrains, 0);
      return () => clearTimeout(t);
    }
  }, [open, tab, loadBrains]);

  useEffect(() => {
    scrollToEnd();
  }, [messages, open, scrollToEnd]);

  const runTraining = useCallback(
    async (kind: "train" | "sweep" | "learn") => {
      setLearning(kind);
      try {
        const endpoint =
          kind === "train" ? "/api/admin/neural/train" : kind === "sweep" ? "/api/admin/neural/hive" : "/api/admin/neural/learn";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const r = data.result ?? {};
        const verb = kind === "train" ? "Training" : kind === "sweep" ? "Sweep" : "Learning";
        setMessages(prev => [
          ...prev,
          {
            role: "assistant",
            content: `✅ ${verb} complete — ${r.signalsCreated ?? 0} new signals, ${r.signalsUpdated ?? 0} updated, top lesson: ${r.lessons?.[0] ?? "—"}`,
            intent: "hive_report",
            enginesUsed: ["hive"],
          },
        ]);
      } catch {
        setMessages(prev => [...prev, { role: "assistant", content: "⚠️ Training call failed. Check dev logs." }]);
      }
      await loadBrains();
      setLearning(null);
    },
    [loadBrains]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isProcessing) return;
      setMessages(prev => [...prev, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);
      setInput("");
      setIsProcessing(true);
      try {
        const res = await fetch("/api/admin/neural/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ message: trimmed }),
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
                  if (last) updated[updated.length - 1] = { ...last, content: last.content + event.content };
                  return updated;
                });
              } else if (event.type === "metadata") {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last) updated[updated.length - 1] = { ...last, intent: event.intent, enginesUsed: event.enginesUsed };
                  return updated;
                });
              } else if (event.type === "hive") {
                setMessages(prev => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last) updated[updated.length - 1] = { ...last, hive: event.status };
                  return updated;
                });
                setHive(event.status);
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
          if (last) updated[updated.length - 1] = { ...last, content: "Error: combined brains failed to respond." };
          return updated;
        });
        setIsProcessing(false);
      }
    },
    [isProcessing]
  );

  const severityColor: Record<NeuralInsight["severity"], string> = {
    info: "text-cyan-400",
    warning: "text-amber-400",
    critical: "text-red-400",
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="group fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-500/30 bg-surface-900/90 shadow-glow backdrop-blur-xl transition-all hover:scale-105"
        title="Ask the combined brains"
      >
        <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
        </span>
        <BrainCircuit className="h-6 w-6 text-brand-400" />
        <span className="absolute right-14 whitespace-nowrap rounded-lg bg-surface-900 border border-surface-700 px-2.5 py-1.5 text-[11px] font-medium text-surface-300 opacity-0 group-hover:opacity-100 transition-opacity">
          Ask NeuroHive — Neural + Hive
        </span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[60] flex w-[min(94vw,24rem)] flex-col overflow-hidden rounded-2xl border border-surface-700 bg-surface-950/95 shadow-glow backdrop-blur-xl" style={{ height: "min(76vh, 600px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-800 px-4 py-3 bg-surface-900/60">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/10">
            <BrainCircuit className="h-5 w-5 text-brand-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-surface-50">NeuroHive · Combined Brains</p>
            <p className="flex items-center gap-1.5 text-[10px] text-surface-500">
              <span className={cn("h-1.5 w-1.5 rounded-full", isProcessing ? "bg-amber-400 animate-pulse" : "bg-emerald-400")} />
              Neural intent + Hive memory · AI teaching
            </p>
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-800 hover:text-surface-50">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-surface-800 bg-surface-900/40 px-3 py-2">
        <button
          onClick={() => setTab("ask")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
            tab === "ask" ? "bg-surface-800 text-surface-50" : "text-surface-500 hover:text-surface-300"
          )}
        >
          <MessageSquareText className="h-3.5 w-3.5" /> Ask
        </button>
        <button
          onClick={() => setTab("brains")}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
            tab === "brains" ? "bg-surface-800 text-surface-50" : "text-surface-500 hover:text-surface-300"
          )}
        >
          <Database className="h-3.5 w-3.5" /> Brains
          {learning && <Loader2 className="h-3 w-3 animate-spin" />}
        </button>
      </div>

      {/* Bodies */}
      {tab === "ask" ? (
        <>
          <div className="flex-1 overflow-y-auto space-y-3 p-3">
            {messages.length === 0 && (
              <div className="py-8 text-center">
                <BrainCircuit className="mx-auto mb-2 h-8 w-8 text-surface-700" />
                <p className="text-sm text-surface-400">Ask the combined brains anything.</p>
                <p className="text-[11px] text-surface-600 mt-1">Neural Mind answers from platform data + external learning; Hive Brain feeds live signals and memory.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap",
                    msg.role === "user"
                      ? "bg-brand-500/20 border border-brand-500/30 text-surface-50"
                      : "bg-surface-800 border border-surface-700 text-surface-200"
                  )}
                >
                  {msg.content || (msg.role === "assistant" && isProcessing ? (
                    <div className="flex gap-1 items-center py-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-surface-400 animate-bounce [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-surface-400 animate-bounce [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-surface-400 animate-bounce [animation-delay:300ms]" />
                    </div>
                  ) : null)}
                  <EngineBadges {...msg} />
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="border-t border-surface-800 p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_QUERIES.map(q => (
                <button
                  key={q.label}
                  onClick={() => sendMessage(q.query)}
                  disabled={isProcessing}
                  className="rounded-full border border-surface-700 bg-surface-900 px-2 py-0.5 text-[10px] text-surface-400 hover:border-brand-500/40 hover:text-brand-400 disabled:opacity-40"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage(input)}
                placeholder="Ask Neural + Hive..."
                disabled={isProcessing}
                className="flex-1 rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-xs text-surface-50 placeholder-surface-500 outline-none focus:border-brand-500/50 disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isProcessing}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white disabled:bg-surface-800 disabled:text-surface-500"
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Knowledge", value: hive ? hive.total.toLocaleString() : "—" },
              { label: "Internal", value: hive ? (hive.sourceBreakdown.internal ?? 0).toLocaleString() : "—" },
              { label: "External", value: hive ? (hive.sourceBreakdown.external ?? 0).toLocaleString() : "—" },
              { label: "AI lessons", value: hive ? (hive.sourceBreakdown.ai ?? 0).toLocaleString() : "—" },
            ].map(stat => (
              <div key={stat.label} className="rounded-xl border border-surface-800 bg-surface-900/50 px-3 py-2">
                <p className="text-lg font-bold text-surface-50">{stat.value}</p>
                <p className="text-[9px] text-surface-500 uppercase tracking-wider">{stat.label}</p>
              </div>
            ))}
          </div>

          {hive && hive.topTopics.length > 0 && (
            <div>
              <p className="mb-1.5 text-[9px] font-medium text-surface-500 uppercase tracking-wider">Hive signals</p>
              <div className="flex flex-wrap gap-1.5">
                {hive.topTopics.slice(0, 12).map(t => (
                  <span key={t.topic} className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400">
                    {t.topic} ×{t.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {insights.length > 0 && (
            <div>
              <p className="mb-1.5 text-[9px] font-medium text-surface-500 uppercase tracking-wider">Neural insights</p>
              <ul className="space-y-1.5">
                {insights.map((ins, i) => (
                  <li key={i} className="rounded-lg border border-surface-800 bg-surface-900/50 px-3 py-2">
                    <p className={cn("text-xs font-medium", severityColor[ins.severity])}>{ins.title}</p>
                    <p className="text-[10px] text-surface-400 mt-0.5 leading-relaxed">{ins.summary}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <button
              onClick={() => runTraining("train")}
              disabled={learning !== null}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-500/20 bg-brand-500/10 px-3 py-2 text-xs font-medium text-brand-400 disabled:opacity-50"
            >
              {learning === "train" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Run AI Training Cycle
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => runTraining("sweep")}
                disabled={learning !== null}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-[11px] text-surface-300 disabled:opacity-50"
              >
                {learning === "sweep" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Sweep Posts
              </button>
              <button
                onClick={() => runTraining("learn")}
                disabled={learning !== null}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-[11px] text-surface-300 disabled:opacity-50"
              >
                {learning === "learn" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                Learn RSS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}