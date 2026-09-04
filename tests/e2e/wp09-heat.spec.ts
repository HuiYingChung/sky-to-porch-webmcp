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
      throw new Error(`Uncontrolled external request in deterministic Heat E2E: ${url.href}`);
    }
    await route.continue();
  });
  await gotoHydrated(page, "/?dev=1");
});

async function submitHeat(page: Page, options: { place?: string; concern?: string; date?: string } = {}) {
  const ask = page.getByTestId("mobile-nav-ask");
  if (await ask.isVisible()) await ask.click();
  const place = options.place ?? "demo-tucson";
  await page.getByTestId(new RegExp(`^(desktop|mobile)-gq-place-${place}$`))
    .filter({ visible: true }).click();
  await page.getByTestId("hazard-select").filter({ visible: true }).selectOption("extreme_heat");
  await page.getByTestId("concern-select").filter({ visible: true })
    .selectOption(options.concern ?? "home");
  await page.getByTestId("heat-mode-select").filter({ visible: true }).selectOption("fixture");
  const date = options.date ?? "2024-07-11";
  await page.getByTestId(/^(desktop|mobile)-gq-custom-date$/).filter({ visible: true }).fill(date);
  await page.getByTestId("find-evidence-btn").filter({ visible: true }).click();
}

async function insight(page: Page, tab: "meaning" | "evidence" | "missions"): Promise<Locator> {
  const mobileInsight = page.getByTestId("mobile-nav-insight");
  if (await mobileInsight.isVisible()) await mobileInsight.click();
  const navigation = page.getByTestId("insight-navigation").filter({ visible: true });
  await navigation.getByTestId(`tab-${tab}`).click();
  return navigation.getByTestId(`panel-${tab}`);
}

async function mapPanel(page: Page): Promise<Locator> {
  const mobileMap = page.getByTestId("mobile-nav-map");
  if (await mobileMap.isVisible()) await mobileMap.click();
  const map = page.getByTestId("analysis-map").filter({ visible: true });
  await expect(map.getByTestId("map-canvas")).toBeVisible();
  return map;
}

test("Heat Meaning is adaptive while Evidence owns six claim assessments", async ({ page }) => {
  await submitHeat(page);
  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("adaptive-meaning")).toBeVisible();
  await expect(meaning.getByTestId("explanation-audit")).toHaveCount(0);

  const evidence = await insight(page, "evidence");
  await expect(evidence.getByTestId("heat-evidence-summary")).toBeVisible();
  await expect(evidence.getByTestId("explanation-audit")).not.toBeVisible();
  await evidence.getByTestId("heat-evidence-details-toggle").click();
  await expect(evidence.locator('[data-testid^="heat-assessment-"]')).toHaveCount(6);
  await expect(evidence.getByTestId("heat-assessment-indoor_temperature"))
    .toContainText("Not supported");
  await expect(evidence.getByTestId("heat-assessment-individual_medical_risk"))
    .toContainText("Not supported");
  await expect(evidence.getByTestId("heat-observation")).toHaveCount(3);
  await expect(evidence.getByTestId("explanation-audit")).toBeVisible();
});

test("Heat Meaning names the validated peak values and the travel implication", async ({ page }) => {
  await submitHeat(page, { concern: "travel" });
  const meaning = await insight(page, "meaning");
  const directAnswer = meaning.getByTestId("meaning-direct-answer");
  await expect(directAnswer).toContainText("41.7");
  await expect(directAnswer).toContainText("travel");
  await expect(directAnswer).toContainText("extreme caution");
  await expect(directAnswer).not.toContainText("real observations were recorded");
});

test("blank Heat question still addresses pets and gives fixed official checkers", async ({ page }) => {
  await submitHeat(page, { concern: "pets" });
  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("meaning-direct-answer")).toContainText("pets");
  await meaning.getByTestId("meaning-details-toggle").click();
  await expect(meaning.getByTestId("verification-source-nws_weather"))
    .toHaveAttribute("href", "https://www.weather.gov/");
  await expect(meaning.getByTestId("verification-source-cdc_heat_pets"))
    .toHaveAttribute("href", "https://www.cdc.gov/heat-health/risk-factors/heat-and-pets.html");
});

test("Surface heat stays a reference raster with a deterministic limitation legend", async ({ page }) => {
  const map = await mapPanel(page);
  const toggle = map.getByTestId("layer-toggle-gibs_surface_temp");
  await expect(toggle).toBeVisible();
  await toggle.check();
  await expect(map.getByTestId("legend-heat")).toContainText("land-surface temperature");
  await expect(map.getByTestId("legend-heat")).toContainText("not outdoor air or indoor temperature");
  await expect(map.getByTestId("heat-map-coverage-label")).toHaveCount(0);
});

test("unsupported and failed Heat sources remain explicit without substitution", async ({ page }) => {
  await submitHeat(page, { date: "1990-01-01" });
  let meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("heat-mode-label")).toContainText("Outside source coverage");
  await expect(meaning.getByTestId("meaning-direct-answer")).toContainText("coverage gap");

  await submitHeat(page, { place: "demo-source-failure" });
  meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("heat-mode-label")).toContainText("Source unavailable");
  await expect(meaning.getByTestId("meaning-direct-answer"))
    .toContainText("failed lookup says nothing about actual conditions");
  const evidence = await insight(page, "evidence");
  await evidence.getByTestId("heat-evidence-details-toggle").click();
  await expect(evidence.getByTestId("heat-no-observations")).toBeVisible();
});

test("Heat Missions labels official imagery as background rather than exact evidence", async ({ page }) => {
  await submitHeat(page);
  const missions = await insight(page, "missions");
  await expect(missions.getByTestId("mission-context-note")).toContainText("not the exact observation");
  await expect(missions.getByTestId("mission-reference-details")).not.toBeVisible();
  await missions.getByTestId("heat-missions-details-toggle").click();
  await expect(missions.getByTestId("heat-missions-panel")).toContainText("Terra");
  await expect(missions.getByTestId("heat-missions-panel")).toContainText("NOAA USCRN");
  await expect(missions.getByTestId("mission-reference-details")).toBeVisible();
});
