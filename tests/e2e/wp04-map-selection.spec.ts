import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "tile.openstreetmap.org" || url.hostname === "gibs.earthdata.nasa.gov") {
      await route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG });
      return;
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`Uncontrolled external request in deterministic selection E2E: ${url.href}`);
    }
    await route.continue();
  });
  // React drops clicks that arrive before hydration finishes, which made the
  // first checkbox interaction flaky under full-suite CPU load. gotoHydrated
  // waits for the shell's post-hydration marker before any interaction.
  await gotoHydrated(page, "/?dev=1");
});

async function goToAsk(page: Page) {
  const button = page.getByTestId("mobile-nav-ask");
  if (await button.isVisible()) await button.click();
}

async function goToMap(page: Page): Promise<Locator> {
  const button = page.getByTestId("mobile-nav-map");
  if (await button.isVisible()) await button.click();
  const showMap = page.getByTestId("show-map-btn").filter({ visible: true });
  if (await showMap.isVisible()) await showMap.click();
  return page.getByTestId("analysis-map").filter({ visible: true });
}

async function selectDemo(page: Page, id: string) {
  await goToAsk(page);
  await page.getByTestId(new RegExp(`^(desktop|mobile)-gq-place-${id}$`))
    .filter({ visible: true }).click();
}

test("Query has one primary action and no Interpret, preview, or Apply action", async ({ page }) => {
  await goToAsk(page);
  const query = page.getByTestId("guided-query").filter({ visible: true });
  const button = query.getByTestId("find-evidence-btn");
  await expect(button).toHaveText("Get evidence-based answer");
  await expect(query.getByText(/\bInterpret\b|\bApply\b|preview/iu)).toHaveCount(0);
  await expect(query.locator('button[type="submit"]')).toHaveCount(1);
});

test("non-map view is an empty textual map alternative, not a second Query form", async ({ page }) => {
  const map = await goToMap(page);
  await map.getByTestId("show-non-map-btn").focus();
  await page.keyboard.press("Enter");
  const nonMap = map.getByTestId("non-map-selection");
  await expect(nonMap).toContainText("No area is selected");
  await expect(nonMap.locator("input, select, textarea, button")).toHaveCount(0);
  await expect(nonMap).not.toContainText("Hazard");
  await expect(nonMap).not.toContainText("Question");
});

test("left Query selection is the same atomic selection in non-map text view", async ({ page }) => {
  await selectDemo(page, "demo-houston");
  await page.getByTestId(/^(desktop|mobile)-gq-radius-input$/).filter({ visible: true }).fill("40");
  await expect(page.getByTestId("guided-query").filter({ visible: true }).getByTestId("selection-summary"))
    .toHaveCount(0);

  const map = await goToMap(page);
  await map.getByTestId("show-non-map-btn").click();
  const summary = map.getByTestId("non-map-selection").getByTestId("selection-summary");
  await expect(summary).toContainText("Houston area (demo)");
  await expect(summary).toContainText("Coordinates:");
  await expect(summary).toContainText("40 km radius");
  await expect(summary).toContainText("Bounds:");
  await expect(summary).toContainText("Selection method:");
  await expect(summary).toContainText("Area model / resolution:");
  await expect(summary).not.toHaveAttribute("data-selection-time");
});

