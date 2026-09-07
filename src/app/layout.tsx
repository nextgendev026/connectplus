import type { Metadata, Viewport } from "next";
import "./globals.css";
import ThemeProvider from "@/components/providers/ThemeProvider";
import { RadioPlayerProvider } from "@/components/radio/RadioPlayerContext";
import { MiniRadioPlayer } from "@/components/radio/MiniRadioPlayer";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AUTH_URL ?? "https://connectplusapp.vercel.app"),
  title: "connectPlus - Stories that connect East Africa",
  description:
    "A modern social blogging platform sharing stories, ideas, and perspectives from across East Africa. Join the conversation.",
  keywords: [
    "blog", "East Africa", "Nairobi", "Kampala", "Dar es Salaam",
    "Kigali", "stories", "writing", "community",
  ],
  applicationName: "connectPlus",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/pwa-192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
    apple: [{ url: "/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "connectPlus",
  },
  openGraph: {
    title: "connectPlus - Stories that connect East Africa",
    description:
      "A modern social blogging platform sharing stories, ideas, and perspectives from across East Africa.",
    type: "website",
    images: [{ url: "/pwa-512.png", width: 512, height: 512, alt: "connectPlus savanna mark" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "connectPlus - Stories that connect East Africa",
    description:
      "A modern social blogging platform sharing stories, ideas, and perspectives from across East Africa.",
    images: ["/pwa-512.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#17130f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <RadioPlayerProvider>
            {children}
            <MiniRadioPlayer />
          </RadioPlayerProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}