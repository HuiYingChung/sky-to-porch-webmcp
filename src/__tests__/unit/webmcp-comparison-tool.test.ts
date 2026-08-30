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
