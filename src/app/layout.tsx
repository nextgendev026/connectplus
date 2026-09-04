import type { Metadata } from "next";
import "./globals.css";
import ThemeProvider from "@/components/providers/ThemeProvider";

export const metadata: Metadata = {
  title: "connectPlus - Stories that connect East Africa",
  description:
    "A modern social blogging platform sharing stories, ideas, and perspectives from across East Africa. Join the conversation.",
  keywords: [
    "blog", "East Africa", "Nairobi", "Kampala", "Dar es Salaam",
    "Kigali", "stories", "writing", "community",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
