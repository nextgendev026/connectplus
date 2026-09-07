"use client";

import { useState, useCallback } from "react";
import {
  BrainCircuit,
  Activity,
  FileSearch,
  ShieldAlert,
  TrendingUp,
  Download,
  Loader2,
  Brain,
  Zap,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import NeuralChat from "@/components/admin/NeuralChat";
import NeuralInsights from "@/components/admin/NeuralInsights";
import NeuralKnowledgeBase from "@/components/admin/NeuralKnowledgeBase";
import HivePanel from "@/components/admin/HivePanel";

const QUICK_ACTIONS = [
  { label: "System Health", query: "How is the platform health?", icon: Activity, color: "text-info-strong" },
  { label: "Content Analysis", query: "Analyze our content and topics", icon: FileSearch, color: "text-purple-400" },
  { label: "Threat Scan", query: "Run a security threat scan", icon: ShieldAlert, color: "text-danger-strong" },
  { label: "Growth Report", query: "Show me the growth report", icon: TrendingUp, color: "text-green-400" },
  { label: "Hive Mind Report", query: "Give me the hive mind report", icon: Brain, color: "text-warning-strong" },
];

export default function NeuralMindPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<"insights" | "knowledge" | "hive">("insights");
  const [isLearning, setIsLearning] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingResult, setTrainingResult] = useState<string | null>(null);

  const handleConversationCreated = useCallback((id: string) => {
    setConversationId(id);
  }, []);

  const handleQuickAction = async (query: string) => {
    const input = document.querySelector<HTMLInputElement>('[placeholder="Query the Neural Mind..."]');
    if (input) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set;
      nativeInputValueSetter?.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
  };

  const handleLearn = async (url?: string) => {
    setIsLearning(true);
    try {
      await fetch("/api/admin/neural/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ url: url || undefined }),
      });
    } catch {}
    setIsLearning(false);
  };

  const handleTrain = async () => {
    setIsTraining(true);
    setTrainingResult(null);
    try {
      const res = await fetch("/api/admin/neural/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        const r = data.result ?? {};
        setTrainingResult(
          `Training complete — ${r.signalsCreated ?? 0} new signals, ${r.signalsUpdated ?? 0} updated. ${r.lessons?.[0] ?? ""}`
        );
      } else {
        setTrainingResult("Training failed. Check dev logs.");
      }
    } catch {
      setTrainingResult("Training failed. Check dev logs.");
    }
    setIsTraining(false);
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/20">
              <BrainCircuit className="h-6 w-6 text-accent-strong" />
            </div>
            <div>
              <h1 className="type-display text-surface-50">Neural Mind</h1>
              <p className="text-sm font-medium text-surface-300">
                Integrated brain pipeline — neural intent + hive machine learning + external web learning
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleLearn()}
              disabled={isLearning}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                isLearning
                  ? "bg-surface-800 text-surface-400 cursor-not-allowed"
                  : "bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 border border-brand-500/20"
              )}
            >
              {isLearning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isLearning ? "Learning..." : "Learn from RSS"}
            </button>
            <button
              onClick={handleTrain}
              disabled={isTraining}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                isTraining
                  ? "bg-surface-800 text-surface-400 cursor-not-allowed"
                  : "bg-amber-500/10 text-warning-strong hover:bg-amber-500/20 border border-amber-500/20"
              )}
            >
              {isTraining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {isTraining ? "Training..." : "Train the Brains"}
            </button>
            <div className="hidden sm:flex items-center gap-2 rounded-full bg-surface-800/50 px-3 py-1.5 border border-surface-700">
              <span className="h-2 w-2 rounded-full bg-brand-500 animate-pulse" />
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-semibold text-surface-300">Neural + Hive Online</span>
            </div>
          </div>
        </div>

        {trainingResult && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-warning-strong" />
            <p className="text-xs text-amber-300 leading-relaxed">{trainingResult}</p>
            <button onClick={() => setTrainingResult(null)} className="ml-auto text-amber-500/60 hover:text-warning-strong shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              onClick={() => handleQuickAction(action.query)}
              className="group flex items-center gap-3 rounded-xl border border-surface-800 bg-surface-900/50 p-4 text-left transition-all duration-200 hover:border-surface-700 hover:bg-surface-900/80"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-800 transition-colors group-hover:bg-surface-800/80">
                <action.icon className={cn("h-5 w-5", action.color)} />
              </div>
              <div>
                <p className="text-sm font-medium text-surface-50">{action.label}</p>
                <p className="type-caption text-surface-500">Quick query</p>
              </div>
            </button>
          ))}
        </div>

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chat Panel */}
          <div className="lg:col-span-2 rounded-xl border border-surface-800 bg-surface-900/50 overflow-hidden" style={{ height: "600px" }}>
            <div className="flex items-center justify-between border-b border-surface-800 px-6 py-3">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-accent-strong" />
                <span className="text-sm font-medium text-surface-50">Neural Chat</span>
              </div>
              {conversationId && (
                <span className="type-caption text-surface-500">session: {conversationId.slice(0, 8)}...</span>
              )}
            </div>
            <div style={{ height: "calc(600px - 49px)" }}>
              <NeuralChat
                conversationId={conversationId}
                onConversationCreated={handleConversationCreated}
              />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Tab Switcher */}
            <div className="flex gap-1 rounded-lg bg-surface-800/50 p-1">
              <button
                onClick={() => setSelectedTab("insights")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all",
                  selectedTab === "insights" ? "bg-surface-800 text-surface-50 shadow-sm" : "text-surface-500 hover:text-surface-300"
                )}
              >
                Insights
              </button>
              <button
                onClick={() => setSelectedTab("knowledge")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all",
                  selectedTab === "knowledge" ? "bg-surface-800 text-surface-50 shadow-sm" : "text-surface-500 hover:text-surface-300"
                )}
              >
                Knowledge
              </button>
              <button
                onClick={() => setSelectedTab("hive")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all",
                  selectedTab === "hive" ? "bg-surface-800 text-surface-50 shadow-sm" : "text-surface-500 hover:text-surface-300"
                )}
              >
                Hive Brain
              </button>
            </div>

            {/* Tab Content */}
            <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-4">
              {selectedTab === "insights" && <NeuralInsights />}
              {selectedTab === "knowledge" && <NeuralKnowledgeBase />}
              {selectedTab === "hive" && <HivePanel />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
