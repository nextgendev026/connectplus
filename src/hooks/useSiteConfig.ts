"use client";

import { useEffect, useState } from "react";

export interface PublicSiteConfig {
  siteName: string;
  siteTagline: string;
  siteDescription: string;
  siteUrl: string;
  contactEmail: string;
  ogImage: string;
  twitterHandle: string;
  seoKeywords: string[];
  robotsIndex: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  features: {
    radio: boolean;
    brainChat: boolean;
    signups: boolean;
    comments: boolean;
    pwa: boolean;
    rss: boolean;
    analytics: boolean;
    chatWidget: boolean;
  };
}

let cachedConfig: PublicSiteConfig | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 60_000;

async function fetchConfig(): Promise<PublicSiteConfig> {
  if (cachedConfig && Date.now() - cacheAt < CACHE_TTL_MS) {
    return cachedConfig;
  }
  try {
    const res = await fetch("/api/settings/public", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedConfig = data.config as PublicSiteConfig;
    cacheAt = Date.now();
    return cachedConfig;
  } catch {
    return {
      siteName: "connectPlus",
      siteTagline: "Stories that connect East Africa",
      siteDescription: "",
      siteUrl: "",
      contactEmail: "",
      ogImage: "",
      twitterHandle: "",
      seoKeywords: [],
      robotsIndex: true,
      maintenanceMode: false,
      maintenanceMessage: "",
      features: {
        radio: true,
        brainChat: true,
        signups: true,
        comments: true,
        pwa: true,
        rss: true,
        analytics: false,
        chatWidget: false,
      },
    };
  }
}

/** Read the live site config (feature flags, branding) from the settings API. */
export function useSiteConfig(): PublicSiteConfig | null {
  const [config, setConfig] = useState<PublicSiteConfig | null>(null);

  useEffect(() => {
    let active = true;
    fetchConfig().then((cfg) => {
      if (active) setConfig(cfg);
    });
    return () => {
      active = false;
    };
  }, []);

  return config;
}