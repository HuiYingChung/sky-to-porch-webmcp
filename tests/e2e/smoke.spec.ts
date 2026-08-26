import { test, expect } from "@playwright/test";
import { gotoHydrated } from "./helpers";

/**
 * E2E smoke test: home page renders and contains required content.
 * Runs against the local production build (http://localhost:3000).
 * No live data, AI, or external sources are called.
 */
test("home page loads and shows foundation status", async ({ page }) => {
  await gotoHydrated(page, "/");
  await expect(page).toHaveTitle(/Sky to Porch/);
  // The WP-03 shell renders "Sky to Porch" in both desktop and mobile headers.
  // Verify the page has loaded by checking it contains the brand text somewhere.
  await expect(page.locator("body")).toContainText("Sky to Porch");
});

test("health API returns ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.status).toBe("ok");
  // Capability flag only; this health request does not contact NOAA.
  expect(body.liveData).toBe(true);
  expect(body.ai).toBe(false);
});
