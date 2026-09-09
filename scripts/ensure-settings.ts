import { ensureSettings } from "@/lib/settings";

ensureSettings().catch((err) => {
  console.error("Failed to ensure settings:", err);
  process.exit(1);
});
