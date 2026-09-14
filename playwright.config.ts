import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    // Playwright's bundled Chromium is not downloaded in this environment (see
    // .freebuff/run.md), but the machine's Chrome is available. Setting
    // PLAYWRIGHT_CHANNEL=chrome runs the suite against it; leaving it unset
    // keeps CI on the bundled browser.
    channel: (process.env.PLAYWRIGHT_CHANNEL as "chrome" | undefined) || undefined,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Pointing PLAYWRIGHT_BASE_URL at a server that is already running means no
  // webServer should be started — otherwise the suite boots a second dev server
  // and then waits on a port nothing is listening to.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
      },
});