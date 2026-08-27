import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";
import fireSuccessFixture from "../../src/data/fixtures/wp02/fire-success.json";

const WEBMCP_TEST_GEOCODES: Record<string, { label: string; lon: number; lat: number }> = {
  "Albuquerque, New Mexico": { label: "Albuquerque, New Mexico", lon: -106.6504, lat: 35.0844 },
  "Tucson, Arizona": { label: "Tucson, Arizona", lon: -110.9747, lat: 32.2226 },
  "Phoenix, Arizona": { label: "Phoenix, Arizona", lon: -112.074, lat: 33.4484 },
  "Hilo, Hawaii": { label: "Hilo, Hawaii", lon: -155.0885, lat: 19.7074 },
};

async function mockWebMcpGeocode(page: Page): Promise<void> {
  await page.route("**/api/geocode", async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    const candidate = body.query ? WEBMCP_TEST_GEOCODES[body.query] : undefined;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, results: candidate ? [candidate] : [] }),
    });
  });
}

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

test("a non-demo Albuquerque question returns evidence and updates the shared human UI", async ({
  page,
}) => {
  await mockWebMcpGeocode(page);
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

  const customEvidence = structuredClone(fireSuccessFixture);
  customEvidence._fixtureId = "webmcp-custom-fire-albuquerque-2025-05-20";
  customEvidence._fixtureDescription =
    "Synthetic validated contract for a non-demo WebMCP browser wiring test; not live evidence.";
  customEvidence.evidenceId = "evd-fire-albuquerque-20250520-browser-test";
  customEvidence.intentId = "intent-webmcp-custom-albuquerque";
  customEvidence.observations[0].observationId = "obs-hms-fire-albuquerque-browser-test";
  customEvidence.observations[0].value = 17;
  customEvidence.observations[0].variableName =
    "HMS fire detection coordinate pairs in the selected Albuquerque test box";
  customEvidence.observations[1].observationId = "obs-hms-smoke-albuquerque-browser-test";
  customEvidence.observations[1].value = 6;
  customEvidence.observations[1].variableName =
    "HMS smoke polygon coordinate pairs in the selected Albuquerque test box";
  for (const observation of customEvidence.observations) {
    observation.provenance.observedAt = "2025-05-20T00:00:00Z";
    observation.provenance.retrievedAt = "2026-08-27T12:00:00Z";
    observation.provenance.requestParameters.date = "2025-05-20";
    observation.metadata.boundingBox = "Albuquerque browser-test selection";
  }
  customEvidence.observations[0].provenance.sourceUrl =
    "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Fire_Points/KML/2025/05/hms_fire20250520.kml";
  customEvidence.observations[0].provenance.payloadHash = "1".repeat(64);
  customEvidence.observations[1].provenance.sourceUrl =
    "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/2025/05/hms_smoke20250520.kml";
  customEvidence.observations[1].provenance.payloadHash = "2".repeat(64);
  customEvidence.missionAttributions[0].contributedObservationIds = [
    customEvidence.observations[0].observationId,
    customEvidence.observations[1].observationId,
  ];
  customEvidence.missionAttributions[0].selectionReason =
    "Synthetic non-demo Albuquerque browser wiring contract.";
  customEvidence.freshness.mostRecentObservationAt = "2025-05-20T00:00:00Z";
  customEvidence.freshness.evaluatedAt = "2026-08-27T12:00:00Z";
  customEvidence.freshness.note =
    "Historical synthetic browser-test fixture for May 20, 2025; not a live retrieval.";
  customEvidence.confidence.level = "moderate";
  customEvidence.confidence.rationale =
    "Two separate synthetic official-source roles exercise the generic WebMCP evidence contract for a non-demo city and date.";
  customEvidence.assembledAt = "2026-08-27T12:00:00Z";

  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/fire/query", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, result: { kind: "success", evidence: customEvidence } }),
    });
  });

  await gotoHydrated(page, "/");
  const output = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools?.analyze_environmental_hazard;
    if (!tool) throw new Error("WebMCP analysis tool was not registered");
    return tool.execute({
      place: "Albuquerque, New Mexico",
      hazard: "fire_smoke",
      time: "2025-05-20",
      analysis_scope: "single_hazard_only",
      radius_km: 30,
      question: "What official fire and smoke observations were recorded near Albuquerque?",
    }, { signal: new AbortController().signal });
  }) as Record<string, unknown>;

  expect(output).toMatchObject({
    status: "success",
    ui_updated: true,
    request: {
      place: "Albuquerque, New Mexico (OSM search)",
      hazard: "fire_smoke",
      concern: "general",
      radius_km: 30,
      time: "2025-05-20",
    },
    answer_order: [
      "strongest_supported_assessment",
      "observation_values_times_and_official_citations",
      "direct_observation_then_labelled_inference",
      "confidence_and_evidence_that_would_change_it",
    ],
    support: { level: "official_observations_returned", observation_count: 2, source_count: 2 },
    citations: [
      { source: "noaa_hms_fire_points", observed_at: "2025-05-20T00:00:00Z" },
      { source: "noaa_hms_smoke_polygons", observed_at: "2025-05-20T00:00:00Z" },
    ],
  });
  expect(output.no_data_is_not_no_danger).toBeUndefined();
  expect(requestBody).toMatchObject({
    concern: "general",
    optionalQuestion: "What official fire and smoke observations were recorded near Albuquerque?",
    time: { kind: "range", startDate: "2025-05-20", endDate: "2025-05-20" },
  });

  const receipt = page.locator('[data-testid="agent-analysis-notice"]:visible');
  await expect(receipt).toContainText("Agent updated this view");
  await expect(receipt.getByTestId("agent-analysis-receipt"))
    .toContainText("Fire & Smoke · Albuquerque, New Mexico · May 20, 2025");
  await receipt.getByTestId("agent-view-evidence").click();
  const insight = page.locator('[data-testid="insight-navigation"]:visible');
  await insight.getByRole("button", { name: /Show evidence details/u }).click();
  await expect(insight).toContainText("Value: 17 coordinate_pairs");
  await expect(insight).toContainText("Source: noaa_hms_fire_points");
  await expect(insight).toContainText("Observed at: 2025-05-20T00:00:00Z");
  await expect(insight).not.toContainText("Los Angeles");
  await expect(insight).not.toContainText("2025-01-08");

  await page.waitForFunction(() => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    return Boolean(state.__skyToPorchWebMcpTools?.inspect_current_environmental_evidence);
  });
  const inspected = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools?.inspect_current_environmental_evidence;
    if (!tool) throw new Error("Contextual evidence tool was not registered");
    return tool.execute({}, { signal: new AbortController().signal });
  }) as Record<string, unknown>;
  expect(inspected).toMatchObject({
    status: "ok",
    hazard: "fire_smoke",
    answer_order: [
      "strongest_supported_assessment",
      "observation_values_times_and_official_citations",
      "direct_observation_then_labelled_inference",
      "confidence_and_evidence_that_would_change_it",
    ],
    citations: [
      { source: "noaa_hms_fire_points", observed_at: "2025-05-20T00:00:00Z" },
      { source: "noaa_hms_smoke_polygons", observed_at: "2025-05-20T00:00:00Z" },
    ],
  });
});

