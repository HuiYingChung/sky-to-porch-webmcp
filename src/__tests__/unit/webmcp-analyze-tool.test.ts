/// <reference types="webmcp-types" />

import { describe, expect, it, vi } from "vitest";
import type { EvidenceObject } from "@/contracts/evidence";
import type { ActiveAnalysis, AnalysisRequest } from "@/lib/analysis/types";
import {
  ANALYZE_HAZARD_INPUT_SCHEMA,
  MAX_OUTPUT_CHARACTERS,
  createAnalyzeHazardTool,
  executeAnalyzeHazardTool,
} from "@/lib/webmcp/analyze-tool";

const NOW = new Date("2026-08-26T18:00:00.000Z");

function toolOptions(signal = new AbortController().signal): WebMCP.ToolExecuteCallbackOptions {
  return { signal };
}

function evidenceWithLongContent(): EvidenceObject {
  const longLimitation = "This bounded source cannot establish property-level safety. ".repeat(8);
  return {
    evidenceId: "ev-webmcp-001",
    hazardId: "fire_smoke",
    intentId: "webmcp-test",
    evidenceState: "observations_returned",
    dataMode: "live",
    observations: Array.from({ length: 5 }, (_, index) => ({
      observationId: `obs-${index}`,
      variableName: `Detected environmental observation ${index} `.repeat(3),
      value: index + 1,
      unit: "count",
      dataMode: "live" as const,
      provenance: {
        sourceId: "noaa_hms_fire_points",
        sourceUrl: `https://example.test/source/${index}/${"x".repeat(500)}`,
        retrievedAt: "2026-08-26T17:00:00.000Z",
        observedAt: "2026-08-25T12:00:00.000Z",
        product: "test product",
        payloadHash: "a".repeat(64),
      },
    })),
    derivedMetrics: [],
    missionAttributions: [],
    freshness: {
      status: "recent",
      classificationBasis: "age_thresholds",
      mostRecentObservationAt: "2026-08-25T12:00:00.000Z",
      evaluatedAt: "2026-08-26T17:00:00.000Z",
      ageSeconds: 104400,
      currentAgeLimitSeconds: 86400,
      recentAgeLimitSeconds: 172800,
      note: "Recent evidence.",
    },
    confidence: { level: "moderate", rationale: "Bounded test evidence." },
    limitations: Array.from({ length: 4 }, (_, index) => ({
      limitationId: `lim-${index}`,
      source: "test",
      description: `${longLimitation}${index}`,
      required: true,
    })),
    explanations: [],
    assembledAt: "2026-08-26T17:00:00.000Z",
  };
}

function successfulFireAnalysis(request: AnalysisRequest): ActiveAnalysis {
  return {
    analysisId: "analysis-webmcp-001",
    origin: "agent",
    request,
    outcome: {
      hazardId: "fire_smoke",
      result: { kind: "success", evidence: evidenceWithLongContent() },
    },
    completedAt: "2026-08-26T17:00:01.000Z",
  };
}

