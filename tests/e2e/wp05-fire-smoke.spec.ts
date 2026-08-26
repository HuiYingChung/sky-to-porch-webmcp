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
      throw new Error(`Uncontrolled external request in deterministic Fire E2E: ${url.href}`);
    }
    await route.continue();
  });
  await gotoHydrated(page, "/?dev=1");
});

async function goToAsk(page: Page) {
  const button = page.getByTestId("mobile-nav-ask");
  if (await button.isVisible()) await button.click();
}

async function selectDemo(page: Page, id: string) {
  await goToAsk(page);
  await page.getByTestId(new RegExp(`^(desktop|mobile)-gq-place-${id}$`))
    .filter({ visible: true }).click();
}

async function submitFireFixture(
  page: Page,
  options: { place?: string; concern?: string; question?: string; date?: string } = {}
) {
  await selectDemo(page, options.place ?? "demo-los-angeles");
  await page.getByTestId("hazard-select").filter({ visible: true }).selectOption("fire_smoke");
  await page.getByTestId("concern-select").filter({ visible: true })
    .selectOption(options.concern ?? "home");
  await page.getByTestId("fire-mode-select").filter({ visible: true }).selectOption("fixture");
  const date = options.date ?? "2025-01-08";
  await page.getByTestId(/^(desktop|mobile)-gq-custom-start$/).filter({ visible: true }).fill(date);
  await page.getByTestId(/^(desktop|mobile)-gq-custom-end$/).filter({ visible: true }).fill(date);
  if (options.question !== undefined) {
    await page.getByTestId("optional-question").filter({ visible: true }).fill(options.question);
  }
  const button = page.getByTestId("find-evidence-btn").filter({ visible: true });
  await expect(button).toBeEnabled();
  await button.click();
}

async function insight(page: Page, tab: "meaning" | "evidence" | "missions"): Promise<Locator> {
  const mobileInsight = page.getByTestId("mobile-nav-insight");
  if (await mobileInsight.isVisible()) await mobileInsight.click();
  const navigation = page.getByTestId("insight-navigation").filter({ visible: true });
  await navigation.getByTestId(`tab-${tab}`).click();
  return navigation.getByTestId(`panel-${tab}`);
}

test("Meaning gives a concise adaptive answer and visible truthful provider status", async ({ page }) => {
  await submitFireFixture(page);
  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("adaptive-meaning")).toBeVisible();
  await expect(meaning.getByTestId("meaning-direct-answer"))
    .toContainText("real observations were recorded");
  await expect(meaning.getByTestId("meaning-details-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(meaning.getByTestId("meaning-sections")).not.toBeVisible();
  await expect(meaning.getByTestId("explanation-provider-status"))
    .toContainText("rule-based explanation");
  await expect(meaning.getByTestId("explanation-audit")).toHaveCount(0);
  await expect(meaning.getByTestId("required-limitations")).toHaveCount(0);
});

test("blank optional question still explains the selected pets concern", async ({ page }) => {
  await submitFireFixture(page, { concern: "pets" });
  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("meaning-direct-answer")).toContainText("pets");
  await meaning.getByTestId("meaning-details-toggle").click();
  await expect(meaning.getByTestId("official-verification-sources")).toContainText("AirNow");
  await expect(meaning.getByTestId("verification-source-epa_airnow"))
    .toHaveAttribute("href", "https://www.airnow.gov/");
});

test("unsupported power-outage question names the missing official source without fabricating an answer", async ({ page }) => {
  await submitFireFixture(page, {
    concern: "power_internet",
    question: "Is there any power outage?",
  });
  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("meaning-direct-answer"))
    .toContainText(/cannot confirm.*power outage/iu);
  await expect(meaning.getByTestId("meaning-direct-answer"))
    .toContainText(/official utility outage/iu);
  await expect(meaning.getByTestId("official-verification-sources")).toHaveCount(0);
});

