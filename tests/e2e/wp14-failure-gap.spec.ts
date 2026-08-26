import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function openApp(page: Page, osmStatus = 200) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "tile.openstreetmap.org") {
      await route.fulfill({
        status: osmStatus,
        contentType: osmStatus === 200 ? "image/png" : "text/plain",
        body: osmStatus === 200 ? TRANSPARENT_PNG : "deterministic tile failure",
      });
      return;
    }
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`Uncontrolled external request in deterministic WP-14 E2E: ${url.href}`);
    }
    await route.continue();
  });
  await gotoHydrated(page, "/?dev=1");
}

async function goToAsk(page: Page) {
  const button = page.getByTestId("mobile-nav-ask");
  if (await button.isVisible()) await button.click();
}

async function goToMap(page: Page): Promise<Locator> {
  const button = page.getByTestId("mobile-nav-map");
  if (await button.isVisible()) await button.click();
  return page.getByTestId("analysis-map").filter({ visible: true });
}

async function goToInsight(page: Page, tab: "meaning" | "evidence" | "missions") {
  const button = page.getByTestId("mobile-nav-insight");
  if (await button.isVisible()) await button.click();
  const navigation = page.getByTestId("insight-navigation").filter({ visible: true });
  await navigation.getByTestId(`tab-${tab}`).click();
  return navigation.getByTestId(`panel-${tab}`);
}

async function submitDrought(page: Page, date: string) {
  await goToAsk(page);
  // ADR-0044: the Tucson card's drought chip selects place AND hazard in one
  // tap; drought has no default map overlays, so the run stays deterministic.
  await page.getByTestId(/^(desktop|mobile)-gq-place-demo-tucson-drought_land$/)
    .filter({ visible: true }).click();
  await page.getByTestId("concern-select").filter({ visible: true }).selectOption("community");
  await page.getByTestId("drought-mode-select").filter({ visible: true }).selectOption("fixture");
  await page.getByTestId(/^(desktop|mobile)-gq-custom-date$/).filter({ visible: true }).fill(date);
  await page.getByTestId("find-evidence-btn").filter({ visible: true }).click();
}

async function submitFireFailure(page: Page) {
  await goToAsk(page);
  await page.getByTestId(/^(desktop|mobile)-gq-place-demo-source-failure$/)
    .filter({ visible: true }).click();
  await page.getByTestId("hazard-select").filter({ visible: true }).selectOption("fire_smoke");
  await page.getByTestId("concern-select").filter({ visible: true }).selectOption("home");
  await page.getByTestId("fire-mode-select").filter({ visible: true }).selectOption("fixture");
  await page.getByTestId(/^(desktop|mobile)-gq-custom-start$/)
    .filter({ visible: true }).fill("2025-01-08");
  await page.getByTestId(/^(desktop|mobile)-gq-custom-end$/)
    .filter({ visible: true }).fill("2025-01-08");
  await page.getByTestId("find-evidence-btn").filter({ visible: true }).click();
}

test("validated fixture evidence stays primary and is visibly non-live", async ({ page }) => {
  await openApp(page);
  await submitDrought(page, "2024-06-04");
  const evidence = await goToInsight(page, "evidence");
  const boundary = evidence.getByTestId("result-failure-gap-boundary");

  await expect(boundary.getByTestId("drought-evidence-summary")).toContainText(
    "2 validated observations"
  );
  await expect(boundary.getByTestId("drought-source-outcomes")).toContainText(
    "NASA GIBS succeeded; U.S. Drought Monitor succeeded"
  );
  await expect(boundary.getByTestId("failure-gap-status")).toHaveAttribute(
    "data-failure-gap-kind",
    "demo_fixture"
  );
  await expect(boundary).toContainText("Demo fixture — not live data");
  await expect(boundary).toContainText(
    "A demo fixture is never silently substituted for a failed live request."
  );
  const directChildren = await boundary.evaluate((element) =>
    Array.from(element.children).map((child) => child.getAttribute("data-testid"))
  );
  expect(directChildren).toEqual([
    "drought-evidence-panel",
    "result-failure-gap-statuses",
  ]);
});

test("a failed lookup names failed sources and never becomes a safety claim", async ({ page }) => {
  await openApp(page);
  await submitFireFailure(page);
  const evidence = await goToInsight(page, "evidence");
  const boundary = evidence.getByTestId("result-failure-gap-boundary");

  await expect(boundary.getByTestId("failure-gap-status")).toHaveAttribute(
    "data-failure-gap-kind",
    "source_failure"
  );
  const directChildren = await boundary.evaluate((element) =>
    Array.from(element.children).map((child) => child.getAttribute("data-testid"))
  );
  expect(directChildren[0]).toBe("result-failure-gap-statuses");
  await boundary.getByTestId("fire-evidence-details-toggle").click();
  await expect(boundary).toContainText("No data was retrieved from NOAA HMS");
  await expect(boundary.getByTestId("source-failure-zero-obs")).toContainText(
    "no stale or fallback result was substituted"
  );
  await expect(boundary).toContainText("does not mean no hazard");
  await expect(boundary).not.toContainText(/there is no danger|safe to return|all clear/iu);
});

test("basemap failure offers and completes the non-map recovery path", async ({ page }) => {
  await openApp(page, 503);
  const map = await goToMap(page);
  const error = map.getByTestId("map-tile-error");

  await expect(error).toBeVisible();
  await expect(error.getByTestId("failure-gap-status")).toHaveAttribute(
    "data-failure-gap-kind",
    "map_failure"
  );
  await error.getByTestId("failure-gap-recovery").click();
  await expect(map.getByTestId("non-map-selection")).toBeVisible();
  await expect(map.getByTestId("non-map-selection")).toContainText("No area is selected");
});
