"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function LoadingScreen() {
  const [showLoading, setShowLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  return showLoading ? (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand-500 via-accent-amber/60 to-brand-600 border-4 border-surface-950 animate-spin"></div>
        <p className="text-surface-400 text-sm">Loading ConnectPlus...</p>
      </div>
    </div>
  ) : null;
}