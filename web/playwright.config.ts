import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against the production build, in a real browser.
// Run with `pnpm test:e2e` (needs src/wasm built: `pnpm build:wasm`).
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts", // keeps these out of Vitest, which picks up *.test.ts / *.spec.ts
  timeout: 120_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: "pnpm exec vite build && pnpm exec vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
