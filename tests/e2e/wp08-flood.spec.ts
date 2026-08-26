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
      throw new Error(`Uncontrolled external request in deterministic Flood E2E: ${url.href}`);
    }
    await route.continue();
  });
  await gotoHydrated(page, "/?dev=1");
});

async function submitFlood(
  page: Page,
  date: string,
  options: { concern?: "home" | "travel"; question?: string } = {}
) {
  const ask = page.getByTestId("mobile-nav-ask");
  if (await ask.isVisible()) await ask.click();
  await page.getByTestId(/^(desktop|mobile)-gq-place-demo-houston$/).filter({ visible: true }).click();
  await page.getByTestId("hazard-select").filter({ visible: true }).selectOption("flood_storm");
  await page.getByTestId("concern-select").filter({ visible: true })
    .selectOption(options.concern ?? "home");
  if (options.question) {
    await page.getByTestId("optional-question").filter({ visible: true }).fill(options.question);
  }
  await page.getByTestId("flood-mode-select").filter({ visible: true }).selectOption("fixture");
  await page.getByTestId(/^(desktop|mobile)-gq-custom-start$/).filter({ visible: true }).fill(date);
  await page.getByTestId(/^(desktop|mobile)-gq-custom-end$/).filter({ visible: true }).fill(date);
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
  return page.getByTestId("analysis-map").filter({ visible: true });
}

test("Flood Meaning stays concise while Evidence preserves six separated claims", async ({ page }) => {
  await submitFlood(page, "2024-07-08");
  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("flood-meaning-panel")).toBeVisible();
  await expect(meaning.getByTestId("adaptive-meaning")).toBeVisible();
  await expect(meaning.getByTestId("explanation-audit")).toHaveCount(0);

  const evidence = await insight(page, "evidence");
  await expect(evidence.getByTestId("flood-evidence-summary")).toBeVisible();
  await expect(evidence.getByTestId("explanation-audit")).not.toBeVisible();
  await evidence.getByTestId("flood-evidence-details-toggle").click();
  await expect(evidence.locator('[data-testid^="flood-assessment-"]')).toHaveCount(6);
  await expect(evidence.getByTestId("flood-assessment-route_disruption")).toContainText("Not supported");
  await expect(evidence.getByTestId("flood-assessment-property_impact")).toContainText("Not supported");
  await expect(evidence.getByTestId("flood-observation")).toHaveCount(2);
  await expect(evidence.getByTestId("explanation-audit")).toBeVisible();
  await expect(evidence.getByText("Official dataset/product URL", { exact: false })).toHaveCount(2);
});

test("Houston traffic question gets flood-impact context and scoped official traffic checks", async ({ page }) => {
  await submitFlood(page, "2024-07-08", {
    concern: "travel",
    question: "Was there any traffic in Houston downtown due to the weather condition?",
  });
  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("meaning-direct-answer"))
    .toContainText("Flooding or high water can disrupt traffic");
  await meaning.getByTestId("meaning-details").click();
  await expect(meaning.getByTestId("verification-source-houston_transtar_traffic"))
    .toHaveAttribute("href", "https://traffic.houstontranstar.org/layers/?hl=en-US");
  await expect(meaning.getByTestId("verification-source-houston_transtar_speed_archive"))
    .toHaveAttribute("href", "https://traffic.houstontranstar.org/map_archive/");
  await expect(meaning.getByTestId("explanation-provider-status"))
    .toContainText("rule-based explanation");
});

test("Flood map never mislabels rain or a gage as flood extent", async ({ page }) => {
  await submitFlood(page, "2024-07-08");
  const map = await mapPanel(page);
  await expect(map.getByTestId("layer-toggle-flood_extent")).toBeEnabled();
  // ADR-0040 (Bug G): selecting the Flood hazard auto-enables its layers.
  await expect(map.getByTestId("layer-toggle-flood_extent")).toBeChecked();
  await expect(map.getByTestId("layer-toggle-gibs_precipitation")).toBeChecked();
  await expect(map.getByTestId("flood_extent-source-gap")).toHaveCount(0);
  await expect(map.getByTestId("legend-rain")).toContainText("Rain intensity is not observed flood extent");
  await expect(map.getByTestId("flood-map-coverage-label")).toHaveCount(0);
});

test("unsupported Flood coverage remains a source gap, not a safety answer", async ({ page }) => {
  await submitFlood(page, "1990-01-01");
  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("flood-mode-label")).toContainText("Outside source coverage");
  await expect(meaning.getByTestId("meaning-direct-answer")).toContainText("coverage gap");
  await expect(meaning.getByTestId("meaning-direct-answer")).not.toContainText(/safe|no flood/iu);
  const evidence = await insight(page, "evidence");
  await evidence.getByTestId("flood-evidence-details-toggle").click();
  await expect(evidence.getByTestId("flood-assessment-satellite_precipitation_visualization"))
    .toContainText("Not included in this evidence");
});

test("Flood Missions identifies background imagery separately from the exact result", async ({ page }) => {
  await submitFlood(page, "2024-07-08");
  const missions = await insight(page, "missions");
  await expect(missions.getByTestId("mission-context-note")).toContainText("not the exact observation");
  await expect(missions.getByTestId("mission-reference-details")).not.toBeVisible();
  await missions.getByTestId("flood-missions-details-toggle").click();
  await expect(missions.getByTestId("flood-missions-panel")).toContainText("GPM");
  await expect(missions.getByTestId("flood-missions-panel")).toContainText("ground monitoring source");
  await expect(missions.getByTestId("mission-reference-details")).toBeVisible();
});

test("Flood mission and Evidence selections remain linked across tabs", async ({ page }) => {
  await submitFlood(page, "2024-07-08");
  const missions = await insight(page, "missions");
  const firstMission = missions.getByTestId("mission-entry").first();
  await firstMission.getByRole("button").first().click();
  await expect(firstMission.getByRole("button").first()).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  const evidence = await insight(page, "evidence");
  await evidence.getByTestId("flood-evidence-details-toggle").click();
  const relatedObservation = evidence.locator(
    '[data-related-to-selected-mission="true"]'
  ).first();
  await expect(relatedObservation).toContainText("Related to selected mission");
  await relatedObservation.click();
  await expect(relatedObservation).toHaveAttribute("aria-pressed", "true");

  const linkedMissions = await insight(page, "missions");
  const relatedMission = linkedMissions.locator(
    '[data-testid="mission-entry"][data-related-to-selected-observation="true"]'
  ).first();
  await expect(relatedMission).toBeVisible();
  await expect(relatedMission.getByRole("button").first()).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
