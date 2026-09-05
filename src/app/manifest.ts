import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "connectPlus - Stories that connect East Africa",
    short_name: "connectPlus",
    description:
      "A modern social blogging platform sharing stories, ideas, and perspectives from across East Africa.",
    start_url: "/",
    display: "standalone",
    background_color: "#17130f",
    theme_color: "#f59e0b",
    orientation: "portrait-primary",
    categories: ["social", "news", "blog"],
    icons: [
      { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
      { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/pwa-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/icon-180.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}