test("expanded details survive tab switches and reset only on a new query (ADR-0047)", async ({ page }) => {
  await submitFireFixture(page);
  const evidence = await insight(page, "evidence");
  await evidence.getByTestId("fire-evidence-details-toggle").click();
  await expect(evidence.getByTestId("fire-evidence-details-toggle"))
    .toHaveAttribute("aria-expanded", "true");

  // Switching away and back is navigation, not a reset.
  await insight(page, "meaning");
  const evidenceAgain = await insight(page, "evidence");
  await expect(evidenceAgain.getByTestId("fire-evidence-details-toggle"))
    .toHaveAttribute("aria-expanded", "true");

  // A new query is a new result; the old expansion positions reset.
  await submitFireFixture(page, { concern: "pets" });
  const evidenceNew = await insight(page, "evidence");
  await expect(evidenceNew.getByTestId("fire-evidence-summary")).toBeVisible();
  await expect(evidenceNew.getByTestId("fire-evidence-details-toggle"))
    .toHaveAttribute("aria-expanded", "false");
});

test("Evidence owns the claim audit, exact observations, provenance, and product URL", async ({ page }) => {
  await submitFireFixture(page);
  const evidence = await insight(page, "evidence");
  await expect(evidence.getByTestId("fire-evidence-summary")).toBeVisible();
  await expect(evidence.getByTestId("explanation-audit")).not.toBeVisible();
  await evidence.getByTestId("fire-evidence-details-toggle").click();
  await expect(evidence.getByTestId("explanation-audit")).toBeVisible();
  await expect(evidence.getByTestId("evidence-id")).not.toBeEmpty();
  await expect(evidence.locator('[data-testid^="observation-"]')).toHaveCount(2);
  await expect(evidence.locator('[data-testid^="obs-hash-"]')).toHaveCount(2);
  await expect(evidence.locator('[data-testid^="obs-hash-"]').first()).toHaveText(/^[a-f0-9]{64}$/iu);
  await expect(evidence.locator('[data-testid^="obs-source-url-"]').first())
    .toHaveAttribute("href", /ospo\.noaa\.gov/iu);
  await expect(evidence).not.toContainText("Official mission/product overview");
});

test("Missions is clearly background imagery, not this result's exact observation", async ({ page }) => {
  await submitFireFixture(page);
  const missions = await insight(page, "missions");
  await expect(missions.getByTestId("mission-context-note"))
    .toContainText("not the exact observation used for this result");
  await expect(missions.getByTestId("mission-reference-details")).not.toBeVisible();
  await missions.getByTestId("fire-missions-details-toggle").click();
  await expect(missions.getByTestId("mission-reference-details")).toBeVisible();
  await expect(missions.getByText("Official mission/product overview", { exact: false })).toBeVisible();
  await expect(missions).not.toContainText("Evidence ID:");
});

test("no-observation and source-failure results never become a no-danger claim", async ({ page }) => {
  await submitFireFixture(page, { place: "demo-lake-michigan" });
  let meaning = await insight(page, "meaning");
  await expect(meaning).toContainText("Missing data does not mean nothing happened");
  await expect(meaning).not.toContainText(/there is no danger|safe to/iu);

  await goToAsk(page);
  await submitFireFixture(page, { place: "demo-source-failure" });
  meaning = await insight(page, "meaning");
  await expect(meaning).toContainText("failed lookup says nothing about actual conditions");
  const evidence = await insight(page, "evidence");
  await evidence.getByTestId("fire-evidence-details-toggle").click();
  await expect(evidence.getByTestId("source-failure-zero-obs"))
    .toContainText("no stale or fallback result was substituted");
});

test("changing a deterministic query control clears the prior result", async ({ page }) => {
  await submitFireFixture(page);
  await expect((await insight(page, "meaning")).getByTestId("fire-meaning-panel")).toBeVisible();
  await goToAsk(page);
  await page.getByTestId("concern-select").filter({ visible: true }).selectOption("travel");
  const meaning = await insight(page, "meaning");
  await expect(meaning.getByTestId("fire-meaning-panel")).toHaveCount(0);
});

test("Meaning/Evidence/Missions tabs remain keyboard operable", async ({ page }) => {
  await submitFireFixture(page);
  const mobileInsight = page.getByTestId("mobile-nav-insight");
  if (await mobileInsight.isVisible()) await mobileInsight.click();
  const navigation = page.getByTestId("insight-navigation").filter({ visible: true });
  const meaningTab = navigation.getByTestId("tab-meaning");
  await meaningTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(navigation.getByTestId("tab-evidence")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(navigation.getByTestId("tab-missions")).toBeFocused();
});
