import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

const MINIMUM_FONT_SIZE_PX = 14;

type FontSizeOffender = {
  selector: string;
  text: string;
  fontSize: number;
};

async function visibleTextBelowMinimum(page: Page) {
  return page.locator("body *").evaluateAll(
    (elements, minimum): FontSizeOffender[] =>
      elements.flatMap((element) => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
          return [];
        }

        const hasDirectText = Array.from(element.childNodes).some(
          (node) =>
            node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
        );
        if (!hasDirectText || element.getClientRects().length === 0) return [];

        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number.parseFloat(style.opacity) === 0
        ) {
          return [];
        }

        const fontSize = Number.parseFloat(style.fontSize);
        if (!Number.isFinite(fontSize) || fontSize >= minimum) return [];

        const testId = element.getAttribute("data-testid");
        const id = element.id;
        return [
          {
            selector: testId
              ? `[data-testid="${testId}"]`
              : id
                ? `#${id}`
                : element.tagName.toLowerCase(),
            text: element.textContent?.trim().slice(0, 80) ?? "",
            fontSize,
          },
        ];
      }),
    MINIMUM_FONT_SIZE_PX
  );
}

test.describe("WP-03 C02 desktop resizable sidebars", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("pointer dragging independently resizes both sidebars and keeps the map usable", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");

    const queryPanel = page.locator("#desktop-query-panel");
    const insightPanel = page.locator("#desktop-insight-panel");
    const mapArea = page.getByTestId("map-area");
    const queryHandle = page.getByTestId("query-resize-handle");
    const insightHandle = page.getByTestId("insight-resize-handle");

    const initialQuery = await queryPanel.boundingBox();
    const initialInsight = await insightPanel.boundingBox();
    const queryHandleBox = await queryHandle.boundingBox();
    expect(initialQuery).not.toBeNull();
    expect(initialInsight).not.toBeNull();
    expect(queryHandleBox).not.toBeNull();
    await expect(queryHandle.getByText("↔")).toBeVisible();
    await expect(queryHandle).toHaveCSS("cursor", "col-resize");

    await page.mouse.move(
      queryHandleBox!.x + queryHandleBox!.width / 2,
      queryHandleBox!.y + 100
    );
    await page.mouse.down();
    await page.mouse.move(queryHandleBox!.x + 80, queryHandleBox!.y + 100);
    await page.mouse.up();

    await expect
      .poll(async () => (await queryPanel.boundingBox())?.width)
      .toBeGreaterThan(initialQuery!.width + 60);

    const insightHandleBox = await insightHandle.boundingBox();
    expect(insightHandleBox).not.toBeNull();
    await page.mouse.move(
      insightHandleBox!.x + insightHandleBox!.width / 2,
      insightHandleBox!.y + 100
    );
    await page.mouse.down();
    await page.mouse.move(insightHandleBox!.x - 80, insightHandleBox!.y + 100);
    await page.mouse.up();

    await expect
      .poll(async () => (await insightPanel.boundingBox())?.width)
      .toBeGreaterThan(initialInsight!.width + 60);
    await expect(mapArea).toBeVisible();

    const mapBox = await mapArea.boundingBox();
    expect(mapBox?.width).toBeGreaterThanOrEqual(320);
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("separators expose values and support Arrow, Home, and End keys", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const queryHandle = page.getByTestId("query-resize-handle");
    const insightHandle = page.getByTestId("insight-resize-handle");

    await expect(queryHandle).toHaveAttribute("role", "separator");
    await expect(queryHandle).toHaveAttribute("aria-orientation", "vertical");
    await queryHandle.focus();
    const initialQuery = Number(await queryHandle.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowRight");
    await expect(queryHandle).toHaveAttribute(
      "aria-valuenow",
      String(initialQuery + 16)
    );
    await page.keyboard.press("Home");
    await expect(queryHandle).toHaveAttribute("aria-valuenow", "240");
    await page.keyboard.press("End");
    const queryMaximum = await queryHandle.getAttribute("aria-valuemax");
    expect(queryMaximum).not.toBeNull();
    await expect(queryHandle).toHaveAttribute(
      "aria-valuenow",
      queryMaximum!
    );

    await insightHandle.focus();
    const initialInsight = Number(
      await insightHandle.getAttribute("aria-valuenow")
    );
    await page.keyboard.press("ArrowLeft");
    await expect(insightHandle).toHaveAttribute(
      "aria-valuenow",
      String(initialInsight + 16)
    );
    await page.keyboard.press("Home");
    await expect(insightHandle).toHaveAttribute("aria-valuenow", "280");
  });

  test("panel widths are re-clamped when the desktop viewport narrows", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    const queryHandle = page.getByTestId("query-resize-handle");
    const insightHandle = page.getByTestId("insight-resize-handle");

    await queryHandle.focus();
    await page.keyboard.press("End");
    await insightHandle.focus();
    await page.keyboard.press("End");
    await page.setViewportSize({ width: 1024, height: 800 });

    await expect
      .poll(async () => (await page.getByTestId("map-area").boundingBox())?.width)
      .toBeGreaterThanOrEqual(320);
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});

test.describe("WP-03 C02 minimum readable font size", () => {
  test("desktop visible text renders at 14px or larger", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHydrated(page, "/");
    expect(await visibleTextBelowMinimum(page)).toEqual([]);
  });

  test("each mobile primary view renders text at 14px or larger", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await gotoHydrated(page, "/");

    expect(await visibleTextBelowMinimum(page)).toEqual([]);
    for (const view of ["map", "insight"] as const) {
      await page.getByTestId(`mobile-nav-${view}`).click();
      expect(await visibleTextBelowMinimum(page)).toEqual([]);
    }

    await expect(page.getByTestId("query-resize-handle")).toBeHidden();
    await expect(page.getByTestId("insight-resize-handle")).toBeHidden();
  });
});