test("map click creates the canonical query selection and survives map/non-map switching", async ({ page }) => {
  const map = await goToMap(page);
  const canvas = map.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("MapLibre canvas has no bounds");
  await canvas.click({ position: { x: box.width * 0.32, y: box.height * 0.72 } });
  await expect(map.getByTestId("map-selection-overlay")).toContainText("Map point");
  // ADR-0049: the query column confirms a map click with its coordinates,
  // since the generic label would not say where the user clicked.
  await goToAsk(page);
  await expect(page.getByTestId(/^(desktop|mobile)-gq-selected-place$/).filter({ visible: true }))
    .toContainText(/Map point -?\d+\.\d{3}°, -?\d+\.\d{3}°/u);
  await goToMap(page);

  await map.getByTestId("show-non-map-btn").click();
  const textSummary = map.getByTestId("non-map-selection").getByTestId("selection-summary");
  await expect(textSummary).toHaveAttribute("data-selection-method", "map_click");
  const coordinate = await textSummary.getAttribute("data-selection-coordinate");
  await map.getByTestId("show-map-btn").click();
  await expect(map.getByTestId("map-selection-overlay").getByTestId("selection-summary"))
    .toHaveAttribute("data-selection-coordinate", coordinate ?? "");

  await goToAsk(page);
  const query = page.getByTestId("guided-query").filter({ visible: true });
  await expect(query.getByTestId("selection-summary")).toHaveCount(0);
  await query.getByTestId("hazard-select").selectOption("fire_smoke");
  await query.getByTestId("concern-select").selectOption("home");
  await expect(query.getByTestId("find-evidence-btn")).toBeEnabled();
});

test("Enter in the place field starts nothing and the picked place is confirmed in the query column (ADR-0049)", async ({ page }) => {
  await page.route("**/api/geocode", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        results: [{ label: "Sendai, Miyagi Prefecture, Japan", lon: 140.87, lat: 38.27 }],
      }),
    });
  });
  // Every text field sits inside the query form: Enter must never reach the
  // submit handler and start a provider call from any of them.
  let queryCalls = 0;
  for (const route of ["fire", "flood", "heat", "drought", "air", "volcano"]) {
    await page.route(`**/api/${route}/query`, async (r) => {
      queryCalls += 1;
      await r.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false}' });
    });
  }

  await goToAsk(page);
  const search = page.getByTestId(/^(desktop|mobile)-gq-place-search$/).filter({ visible: true });
  await search.fill("Sendai Japan");
  await search.press("Enter");
  await expect(search).toHaveValue("Sendai Japan");

  // A complete draft would otherwise be submittable, so press Enter in the
  // other fields too, where an accidental provider call would be costly.
  await selectDemo(page, "demo-houston");
  await page.getByTestId("concern-select").filter({ visible: true }).selectOption("home");
  await page.getByTestId(/^(desktop|mobile)-gq-radius-input$/).filter({ visible: true })
    .press("Enter");
  await page.getByTestId("hazard-select").filter({ visible: true }).press("Enter");
  await expect(page.getByTestId("find-evidence-btn").filter({ visible: true })).toBeEnabled();
  expect(queryCalls).toBe(0);

  await search.fill("Sendai Japan");
  // Searching is the button's job, and only the button's.
  await expect(page.getByRole("button", { name: /Sendai, Miyagi Prefecture/ })
    .filter({ visible: true })).toHaveCount(0);
  await page.getByTestId(/^(desktop|mobile)-gq-world-search-btn$/).filter({ visible: true }).click();

  await page.getByRole("button", { name: /Sendai, Miyagi Prefecture/ })
    .filter({ visible: true }).click();
  const selected = page.getByTestId(/^(desktop|mobile)-gq-selected-place$/).filter({ visible: true });
  await expect(selected).toContainText("Sendai, Miyagi Prefecture, Japan");
  // WP-04 keeps exactly one canonical summary, and it is not in this column.
  await expect(page.getByTestId("guided-query").filter({ visible: true })
    .getByTestId("selection-summary")).toHaveCount(0);
});

