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
import type {
  AgentPlaceLookupFeedbackContext,
  AgentPlaceLookupFeedbackSession,
} from "@/lib/webmcp/place-tool";

const NOW = new Date("2026-08-29T18:00:00.000Z");
const OPTIONS = { signal: new AbortController().signal } as WebMCP.ToolExecuteCallbackOptions;

function expectPublicToolOutput(output: unknown): void {
  const serialized = JSON.stringify(output);
  expect(serialized).not.toMatch(/"(?:analysis_id|source_id|included_chains)"\s*:/u);
  expect(serialized).not.toMatch(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/u
  );
}

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
    expectPublicToolOutput(output);
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

  it("returns all five checked candidates for an ambiguous comparison place", async () => {
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      id: `springfield-${index}`,
      label: `Springfield ${index + 1}`,
      lon: -90 - index,
      lat: 35 + index,
    }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: candidates,
    }), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const runAnalysisBundle = vi.fn();

    const output = await executeCompareHazardTool(
      {
        baseline: { place: "Springfield", time: "2024-07-07" },
        comparison: { place: "Houston", time: "2024-07-08" },
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
      },
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, fetchImpl, now: () => NOW }
    ) as { status: string; choices?: Array<{ label: string }> };

    expect(output.status).toBe("needs_place_choice");
    expect(output.choices).toHaveLength(5);
    expect(output.choices?.at(-1)?.label).toBe("Springfield 5");
    expect(runAnalysisBundle).not.toHaveBeenCalled();
  });

  it.each([
    "First comparison place",
    "Second comparison place",
  ])("rechecks invocation order after terminal feedback for the %s", async (blockedLabel) => {
    let latestInvocation = 0;
    let releaseFeedback!: () => void;
    const feedbackPending = new Promise<void>((resolve) => {
      releaseFeedback = resolve;
    });
    const terminalFeedbackStarted = vi.fn();
    const beginInvocation = () => {
      const invocation = ++latestInvocation;
      return () => invocation === latestInvocation;
    };
    const beginPlaceLookupFeedback = vi.fn(async (
      context: AgentPlaceLookupFeedbackContext
    ): Promise<AgentPlaceLookupFeedbackSession> => ({
      isCurrent: () => true,
      publish: vi.fn(async () => {
        if (context.context_label === blockedLabel) {
          terminalFeedbackStarted();
          await feedbackPending;
        }
        return true;
      }),
    }));
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const query = (JSON.parse(String(init?.body)) as { query: string }).query;
      return new Response(JSON.stringify({
        ok: true,
        results: [{
          id: `${query.toLowerCase()}-city`,
          label: `${query}, Texas`,
          lon: query === "Houston" ? -95.3698 : -97.7431,
          lat: query === "Houston" ? 29.7604 : 30.2672,
        }],
      }), { headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const runAnalysisBundle = vi.fn(async (requests: AnalysisRequest[]) =>
      requests.map(analysis));
    const dependencies = {
      runAnalysis: vi.fn(),
      runAnalysisBundle,
      fetchImpl,
      now: () => NOW,
      beginInvocation,
      beginPlaceLookupFeedback,
    };

    const older = executeCompareHazardTool(
      {
        baseline: { place: "Houston", time: "2024-07-07" },
        comparison: { place: "Austin", time: "2024-07-08" },
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
      },
      OPTIONS,
      dependencies
    );
    await vi.waitFor(() => expect(terminalFeedbackStarted).toHaveBeenCalledTimes(1));

    const invalid = await executeCompareHazardTool(
      {
        baseline: { place: "Dallas", time: "2024-07-07" },
        comparison: { place: "Austin", time: "2024-07-08" },
        hazard: "wind_storm",
        unexpected: true,
      },
      OPTIONS,
      dependencies
    );
    expect(invalid).toMatchObject({ status: "invalid_input", ui_updated: false });

    releaseFeedback();
    await expect(older).resolves.toMatchObject({
      status: "superseded",
      ui_updated: false,
    });
    expect(runAnalysisBundle).not.toHaveBeenCalled();
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
      "Houston, Texas (place search result)",
      "Houston, Texas (place search result)",
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
    expect(output.message).toBe(
      "Several places matched the first comparison place. Please choose one below. The current map and results have not changed."
    );
    expect(String(output.message)).not.toContain("PAUSE FOR USER");
    expect(runAnalysisBundle).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation from the comparison bundle", async () => {
    const controller = new AbortController();
    const runAnalysis = vi.fn();
    const runAnalysisBundle = vi.fn((
      _requests: AnalysisRequest[],
      _origin?: "agent",
      signal?: AbortSignal
    ): Promise<ActiveAnalysis[] | null> => new Promise((resolve) => {
      signal?.addEventListener("abort", () => resolve(null), { once: true });
    }));
    const pending = executeCompareHazardTool(
      {
        baseline: { place: "29.7604, -95.3698", time: "2026-08-28" },
        comparison: { place: "30.2672, -97.7431", time: "2026-08-27" },
        hazard: "wind_storm",
      },
      { signal: controller.signal },
      { runAnalysis, runAnalysisBundle, now: () => NOW }
    );
    await vi.waitFor(() => expect(runAnalysisBundle).toHaveBeenCalledTimes(1));

    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("does not claim or change the current view when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    const beginInvocation = vi.fn(() => () => true);
    const runAnalysis = vi.fn();
    const runAnalysisBundle = vi.fn();

    await expect(executeCompareHazardTool(
      {
        baseline: { place: "29.7604, -95.3698", time: "2026-08-28" },
        comparison: { place: "30.2672, -97.7431", time: "2026-08-27" },
        hazard: "wind_storm",
      },
      { signal: controller.signal },
      { runAnalysis, runAnalysisBundle, beginInvocation, now: () => NOW }
    )).rejects.toMatchObject({ name: "AbortError" });

    expect(beginInvocation).not.toHaveBeenCalled();
    expect(runAnalysisBundle).not.toHaveBeenCalled();
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("publishes a bounded comparison contract", () => {
    const tool = createCompareHazardTool({ runAnalysis: vi.fn() });
    expect(tool.name).toBe("compare_environmental_evidence");
    expect(tool.description).toContain("Report every scenario and every chain in plain English");
    expect(COMPARE_HAZARD_INPUT_SCHEMA.required).toEqual(["baseline", "comparison", "hazard"]);
    expect(COMPARE_HAZARD_INPUT_SCHEMA.additionalProperties).toBe(false);
  });

  it("uses public status and source names in comparison prose", async () => {
    const observation: Observation = {
      observationId: "obs-comparison-wind",
      variableName: "Peak wind gust",
      value: 21,
      unit: "m/s",
      dataMode: "historical",
      provenance: {
        sourceId: "noaa_ncei_global_hourly",
        sourceUrl: "https://example.test/wind",
        retrievedAt: NOW.toISOString(),
        observedAt: "2026-08-27T18:00:00.000Z",
        product: "NOAA GHCNh",
        payloadHash: "a".repeat(64),
      },
    };
    const runAnalysisBundle = vi.fn(async (requests: AnalysisRequest[]) =>
      requests.map((request): ActiveAnalysis => request.evidenceBundle?.scenarioId === "baseline"
        ? analysis(request)
        : {
            analysisId: "analysis-comparison-wind",
            origin: "agent",
            request,
            outcome: {
              hazardId: request.hazardId,
              result: {
                kind: "success",
                evidence: {
                  observations: [observation],
                  confidence: { level: "moderate" },
                  limitations: [],
                  missionAttributions: [],
                } as unknown as EvidenceObject,
              },
            } as ActiveAnalysis["outcome"],
            completedAt: NOW.toISOString(),
          })
    );
    const output = await executeCompareHazardTool(
      {
        baseline: { place: "29.7604, -95.3698", time: "2026-08-28" },
        comparison: { place: "30.2672, -97.7431", time: "2026-08-27" },
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        question: "Compare official wind gust observations.",
      },
      OPTIONS,
      { runAnalysis: vi.fn(), runAnalysisBundle, now: () => NOW }
    ) as {
      comparison: { differences: string[] };
      synthesis: { directly_observed: string[] };
      scenarios: Array<{
        id: string;
        chains: Array<{
          citation?: {
            source_name: string;
            product: string;
            observed: string;
          };
        }>;
      }>;
    };

    expect(output.comparison.differences.join(" ")).toMatch(
      /baseline not supported for this area; comparison official readings and reports returned/iu
    );
    expect(output.comparison.differences.join(" ")).not.toContain("unsupported_coverage");
    expect(output.synthesis.directly_observed.join(" ")).toContain(
      "NOAA NCEI Global Historical Climatology"
    );
    expect(output.synthesis.directly_observed.join(" ")).not.toContain(
      "noaa_ncei_global_hourly"
    );
    expect(output.scenarios.find((scenario) => scenario.id === "comparison")
      ?.chains[0]?.citation).toMatchObject({
        source_name: expect.stringContaining("NOAA NCEI Global Historical Climatology"),
        observed: "Aug 27, 2026, 6:00 PM UTC",
      });
    expectPublicToolOutput(output);
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
