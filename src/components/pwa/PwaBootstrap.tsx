"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/permissions";

export function PwaBootstrap() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}