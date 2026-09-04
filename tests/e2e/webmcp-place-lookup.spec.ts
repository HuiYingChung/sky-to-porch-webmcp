import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";

interface GeocodeCandidate {
  id: string;
  label: string;
  lon: number;
  lat: number;
  boundingBox?: { west: number; south: number; east: number; north: number };
  adminContext?: Record<string, string>;
}

async function installToolRegistry(page: Page) {
  await page.addInitScript(() => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    state.__skyToPorchWebMcpTools = {};
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: async (tool: WebMCP.ModelContextTool) => {
          state.__skyToPorchWebMcpTools![tool.name] = tool;
        },
      },
    });
  });
}

async function mockPlaces(
  page: Page,
  places: Record<string, GeocodeCandidate[]>
) {
  await page.route("**/api/geocode", async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        results: body.query ? places[body.query] ?? [] : [],
      }),
    });
  });
}

async function waitForPlaceTool(page: Page) {
  await page.waitForFunction(() => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    return Boolean(state.__skyToPorchWebMcpTools?.look_up_place_location);
  });
}

test("a unique place lookup has updated the visible map before the tool returns", async ({
  page,
}, testInfo) => {
  await installToolRegistry(page);
  await mockPlaces(page, {
    Austin: [{
      id: "austin",
      label: "Austin, Texas, United States",
      lon: -97.7431,
      lat: 30.2672,
      adminContext: { city: "Austin", state: "Texas", country: "United States" },
    }],
    Houston: [{
      id: "houston",
      label: "Houston, Texas, United States",
      lon: -95.3698,
      lat: 29.7604,
      boundingBox: { west: -95.91, south: 29.52, east: -95.01, north: 30.11 },
      adminContext: { city: "Houston", state: "Texas", country: "United States" },
    }],
  });
  await gotoHydrated(page, "/");
  await waitForPlaceTool(page);

  const firstLookup = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const liveRegionBefore = document.querySelector(
      '[data-testid="agent-place-lookup-live-region"]'
    );
    const initialText = liveRegionBefore?.textContent ?? "";
    const output = await state.__skyToPorchWebMcpTools!.look_up_place_location.execute(
      { place: "Austin" },
      { signal: new AbortController().signal }
    );
    return {
      output,
      initialText,
      sameLiveRegion: liveRegionBefore === document.querySelector(
        '[data-testid="agent-place-lookup-live-region"]'
      ),
    };
  });
  expect(firstLookup).toMatchObject({
    output: { status: "success", ui_updated: true },
    initialText: "",
    sameLiveRegion: true,
  });
  await page.getByTestId("show-non-map-btn").filter({ visible: true }).click();
  await expect(page.getByTestId("show-map-btn").filter({ visible: true })).toBeVisible();

  const layerOnly = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const output = await state.__skyToPorchWebMcpTools!.set_environmental_map_layers.execute(
      { layers: { rain_satellite: false } },
      { signal: new AbortController().signal }
    );
    return {
      output,
      nonMapIsShown: Boolean([...document.querySelectorAll<HTMLElement>(
        '[data-testid="show-map-btn"]'
      )].find((element) => element.getClientRects().length > 0)),
    };
  });
  expect(layerOnly).toMatchObject({
    output: { status: "success", ui_updated: true },
    nonMapIsShown: true,
  });

  const immediate = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools!.look_up_place_location;
    const output = await tool.execute(
      { place: "Houston" },
      { signal: new AbortController().signal }
    );
    const notice = document.querySelector<HTMLElement>(
      '[data-testid="agent-place-lookup-notice"]'
    );
    const visibleText = (testId: string) => [...document.querySelectorAll<HTMLElement>(
      `[data-testid="${testId}"]`
    )].find((element) => element.getClientRects().length > 0)?.textContent ?? "";
    return {
      output,
      noticeStatus: notice?.dataset.status ?? "",
      noticeText: notice?.textContent ?? "",
      visibleSelection: visibleText("selection-summary"),
      mapIsShown: Boolean([...document.querySelectorAll<HTMLElement>(
        '[data-testid="show-non-map-btn"]'
      )].find((element) => element.getClientRects().length > 0)),
      nonMapIsShown: Boolean([...document.querySelectorAll<HTMLElement>(
        '[data-testid="show-map-btn"]'
      )].find((element) => element.getClientRects().length > 0)),
      readOnlyHint: tool.annotations?.readOnlyHint,
    };
  });

  expect(immediate.output).toMatchObject({
    status: "success",
    ui_updated: true,
    map_updated: true,
    canonical_label: "Houston, Texas, United States",
  });
  expect(immediate).toMatchObject({
    noticeStatus: "success",
    mapIsShown: true,
    nonMapIsShown: false,
    readOnlyHint: false,
  });
  expect(immediate.noticeText).toContain("Map moved to this place");
  expect(immediate.noticeText).toContain("Houston, Texas, United States");
  expect(immediate.noticeText).toContain("Latitude 29.7604, longitude -95.3698");
  expect(immediate.visibleSelection).toContain("Houston, Texas, United States");
  expect(`${immediate.noticeText} ${immediate.visibleSelection}`).not.toMatch(
    /choice_id|WGS84|revision|schema|OSM search|\blon\b|\blat\b/iu
  );

  const repeatedAnnouncement = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const liveRegionBefore = document.querySelector<HTMLElement>(
      '[data-testid="agent-place-lookup-live-region"]'
    );
    const activeSlotBefore = liveRegionBefore?.querySelector<HTMLElement>(
      '[data-announcement-slot]:not(:empty)'
    )?.dataset.announcementSlot ?? "";
    const textBefore = liveRegionBefore?.textContent ?? "";
    const output = await state.__skyToPorchWebMcpTools!.look_up_place_location.execute(
      { place: "Houston" },
      { signal: new AbortController().signal }
    );
    const liveRegionAfter = document.querySelector<HTMLElement>(
      '[data-testid="agent-place-lookup-live-region"]'
    );
    return {
      output,
      sameLiveRegion: liveRegionBefore === liveRegionAfter,
      activeSlotBefore,
      activeSlotAfter: liveRegionAfter?.querySelector<HTMLElement>(
        '[data-announcement-slot]:not(:empty)'
      )?.dataset.announcementSlot ?? "",
      textBefore,
      textAfter: liveRegionAfter?.textContent ?? "",
    };
  });
  expect(repeatedAnnouncement).toMatchObject({
    output: {
      status: "success",
      ui_updated: true,
      selection_updated: false,
      analysis_cleared: false,
    },
    sameLiveRegion: true,
  });
  expect(repeatedAnnouncement.activeSlotAfter).not.toBe(
    repeatedAnnouncement.activeSlotBefore
  );
  expect(repeatedAnnouncement.textAfter).toBe(repeatedAnnouncement.textBefore);

  if (testInfo.project.name === "chromium-mobile") {
    await expect(page.getByTestId("mobile-nav-map")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  }
});

