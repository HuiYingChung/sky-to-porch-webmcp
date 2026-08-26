import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

type MockMode = "positive" | "empty" | "failure";

async function installNetworkMocks(page: Page, mode: MockMode) {
  let wildfireRequests = 0;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/map/wildfire") {
      wildfireRequests += 1;
      if (mode === "failure") {
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "source_failure" }),
        });
        return;
      }
      const area = {
        west: Number(url.searchParams.get("west")),
        south: Number(url.searchParams.get("south")),
        east: Number(url.searchParams.get("east")),
        north: Number(url.searchParams.get("north")),
      };
      const features = mode === "positive" ? [{
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [(area.west + area.east) / 2, (area.south + area.north) / 2],
        },
        properties: {
          detectionId: "mock-n20-detection",
          acquiredAt: "2026-08-13T14:30:00Z",
          satellite: "N20",
          instrument: "VIIRS",
          confidence: "nominal",
          processing: "near_real_time",
          version: "2.0NRT",
          frpMw: 4.5,
          dayNight: "day",
        },
      }] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          result: {
            sourceId: "nasa_firms",
            sourceUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
            product: "VIIRS_NOAA20_NRT",
            dataMode: "live",
            evidenceState: features.length > 0 ? "observations_returned" : "no_observation",
            retrievedAt: "2026-08-13T16:00:00.000Z",
            latestAcquiredAt: features.length > 0 ? "2026-08-13T14:30:00Z" : null,
            requestArea: area,
            featureCollection: { type: "FeatureCollection", features },
            payloadHash: "a".repeat(64),
            limitations: [
              "Hotspots are satellite pixel detections, not wildfire perimeters.",
              "No detection is not evidence of no fire or no danger.",
            ],
          },
        }),
      });
      return;
    }
    if (url.hostname === "tile.openstreetmap.org") {
      await route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG });
      return;
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`Uncontrolled external request in deterministic FIRMS E2E: ${url.href}`);
    }
    await route.continue();
  });
  return () => wildfireRequests;
}

async function visibleMap(page: Page) {
  await gotoHydrated(page, "/?dev=1");
  const mobileAsk = page.getByTestId("mobile-nav-ask");
  if (await mobileAsk.isVisible()) await mobileAsk.click();
  // ADR-0044: story cards set a hazard, which auto-enables its map layers
  // (ADR-0040). This spec exercises manual layer control, so it selects the
  // dev place-only shortcut, which sets no hazard and enables no layer.
  await page.getByTestId(/^(desktop|mobile)-gq-place-demo-lake-michigan$/)
    .filter({ visible: true }).click();
  const mobileMap = page.getByTestId("mobile-nav-map");
  if (await mobileMap.isVisible()) await mobileMap.click();
  return page.getByTestId("analysis-map").filter({ visible: true });
}

test("FIRMS toggle is always available, off by default, and loads the visible viewport only on request", async ({ page }) => {
  const requestCount = await installNetworkMocks(page, "positive");
  const map = await visibleMap(page);
  const toggle = map.getByTestId("layer-toggle-wildfire_nrt");
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  expect(requestCount()).toBe(0);

  await toggle.check();
  await expect(map.getByTestId("wildfire-layer-count")).toContainText("1 validated thermal-anomaly pixel");
  await expect(map.getByTestId("map-canvas")).toHaveAttribute("data-wildfire-rendered-count", "1");
  expect(requestCount()).toBe(1);
  await expect(map.getByTestId("wildfire-layer-status"))
    .toContainText("not severity, perimeter, official incident, or evacuation information");

  await toggle.uncheck();
  await expect(map.getByTestId("wildfire-layer-status")).toHaveCount(0);
  await expect(map.getByTestId("map-canvas")).toHaveAttribute("data-wildfire-rendered-count", "0");
});

test("hotspot inspection opens details without changing the canonical query selection", async ({ page }) => {
  await installNetworkMocks(page, "positive");
  await gotoHydrated(page, "/?dev=1");
  const ask = page.getByTestId("mobile-nav-ask");
  if (await ask.isVisible()) await ask.click();
  // ADR-0044: place-only dev shortcut — the LA story card would select the
  // Fire hazard and auto-enable this very layer before the manual check.
  await page.getByTestId(/^(desktop|mobile)-gq-place-demo-lake-michigan$/)
    .filter({ visible: true }).click();
  const mobileMap = page.getByTestId("mobile-nav-map");
  if (await mobileMap.isVisible()) await mobileMap.click();
  const map = page.getByTestId("analysis-map").filter({ visible: true });
  const before = await map.getByTestId("map-selection-overlay").getByTestId("selection-summary")
    .getAttribute("data-selection-coordinate");
  await page.waitForTimeout(1000);
  await map.getByTestId("layer-toggle-wildfire_nrt").check();
  await expect(map.getByTestId("wildfire-layer-count")).toBeVisible();
  const layerCardToggle = map.getByTestId("map-layer-overlay-collapse-toggle");
  await layerCardToggle.click();
  await expect(layerCardToggle).toHaveAttribute("aria-expanded", "false");
  await expect(map.getByTestId("layer-manager")).not.toBeVisible();

  const canvas = map.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("MapLibre canvas has no bounds");
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(map.getByText("NASA FIRMS hotspot pixel")).toBeVisible();
  await expect(map.getByTestId("map-selection-overlay").getByTestId("selection-summary"))
    .toHaveAttribute("data-selection-coordinate", before ?? "");
});

test("empty viewport responses remain explicit with no fallback points", async ({ page }) => {
  await installNetworkMocks(page, "empty");
  const map = await visibleMap(page);
  await map.getByTestId("layer-toggle-wildfire_nrt").check();
  await expect(map.getByTestId("wildfire-layer-status"))
    .toContainText("does not mean no wildfire");
  await expect(map.getByTestId("map-canvas")).toHaveAttribute("data-wildfire-rendered-count", "0");
});

test("failed viewport responses remain explicit with no fallback points", async ({ page }) => {
  const failureRequestCount = await installNetworkMocks(page, "failure");
  const map = await visibleMap(page);
  const toggle = map.getByTestId("layer-toggle-wildfire_nrt");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect.poll(failureRequestCount).toBe(1);
  await expect(map.getByTestId("wildfire-layer-status"))
    .toContainText("Failure is not evidence of no wildfire");
  await expect(map.getByTestId("map-canvas")).toHaveAttribute("data-wildfire-rendered-count", "0");
});
