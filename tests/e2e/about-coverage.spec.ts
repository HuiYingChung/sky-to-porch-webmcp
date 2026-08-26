import { expect, test, type Locator } from "@playwright/test";
import { gotoHydrated } from "./helpers";

async function expectSingleAboutScrollOwner(dialog: Locator): Promise<void> {
  expect(await dialog.evaluate((element) => {
    const frame = element.querySelector<HTMLElement>(".about-dialog-frame");
    const picker = element.querySelector<HTMLElement>(".about-section-picker");
    const content = element.querySelector<HTMLElement>(".about-dialog-content");
    if (!frame || !picker || !content) {
      throw new Error("About layout regions are missing");
    }

    return {
      dialogHasVerticalOverflow: element.scrollHeight > element.clientHeight + 1,
      frameHasVerticalOverflow: frame.scrollHeight > frame.clientHeight + 1,
      pickerHasHorizontalOverflow: picker.scrollWidth > picker.clientWidth + 1,
      contentHasHorizontalOverflow: content.scrollWidth > content.clientWidth + 1,
    };
  })).toEqual({
    dialogHasVerticalOverflow: false,
    frameHasVerticalOverflow: false,
    pickerHasHorizontalOverflow: false,
    contentHasHorizontalOverflow: false,
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
  await gotoHydrated(page, "/?dev=1");
});

test("About keeps coverage compact and exposes Satellite data with keyboard-safe dismissal", async ({ page }) => {
  const aboutButton = page.getByRole("button", { name: "About" }).filter({ visible: true });
  await aboutButton.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "About Sky to Porch" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("It does not mean no danger");
  await expect(dialog).toContainText("Current primary gaps");
  await expect(dialog.locator(".about-hazard-card")).toHaveCount(6);
  await expect(dialog.locator(".about-hazard-card[open]")).toHaveCount(0);

  // ADR-0047: bulk expand/collapse drives every card; per-card toggling
  // (asserted further down) must keep working afterwards.
  await dialog.getByTestId("about-expand-all").click();
  await expect(dialog.locator(".about-hazard-card[open]")).toHaveCount(6);
  await dialog.getByTestId("about-collapse-all").click();
  await expect(dialog.locator(".about-hazard-card[open]")).toHaveCount(0);
  await expectSingleAboutScrollOwner(dialog);
  expect(await dialog.evaluate((element) => {
    const visible = [element, ...Array.from(element.querySelectorAll("*"))].filter((node) => {
      const html = node as HTMLElement;
      const style = getComputedStyle(html);
      return style.visibility !== "hidden" && style.display !== "none" && html.getClientRects().length > 0;
    }) as HTMLElement[];
    return visible
      // ADR-0053: the colophon is an owner-granted 12px exception so it
      // reads as an annotation. Everything else still holds the 14px floor.
      .filter((node) => !node.closest(".about-colophon"))
      .filter((node) => node.textContent?.trim() && Number.parseFloat(getComputedStyle(node).fontSize) < 14)
      .map((node) => `${node.tagName}:${getComputedStyle(node).fontSize}`);
  })).toEqual([]);
  // The exception is 12px exactly, not "anything smaller is fine".
  expect(await dialog.evaluate((element) => {
    const paragraphs = Array.from(
      element.querySelectorAll(".about-colophon p")
    ) as HTMLElement[];
    return paragraphs.map((node) => getComputedStyle(node).fontSize);
  })).toEqual(["12px", "12px"]);

  const fireCard = dialog.locator(".about-hazard-card").nth(0);
  const floodCard = dialog.locator(".about-hazard-card").nth(1);
  const collapsedFloodHeight = await floodCard.evaluate((element) => element.getBoundingClientRect().height);
  await fireCard.locator(":scope > summary").click();
  await expect(fireCard).toHaveAttribute("open", "");
  const expandedLayout = await Promise.all([
    fireCard.evaluate((element) => element.getBoundingClientRect().width),
    floodCard.evaluate((element) => element.getBoundingClientRect().width),
    floodCard.evaluate((element) => element.getBoundingClientRect().height),
  ]);
  if ((page.viewportSize()?.width ?? 0) > 720) {
    expect(expandedLayout[0]).toBeGreaterThan(expandedLayout[1] * 1.8);
  } else {
    expect(Math.abs(expandedLayout[0] - expandedLayout[1])).toBeLessThan(1);
  }
  expect(expandedLayout[2]).toBe(collapsedFloodHeight);

  await dialog.getByRole("button", { name: "Satellite data" }).click();
  await expect(dialog).toContainText("Satellite data is a separate evidence category");
  await expect(dialog.locator('[data-source-id="nasa_gibs_modis_ndvi_16day"]')).toBeVisible();
  await expect(dialog.locator('[data-source-id="usgs_instantaneous_values"]')).toHaveCount(0);
  await expectSingleAboutScrollOwner(dialog);

  await dialog.getByRole("button", { name: "North America" }).click();
  await expect(dialog).toContainText("North America is the first coverage target");
  await expect(dialog.locator('[data-source-id="canada_geomet"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(aboutButton).toBeFocused();
});
