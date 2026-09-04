/// <reference types="webmcp-types" />

import { describe, expect, it, vi } from "vitest";
import type { EvidenceObject, Observation } from "@/contracts/evidence";
import type { ActiveAnalysis, AnalysisRequest } from "@/lib/analysis/types";
import {
  COMPARE_HAZARD_INPUT_SCHEMA,
  MAX_OUTPUT_CHARACTERS,
  createCompareHazardTool,
  executeCompareHazardTool,
  orderedEvidenceObservations,
} from "@/lib/webmcp/analyze-tool";

const NOW = new Date("2026-08-29T18:00:00.000Z");
const OPTIONS = { signal: new AbortController().signal } as WebMCP.ToolExecuteCallbackOptions;

function analysis(request: AnalysisRequest): ActiveAnalysis {
  return {
    analysisId: `analysis-${request.evidenceBundle?.scenarioId}-${request.hazardId}`,
    origin: "agent",
    request,
    outcome: {
      hazardId: request.hazardId,
      result: {
        kind: "unsupported_coverage",
        rejectionReason: `No direct ${request.hazardId} observation in this bounded test.`,
      },
    } as ActiveAnalysis["outcome"],
    completedAt: NOW.toISOString(),
  };
}

describe("WebMCP environmental evidence comparison tool", () => {
  it("runs both generic-storm chains for both scenarios and preserves each radius", async () => {
    const runAnalysis = vi.fn();
    const runAnalysisBundle = vi.fn(async (requests: AnalysisRequest[]) => requests.map(analysis));
    const output = await executeCompareHazardTool(
      {
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
        concern: "travel",
        question: "Compare the storm evidence in Houston and Austin.",
      },
      OPTIONS,
      { runAnalysis, runAnalysisBundle, now: () => NOW }
    ) as {
      status: string;
      scenarios: Array<{ id: string; radius_km: number; chains: Array<{ hazard: string }> }>;
      comparison: { unknowns: string[] };
      agent_response_contract: { style: string };
    };

    expect(runAnalysis).not.toHaveBeenCalled();
    expect(runAnalysisBundle).toHaveBeenCalledTimes(1);
    const requests = runAnalysisBundle.mock.calls[0][0];
    expect(requests.map((request) => [
      request.evidenceBundle?.scenarioId,
      request.hazardId,
      request.placeSelection.analysisArea.radiusKm,
    ])).toEqual([
      ["baseline", "flood_storm", 50],
      ["baseline", "wind_storm", 50],
      ["comparison", "flood_storm", 15],
      ["comparison", "wind_storm", 15],
    ]);
    expect(requests.at(-1)?.evidenceBundle).toMatchObject({
      role: "primary",
      investigationKind: "comparison",
      scenarioId: "comparison",
      scenarioOrder: 1,
    });
    expect(output).toMatchObject({
      status: "environmental_evidence_comparison",
      agent_response_contract: { style: "plain_english" },
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
    expect(output.comparison.unknowns.join(" ")).toMatch(/do not.*prove.*severity/iu);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
  });

  it("resolves the same normalized named place and choice once while preserving scenario dates and radii", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      expect(body.query).toBe("Houston");
      return new Response(JSON.stringify({
        ok: true,
        results: [
          { id: "houston-city", label: "Houston, Texas", lon: -95.3698, lat: 29.7604 },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const runAnalysisBundle = vi.fn(async (requests: AnalysisRequest[]) => requests.map(analysis));

    const output = await executeCompareHazardTool(
      {
        baseline: {
          place: " Houston ",
          place_choice_id: "place-houston-city",
          radius_km: 50,
          time: "2024-07-07",
        },
        comparison: {
          place: "HOUSTON",
          place_choice_id: "place-houston-city",
          radius_km: 15,
          time: "2024-07-08",
        },
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        question: "Compare the wind evidence on these dates.",
      },
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, fetchImpl, now: () => NOW }
    ) as {
      scenarios: Array<{ id: string; radius_km: number; time: string }>;
    };

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(runAnalysisBundle).toHaveBeenCalledTimes(1);
    const requests = runAnalysisBundle.mock.calls[0][0];
    expect(requests.map((request) => ({
      scenario: request.evidenceBundle?.scenarioId,
      radius: request.placeSelection.analysisArea.radiusKm,
      start: request.placeSelection.timeSelection.startTs,
      end: request.placeSelection.timeSelection.endTs,
      coordinate: request.placeSelection.coordinate,
    }))).toEqual([
      {
        scenario: "baseline",
        radius: 50,
        start: "2024-07-07T00:00:00.000Z",
        end: "2024-07-07T23:59:59.000Z",
        coordinate: { lon: -95.3698, lat: 29.7604 },
      },
      {
        scenario: "comparison",
        radius: 15,
        start: "2024-07-08T00:00:00.000Z",
        end: "2024-07-08T23:59:59.000Z",
        coordinate: { lon: -95.3698, lat: 29.7604 },
      },
    ]);
    expect(output.scenarios).toMatchObject([
      { id: "baseline", radius_km: 50, time: "2024-07-07" },
      { id: "comparison", radius_km: 15, time: "2024-07-08" },
    ]);
  });

  it("uses one user choice for the same ambiguous named place in both scenarios", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: [
        { id: "houston-city", label: "Houston, Texas", lon: -95.3698, lat: 29.7604 },
        { id: "houston-county", label: "Houston County, Texas", lon: -95.45, lat: 31.32 },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    const runAnalysisBundle = vi.fn(async (requests: AnalysisRequest[]) => requests.map(analysis));
    const originalInput = {
      baseline: { place: "Houston", time: "2024-07-07" },
      comparison: { place: " houston ", time: "2024-07-08" },
      hazard: "wind_storm",
      analysis_scope: "single_hazard_only",
      question: "Compare Houston wind evidence on these dates.",
    };

    const first = await executeCompareHazardTool(
      originalInput,
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, fetchImpl, now: () => NOW }
    ) as {
      status: string;
      ambiguous_scenario: string;
      choices: Array<{ choice_id: string }>;
      after_user_choice: { retry_with_original_arguments: Record<string, unknown> };
    };

    expect(first).toMatchObject({
      status: "needs_place_choice",
      ambiguous_scenario: "baseline",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const retryArguments = first.after_user_choice.retry_with_original_arguments;
    const retry = {
      ...retryArguments,
      baseline: {
        ...(retryArguments.baseline as Record<string, unknown>),
        place_choice_id: first.choices[0].choice_id,
      },
    };

    const completed = await executeCompareHazardTool(
      retry,
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, fetchImpl, now: () => NOW }
    ) as { status: string; scenarios: Array<{ place: string }> };

    expect(completed.status).toBe("environmental_evidence_comparison");
    expect(completed.scenarios.map((scenario) => scenario.place)).toEqual([
      "Houston, Texas (OSM search)",
      "Houston, Texas (OSM search)",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(runAnalysisBundle).toHaveBeenCalledTimes(1);
  });

  it("keeps each explicit-coordinate label even when both coordinates are numerically equal", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const runAnalysisBundle = vi.fn(async (requests: AnalysisRequest[]) => requests.map(analysis));

    const output = await executeCompareHazardTool(
      {
        baseline: { place: "29.7604, -95.3698", time: "2024-07-07" },
        comparison: { place: "29.7604000,-95.3698000", time: "2024-07-08" },
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        question: "Compare wind evidence at these coordinates.",
      },
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, fetchImpl, now: () => NOW }
    ) as { scenarios: Array<{ place: string }> };

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(output.scenarios.map((scenario) => scenario.place)).toEqual([
      "29.7604, -95.3698 (agent coordinates)",
      "29.7604000,-95.3698000 (agent coordinates)",
    ]);
  });

  it("resolves different named places independently and completes with injected lookups", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const query = (JSON.parse(String(init?.body)) as { query: string }).query;
      const result = query === "Houston"
        ? { id: "houston-city", label: "Houston, Texas", lon: -95.3698, lat: 29.7604 }
        : { id: "austin-city", label: "Austin, Texas", lon: -97.7431, lat: 30.2672 };
      return new Response(JSON.stringify({ ok: true, results: [result] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const runAnalysisBundle = vi.fn(async (requests: AnalysisRequest[]) => requests.map(analysis));

    const output = await executeCompareHazardTool(
      {
        baseline: { place: "Houston", time: "2024-07-07" },
        comparison: { place: "Austin", time: "2024-07-08" },
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        question: "Compare the wind evidence in Houston and Austin.",
      },
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, fetchImpl, now: () => NOW }
    ) as { status: string };

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) =>
      (JSON.parse(String(init?.body)) as { query: string }).query
    )).toEqual(["Houston", "Austin"]);
    expect(runAnalysisBundle).toHaveBeenCalledTimes(1);
    expect(output.status).toBe("environmental_evidence_comparison");
  });

  it("does not share a named-place resolution across different choice ids", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: [
        { id: "springfield-illinois", label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
        { id: "springfield-missouri", label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const runAnalysisBundle = vi.fn(async (requests: AnalysisRequest[]) => requests.map(analysis));

    const output = await executeCompareHazardTool(
      {
        baseline: {
          place: "Springfield",
          place_choice_id: "place-springfield-illinois",
          time: "2024-07-07",
        },
        comparison: {
          place: " springfield ",
          place_choice_id: "place-springfield-missouri",
          time: "2024-07-08",
        },
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        question: "Compare wind evidence for the two selected Springfields.",
      },
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, fetchImpl, now: () => NOW }
    ) as { status: string };

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = runAnalysisBundle.mock.calls[0][0];
    expect(requests.map((request) => request.placeSelection.coordinate)).toEqual([
      { lon: -89.65, lat: 39.78 },
      { lon: -93.29, lat: 37.21 },
    ]);
    expect(output.status).toBe("environmental_evidence_comparison");
  });

  it("revalidates a comparison-only choice id instead of hiding a stale selection", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: [
        { id: "houston-city", label: "Houston, Texas", lon: -95.3698, lat: 29.7604 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const runAnalysisBundle = vi.fn();

    const output = await executeCompareHazardTool(
      {
        baseline: { place: "Houston", time: "2024-07-07" },
        comparison: {
          place: "houston",
          place_choice_id: "place-stale-houston",
          time: "2024-07-08",
        },
        hazard: "wind_storm",
      },
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, fetchImpl, now: () => NOW }
    );

    expect(output).toMatchObject({
      status: "needs_place_choice",
      ambiguous_scenario: "comparison",
      choices: [{ choice_id: "place-houston-city" }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(runAnalysisBundle).not.toHaveBeenCalled();
  });

  it("identifies the scenario when a named place is not found", async () => {
    const runAnalysisBundle = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, results: [] }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as unknown as typeof fetch;

    const output = await executeCompareHazardTool(
      {
        baseline: { place: "Missing place", time: "2024-07-07" },
        comparison: { place: "Houston", time: "2024-07-08" },
        hazard: "wind_storm",
      },
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, fetchImpl, now: () => NOW }
    );

    expect(output).toMatchObject({
      status: "place_not_found",
      failed_scenario: "baseline",
      ui_updated: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(runAnalysisBundle).not.toHaveBeenCalled();
  });

  it("preserves a geocode rate-limit reason and identifies the failed comparison scenario", async () => {
    const runAnalysisBundle = vi.fn();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const query = (JSON.parse(String(init?.body)) as { query: string }).query;
      if (query === "Houston") {
        return new Response(JSON.stringify({
          ok: true,
          results: [
            { id: "houston-city", label: "Houston, Texas", lon: -95.3698, lat: 29.7604 },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const output = await executeCompareHazardTool(
      {
        baseline: { place: "Houston", time: "2024-07-07" },
        comparison: { place: "Austin", time: "2024-07-08" },
        hazard: "wind_storm",
      },
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, fetchImpl, now: () => NOW }
    );

    expect(output).toMatchObject({
      status: "place_lookup_failed",
      reason: "rate_limited",
      failed_scenario: "comparison",
      ui_updated: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(runAnalysisBundle).not.toHaveBeenCalled();
  });

  it("preserves the full comparison when one scenario needs a place choice", async () => {
    const runAnalysisBundle = vi.fn();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const query = (JSON.parse(String(init?.body)) as { query: string }).query;
      const results = query === "Springfield"
        ? [
            { id: "illinois", label: "Springfield, Illinois", lon: -89.65, lat: 39.78 },
            { id: "missouri", label: "Springfield, Missouri", lon: -93.29, lat: 37.21 },
          ]
        : [{ id: "houston", label: "Houston, Texas", lon: -95.37, lat: 29.76 }];
      return new Response(JSON.stringify({ ok: true, results }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const input = {
      baseline: { place: "Springfield", time: "2026-08-28" },
      comparison: { place: "Houston", time: "2026-08-28" },
      hazard: "extreme_heat",
    };
    const output = await executeCompareHazardTool(input, OPTIONS, {
      runAnalysis: vi.fn(),
      runAnalysisBundle,
      fetchImpl,
      now: () => NOW,
    }) as Record<string, unknown>;

    expect(output).toMatchObject({
      status: "needs_place_choice",
      ambiguous_scenario: "baseline",
      after_user_choice: {
        preserve_all_other_arguments: true,
        set_selected_choice_at: "baseline.place_choice_id",
        retry_with_original_arguments: input,
      },
    });
    expect(runAnalysisBundle).not.toHaveBeenCalled();
  });

  it("publishes a bounded comparison contract", () => {
    const tool = createCompareHazardTool({ runAnalysis: vi.fn() });
    expect(tool.name).toBe("compare_environmental_evidence");
    expect(tool.description).toContain("Report every scenario and every chain in plain English");
    expect(COMPARE_HAZARD_INPUT_SCHEMA.required).toEqual(["baseline", "comparison", "hazard"]);
    expect(COMPARE_HAZARD_INPUT_SCHEMA.additionalProperties).toBe(false);
  });

  it("prioritizes an in-area NWS event report over a satellite visualization in Agent summaries", () => {
    const common = {
      observationId: "obs-common",
      variableName: "Observation",
      textValue: "available",
      dataMode: "historical" as const,
      provenance: {
        sourceId: "nasa_gibs_imerg" as const,
        sourceUrl: "https://example.test/gibs",
        retrievedAt: NOW.toISOString(),
        observedAt: "2026-08-28T00:00:00.000Z",
        product: "test",
        payloadHash: "a".repeat(64),
      },
    } satisfies Observation;
    const report: Observation = {
      ...common,
      observationId: "obs-nws-lsr",
      variableName: "NWS Local Storm Report: Flash flood",
      provenance: {
        ...common.provenance,
        sourceId: "nws_local_storm_reports",
        sourceUrl: "https://api.weather.gov/products/test",
      },
    };
    const evidence = {
      observations: [common, report],
    } as EvidenceObject;
    expect(orderedEvidenceObservations(evidence)[0].provenance.sourceId)
      .toBe("nws_local_storm_reports");
  });
});