test("ambiguous and failed lookups are visible but leave the current map in place", async ({
  page,
}) => {
  await installToolRegistry(page);
  const springfields: GeocodeCandidate[] = [
    ["il", "Illinois", -89.65, 39.78],
    ["mo", "Missouri", -93.29, 37.21],
    ["ma", "Massachusetts", -72.59, 42.1],
    ["or", "Oregon", -123.02, 44.05],
    ["oh", "Ohio", -83.81, 39.92],
  ].map(([id, state, lon, lat]) => ({
    id: `springfield-${id}`,
    label: `Springfield, ${state}, United States`,
    lon: lon as number,
    lat: lat as number,
    boundingBox: {
      west: (lon as number) - 0.15,
      south: (lat as number) - 0.1,
      east: (lon as number) + 0.15,
      north: (lat as number) + 0.1,
    },
    adminContext: { city: "Springfield", state: state as string, country: "United States" },
  }));
  await mockPlaces(page, {
    Austin: [{
      id: "austin",
      label: "Austin, Texas, United States",
      lon: -97.7431,
      lat: 30.2672,
      adminContext: { city: "Austin", state: "Texas", country: "United States" },
    }],
    Springfield: springfields,
    Nowhere: [],
  });
  await gotoHydrated(page, "/");
  await waitForPlaceTool(page);

  const result = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools!.look_up_place_location;
    await tool.execute({ place: "Austin" }, { signal: new AbortController().signal });
    const selectionText = () => [...document.querySelectorAll<HTMLElement>(
      '[data-testid="selection-summary"]'
    )].find((element) => element.getClientRects().length > 0)?.textContent ?? "";
    const before = selectionText();
    const output = await tool.execute(
      { place: "Springfield" },
      { signal: new AbortController().signal }
    );
    const notice = document.querySelector<HTMLElement>(
      '[data-testid="agent-place-lookup-notice"]'
    );
    const noticeFonts = notice
      ? [notice, ...notice.querySelectorAll<HTMLElement>("*")]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
      : [];
    return {
      output,
      before,
      after: selectionText(),
      noticeStatus: notice?.dataset.status ?? "",
      noticeText: notice?.textContent ?? "",
      choiceCount: notice?.querySelectorAll("li[data-choice-id]").length ?? 0,
      smallestNoticeFontPx: noticeFonts.length > 0 ? Math.min(...noticeFonts) : 0,
    };
  });

  expect(result.output).toMatchObject({
    status: "needs_place_choice",
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
  });
  expect(result.noticeStatus).toBe("needs_place_choice");
  expect(result.choiceCount).toBe(5);
  expect(result.smallestNoticeFontPx).toBeGreaterThanOrEqual(14);
  expect(result.after).toBe(result.before);
  expect(result.noticeText).toContain("Which place did you mean?");
  expect(result.noticeText).toContain("Coordinates:");
  expect(result.noticeText).toContain("Located in:");
  expect(result.noticeText).toContain("Approximate area:");
  for (const candidate of springfields) {
    expect(result.noticeText).toContain(candidate.label);
  }
  expect(result.noticeText).not.toMatch(
    /PAUSE FOR USER|choice_id|Choice ID|WGS84|revision|schema/iu
  );

  const failure = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools!.look_up_place_location;
    const output = await tool.execute(
      { place: "Nowhere" },
      { signal: new AbortController().signal }
    );
    const notice = document.querySelector<HTMLElement>(
      '[data-testid="agent-place-lookup-notice"]'
    );
    const selection = [...document.querySelectorAll<HTMLElement>(
      '[data-testid="selection-summary"]'
    )].find((element) => element.getClientRects().length > 0)?.textContent ?? "";
    return {
      output,
      selection,
      noticeStatus: notice?.dataset.status ?? "",
      noticeText: notice?.textContent ?? "",
    };
  });

  expect(failure.output).toMatchObject({
    status: "place_not_found",
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
  });
  expect(failure.noticeStatus).toBe("place_not_found");
  expect(failure.noticeText).toContain("We couldn’t find a place matching");
  expect(failure.selection).toBe(result.before);
});