describe("WebMCP environmental hazard tool", () => {
  it("publishes one bounded, truthful tool contract", () => {
    const tool = createAnalyzeHazardTool({ runAnalysis: vi.fn() });

    expect(tool.name).toBe("analyze_environmental_hazard");
    expect(tool.description.length).toBeLessThanOrEqual(700);
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: true,
    });
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.additionalProperties).toBe(false);
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.required).toEqual(["place", "hazard", "time"]);
    for (const property of Object.values(ANALYZE_HAZARD_INPUT_SCHEMA.properties)) {
      expect(property.description.length).toBeLessThanOrEqual(150);
    }
  });

  it("supports the native one-argument callback and preserves source failure", async () => {
    const runAnalysis = vi.fn(async (
      request: AnalysisRequest,
      _origin?: "agent",
      _signal?: AbortSignal
    ): Promise<ActiveAnalysis> => {
      void _origin;
      void _signal;
      return {
        analysisId: "analysis-native-one-argument",
        origin: "agent",
        request,
        outcome: {
          hazardId: "wind_storm",
          result: {
            kind: "source_failure",
            rejectionReason: "Deterministic provider failure boundary.",
          },
        },
        completedAt: "2026-08-26T18:00:01.000Z",
      };
    });
    const tool = createAnalyzeHazardTool({ runAnalysis, now: () => NOW });
    const executeWithOneArgument = tool.execute as (
      input: Record<string, unknown>
    ) => Promise<Record<string, unknown>>;

    const output = await executeWithOneArgument({
      place: "29.7604, -95.3698",
      hazard: "wind_storm",
      analysis_scope: "single_hazard_only",
      concern: "home",
      time: "2024-07-08",
    });

    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    expect(output).toMatchObject({
      status: "source_failure",
      evidence: null,
      limitations: ["Deterministic provider failure boundary."],
      no_data_is_not_no_danger: true,
      evidence_scope: "regional_wind_observations",
    });
  });

  it("returns choices instead of guessing between ambiguous place results", async () => {
    const runAnalysis = vi.fn();
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      const results = body.query === "Springfield, Illinois"
        ? [{ label: "Springfield, Illinois", lon: -89.65, lat: 39.78 }]
        : [
            { label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
            { label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
          ];
      return new Response(JSON.stringify({ ok: true, results }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const output = await executeAnalyzeHazardTool(
      { place: "Springfield", hazard: "fire_smoke", time: "latest_completed" },
      toolOptions(),
      { runAnalysis, fetchImpl, now: () => NOW }
    );

    expect(output.status).toBe("needs_place_choice");
    expect(output.ui_updated).toBe(false);
    expect(output.no_data_is_not_no_danger).toBe(true);
    expect(output).toMatchObject({
      requires_user_input: true,
      required_next_action: "ask_user_to_choose_place_and_wait",
      must_not_select_place: true,
      must_not_retry_before_user_reply: true,
      after_user_choice: {
        required_next_action: "retry_analysis_with_selected_place",
        continue_task: true,
        set_place_to_selected_label: true,
        preserve_other_arguments: true,
      },
    });
    expect("choices" in output ? output.choices : undefined).toEqual([
      {
        choice_id: "place-1",
        label: "Springfield, Illinois",
      },
      {
        choice_id: "place-2",
        label: "Springfield, Missouri",
      },
    ]);
    const message = "message" in output ? output.message : "";
    expect(message).toContain("PAUSE FOR USER:");
    expect(message).toContain("wait for a new user message");
    expect(message).toContain("continue the unfinished task");
    expect(message).toContain("keep every other input unchanged");
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("tells the agent to wait for the person, then resume the unfinished task", () => {
    const tool = createAnalyzeHazardTool({ runAnalysis: vi.fn() });

    expect(tool.description).toContain("Never infer coordinates");
    expect(tool.description).toContain("wait for a new user reply");
    expect(tool.description).toContain("the task is unfinished");
    expect(tool.description).toContain("immediately call this tool again");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties).not.toHaveProperty("latitude");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties).not.toHaveProperty("longitude");
  });

  it("continues the analysis after the person selects a returned place", async () => {
    const runAnalysis = vi.fn(async (
      request: AnalysisRequest,
      _origin?: "agent",
      _signal?: AbortSignal
    ) => {
      void _origin;
      void _signal;
      return successfulFireAnalysis(request);
    });
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      const results = body.query === "Springfield, Illinois"
        ? [{ label: "Springfield, Illinois", lon: -89.65, lat: 39.78 }]
        : [
            { label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
            { label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
          ];
      return new Response(JSON.stringify({ ok: true, results }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const ambiguous = await executeAnalyzeHazardTool(
      {
        place: "Springfield",
        hazard: "fire_smoke",
        time: "latest_completed",
        analysis_scope: "single_hazard_only",
      },
      toolOptions(),
      { runAnalysis, fetchImpl, now: () => NOW }
    );
    expect(ambiguous.status).toBe("needs_place_choice");
    expect(runAnalysis).not.toHaveBeenCalled();

    const completed = await executeAnalyzeHazardTool(
      {
        place: "Springfield, Illinois",
        hazard: "fire_smoke",
        time: "latest_completed",
        analysis_scope: "single_hazard_only",
      },
      toolOptions(),
      { runAnalysis, fetchImpl, now: () => NOW }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0][0]).toMatchObject({
      hazardId: "fire_smoke",
      placeSelection: {
        label: "Springfield, Illinois (OSM search)",
        selectionMethod: "place_search",
      },
    });
    expect(completed.ui_updated).toBe(true);
  });

  it("uses explicit coordinate text, defaults to general/latest, returns citations, and caps output", async () => {
    const runAnalysis = vi.fn(async (
      request: AnalysisRequest,
      _origin?: "agent",
      _signal?: AbortSignal
    ) => {
      void _origin;
      void _signal;
      return successfulFireAnalysis(request);
    });
    const fetchImpl = vi.fn();

    const output = await executeAnalyzeHazardTool(
      {
        place: "32.2226, -110.9747",
        hazard: "fire_smoke",
        time: "latest_completed",
        analysis_scope: "single_hazard_only",
      },
      toolOptions(),
      { runAnalysis, fetchImpl, now: () => NOW }
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    const [request, origin] = runAnalysis.mock.calls[0];
    expect(origin).toBe("agent");
    expect(request.concern).toBe("general");
    expect(request.evidenceMode).toBe("live");
    expect(request.placeSelection.selectionMethod).toBe("agent_coordinate");
    expect(request.placeSelection.timeSelection.type).toBe("latest");
    expect(output.ui_updated).toBe(true);
    expect(output.no_data_is_not_no_danger).toBeUndefined();
    expect(output).toMatchObject({
      answer_order: [
        "strongest_supported_assessment",
        "observation_values_times_and_official_citations",
        "direct_observation_then_labelled_inference",
        "confidence_and_evidence_that_would_change_it",
      ],
      support: {
        level: "official_observations_returned",
        confidence: "moderate",
        observation_count: 5,
        source_count: 1,
      },
      citations: [{
        source: "noaa_hms_fire_points",
        product: "test product",
        observed_at: "2026-08-25T12:00:00.000Z",
        retrieved_at: "2026-08-26T17:00:00.000Z",
      }],
    });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
  });

  it("defaults single-day hazards to yesterday's completed UTC date", async () => {
    const runAnalysis = vi.fn(async (request: AnalysisRequest): Promise<ActiveAnalysis> => ({
      analysisId: "analysis-heat-001",
      origin: "agent",
      request,
      outcome: {
        hazardId: "extreme_heat",
        result: { kind: "unsupported_coverage", rejectionReason: "No station coverage." },
      },
      completedAt: "2026-08-26T18:00:01.000Z",
    }));

    const output = await executeAnalyzeHazardTool(
      {
        place: "32.2226, -110.9747",
        hazard: "extreme_heat",
        time: "latest_completed",
        analysis_scope: "single_hazard_only",
        concern: "health",
      },
      toolOptions(),
      { runAnalysis, now: () => NOW }
    );

    const request = runAnalysis.mock.calls[0][0];
    expect(request.placeSelection.timeSelection.startTs).toBe("2026-08-25T00:00:00.000Z");
    expect(request.placeSelection.timeSelection.endTs).toBe("2026-08-25T23:59:59.000Z");
    expect(output.status).toBe("unsupported_coverage");
    expect(output.no_data_is_not_no_danger).toBe(true);
    expect("limitations" in output ? output.limitations[0] : undefined).toBe("No station coverage.");
  });

  it.each([
    ["wind_storm", "regional_wind_observations"],
    ["flood_storm", "regional_water_and_rain_observations"],
  ] as const)("labels the %s evidence chain so same-event data stays distinct", async (
    hazardId,
    evidenceScope
  ) => {
    const runAnalysis = vi.fn(async (request: AnalysisRequest): Promise<ActiveAnalysis> => ({
      analysisId: `analysis-${hazardId}`,
      origin: "agent",
      request,
      outcome: {
        hazardId,
        result: { kind: "unsupported_coverage", rejectionReason: "No source coverage." },
      } as ActiveAnalysis["outcome"],
      completedAt: "2026-08-26T18:00:01.000Z",
    }));

    const output = await executeAnalyzeHazardTool(
      {
        place: "29.7604, -95.3698",
        hazard: hazardId,
        analysis_scope: "single_hazard_only",
        time: "2024-07-08",
      },
      toolOptions(),
      { runAnalysis, now: () => NOW }
    );

    expect(output).toMatchObject({ evidence_scope: evidenceScope });
  });

  it("automatically gathers separate wind and water chains for a broad storm-impact question", async () => {
    const runAnalysis = vi.fn(async (request: AnalysisRequest): Promise<ActiveAnalysis> => ({
      analysisId: `analysis-${request.hazardId}`,
      origin: "agent",
      request,
      outcome: {
        hazardId: request.hazardId,
        result: { kind: "unsupported_coverage", rejectionReason: `No ${request.hazardId} coverage.` },
      } as ActiveAnalysis["outcome"],
      completedAt: "2026-08-26T18:00:01.000Z",
    }));

    const output = await executeAnalyzeHazardTool(
      {
        place: "29.7604, -95.3698",
        hazard: "wind_storm",
        concern: "home",
        time: "2024-07-08",
        question: "Could this storm have damaged my home, and what can I discuss with my insurer?",
      },
      toolOptions(),
      { runAnalysis, now: () => NOW }
    );

    expect(runAnalysis.mock.calls.map(([request]) => request.hazardId)).toEqual([
      "flood_storm",
      "wind_storm",
    ]);
    expect(output).toMatchObject({
      status: "related_environmental_evidence_bundle",
      evidence_scope: "separate_related_hazard_chains",
      relationship: "related_evidence_for_assessment",
      inference_guidance: "state_strongest_supported_inference_and_confidence",
      answer_order: [
        "strongest_supported_assessment",
        "observation_values_times_and_official_citations",
        "direct_observation_then_labelled_inference",
        "confidence_and_evidence_that_would_change_it",
      ],
      included_chains: ["flood_storm", "wind_storm"],
      chains: [
        {
          hazard: "flood_storm",
          evidence_scope: "regional_water_and_rain_observations",
        },
        {
          hazard: "wind_storm",
          evidence_scope: "regional_wind_observations",
        },
      ],
    });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
  });

  it("keeps a production-sized Beryl evidence bundle inside the primary output limit", async () => {
    const runAnalysis = vi.fn(async (request: AnalysisRequest): Promise<ActiveAnalysis> => {
      const base = evidenceWithLongContent();
      const isWind = request.hazardId === "wind_storm";
      const observation = {
        ...base.observations[0],
        observationId: isWind
          ? "obs-ghcnh-wind-gust-USW00000188-20240708143500000"
          : "obs-gibs-imerg-custom-area-2024-07-08",
        variableName: isWind
          ? "Peak observed wind gust"
          : "GIBS IMERG precipitation visualization PNG",
        provenance: {
          ...base.observations[0].provenance,
          sourceId: isWind
            ? "noaa_ncei_global_hourly" as const
            : "nasa_gibs_imerg" as const,
          sourceUrl: isWind
            ? "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/2024/psv/GHCNh_USW00000188_2024.psv"
            : "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=IMERG_Precipitation_Rate&SRS=EPSG%3A4326&STYLES=&WIDTH=512&HEIGHT=512&TIME=2024-07-08&BBOX=-95.62849777141066%2C29.535822206252245%2C-95.11110222858933%2C29.984977793747756",
          product: isWind
            ? "NOAA NCEI GHCNh Version 1 station-by-year PSV"
            : "NASA GIBS best-service layer IMERG_Precipitation_Rate; GetMap does not expose a numeric rainfall value",
          observedAt: isWind
            ? "2024-07-08T14:35:00.000Z"
            : "2024-07-08T00:00:00Z",
        },
      };
      const evidence: EvidenceObject = {
        ...base,
        evidenceId: `evidence-${request.hazardId}`,
        hazardId: request.hazardId,
        observations: [observation],
        limitations: [{
          limitationId: `limitation-${request.hazardId}`,
          source: observation.provenance.sourceId,
          description: isWind
            ? "The selected in-area station is an outdoor point observation. It does not establish roof-level wind, wind at an address, property damage, or causation."
            : "GIBS imagery is visualization evidence only. Numeric rainfall, surface-water extent, route status, and property impact are not inferred from image colors.",
          required: true,
        }],
      };
      return {
        analysisId: `analysis-1-${isWind ? 1 : 0}-${request.hazardId}`,
        origin: "agent",
        request,
        outcome: {
          hazardId: request.hazardId,
          result: { kind: "success", evidence },
        } as ActiveAnalysis["outcome"],
        completedAt: "2026-08-26T18:00:01.000Z",
      };
    });

    const output = await executeAnalyzeHazardTool(
      {
        place: "29.7604, -95.3698",
        hazard: "wind_storm",
        concern: "home",
        radius_km: 25,
        time: "2024-07-08",
        question: "Could Hurricane Beryl have damaged my home or roof, and what official environmental evidence can help me discuss it with my insurer?",
      },
      toolOptions(),
      { runAnalysis, now: () => NOW }
    );

    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
    expect(output).toMatchObject({
      status: "related_environmental_evidence_bundle",
      included_chains: ["flood_storm", "wind_storm"],
      chains: [
        { hazard: "flood_storm", citation: { source: "nasa_gibs_imerg" } },
        { hazard: "wind_storm", citation: { source: "noaa_ncei_global_hourly" } },
      ],
    });
  });

  it("reports moderate assessment confidence when every chain has independent official sources", async () => {
    const sources = {
      air_quality: ["nasa_gibs_modis_aod", "airnow_daily_data"],
      fire_smoke: ["noaa_hms_fire_points", "noaa_hms_smoke_polygons"],
    } as const;
    const runAnalysis = vi.fn(async (request: AnalysisRequest): Promise<ActiveAnalysis> => {
      const base = evidenceWithLongContent();
      const evidence: EvidenceObject = {
        ...base,
        evidenceId: `evidence-${request.hazardId}`,
        hazardId: request.hazardId,
        observations: sources[request.hazardId as keyof typeof sources].map((sourceId, index) => ({
          ...base.observations[index],
          observationId: `observation-${request.hazardId}-${index}`,
          provenance: {
            ...base.observations[index].provenance,
            sourceId,
            sourceUrl: `https://example.test/${sourceId}`,
            product: `Official ${sourceId} product`,
          },
        })),
      };
      return {
        analysisId: `analysis-${request.hazardId}`,
        origin: "agent",
        request,
        outcome: {
          hazardId: request.hazardId,
          result: { kind: "success", evidence },
        } as ActiveAnalysis["outcome"],
        completedAt: "2026-08-26T18:00:01.000Z",
      };
    });

    const output = await executeAnalyzeHazardTool(
      {
        place: "34.0522, -118.2437",
        hazard: "fire_smoke",
        concern: "health",
        time: "2025-01-09",
      },
      toolOptions(),
      { runAnalysis, now: () => NOW }
    );

    expect(output).toMatchObject({
      support: {
        level: "multi_chain_official_context",
        assessment_confidence: "moderate",
        basis: "independent_official_sources_across_every_chain",
        chains_with_observations: 2,
        total_chains: 2,
        source_count: 4,
      },
      inference_guidance: "state_strongest_supported_inference_and_confidence",
      chains: [
        { hazard: "air_quality", citation: { source: "nasa_gibs_modis_aod" } },
        { hazard: "fire_smoke", citation: { source: "noaa_hms_fire_points" } },
      ],
    });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
  });

  it.each([
    ["extreme_heat", ["drought_land", "extreme_heat"]],
    ["drought_land", ["extreme_heat", "drought_land"]],
    ["fire_smoke", ["air_quality", "fire_smoke"]],
    ["air_quality", ["fire_smoke", "air_quality"]],
    ["earth_volcanoes", ["air_quality", "extreme_heat", "earth_volcanoes"]],
  ] as const)("defaults broad %s questions to the governed related-context plan", async (
    hazard,
    expectedHazards
  ) => {
    const runAnalysis = vi.fn(async (request: AnalysisRequest): Promise<ActiveAnalysis> => ({
      analysisId: `analysis-${request.hazardId}`,
      origin: "agent",
      request,
      outcome: {
        hazardId: request.hazardId,
        result: { kind: "unsupported_coverage", rejectionReason: `No ${request.hazardId} coverage.` },
      } as ActiveAnalysis["outcome"],
      completedAt: "2026-08-26T18:00:01.000Z",
    }));

    const output = await executeAnalyzeHazardTool(
      {
        place: "32.2226, -110.9747",
        hazard,
        time: "latest_completed",
      },
      toolOptions(),
      { runAnalysis, now: () => NOW }
    );

    expect(runAnalysis.mock.calls.map(([request]) => request.hazardId)).toEqual(expectedHazards);
    expect(output).toMatchObject({
      status: "related_environmental_evidence_bundle",
      relationship: "related_evidence_for_assessment",
      included_chains: expectedHazards,
    });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
  });

  it("runs exactly one chain only when the Agent marks an explicitly narrow question", async () => {
    const runAnalysis = vi.fn(async (request: AnalysisRequest): Promise<ActiveAnalysis> => ({
      analysisId: `analysis-${request.hazardId}`,
      origin: "agent",
      request,
      outcome: {
        hazardId: "extreme_heat",
        result: { kind: "unsupported_coverage", rejectionReason: "No heat coverage." },
      },
      completedAt: "2026-08-26T18:00:01.000Z",
    }));

    const output = await executeAnalyzeHazardTool(
      {
        place: "33.4484, -112.074",
        hazard: "extreme_heat",
        time: "latest_completed",
        analysis_scope: "single_hazard_only",
        question: "What was the maximum temperature on this date only?",
      },
      toolOptions(),
      { runAnalysis, now: () => NOW }
    );

    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(output).toMatchObject({
      evidence_scope: "regional_heat_observations",
      request: { hazard: "extreme_heat" },
    });
  });

  it("uses one parallel bundle transaction when the shared controller provides it", async () => {
    const runAnalysis = vi.fn();
    const runAnalysisBundle = vi.fn(async (requests: AnalysisRequest[]): Promise<ActiveAnalysis[]> =>
      requests.map((request) => ({
        analysisId: `analysis-${request.hazardId}`,
        origin: "agent",
        request,
        outcome: {
          hazardId: request.hazardId,
          result: { kind: "unsupported_coverage", rejectionReason: "Bounded test result." },
        } as ActiveAnalysis["outcome"],
        completedAt: "2026-08-26T18:00:01.000Z",
      }))
    );

    const output = await executeAnalyzeHazardTool(
      {
        place: "19.7074, -155.0885",
        hazard: "earth_volcanoes",
        time: "latest_completed",
      },
      toolOptions(),
      { runAnalysis, runAnalysisBundle, now: () => NOW }
    );

    expect(runAnalysis).not.toHaveBeenCalled();
    expect(runAnalysisBundle).toHaveBeenCalledTimes(1);
    expect(runAnalysisBundle.mock.calls[0][0].map((request) => request.hazardId)).toEqual([
      "air_quality",
      "extreme_heat",
      "earth_volcanoes",
    ]);
    expect(output).toMatchObject({
      included_chains: ["air_quality", "extreme_heat", "earth_volcanoes"],
    });
  });

  it.each([
    [{ place: "91, -110.9", hazard: "fire_smoke", time: "latest_completed" }, "outside the valid WGS-84 range"],
    [{ place: "Tucson", hazard: "fire_smoke", time: "latest_completed", latitude: 32.2 }, "Unexpected input field"],
    [
      {
        place: "Tucson",
        hazard: "fire_smoke",
        time: "latest_completed",
        related_hazards: ["air_quality"],
      },
      "Unexpected input field",
    ],
    [
      {
        place: "Tucson",
        hazard: "extreme_heat",
        analysis_scope: "single_hazard_only",
        time: "2026-08-20/2026-08-21",
      },
      "exactly one",
    ],
    [
      {
        place: "Tucson",
        hazard: "fire_smoke",
        time: "2026-02-30",
      },
      "real calendar dates",
    ],
  ])("fails closed on invalid input %#", async (input, expectedMessage) => {
    const runAnalysis = vi.fn();
    const output = await executeAnalyzeHazardTool(
      input,
      toolOptions(),
      { runAnalysis, now: () => NOW }
    );

    expect(output.status).toBe("invalid_input");
    expect("message" in output ? output.message : "").toContain(expectedMessage);
    expect(runAnalysis).not.toHaveBeenCalled();
  });
});