test("an ambiguous place waits for a person, then the selected label completes the shared analysis", async ({
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

  await page.route("**/api/geocode", async (route) => {
    const body = route.request().postDataJSON() as { query: string };
    const results = body.query === "Springfield, Illinois"
      ? [{ label: "Springfield, Illinois", lon: -89.6501, lat: 39.7817 }]
      : [
          { label: "Springfield, Illinois", lon: -89.6501, lat: 39.7817 },
          { label: "Springfield, Missouri", lon: -93.2923, lat: 37.209 },
        ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, results }),
    });
  });

  let analysisQueries = 0;
  await page.route("**/api/fire/query", async (route) => {
    analysisQueries += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          kind: "unsupported_place",
          rejectionReason: "Deterministic ambiguity-continuation boundary.",
        },
      }),
    });
  });

  await gotoHydrated(page, "/");
  const execute = (place: string) => page.evaluate(async (agentPlace) => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools?.analyze_environmental_hazard;
    if (!tool) throw new Error("WebMCP analysis tool was not registered");
    return tool.execute({
      place: agentPlace,
      hazard: "fire_smoke",
      time: "latest_completed",
      analysis_scope: "single_hazard_only",
    }, { signal: new AbortController().signal });
  }, place) as Promise<Record<string, unknown>>;

  const ambiguous = await execute("Springfield");
  expect(ambiguous).toMatchObject({
    status: "needs_place_choice",
    ui_updated: false,
    requires_user_input: true,
    required_next_action: "ask_user_to_choose_place_and_wait",
    must_not_select_place: true,
    must_not_retry_before_user_reply: true,
    choices: [
      { choice_id: "place-1", label: "Springfield, Illinois" },
      { choice_id: "place-2", label: "Springfield, Missouri" },
    ],
  });
  expect(analysisQueries).toBe(0);

  const completed = await execute("Springfield, Illinois");
  expect(completed).toMatchObject({
    status: "unsupported_place",
    ui_updated: true,
    request: { place: "Springfield, Illinois (OSM search)" },
  });
  expect(analysisQueries).toBe(1);
  await expect(page.locator('[data-testid="agent-analysis-receipt"]:visible'))
    .toContainText("Springfield, Illinois");
});

