import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./helpers";

test("shows a neutral waiting status while WebMCP tools are still registering", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: () => new Promise<void>(() => {}),
      },
    });
  });

  await gotoHydrated(page, "/");
  const agentStatus = page.locator('[data-testid="webmcp-status"]:visible');
  await expect(agentStatus).toHaveText("Waiting for Agent");
  await expect(agentStatus).toHaveAttribute("data-status", "registering");
  await expect(agentStatus).toHaveCSS("color", "rgb(139, 148, 158)");
  await expect(agentStatus).toHaveCSS("border-width", "0px");
  await expect(agentStatus).toHaveCSS("border-radius", "0px");
  await expect(agentStatus).toHaveCSS("padding", "0px");
});

test("registers WebMCP and shares an agent analysis with the visible product", async ({
  page,
}, testInfo) => {
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

  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/fire/query", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          kind: "unsupported_place",
          rejectionReason: "Deterministic WebMCP E2E boundary.",
        },
      }),
    });
  });

  await gotoHydrated(page, "/");
  const agentStatus = page.locator('[data-testid="webmcp-status"]:visible');
  await expect(agentStatus).toHaveText("Agent ready");
  await expect(agentStatus).toHaveAttribute("data-status", "ready");
  await expect(agentStatus).toHaveCSS("color", "rgb(63, 185, 80)");
  await expect(agentStatus).toHaveCSS("border-width", "0px");
  await expect(agentStatus).toHaveCSS("border-radius", "0px");
  await expect(agentStatus).toHaveCSS("padding", "0px");

  const registered = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tools = state.__skyToPorchWebMcpTools;
    const analysisTool = tools?.analyze_environmental_hazard;
    const listTool = tools?.list_environmental_hazards;
    const coverageTool = tools?.get_environmental_source_coverage;
    if (!analysisTool || !listTool || !coverageTool) return null;
    const options = { signal: new AbortController().signal };
    return {
      names: Object.keys(tools),
      analysisAnnotations: analysisTool.annotations,
      hazardCatalog: await listTool.execute({}, options),
      coverageCatalog: await coverageTool.execute({ hazard: "air_quality" }, options),
    };
  });
  expect(registered).toMatchObject({
    names: [
      "analyze_environmental_hazard",
      "list_environmental_hazards",
      "get_environmental_source_coverage",
    ],
    analysisAnnotations: { readOnlyHint: false, untrustedContentHint: true },
    hazardCatalog: {
      status: "hazard_catalog",
      ui_updated: false,
    },
    coverageCatalog: {
      status: "coverage_catalog",
      hazard: "air_quality",
      coverage_scope: "pipeline_eligibility_not_observation",
      live_sources_queried: false,
      actual_observation_not_established: true,
    },
  });

  const executeAgentAnalysis = async (input: {
    place: string;
    latitude: number;
    longitude: number;
  }) => page.evaluate(async (agentInput) => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools?.analyze_environmental_hazard;
    if (!tool) throw new Error("WebMCP analysis tool was not registered");
    return tool.execute(
      {
        place: agentInput.place,
        hazard: "fire_smoke",
        analysis_scope: "single_hazard_only",
        concern: "pets",
        latitude: agentInput.latitude,
        longitude: agentInput.longitude,
        radius_km: 15,
      },
      { signal: new AbortController().signal }
    );
  }, input) as Promise<Record<string, unknown>>;

  const output = await executeAgentAnalysis({
    place: "Tucson, Arizona",
    latitude: 32.2226,
    longitude: -110.9747,
  });

  expect(output).toMatchObject({
    status: "unsupported_place",
    ui_updated: true,
    no_data_is_not_no_danger: true,
    request: {
      hazard: "fire_smoke",
      concern: "pets",
      radius_km: 15,
    },
  });
  expect(JSON.stringify(output).length).toBeLessThanOrEqual(1_500);
  expect(requestBody).toMatchObject({
    placeId: "custom-area",
    mode: "live",
    concern: "pets",
    time: { kind: "latest", days: 1 },
  });

  const visibleReceipt = page.locator('[data-testid="agent-analysis-notice"]:visible');
  await expect(visibleReceipt)
    .toContainText("Agent updated this view");
  await expect(visibleReceipt.getByTestId("agent-analysis-receipt"))
    .toContainText("Fire & Smoke · Tucson, Arizona · Latest available data");
  await expect(visibleReceipt.getByTestId("agent-restore-previous")).toHaveCount(0);

  const visibleInsight = page.locator('[data-testid="insight-navigation"]:visible');
  await expect(visibleInsight.getByTestId("analysis-trust-strip"))
    .toContainText("Source coverage unavailable · 0 sources · 1 limitation");
  await expect(visibleInsight.getByTestId("analysis-no-danger-reminder"))
    .toContainText("does not mean no danger");
  await visibleReceipt.getByTestId("agent-view-evidence").click();
  await expect(visibleInsight.getByTestId("tab-evidence"))
    .toHaveAttribute("aria-selected", "true");
  await visibleInsight.getByTestId("tab-meaning").click();

  await expect(page.locator(
    '[data-testid="map-area"] [data-testid="selection-summary"]'
  )).toHaveAttribute("data-selection-method", "agent_coordinate");

  await executeAgentAnalysis({
    place: "Phoenix, Arizona",
    latitude: 33.4484,
    longitude: -112.074,
  });
  await expect(visibleReceipt.getByTestId("agent-analysis-receipt"))
    .toContainText("Phoenix, Arizona");
  await expect(visibleReceipt.getByTestId("agent-restore-previous"))
    .toBeVisible();
  await visibleReceipt.getByTestId("agent-restore-previous").click();
  await expect(visibleReceipt.getByTestId("agent-analysis-receipt"))
    .toContainText("Tucson, Arizona");
  await expect(visibleReceipt.getByTestId("agent-restore-previous")).toHaveCount(0);
  await expect(page.locator(
    '[data-testid="map-area"] [data-testid="selection-summary"]'
  )).toContainText("Tucson, Arizona");

  if (testInfo.project.name === "chromium-mobile") {
    await expect(page.getByTestId("mobile-nav-insight")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  }
});

