import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const PNG_DATA_URL = `data:image/png;base64,${TRANSPARENT_PNG.toString("base64")}`;

type MockMode = "positive" | "empty" | "failure";

async function installNetworkMocks(page: Page, mode: MockMode) {
  let floodRequests = 0;
  let lastRequest: { date: string; area: string } | null = null;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/map/flood-extent") {
      floodRequests += 1;
      if (mode === "failure") {
        await route.fulfill({
          status: 504,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "timeout" }),
        });
        return;
      }
      const area = {
        west: Number(url.searchParams.get("west")),
        south: Number(url.searchParams.get("south")),
        east: Number(url.searchParams.get("east")),
        north: Number(url.searchParams.get("north")),
      };
      const date = url.searchParams.get("date") ?? "";
      lastRequest = {
        date,
        area: [area.west, area.south, area.east, area.north]
          .map((value) => value.toFixed(3))
          .join(","),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          result: {
            sourceId: "nasa_lance_flood_extent",
            sourceUrl: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
            product: "VIIRS_Combined_Flood_3-Day",
            dataMode: "live",
            evidenceState: mode === "positive" ? "observations_returned" : "no_observation",
            retrievedAt: "2026-08-14T20:00:00.000Z",
            observedDate: mode === "positive" ? date : null,
            requestArea: area,
            imageDataUrl: mode === "positive" ? PNG_DATA_URL : null,
            imageWidth: 512,
            imageHeight: 512,
            payloadHash: "b".repeat(64),
            claimBoundary: mode === "positive"
              ? "Visualization only; pixel classes are not interpreted."
              : "A transparent response is no observation, not no flood and not no danger.",
            limitations: [
              "Not flood depth or property impact.",
              "No observation is not evidence of no flood or no danger.",
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
      throw new Error(`Uncontrolled external request in deterministic flood-layer E2E: ${url.href}`);
    }
    await route.continue();
  });
  return {
    requestCount: () => floodRequests,
    latestRequest: () => lastRequest,
  };
}

async function selectedMap(page: Page) {
  await gotoHydrated(page, "/?dev=1");
  const mobileAsk = page.getByTestId("mobile-nav-ask");
  if (await mobileAsk.isVisible()) await mobileAsk.click();
  // ADR-0044: the Houston story card selects the Flood hazard, which
  // auto-enables this very layer (ADR-0040). This spec exercises manual
  // layer control, so it uses the place-only dev shortcut instead.
  await page.getByTestId(/^(desktop|mobile)-gq-place-demo-lake-michigan$/)
    .filter({ visible: true }).click();
  const mobileMap = page.getByTestId("mobile-nav-map");
  if (await mobileMap.isVisible()) await mobileMap.click();
  const map = page.getByTestId("analysis-map").filter({ visible: true });
  const bounds = await map.getByTestId("selection-summary").getAttribute("data-selection-bounds");
  return {
    map,
    bounds,
  };
}

test("Flood extent uses the exact canonical area and renders only a validated returned image", async ({ page }) => {
  const requests = await installNetworkMocks(page, "positive");
  const { map, bounds } = await selectedMap(page);
  const toggle = map.getByTestId("layer-toggle-flood_extent");
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  expect(requests.requestCount()).toBe(0);

  await toggle.check();
  await expect(map.getByTestId("flood-extent-layer-date")).toBeVisible();
  await expect(map.getByTestId("map-canvas")).toHaveAttribute("data-flood-extent-rendered", "true");
  expect(requests.requestCount()).toBe(1);
  expect(requests.latestRequest()?.area).toBe(bounds);

  await toggle.uncheck();
  await expect(map.getByTestId("flood-extent-layer-status")).toHaveCount(0);
  await expect(map.getByTestId("map-canvas")).toHaveAttribute("data-flood-extent-rendered", "false");
});

test("Flood extent keeps no-observation explicit with no fallback image", async ({ page }) => {
  const requests = await installNetworkMocks(page, "empty");
  const { map } = await selectedMap(page);
  await map.getByTestId("layer-toggle-flood_extent").check();
  await expect(map.getByTestId("flood-extent-layer-status"))
    .toContainText("does not mean no flood or no danger");
  await expect(map.getByTestId("map-canvas")).toHaveAttribute("data-flood-extent-rendered", "false");
  expect(requests.requestCount()).toBe(1);
});

test("Flood extent keeps source failure explicit with no fallback image", async ({ page }) => {
  const requests = await installNetworkMocks(page, "failure");
  const { map } = await selectedMap(page);
  const toggle = map.getByTestId("layer-toggle-flood_extent");
  await toggle.check();
  await expect(map.getByTestId("flood-extent-layer-status"))
    .toContainText("does not mean there is no flood");
  await expect(map.getByTestId("map-canvas")).toHaveAttribute("data-flood-extent-rendered", "false");
  expect(requests.requestCount()).toBe(1);
});
