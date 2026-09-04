import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { gotoHydrated } from "./helpers";
import fireSuccessFixture from "../../src/data/fixtures/wp02/fire-success.json";
import floodSuccessFixture from "../../src/data/fixtures/wp02/flood-success.json";

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
      __skyToPorchWebMcpRegistrationCounts?: Record<string, number>;
      __skyToPorchWebMcpRegistrationEpoch?: number;
      __skyToPorchCapturedCompareDefinition?: WebMCP.ModelContextTool;
    };
    state.__skyToPorchWebMcpTools = {};
    state.__skyToPorchWebMcpRegistrationCounts = {};
    state.__skyToPorchWebMcpRegistrationEpoch = 0;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: async (
          tool: WebMCP.ModelContextTool,
          options?: WebMCP.ModelContextRegisterToolOptions
        ) => {
          if (state.__skyToPorchWebMcpTools![tool.name]) {
            throw new DOMException(`Duplicate tool: ${tool.name}`, "InvalidStateError");
          }
          state.__skyToPorchWebMcpTools![tool.name] = tool;
          state.__skyToPorchWebMcpRegistrationCounts![tool.name] =
            (state.__skyToPorchWebMcpRegistrationCounts![tool.name] ?? 0) + 1;
          state.__skyToPorchWebMcpRegistrationEpoch! += 1;
          options?.signal?.addEventListener("abort", () => {
            if (state.__skyToPorchWebMcpTools![tool.name] !== tool) return;
            delete state.__skyToPorchWebMcpTools![tool.name];
            state.__skyToPorchWebMcpRegistrationEpoch! += 1;
          }, { once: true });
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
  await page.waitForFunction(() => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    return Object.keys(state.__skyToPorchWebMcpTools ?? {}).length === 6;
  });
  const registryBeforeAnalysis = await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
      __skyToPorchWebMcpRegistrationCounts?: Record<string, number>;
      __skyToPorchWebMcpRegistrationEpoch?: number;
      __skyToPorchCapturedCompareDefinition?: WebMCP.ModelContextTool;
    };
    const tools = state.__skyToPorchWebMcpTools ?? {};
    const expectedNames = [
      "analyze_environmental_hazard",
      "compare_environmental_evidence",
      "get_sky_to_porch_help_and_demos",
      "get_environmental_source_coverage",
      "inspect_current_environmental_evidence",
      "prepare_storm_claim_discussion",
    ];
    if (!expectedNames.every((name) => Boolean(tools[name]))) {
      throw new Error("The complete stable WebMCP tool set was not registered");
    }
    state.__skyToPorchCapturedCompareDefinition = tools.compare_environmental_evidence;
    return {
      epoch: state.__skyToPorchWebMcpRegistrationEpoch,
      counts: state.__skyToPorchWebMcpRegistrationCounts,
    };
  });
  expect(registryBeforeAnalysis).toEqual({
    epoch: 6,
    counts: {
      analyze_environmental_hazard: 1,
      compare_environmental_evidence: 1,
      get_sky_to_porch_help_and_demos: 1,
      get_environmental_source_coverage: 1,
      inspect_current_environmental_evidence: 1,
      prepare_storm_claim_discussion: 1,
    },
  });
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
  await expect(receipt).toContainText("Agent made this view more useful");
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
  const registryAfterInspection = await page.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
      __skyToPorchWebMcpRegistrationCounts?: Record<string, number>;
      __skyToPorchWebMcpRegistrationEpoch?: number;
      __skyToPorchCapturedCompareDefinition?: WebMCP.ModelContextTool;
    };
    return {
      epoch: state.__skyToPorchWebMcpRegistrationEpoch,
      counts: state.__skyToPorchWebMcpRegistrationCounts,
      cachedCompareDefinitionStillCurrent:
        state.__skyToPorchCapturedCompareDefinition ===
        state.__skyToPorchWebMcpTools?.compare_environmental_evidence,
    };
  });
  expect(registryAfterInspection).toEqual({
    ...registryBeforeAnalysis,
    cachedCompareDefinitionStillCurrent: true,
  });
});

