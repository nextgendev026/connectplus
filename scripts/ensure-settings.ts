// Build-time settings seeder. Prefers DIRECT_URL (bypasses the pooled
// connection, which is reserved for the running app) over DATABASE_URL.
// require() is deferred until after the env swap below.
async function main() {
  if (process.env.DIRECT_URL) {
    process.env.DATABASE_URL = process.env.DIRECT_URL;
  }
  const { ensureSettings } = require("../src/lib/settings") as typeof import("../src/lib/settings");
  await ensureSettings();
  console.log("settings ensured");
}

main().catch((err) => {
  console.error("Failed to ensure settings:", err);
  process.exit(1);
});