test("related-context scope automatically checks heat and drought as separate visible chains", async ({
  page,
}) => {
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

  const queriedHazards: string[] = [];
  await page.route("**/api/drought/query", async (route) => {
    queriedHazards.push("drought_land");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          kind: "unsupported_coverage",
          sourceOutcomes: {},
          rejectionReason: "Deterministic drought context boundary.",
        },
      }),
    });
  });
  await page.route("**/api/heat/query", async (route) => {
    queriedHazards.push("extreme_heat");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          kind: "unsupported_coverage",
          rejectionReason: "Deterministic heat context boundary.",
        },
      }),
    });
  });

  await gotoHydrated(page, "/");
  await expect(page.locator('[data-testid="webmcp-status"]:visible'))
    .toHaveText("Agent ready");

  const output = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools?.analyze_environmental_hazard;
    if (!tool) throw new Error("WebMCP analysis tool was not registered");
    return tool.execute(
      {
        place: "Phoenix, Arizona",
        hazard: "extreme_heat",
        concern: "health",
        latitude: 33.4484,
        longitude: -112.074,
        question: "How could heat and persistent dry conditions affect me?",
      },
      { signal: new AbortController().signal }
    );
  }) as Record<string, unknown>;

  expect(queriedHazards).toHaveLength(2);
  expect(queriedHazards).toEqual(expect.arrayContaining(["drought_land", "extreme_heat"]));
  expect(output).toMatchObject({
    status: "related_environmental_evidence_bundle",
    relationship: "co_occurring_context_not_causation",
    included_chains: ["drought_land", "extreme_heat"],
  });
  expect(JSON.stringify(output).length).toBeLessThanOrEqual(1_500);

  const visibleReceipt = page.locator('[data-testid="agent-analysis-notice"]:visible');
  await expect(visibleReceipt.getByTestId("agent-analysis-receipt"))
    .toContainText("Extreme Heat · Phoenix, Arizona");
  await expect(visibleReceipt.getByTestId("agent-related-context-receipt"))
    .toContainText("Drought & Land");
  await expect(visibleReceipt.getByTestId("agent-related-context-receipt"))
    .toContainText("co-occurrence is not causation");

  const visibleInsight = page.locator('[data-testid="insight-navigation"]:visible');
  await expect(visibleInsight.getByTestId("related-drought_land-evidence-chain"))
    .toContainText("Collected automatically under related-context scope");
  await expect(visibleInsight.getByTestId("related-drought_land-evidence-chain"))
    .toContainText("co-occurrence does not establish");
});

test("volcano related context automatically adds separate air-quality and heat chains", async ({
  page,
}) => {
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

  const queriedHazards: string[] = [];
  for (const [path, hazardId] of [
    ["**/api/air/query", "air_quality"],
    ["**/api/volcano/query", "earth_volcanoes"],
  ] as const) {
    await page.route(path, async (route) => {
      queriedHazards.push(hazardId);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          result: {
            kind: "unsupported_coverage",
            hazardId,
            date: body.date,
            area: body.area,
            retrievalAttempted: true,
            sourceOutcomes: {},
            meaning: {
              concern: "community",
              summary: `Deterministic ${hazardId} context boundary.`,
              optionalQuestionAcknowledged: true,
            },
            limitations: ["This chain does not establish cross-hazard causation."],
            rejectionReason: `No ${hazardId} observation in this deterministic test.`,
          },
        }),
      });
    });
  }
  await page.route("**/api/heat/query", async (route) => {
    queriedHazards.push("extreme_heat");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          kind: "unsupported_coverage",
          rejectionReason: "Deterministic heat context boundary.",
        },
      }),
    });
  });

  await gotoHydrated(page, "/");
  const output = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools?.analyze_environmental_hazard;
    if (!tool) throw new Error("WebMCP analysis tool was not registered");
    return tool.execute(
      {
        place: "Hilo, Hawaii",
        hazard: "earth_volcanoes",
        concern: "community",
        latitude: 19.7074,
        longitude: -155.0885,
        question: "Check volcanic activity, air quality, and heat together.",
      },
      { signal: new AbortController().signal }
    );
  }) as Record<string, unknown>;

  expect(queriedHazards).toHaveLength(3);
  expect(queriedHazards).toEqual(expect.arrayContaining([
    "air_quality",
    "extreme_heat",
    "earth_volcanoes",
  ]));
  expect(output).toMatchObject({
    relationship: "co_occurring_context_not_causation",
    included_chains: ["air_quality", "extreme_heat", "earth_volcanoes"],
  });
  expect(JSON.stringify(output).length).toBeLessThanOrEqual(1_500);

  const visibleInsight = page.locator('[data-testid="insight-navigation"]:visible');
  await expect(visibleInsight.getByTestId("related-air_quality-evidence-chain"))
    .toContainText("Related Air Quality evidence");
  await expect(visibleInsight.getByTestId("related-extreme_heat-evidence-chain"))
    .toContainText("Related Extreme Heat evidence");
});
