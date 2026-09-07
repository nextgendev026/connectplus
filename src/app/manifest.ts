import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "connectPlus - Stories that connect East Africa",
    short_name: "connectPlus",
    description:
      "A vibrant social blogging platform sharing stories, ideas, and perspectives from across East Africa — read, write, and connect.",
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    background_color: "#17130f",
    theme_color: "#f59e0b",
    orientation: "portrait-primary",
    categories: ["social", "news", "blog", "lifestyle"],
    prefer_related_applications: false,
    launch_handler: { client_mode: "navigate-existing" },
    shortcuts: [
      {
        name: "Write a Story",
        short_name: "Write",
        description: "Open the Story Studio to start a new post",
        url: "/studio",
        icons: [{ src: "/icon-180.png", sizes: "180x180", type: "image/png" }],
      },
      {
        name: "Search Stories",
        short_name: "Search",
        description: "Find stories across East Africa",
        url: "/search",
        icons: [{ src: "/icon-180.png", sizes: "180x180", type: "image/png" }],
      },
      {
        name: "Listen to Radio",
        short_name: "Radio",
        description: "Live East African radio stations",
        url: "/radio",
        icons: [{ src: "/icon-180.png", sizes: "180x180", type: "image/png" }],
      },
    ],
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