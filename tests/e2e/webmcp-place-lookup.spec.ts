import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
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
  places: Record<string, GeocodeCandidate[]>,
  failures: Record<string, { status: number; body: unknown }> = {}
) {
  await page.route("**/api/geocode", async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    const failure = body.query ? failures[body.query] : undefined;
    if (failure) {
      await route.fulfill({
        status: failure.status,
        contentType: "application/json",
        body: JSON.stringify(failure.body),
      });
      return;
    }
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

test("pending and replaced place searches are visibly announced", async ({ page }) => {
  await installToolRegistry(page);
  const pendingRoutes = new Map<string, Route>();
  await page.route("**/api/geocode", async (route) => {
    const body = route.request().postDataJSON() as { query: string };
    pendingRoutes.set(body.query, route);
  });
  await gotoHydrated(page, "/");
  await waitForPlaceTool(page);

  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
      __pendingPlaceLookups?: Record<string, Promise<unknown>>;
    };
    const tool = state.__skyToPorchWebMcpTools!.look_up_place_location;
    state.__pendingPlaceLookups = {
      older: Promise.resolve(tool.execute(
        { place: "Slowtown" },
        { signal: new AbortController().signal }
      )),
    };
  });
  const notice = page.getByTestId("agent-place-lookup-notice");
  await expect(notice).toHaveAttribute("data-status", "lookup_pending");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Finding the place");
  await expect(notice).toContainText("current map and results stay in place");
  await expect.poll(() => pendingRoutes.has("Slowtown")).toBe(true);

  await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
      __pendingPlaceLookups?: Record<string, Promise<unknown>>;
    };
    const tool = state.__skyToPorchWebMcpTools!.look_up_place_location;
    state.__pendingPlaceLookups!.newer = Promise.resolve(tool.execute(
      { place: "Newtown" },
      { signal: new AbortController().signal }
    ));
  });
  await expect(notice).toHaveAttribute("data-status", "lookup_pending");
  await expect(notice).toContainText("The earlier search for “Slowtown” stopped");
  await expect(notice).toContainText("this newer request took its place");
  expect(await notice.textContent()).not.toMatch(
    /choice_id|place-[A-Za-z0-9._-]+|\.tsx?:\d+|sha256|[a-f0-9]{32,}/iu
  );
  await expect.poll(() => pendingRoutes.has("Newtown")).toBe(true);

  await pendingRoutes.get("Newtown")!.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      results: [{
        id: "internal-newtown-550e8400-e29b-41d4-a716-446655440000",
        label: "Newtown, Texas, United States",
        lon: -97.1,
        lat: 30.1,
      }],
    }),
  });
  await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __pendingPlaceLookups?: Record<string, Promise<unknown>>;
    };
    await state.__pendingPlaceLookups!.newer;
  });

  await pendingRoutes.get("Slowtown")!.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      results: [{
        id: "internal-slowtown-result",
        label: "Slowtown, Texas, United States",
        lon: -98.1,
        lat: 31.1,
      }],
    }),
  });
  const olderOutput = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __pendingPlaceLookups?: Record<string, Promise<unknown>>;
    };
    return state.__pendingPlaceLookups!.older;
  });
  expect(olderOutput).toMatchObject({ status: "superseded", ui_updated: false });
  await expect(page.getByTestId("agent-place-lookup-notice"))
    .toHaveAttribute("data-status", "success");
});

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
    const pendingOutput = Promise.resolve(
      state.__skyToPorchWebMcpTools!.look_up_place_location.execute(
        { place: "Houston" },
        { signal: new AbortController().signal }
      )
    );
    const liveRegionPending = document.querySelector<HTMLElement>(
      '[data-testid="agent-place-lookup-live-region"]'
    );
    const activeSlotPending = liveRegionPending?.querySelector<HTMLElement>(
      '[data-announcement-slot]:not(:empty)'
    )?.dataset.announcementSlot ?? "";
    const pendingText = liveRegionPending?.textContent ?? "";
    const output = await pendingOutput;
    const liveRegionAfter = document.querySelector<HTMLElement>(
      '[data-testid="agent-place-lookup-live-region"]'
    );
    return {
      output,
      sameLiveRegion: liveRegionBefore === liveRegionAfter,
      activeSlotBefore,
      activeSlotPending,
      activeSlotAfter: liveRegionAfter?.querySelector<HTMLElement>(
        '[data-announcement-slot]:not(:empty)'
      )?.dataset.announcementSlot ?? "",
      textBefore,
      pendingText,
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
  expect(repeatedAnnouncement.activeSlotPending).not.toBe(
    repeatedAnnouncement.activeSlotBefore
  );
  expect(repeatedAnnouncement.pendingText).toContain("Finding the place");
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
}, testInfo) => {
  await installToolRegistry(page);
  const springfields: GeocodeCandidate[] = [
    ["il", "Illinois", -89.65, 39.78],
    ["mo", "Missouri", -93.29, 37.21],
    ["ma", "Massachusetts", -72.59, 42.1],
    ["or", "Oregon", -123.02, 44.05],
    ["oh", "Ohio", -83.81, 39.92],
    ["vt", "Vermont", -72.58, 44.26],
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
  }, {
    "Broken Place": {
      status: 500,
      body: {
        ok: false,
        error: "C:\\srv\\geocode-handler.ts:77 550e8400-e29b-41d4-a716-446655440000 sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
    },
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
      choiceTexts: [...(notice?.querySelectorAll<HTMLElement>("li[data-choice-id]") ?? [])]
        .map((choice) => choice.textContent ?? ""),
      smallestNoticeFontPx: noticeFonts.length > 0 ? Math.min(...noticeFonts) : 0,
      noticeVisible: Boolean(notice?.getClientRects().length),
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      noticeLeft: notice?.getBoundingClientRect().left ?? -1,
      noticeRight: notice?.getBoundingClientRect().right ?? -1,
      noticeOverflowY: notice ? getComputedStyle(notice).overflowY : "",
      noticeScrollHeight: notice?.scrollHeight ?? 0,
      noticeClientHeight: notice?.clientHeight ?? 0,
    };
  });

  expect(result.output).toMatchObject({
    status: "needs_place_choice",
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
  });
  expect(result.noticeStatus).toBe("needs_place_choice");
  expect(result.noticeVisible).toBe(true);
  expect(result.choiceCount).toBe(5);
  expect(result.smallestNoticeFontPx).toBeGreaterThanOrEqual(14);
  expect(result.after).toBe(result.before);
  expect(result.noticeText).toContain("Which place did you mean?");
  expect(result.noticeText).toContain("Coordinates:");
  expect(result.noticeText).toContain("Located in:");
  expect(result.noticeText).toContain("Approximate area:");
  for (const [index, candidate] of springfields.slice(0, 5).entries()) {
    expect(result.choiceTexts[index]).toContain(candidate.label);
    expect(result.choiceTexts[index]).toContain("Coordinates:");
    expect(result.choiceTexts[index]).toContain("Located in:");
    expect(result.choiceTexts[index]).toContain("Approximate area:");
    expect(result.noticeText).not.toContain(candidate.id);
  }
  expect(result.noticeText).not.toContain(springfields[5].label);
  expect(result.noticeText).not.toContain(springfields[5].id);
  expect(result.noticeText).not.toMatch(
    /PAUSE FOR USER|choice_id|Choice ID|place-[A-Za-z0-9._-]+|WGS84|revision|schema|\.tsx?:\d+|sha256|[a-f0-9]{32,}/iu
  );

  if (testInfo.project.name === "chromium-mobile") {
    expect(result.documentScrollWidth).toBeLessThanOrEqual(result.viewportWidth);
    expect(result.bodyScrollWidth).toBeLessThanOrEqual(result.viewportWidth);
    expect(result.noticeLeft).toBeGreaterThanOrEqual(0);
    expect(result.noticeRight).toBeLessThanOrEqual(result.viewportWidth);
    expect(result.noticeOverflowY).toBe("auto");
    expect(result.noticeScrollHeight).toBeGreaterThan(result.noticeClientHeight);
    const scrollTop = await page.getByTestId("agent-place-lookup-notice").evaluate(
      (notice) => {
        notice.scrollTop = notice.scrollHeight;
        return notice.scrollTop;
      }
    );
    expect(scrollTop).toBeGreaterThan(0);
  }

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
      noticeVisible: Boolean(notice?.getClientRects().length),
    };
  });

  expect(failure.output).toMatchObject({
    status: "place_not_found",
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
  });
  expect(failure.noticeStatus).toBe("place_not_found");
  expect(failure.noticeVisible).toBe(true);
  expect(failure.noticeText).toContain("We couldn’t find a place matching");
  expect(failure.selection).toBe(result.before);

  const unavailable = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const output = await state.__skyToPorchWebMcpTools!.look_up_place_location.execute(
      { place: "Broken Place" },
      { signal: new AbortController().signal }
    );
    const notice = document.querySelector<HTMLElement>(
      '[data-testid="agent-place-lookup-notice"]'
    );
    return {
      output,
      noticeStatus: notice?.dataset.status ?? "",
      noticeText: notice?.textContent ?? "",
      noticeVisible: Boolean(notice?.getClientRects().length),
    };
  });
  expect(unavailable.output).toMatchObject({
    status: "place_lookup_failed",
    ui_updated: true,
    map_updated: false,
    map_unchanged: true,
  });
  expect(unavailable).toMatchObject({
    noticeStatus: "place_lookup_failed",
    noticeVisible: true,
  });
  expect(unavailable.noticeText).toContain("Place search isn’t available right now");
  expect(unavailable.noticeText).not.toMatch(
    /geocode-handler\.ts|550e8400-e29b-41d4-a716-446655440000|0123456789abcdef|sha256/iu
  );
});
