import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "tile.openstreetmap.org") {
      await route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG });
      return;
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`Uncontrolled external request in deterministic Drought E2E: ${url.href}`);
    }
    await route.continue();
  });
  await gotoHydrated(page, "/?dev=1");
});

async function submitDrought(page: Page, concern = "community") {
  const ask = page.getByTestId("mobile-nav-ask");
  if (await ask.isVisible()) await ask.click();
  // ADR-0044: the Tucson card's drought chip selects place AND hazard in one
  // tap; drought has no default map overlays, so the run stays deterministic.
  await page.getByTestId(/^(desktop|mobile)-gq-place-demo-tucson-drought_land$/)
    .filter({ visible: true }).click();
  await page.getByTestId("concern-select").filter({ visible: true }).selectOption(concern);
  await page.getByTestId("drought-mode-select").filter({ visible: true }).selectOption("fixture");
  await page.getByTestId(/^(desktop|mobile)-gq-custom-date$/).filter({ visible: true }).fill("2024-06-04");
  await page.getByTestId("find-evidence-btn").filter({ visible: true }).click();
}

async function insight(page: Page, tab: "meaning" | "evidence" | "missions"): Promise<Locator> {
  const mobileInsight = page.getByTestId("mobile-nav-insight");
  if (await mobileInsight.isVisible()) await mobileInsight.click();
  const navigation = page.getByTestId("insight-navigation").filter({ visible: true });
  await navigation.getByTestId(`tab-${tab}`).click();
  return navigation.getByTestId(`panel-${tab}`);
}

test("Drought uses the shared CTA and adaptive Meaning for a blank question", async ({ page }) => {
  await submitDrought(page);
  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("drought-meaning-panel")).toBeVisible();
  await expect(meaning.getByTestId("adaptive-meaning")).toBeVisible();
  await expect(meaning.getByTestId("meaning-direct-answer")).toContainText("community");
  await expect(meaning.getByTestId("explanation-provider-status"))
    .toContainText("rule-based explanation");
});

test("Drought Evidence exposes observations and safe product URLs, not raw request URLs or internal IDs", async ({ page }) => {
  await submitDrought(page);
  const evidence = await insight(page, "evidence");
  await expect(evidence.getByTestId("drought-evidence-summary")).toBeVisible();
  await expect(evidence.getByTestId("explanation-audit")).not.toBeVisible();
  await evidence.getByTestId("drought-evidence-details-toggle").click();
  await expect(evidence.getByTestId("drought-observation")).toHaveCount(2);
  await expect(evidence.getByTestId("explanation-audit")).toBeVisible();
  const sourceLinks = evidence.getByText("Official dataset/product URL", { exact: false });
  await expect(sourceLinks).toHaveCount(2);
  const hrefs = await sourceLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs.join(" ")).not.toContain("?bbox=");
  expect(hrefs.join(" ")).not.toContain("apiKey");
  const visibleText = await evidence.innerText();
  expect(visibleText).not.toMatch(
    /Evidence ID|Observation ID|payload hash|\b(?:evd|obs)-[a-z0-9_-]+\b|\b[0-9a-f]{32,}\b|\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b|\.(?:csv|json|geojson|png|tiff?|kml|xml|psv|txt|zip|gz)\b/iu
  );
});

test("Drought Missions separates Terra and USDM background from this observation", async ({ page }) => {
  await submitDrought(page);
  const missions = await insight(page, "missions");
  await expect(missions.getByTestId("mission-context-note")).toContainText("not the exact observation");
  await expect(missions.getByTestId("mission-reference-details").first()).not.toBeVisible();
  await missions.getByTestId("drought-missions-details-toggle").click();
  await expect(missions.getByTestId("drought-missions-panel")).toContainText("Terra");
  await expect(missions.getByTestId("drought-missions-panel")).toContainText("U.S. Drought Monitor");
  await expect(missions.getByTestId("mission-reference-details")).toHaveCount(2);
});
