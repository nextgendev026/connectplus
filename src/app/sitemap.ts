import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getSiteConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

const STATIC_ROUTES = [
  "",
  "/trending",
  "/categories",
  "/radio",
  "/search",
  "/about",
  "/guidelines",
  "/help",
  "/privacy",
  "/terms",
  "/contact",
  "/monetize",
  "/notifications",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let baseUrl = "https://connectplusapp.vercel.app";
  try {
    const cfg = await getSiteConfig();
    baseUrl = cfg.siteUrl || baseUrl;
  } catch {
    // fall back to env/default
  }
  const origin = baseUrl.replace(/\/$/, "");

  const staticPages: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${origin}${route}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: route === "" ? 1 : 0.7,
  }));

  const posts = await prisma.post.findMany({
    where: { status: "PUBLISHED", moderationStatus: "APPROVED" },
    select: { slug: true, updatedAt: true, publishedAt: true },
    orderBy: { publishedAt: "desc" },
    take: 2000,
  });

  const postPages: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${origin}/article/${post.slug}`,
    lastModified: post.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...postPages];
}