test("world place search submits the same bounded custom-area contract as a map click", async ({ page }) => {
  await page.route("**/api/geocode", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        results: [{ label: "New York, New York, United States", lon: -74.006, lat: 40.7128 }],
      }),
    });
  });

  let submittedBody: Record<string, unknown> | null = null;
  await page.route("**/api/heat/query", async (route) => {
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "fixture_visual_check_only" }),
    });
  });

  await goToAsk(page);
  const search = page.getByTestId(/^(desktop|mobile)-gq-place-search$/).filter({ visible: true });
  await search.fill("New York");
  await page.getByTestId(/^(desktop|mobile)-gq-world-search-btn$/).filter({ visible: true }).click();
  await page.getByRole("button", { name: /New York, New York/ }).filter({ visible: true }).click();
  await page.getByTestId("hazard-select").filter({ visible: true }).selectOption("extreme_heat");
  await page.getByTestId("concern-select").filter({ visible: true }).selectOption("pets");
  await page.getByTestId("heat-mode-select").filter({ visible: true }).selectOption("live");
  await page.getByTestId(/^(desktop|mobile)-gq-custom-date$/).filter({ visible: true }).fill("2024-07-11");
  await page.getByTestId("find-evidence-btn").filter({ visible: true }).click();

  await expect.poll(() => submittedBody).not.toBeNull();
  expect(submittedBody).toMatchObject({
    placeId: "custom-area",
    date: "2024-07-11",
    mode: "live",
    concern: "pets",
    area: {
      west: expect.any(Number),
      south: expect.any(Number),
      east: expect.any(Number),
      north: expect.any(Number),
    },
  });
  const capturedBody = submittedBody as Record<string, unknown> | null;
  if (!capturedBody) throw new Error("Heat request was not captured");
  const submittedArea = capturedBody.area as {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  expect((submittedArea.west + submittedArea.east) / 2).toBeCloseTo(-74.006, 5);
  expect((submittedArea.south + submittedArea.north) / 2).toBeCloseTo(40.7128, 5);
});

test("selecting a hazard auto-enables its matching layers without locking manual control", async ({ page }) => {
  await goToAsk(page);
  await page.getByTestId("hazard-select").filter({ visible: true }).selectOption("extreme_heat");
  const map = await goToMap(page);
  const manager = map.getByTestId("layer-manager");
  // ADR-0040 (Bug G): Extreme Heat turns the surface-heat raster on…
  await expect(manager.getByTestId("layer-toggle-gibs_surface_temp")).toBeChecked();
  await expect(manager.getByTestId("layer-toggle-gibs_precipitation")).not.toBeChecked();
  // …and the user can still turn it back off manually.
  await manager.getByTestId("layer-toggle-gibs_surface_temp").uncheck();
  await expect(manager.getByTestId("layer-toggle-gibs_surface_temp")).not.toBeChecked();
});

test("layer controls are always present and Flood truthfully reports a source gap", async ({ page }) => {
  const map = await goToMap(page);
  const layers = map.getByTestId("layer-manager");
  // ADR-0046: the base layers are always-on and expose no toggle.
  await expect(layers.getByTestId("layer-toggle-basemap")).toHaveCount(0);
  await expect(layers.getByTestId("layer-toggle-selected_place")).toHaveCount(0);
  await expect(layers.getByTestId("layer-toggle-analysis_area")).toHaveCount(0);
  await expect(layers.getByTestId("layer-toggle-gibs_precipitation")).toBeVisible();
  await expect(layers.getByTestId("layer-toggle-gibs_surface_temp")).toBeVisible();
  await expect(layers.getByTestId("layer-toggle-wildfire_nrt")).toBeVisible();
  await expect(layers.getByTestId("layer-toggle-flood_extent")).toBeEnabled();
  await expect(layers.getByTestId("layer-toggle-flood_extent")).not.toBeChecked();
  await expect(layers.getByTestId("flood_extent-source-gap")).toHaveCount(0);
});

test("the selected place marker still renders even though its toggle is gone (ADR-0046)", async ({ page }) => {
  await selectDemo(page, "demo-houston");
  const map = await goToMap(page);
  await expect(map.locator("canvas.maplibregl-canvas")).toBeVisible();
  // The marker is always-on: it must appear with no checkbox able to remove it.
  await expect(map.locator(".maplibregl-marker")).toBeVisible();
  const layers = map.getByTestId("layer-manager");
  await expect(layers.getByTestId("layer-toggle-selected_place")).toHaveCount(0);
  await expect(layers.getByTestId("layer-toggle-analysis_area")).toHaveCount(0);
});

