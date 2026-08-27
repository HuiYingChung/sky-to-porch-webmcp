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
    expect(tool.description.length).toBeLessThanOrEqual(500);
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: true,
    });
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.additionalProperties).toBe(false);
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.required).toEqual(["place", "hazard"]);
    for (const property of Object.values(ANALYZE_HAZARD_INPUT_SCHEMA.properties)) {
      expect(property.description.length).toBeLessThanOrEqual(150);
    }
  });

  it("returns choices instead of guessing between ambiguous place results", async () => {
    const runAnalysis = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          results: [
            { label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
            { label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const output = await executeAnalyzeHazardTool(
      { place: "Springfield", hazard: "fire_smoke" },
      toolOptions(),
      { runAnalysis, fetchImpl, now: () => NOW }
    );

    expect(output.status).toBe("needs_place_choice");
    expect(output.ui_updated).toBe(false);
    expect(output.no_data_is_not_no_danger).toBe(true);
    expect("choices" in output ? output.choices : undefined).toEqual([
      {
        choice_id: "place-1",
        label: "Springfield, Illinois",
        retry_with: { latitude: 39.78, longitude: -89.65 },
      },
      {
        choice_id: "place-2",
        label: "Springfield, Missouri",
        retry_with: { latitude: 37.21, longitude: -93.29 },
      },
    ]);
    expect("message" in output ? output.message : "").toContain(
      "Keep every other input unchanged"
    );
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("uses supplied coordinates, defaults to home/latest, updates the UI, and caps output", async () => {
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
        place: "Tucson, Arizona",
        hazard: "fire_smoke",
        latitude: 32.2226,
        longitude: -110.9747,
      },
      toolOptions(),
      { runAnalysis, fetchImpl, now: () => NOW }
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    const [request, origin] = runAnalysis.mock.calls[0];
    expect(origin).toBe("agent");
    expect(request.concern).toBe("home");
    expect(request.evidenceMode).toBe("live");
    expect(request.placeSelection.selectionMethod).toBe("agent_coordinate");
    expect(request.placeSelection.timeSelection.type).toBe("latest");
    expect(output.ui_updated).toBe(true);
    expect(output.no_data_is_not_no_danger).toBe(true);
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
        place: "Tucson, Arizona",
        hazard: "extreme_heat",
        concern: "health",
        latitude: 32.2226,
        longitude: -110.9747,
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
    ["wind_storm", "wind_only_no_rain_flood_or_water_gages"],
    ["flood_storm", "water_only_no_wind_damage_causation"],
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
        place: "Houston, Texas",
        hazard: hazardId,
        latitude: 29.7604,
        longitude: -95.3698,
        start_date: "2024-07-08",
        end_date: "2024-07-08",
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
        place: "Houston, Texas",
        hazard: "storm_impacts",
        concern: "home",
        latitude: 29.7604,
        longitude: -95.3698,
        start_date: "2024-07-08",
        end_date: "2024-07-08",
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
      status: "storm_evidence_bundle",
      evidence_scope: "separate_wind_and_water_chains",
      chains: {
        wind: { evidence_scope: "wind_only_no_rain_flood_or_water_gages" },
        water: { evidence_scope: "water_only_no_wind_damage_causation" },
      },
    });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
  });

  it.each([
    [{ place: "Tucson", hazard: "fire_smoke", latitude: 32.2 }, "latitude and longitude"],
    [
      {
        place: "Tucson",
        hazard: "extreme_heat",
        latitude: 32.2,
        longitude: -110.9,
        start_date: "2026-08-20",
        end_date: "2026-08-21",
      },
      "exactly one",
    ],
    [
      {
        place: "Tucson",
        hazard: "fire_smoke",
        latitude: 32.2,
        longitude: -110.9,
        start_date: "2026-02-30",
        end_date: "2026-02-30",
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
