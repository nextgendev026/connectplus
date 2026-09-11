"use client";

import { SessionProvider } from "next-auth/react";
import Navbar from "./Navbar";
import Footer from "./Footer";
import BottomNav from "./BottomNav";
import { LoadingScreen } from "@/components/loading/Loading";
import { PageViewTracker } from "@/components/analytics/PageViewTracker";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <div className="flex min-h-screen flex-col bg-surface-950">
        <PageViewTracker />
        <Navbar />
        <main className="flex-1 pb-16 md:pb-0">
          <LoadingScreen />
          {children}
        </main>
        <Footer />
        <BottomNav />
      </div>
    </SessionProvider>
  );
}
