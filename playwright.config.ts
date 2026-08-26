import { defineConfig, devices } from "@playwright/test";

const requestedPort = process.env.PLAYWRIGHT_PORT ?? "3000";
const playwrightPort = /^\d{2,5}$/u.test(requestedPort) ? requestedPort : "3000";
const playwrightBaseUrl = `http://localhost:${playwrightPort}`;
const playwrightServerCommand = process.env.PLAYWRIGHT_DEV_SERVER === "1"
  ? `npm run dev -- -p ${playwrightPort}`
  : `npm run start -- -p ${playwrightPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  use: {
    baseURL: playwrightBaseUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 393, height: 851 },
      },
    },
  ],
  // Start the production build before running E2E tests.
  webServer: {
    command: playwrightServerCommand,
    url: playwrightBaseUrl,
    // Deterministic E2E must never use a developer's stored FIRMS credential or
    // contact the live provider. Wildfire-layer cases mock the internal route.
    env: {
      FIRMS_MAP_KEY: "",
      PLAYWRIGHT_TEST_SERVER: "1",
      SKY_TO_PORCH_E2E_FIXTURES: "coverage-gap-v1",
    },
    // Never silently test a dev server from another worktree. Reuse is an
    // explicit local-only opt-in; CI and normal verification start the exact
    // production candidate declared above.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1",
    timeout: 60_000,
  },
});
