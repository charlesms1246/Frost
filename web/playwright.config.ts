import { defineConfig, devices } from "@playwright/test";

// Chromium-only Playwright config. Firefox/WebKit are skipped to save ~600MB
// of browser downloads; the connect/* pages have no browser-specific code
// worth re-testing across engines.
//
// `webServer` starts `npm run dev` on the local box for the duration of the
// suite. `reuseExistingServer: true` lets a hand-started dev server (e.g. the
// one the user is using for Flask smoke-tests) be reused so we don't double-
// bind port 3000.

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