test("deterministic legends and the layer card collapse and restore with the keyboard", async ({ page }) => {
  const map = await goToMap(page);
  const manager = map.getByTestId("layer-manager");
  await manager.getByTestId("layer-toggle-gibs_precipitation").check();
  await expect(manager.getByTestId("legend-rain")).toContainText("mm/hour");
  await expect(manager.getByTestId("legend-rain")).toContainText("not observed flood extent");
  await manager.getByTestId("layer-toggle-gibs_surface_temp").check();
  await expect(manager.getByTestId("legend-heat")).toContainText("K source scale");
  await expect(manager.getByTestId("legend-heat")).toContainText("not outdoor air");

  const toggle = map.getByTestId("map-layer-overlay-collapse-toggle");
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(manager).not.toBeVisible();
  // Collapsing must keep focus on the toggle so the keyboard can restore it.
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(manager).toBeVisible();
});

test("both map cards collapse and can be repositioned without leaving the map", async ({ page }) => {
  await selectDemo(page, "demo-tucson");
  const map = await goToMap(page);
  const selectionCard = map.getByTestId("map-selection-overlay");
  const layerCard = map.getByTestId("map-layer-overlay");

  const selectionToggle = selectionCard.getByTestId("map-selection-overlay-collapse-toggle");
  const layerToggle = layerCard.getByTestId("map-layer-overlay-collapse-toggle");
  await selectionToggle.click();
  await layerToggle.click();
  await expect(selectionToggle).toHaveAttribute("aria-expanded", "false");
  await expect(layerToggle).toHaveAttribute("aria-expanded", "false");

  const selectionBefore = await selectionCard.boundingBox();
  const selectionHandle = selectionCard.getByTestId("map-selection-overlay-drag-handle");
  const handleBox = await selectionHandle.boundingBox();
  if (!selectionBefore || !handleBox) throw new Error("Selection card drag bounds unavailable");
  await page.mouse.move(handleBox.x + 20, handleBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 55, handleBox.y + 58, { steps: 5 });
  await page.mouse.up();
  const selectionAfter = await selectionCard.boundingBox();
  expect(selectionAfter?.y).toBeGreaterThan(selectionBefore.y + 20);
  await expect(selectionCard).toHaveAttribute("data-positioned", "true");

  const layerBefore = await layerCard.boundingBox();
  const layerHandle = layerCard.getByTestId("map-layer-overlay-drag-handle");
  const layerHandleBox = await layerHandle.boundingBox();
  if (!layerBefore || !layerHandleBox) throw new Error("Layer card drag bounds unavailable");
  await page.mouse.move(layerHandleBox.x + 20, layerHandleBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(layerHandleBox.x + 10, layerHandleBox.y + 70, { steps: 5 });
  await page.mouse.up();
  const layerAfter = await layerCard.boundingBox();
  expect(layerAfter?.y).toBeGreaterThan(layerBefore.y + 20);
  await expect(layerCard).toHaveAttribute("data-positioned", "true");

  await layerHandle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(layerHandle).toBeFocused();

  const mapBox = await map.boundingBox();
  const finalSelection = await selectionCard.boundingBox();
  const finalLayer = await layerCard.boundingBox();
  if (!mapBox || !finalSelection || !finalLayer) throw new Error("Final map card bounds unavailable");
  for (const card of [finalSelection, finalLayer]) {
    expect(card.x).toBeGreaterThanOrEqual(mapBox.x);
    expect(card.y).toBeGreaterThanOrEqual(mapBox.y);
    expect(card.x + card.width).toBeLessThanOrEqual(mapBox.x + mapBox.width);
    expect(card.y + card.height).toBeLessThan(mapBox.y + mapBox.height - 20);
  }
});

test("OpenStreetMap attribution remains visible", async ({ page }) => {
  const map = await goToMap(page);
  await expect(map.locator(".maplibregl-ctrl-attrib")).toContainText("OpenStreetMap");
});