test("an identical-label place choice resumes by stable id and completes the shared analysis", async ({
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
    expect(body.query).toBe("Houston");
    const results = [
      {
        id: "osm-r-2688911",
        label: "Houston, Texas, United States",
        lon: -95.3676974,
        lat: 29.7589382,
      },
      {
        id: "osm-r-1840945",
        label: "Houston, Texas, United States",
        lon: -95.390805,
        lat: 31.3378465,
      },
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
  const execute = (place: string, placeChoiceId?: string) => page.evaluate(async (args) => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools?.analyze_environmental_hazard;
    if (!tool) throw new Error("WebMCP analysis tool was not registered");
    return tool.execute({
      place: args.place,
      ...(args.placeChoiceId ? { place_choice_id: args.placeChoiceId } : {}),
      hazard: "fire_smoke",
      time: "latest_completed",
      analysis_scope: "single_hazard_only",
    }, { signal: new AbortController().signal });
  }, { place, placeChoiceId }) as Promise<Record<string, unknown>>;

  const ambiguous = await execute("Houston");
  expect(ambiguous).toMatchObject({
    status: "needs_place_choice",
    ui_updated: false,
    requires_user_input: true,
    required_next_action: "ask_user_to_choose_place_and_wait",
    must_not_select_place: true,
    must_not_retry_before_user_reply: true,
    choices: [
      { choice_id: "place-osm-r-2688911", label: "Houston, Texas, United States" },
      { choice_id: "place-osm-r-1840945", label: "Houston, Texas, United States" },
    ],
  });
  expect(analysisQueries).toBe(0);

  const completed = await execute("Houston", "place-osm-r-2688911");
  expect(completed).toMatchObject({
    status: "unsupported_place",
    ui_updated: true,
    request: { place: "Houston, Texas, United States (OSM search)" },
  });
  expect(analysisQueries).toBe(1);
  await expect(page.locator('[data-testid="agent-analysis-receipt"]:visible'))
    .toContainText("Houston, Texas, United States");
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
    const listTool = tools?.get_sky_to_porch_help_and_demos;
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
      "compare_environmental_evidence",
      "get_sky_to_porch_help_and_demos",
      "get_environmental_source_coverage",
      "inspect_current_environmental_evidence",
      "prepare_storm_claim_discussion",
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
    .toContainText("Agent made this view more useful");
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
    must_report_every_chain: true,
    required_chain_reporting: "report_each_included_chain",
    agent_response_contract: {
      style: "plain_english",
      avoid_internal_names: true,
      use_chain_name: true,
      use_status_summary: true,
      use_overall_summary: true,
      summary_first: true,
    },
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
  await expect(visibleReceipt.getByTestId("agent-chain-result-summary"))
    .toContainText("With Agent help, this interface checked");
  await expect(visibleReceipt.getByTestId("agent-extreme_heat-result-summary"))
    .toContainText("Extreme Heat");
  await expect(visibleReceipt.getByTestId("agent-drought_land-result-summary"))
    .toContainText("Drought & Land");
  await visibleReceipt.getByTestId("agent-view-drought_land-result").click();
  await expect(page.locator('[data-testid="tab-evidence"]:visible'))
    .toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-testid="related-drought_land-evidence-chain"]:visible'))
    .toBeFocused();

  const visibleDroughtChain = page.locator(
    '[data-testid="related-drought_land-evidence-chain"]:visible'
  );
  await expect(visibleDroughtChain)
    .toContainText("Collected automatically for the same place and time");
  await expect(visibleDroughtChain)
    .toContainText("reinforces the concern");
});