test.describe("WP-03 C03 responsive map overlays", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("selection and layer overlays never intersect at the minimum map width", async ({
    page,
  }) => {
    await gotoHydrated(page, "/");
    await page
      .getByTestId("desktop-gq-place-demo-los-angeles")
      .click();

    const queryHandle = page.getByTestId("query-resize-handle");
    const insightHandle = page.getByTestId("insight-resize-handle");
    await queryHandle.focus();
    await page.keyboard.press("End");
    await insightHandle.focus();
    await page.keyboard.press("End");

    const mapArea = page.getByTestId("map-area");
    const selectionOverlay = page.getByTestId("map-selection-overlay");
    const layerManager = page.getByTestId("layer-manager");
    await expect(mapArea).toBeVisible();
    await expect(selectionOverlay).toBeVisible();
    await expect(layerManager).toBeVisible();

    await expect
      .poll(async () => Math.round((await mapArea.boundingBox())?.width ?? 0))
      .toBe(320);

    const boxes = await page.evaluate(() => {
      const map = document.querySelector('[data-testid="map-area"]');
      const selection = document.querySelector(
        '[data-testid="map-selection-overlay"]'
      );
      const layers = document.querySelector('[data-testid="layer-manager"]');
      if (!map || !selection || !layers) return null;

      const mapBox = map.getBoundingClientRect();
      const selectionBox = selection.getBoundingClientRect();
      const layerBox = layers.getBoundingClientRect();
      const intersects = !(
        selectionBox.right <= layerBox.left ||
        layerBox.right <= selectionBox.left ||
        selectionBox.bottom <= layerBox.top ||
        layerBox.bottom <= selectionBox.top
      );

      return {
        intersects,
        map: {
          left: mapBox.left,
          right: mapBox.right,
        },
        selection: {
          left: selectionBox.left,
          right: selectionBox.right,
        },
        layers: {
          left: layerBox.left,
          right: layerBox.right,
        },
        pageOverflows:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });

    expect(boxes).not.toBeNull();
    expect(boxes!.intersects).toBe(false);
    expect(boxes!.selection.left).toBeGreaterThanOrEqual(boxes!.map.left);
    expect(boxes!.selection.right).toBeLessThanOrEqual(boxes!.map.right);
    expect(boxes!.layers.left).toBeGreaterThanOrEqual(boxes!.map.left);
    expect(boxes!.layers.right).toBeLessThanOrEqual(boxes!.map.right);
    expect(boxes!.pageOverflows).toBe(false);
  });
});