test("registers WebMCP and shares an agent analysis with the visible product", async ({
  page,
}, testInfo) => {
  await mockWebMcpGeocode(page);
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

  const executeAgentAnalysis = async (place: string) => page.evaluate(async (agentPlace) => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools?.analyze_environmental_hazard;
    if (!tool) throw new Error("WebMCP analysis tool was not registered");
    return tool.execute(
      {
        place: agentPlace,
        hazard: "fire_smoke",
        time: "latest_completed",
        analysis_scope: "single_hazard_only",
        concern: "pets",
        radius_km: 15,
      },
      { signal: new AbortController().signal }
    );
  }, place) as Promise<Record<string, unknown>>;

  const output = await executeAgentAnalysis("Tucson, Arizona");

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
  expect(JSON.stringify(output).length).toBeLessThanOrEqual(2_400);
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
  )).toHaveAttribute("data-selection-method", "place_search");

  await executeAgentAnalysis("Phoenix, Arizona");
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
  await mockWebMcpGeocode(page);
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
        time: "latest_completed",
        concern: "health",
        question: "How could heat and persistent dry conditions affect me?",
      },
      { signal: new AbortController().signal }
    );
  }) as Record<string, unknown>;

  expect(queriedHazards).toHaveLength(2);
  expect(queriedHazards).toEqual(expect.arrayContaining(["drought_land", "extreme_heat"]));
  expect(output).toMatchObject({
    status: "related_environmental_evidence_bundle",
    relationship: "related_evidence_for_assessment",
    included_chains: ["drought_land", "extreme_heat"],
  });
  expect(JSON.stringify(output).length).toBeLessThanOrEqual(2_400);

  const visibleReceipt = page.locator('[data-testid="agent-analysis-notice"]:visible');
  await expect(visibleReceipt.getByTestId("agent-analysis-receipt"))
    .toContainText("Extreme Heat · Phoenix, Arizona");
  await expect(visibleReceipt.getByTestId("agent-related-context-receipt"))
    .toContainText("Drought & Land");
  await expect(visibleReceipt.getByTestId("agent-related-context-receipt"))
    .toContainText("timing, strength, and confidence");

  const visibleInsight = page.locator('[data-testid="insight-navigation"]:visible');
  await expect(visibleInsight.getByTestId("related-drought_land-evidence-chain"))
    .toContainText("Collected automatically for the same place and time");
  await expect(visibleInsight.getByTestId("related-drought_land-evidence-chain"))
    .toContainText("reinforces the concern");
});

test("volcano related context automatically adds separate air-quality and heat chains", async ({
  page,
}) => {
  await mockWebMcpGeocode(page);
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
        time: "latest_completed",
        concern: "community",
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
    relationship: "related_evidence_for_assessment",
    included_chains: ["air_quality", "extreme_heat", "earth_volcanoes"],
  });
  expect(JSON.stringify(output).length).toBeLessThanOrEqual(2_400);

  const visibleInsight = page.locator('[data-testid="insight-navigation"]:visible');
  await expect(visibleInsight.getByTestId("related-air_quality-evidence-chain"))
    .toContainText("Related Air Quality evidence");
  await expect(visibleInsight.getByTestId("related-extreme_heat-evidence-chain"))
    .toContainText("Related Extreme Heat evidence");
});