test("a generic storm call cannot collapse to wind-only when water evidence exists", async ({
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

  const floodEvidence = JSON.parse(
    JSON.stringify(floodSuccessFixture)
      .replaceAll("2024-07-08", "2026-08-28")
      .replaceAll("20240708", "20260828")
  ) as typeof floodSuccessFixture;
  floodEvidence._fixtureId = "webmcp-generic-storm-water-evidence-browser-test";
  floodEvidence._fixtureDescription =
    "Synthetic browser wiring evidence for the Houston generic-storm regression; not live evidence.";

  const floodRequests: Array<Record<string, unknown>> = [];
  const windRequests: Array<Record<string, unknown>> = [];
  await page.route("**/api/flood/query", async (route) => {
    floodRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          kind: "success",
          evidence: floodEvidence,
        },
      }),
    });
  });
  await page.route("**/api/storm/query", async (route) => {
    windRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          kind: "no_observation",
          sourceOutcomes: {
            ghcnhWind: "no_observation",
            officialEventContext: "not_applicable",
          },
          rejectionReason:
            "No requested-date wind row was returned; the separate water chain still contains evidence.",
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
        place: "29.748, -95.384",
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        concern: "general",
        radius_km: 50,
        time: "2026-08-28",
      },
      { signal: new AbortController().signal }
    );
  }) as Record<string, unknown>;

  expect(floodRequests).toHaveLength(1);
  expect(windRequests).toHaveLength(1);
  expect(floodRequests[0]).toMatchObject({
    startDate: "2026-08-28",
    endDate: "2026-08-28",
    mode: "live",
  });
  expect(windRequests[0]).toMatchObject({ date: "2026-08-28", mode: "live" });
  expect(floodRequests[0].area).toEqual(windRequests[0].area);
  expect(output).toMatchObject({
    status: "related_environmental_evidence_bundle",
    must_report_every_chain: true,
    required_chain_reporting: "report_each_included_chain",
    agent_response_contract: {
      style: "plain_english",
      avoid_internal_names: true,
      use_chain_name: true,
      use_status_summary: true,
      use_overall_summary: true,
      summary_first: true,
      per_chain_fields: "status_strongest_evidence_time_source_limitation",
    },
    request: { radius_km: 50, analysis_scope: "related_context" },
    overall_summary: "Flood & Heavy Rain: observations returned; Wind & Storm: no matching observation returned",
    support: {
      level: "partial_official_context",
      chains_with_observations: 1,
      total_chains: 2,
    },
    included_chains: ["flood_storm", "wind_storm"],
    chains: [
      {
        hazard: "flood_storm",
        status_summary: "observations returned",
        citation: { source: "usgs_instantaneous_values" },
      },
      { hazard: "wind_storm", status_summary: "no matching observation returned" },
    ],
  });
  expect(output).not.toHaveProperty("required_final_answer_sentence");

  const receipt = page.locator('[data-testid="agent-analysis-notice"]:visible');
  await expect(receipt.getByTestId("agent-analysis-receipt"))
    .toContainText("Wind & Storm");
  await expect(receipt.getByTestId("agent-related-context-receipt"))
    .toContainText("Flood & Heavy Rain");
  await expect(receipt.getByTestId("agent-wind_storm-result-summary"))
    .toContainText("No matching observation returned · 0 sources");
  await expect(receipt.getByTestId("agent-flood_storm-result-summary"))
    .toContainText("Observations returned · 2 sources");
  const relatedFlood = page.locator('[data-testid="related-flood-evidence-chain"]:visible');
  await expect(relatedFlood).toContainText("Related Flood & Heavy Rain evidence");
  await receipt.getByTestId("agent-view-flood_storm-result").click();
  await expect(relatedFlood).toBeFocused();
  await expect(relatedFlood).toContainText("2 validated observations are available");
  await receipt.getByTestId("agent-view-wind_storm-result").click();
  await expect(page.locator('[data-testid="primary-wind_storm-evidence-chain"]:visible'))
    .toBeFocused();
});

test("Agent comparison keeps both storm chains visible for both user-sized scenarios", async ({
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

  const floodRequests: Array<Record<string, unknown>> = [];
  const windRequests: Array<Record<string, unknown>> = [];
  await page.route("**/api/flood/query", async (route) => {
    floodRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          kind: "unsupported_coverage",
          rejectionReason: "No direct Flood observation in this comparison fixture.",
        },
      }),
    });
  });
  await page.route("**/api/storm/query", async (route) => {
    windRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: {
          kind: "unsupported_coverage",
          rejectionReason: "No direct Wind observation in this comparison fixture.",
        },
      }),
    });
  });

  await gotoHydrated(page, "/");
  const output = await page.evaluate(async () => {
    const state = globalThis as typeof globalThis & {
      __skyToPorchWebMcpTools?: Record<string, WebMCP.ModelContextTool>;
    };
    const tool = state.__skyToPorchWebMcpTools?.compare_environmental_evidence;
    if (!tool) throw new Error("WebMCP comparison tool was not registered");
    return tool.execute({
      baseline: {
        place: "29.7604, -95.3698",
        radius_km: 50,
        time: "2026-08-28",
      },
      comparison: {
        place: "30.2672, -97.7431",
        radius_km: 15,
        time: "2026-08-27",
      },
      hazard: "wind_storm",
      analysis_scope: "related_context",
      question: "Compare the storm evidence for both scenarios.",
    }, { signal: new AbortController().signal });
  }) as Record<string, unknown>;

  expect(floodRequests).toHaveLength(2);
  expect(windRequests).toHaveLength(2);
  expect(output).toMatchObject({
    status: "environmental_evidence_comparison",
    must_report_every_scenario_and_chain: true,
    agent_response_contract: { style: "plain_english", summary_first: true },
    scenarios: [
      {
        id: "baseline",
        radius_km: 50,
        chains: [{ hazard: "flood_storm" }, { hazard: "wind_storm" }],
      },
      {
        id: "comparison",
        radius_km: 15,
        chains: [{ hazard: "flood_storm" }, { hazard: "wind_storm" }],
      },
    ],
  });
  expect(JSON.stringify(output).length).toBeLessThanOrEqual(2_400);

  const receipt = page.locator('[data-testid="agent-analysis-notice"]:visible');
  await expect(receipt).toContainText("Agent made this view more useful");
  await expect(receipt.getByTestId("agent-analysis-receipt"))
    .toContainText("Compared 2 scenarios across 4 separate evidence chains");
  for (const id of [
    "agent-view-baseline-flood_storm-result",
    "agent-view-baseline-wind_storm-result",
    "agent-view-comparison-flood_storm-result",
    "agent-view-comparison-wind_storm-result",
  ]) {
    await expect(receipt.getByTestId(id)).toBeVisible();
  }
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
