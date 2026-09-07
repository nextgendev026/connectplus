import type { MetadataRoute } from "next";
import { getSiteConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  let baseUrl = "https://connectplusapp.vercel.app";
  let allowIndexing = true;
  try {
    const cfg = await getSiteConfig();
    baseUrl = cfg.siteUrl || baseUrl;
    allowIndexing = cfg.robotsIndex;
  } catch {
    // fall back to defaults
  }
  const origin = baseUrl.replace(/\/$/, "");

  return {
    rules: allowIndexing
      ? {
          userAgent: "*",
          allow: "/",
          disallow: ["/api/", "/studio", "/admin", "/auth/", "/settings"],
        }
      : { userAgent: "*", disallow: "/" },
    sitemap: `${origin}/sitemap.xml`,
  };
}