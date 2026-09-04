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
      // ADR-0044: a story card may transiently enable hazard map overlays
      // (ADR-0040); GIBS raster tiles stay deterministic transparent PNGs.
      await route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG });
      return;
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`Uncontrolled external request in deterministic source-gap E2E: ${url.href}`);
    }
    await route.continue();
  });
  await gotoHydrated(page, "/?dev=1");
});

async function submitLiveHazard(
  page: Page,
  hazardId: "air_quality" | "earth_volcanoes",
  concern: "health" | "community"
) {
  const ask = page.getByTestId("mobile-nav-ask");
  if (await ask.isVisible()) await ask.click();
  // The Air fixture's AQI row is a Houston-area site, so the air case keeps
  // the Houston card and re-selects the hazard; Earth uses its own card.
  const cardId = hazardId === "air_quality"
    ? /^(desktop|mobile)-gq-place-demo-houston$/
    : /^(desktop|mobile)-gq-place-demo-hawaii-island$/;
  await page.getByTestId(cardId).filter({ visible: true }).click();
  await page.getByTestId("hazard-select").filter({ visible: true }).selectOption(hazardId);
  await page.getByTestId("concern-select").filter({ visible: true }).selectOption(concern);
  await page.getByTestId(/^(desktop|mobile)-gq-custom-date$/).filter({ visible: true }).fill("2026-08-13");
  await page.getByTestId("find-evidence-btn").filter({ visible: true }).click();
}

async function insight(page: Page, tab: "meaning" | "evidence" | "missions"): Promise<Locator> {
  const mobileInsight = page.getByTestId("mobile-nav-insight");
  if (await mobileInsight.isVisible()) await mobileInsight.click();
  const navigation = page.getByTestId("insight-navigation").filter({ visible: true });
  await navigation.getByTestId(`tab-${tab}`).click();
  return navigation.getByTestId(`panel-${tab}`);
}

test("Air Quality composes separate live satellite and outdoor AQI evidence", async ({ page }) => {
  await submitLiveHazard(page, "air_quality", "health");

  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("coverage-gap-panel")).toContainText("Air Quality");
  // ADR-0045: air joined the guarded explanation chain. The deterministic
  // interpretation answers with the official EPA category; the guard always
  // denies before any provider call in E2E (reason wording depends on which
  // env is present), so accept any deterministic status but never an AI answer.
  await expect(meaning.getByTestId("meaning-direct-answer"))
    .toContainText("air-quality index at 42");
  await expect(meaning.getByTestId("meaning-direct-answer"))
    .toContainText("\"Good\" on the official U.S. EPA Air Quality Index scale");
  await expect(meaning.getByTestId("explanation-provider-status"))
    .toContainText(/rule-based explanation|AI explanation is not configured/);
  await expect(meaning.getByTestId("explanation-provider-status"))
    .not.toContainText("Explained by");

  const evidence = await insight(page, "evidence");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("Retrieval attempted: yes");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("MAIAC aerosol optical depth");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("succeeded");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("AirNow daily outdoor AQI");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("42 on the air quality index");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("UTC instant unavailable");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("not indoor air quality");
  expect(await evidence.innerText()).not.toMatch(
    /nasa_gibs|airnow_daily_data|Observation ID|Evidence ID|payload hash|\b(?:obs|evd)-[a-z0-9_-]+\b|\b[0-9a-f]{32,}\b|\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b|\.(?:csv|json|geojson|png|tiff?|kml|xml|psv|txt|zip|gz)\b/iu
  );

  const missions = await insight(page, "missions");
  await expect(missions.getByTestId("coverage-gap-missions")).toContainText("AirNow daily outdoor AQI succeeded");
  await expect(missions.getByTestId("coverage-gap-missions")).toContainText("AOD is never rewritten as AQI");
});

test("Earth and Volcanoes separates satellite, volcano, and observed-earthquake evidence", async ({ page }) => {
  await submitLiveHazard(page, "earth_volcanoes", "community");

  const evidence = await insight(page, "evidence");
  await expect(evidence.getByTestId("coverage-gap-panel")).toContainText("Earth & Volcanoes");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("OMPS sulfur dioxide");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("USGS Volcano Hazards");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("USGS observed earthquake catalog events");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("USGS observed earthquake event");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("magnitude 2.1");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("Earthquake prediction");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("out of scope");
  await expect(evidence.getByTestId("coverage-gap-evidence")).toContainText("not no volcanic hazard");
  expect(await evidence.innerText()).not.toMatch(
    /nasa_gibs|usgs_earthquake_geojson|usgs_volcano_hans|Observation ID|Evidence ID|payload hash|\b(?:obs|evd)-[a-z0-9_-]+\b|\b[0-9a-f]{32,}\b|\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b|\.(?:csv|json|geojson|png|tiff?|kml|xml|psv|txt|zip|gz)\b/iu
  );

  const missions = await insight(page, "missions");
  await expect(missions.getByTestId("coverage-gap-missions")).toContainText("OMPS returned nothing");
  await expect(missions.getByTestId("coverage-gap-missions")).toContainText("HANS returned nothing");
  await expect(missions.getByTestId("coverage-gap-missions")).toContainText("observed USGS earthquake events succeeded");
  await expect(missions.getByTestId("coverage-gap-missions")).toContainText("do not predict or prove causality");
});
