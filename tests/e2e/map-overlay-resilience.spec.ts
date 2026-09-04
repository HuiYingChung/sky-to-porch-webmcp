import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

/**
 * P0-D: a failing overlay source (NASA GIBS raster tiles) must never replace
 * the working OSM basemap with the basemap-unavailable panel, while a real
 * basemap failure must still surface it. All external hosts are route-mocked.
 */

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function mapPanel(page: Page): Promise<Locator> {
  const mobileMap = page.getByTestId("mobile-nav-map");
  if (await mobileMap.isVisible()) await mobileMap.click();
  return page.getByTestId("analysis-map").filter({ visible: true });
}

test("a failing GIBS overlay never removes the basemap", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/map/gibs-availability") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "source_failure" }),
      });
      return;
    }
    if (url.hostname === "tile.openstreetmap.org") {
      await route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG });
      return;
    }
    if (url.hostname === "gibs.earthdata.nasa.gov") {
      await route.abort();
      return;
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`Uncontrolled external request in overlay-resilience E2E: ${url.href}`);
    }
    await route.continue();
  });
  await gotoHydrated(page, "/?dev=1");

  // Give the overlay an explicit selected analysis area and one resolved UTC
  // date so this test reaches the browser tile path it is intended to cover.
  await page.getByTestId(/^(desktop|mobile)-gq-place-demo-houston$/)
    .filter({ visible: true })
    .click();

  const map = await mapPanel(page);
  await expect(map.getByTestId("map-canvas")).toBeVisible();

  const toggle = map.getByTestId("layer-toggle-gibs_surface_temp");
  await expect(toggle).toBeVisible();
  await toggle.check();

  // Give the aborted GIBS tile requests time to fail and fire map errors.
  await page.waitForTimeout(2500);

  await expect(map.getByTestId("map-canvas")).toBeVisible();
  await expect(page.getByTestId("map-tile-error")).toHaveCount(0);

  // ADR-0040 (Bug E): the failure is no longer silent — the layer card
  // states it without claiming the hazard is absent.
  const status = map.getByTestId("gibs_surface_temp-layer-status");
  await expect(status).toBeVisible();
  await expect(status).toContainText("could not be loaded");
  await expect(status).toContainText("not evidence of no hazard");
});

test("a failing OSM basemap still shows the basemap-unavailable panel", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/map/gibs-availability") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "source_failure" }),
      });
      return;
    }
    if (url.hostname === "tile.openstreetmap.org") {
      await route.abort();
      return;
    }
    if (url.hostname === "gibs.earthdata.nasa.gov") {
      await route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG });
      return;
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`Uncontrolled external request in overlay-resilience E2E: ${url.href}`);
    }
    await route.continue();
  });
  await gotoHydrated(page, "/?dev=1");

  const map = await mapPanel(page);
  await expect(map.getByTestId("map-tile-error")).toBeVisible({ timeout: 15_000 });
});
