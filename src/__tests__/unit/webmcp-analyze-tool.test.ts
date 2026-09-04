/// <reference types="webmcp-types" />

import { describe, expect, it, vi } from "vitest";
import type { EvidenceObject } from "@/contracts/evidence";
import type { ActiveAnalysis, AnalysisRequest } from "@/lib/analysis/types";
import {
  ANALYZE_HAZARD_INPUT_SCHEMA,
  MAX_OUTPUT_CHARACTERS,
  createAnalyzeHazardTool,
  executeAnalyzeHazardTool,
  resultStatusNameForOutput,
} from "@/lib/webmcp/analyze-tool";
import { placeChoiceId } from "@/lib/webmcp/place-resolution";
import type {
  AgentPlaceLookupFeedbackContext,
  AgentPlaceLookupFeedbackSession,
} from "@/lib/webmcp/place-tool";

const NOW = new Date("2026-08-26T18:00:00.000Z");

describe("agent-facing result status labels", () => {
  it.each([
    ["success", "Official readings and reports returned"],
    ["no_observation", "No matching readings or reports returned"],
    ["inconclusive_evidence", "Context returned; no direct reading"],
    ["stale_data", "Available readings are out of date"],
    ["unsupported_coverage", "Not supported for this area"],
    ["source_failure", "Official source unavailable"],
  ])("uses a specific public label for %s", (status, label) => {
    expect(resultStatusNameForOutput(status)).toBe(label);
    expect(resultStatusNameForOutput(status)).not.toBe("Information status unavailable");
  });
});

function toolOptions(signal = new AbortController().signal): WebMCP.ToolExecuteCallbackOptions {
  return { signal };
}

function expectPublicToolOutput(output: unknown): void {
  const serialized = JSON.stringify(output);
  expect(serialized).not.toMatch(/"(?:analysis_id|source_id|included_chains)"\s*:/u);
  expect(serialized).not.toMatch(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/u
  );
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
        product: "NOAA satellite fire detections",
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
      expect(property.description.length).toBeLessThanOrEqual(220);
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
      question: "What official wind observations were recorded?",
    });

    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    expect(output).toMatchObject({
      status: "source_failure",
      evidence: null,
      limitations: ["Deterministic provider failure boundary."],
      no_data_is_not_no_danger: true,
      required_answer_boundary: "no_observations_do_not_prove_safety",
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
      {
        place: "Springfield",
        place_choice_id: null,
        hazard: "fire_smoke",
        time: "latest_completed",
      },
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
        set_place_choice_id_to_selected_choice_id: true,
        preserve_original_place: true,
        preserve_other_arguments: true,
        retry_with_original_arguments: {
          place: "Springfield",
          hazard: "fire_smoke",
          analysis_scope: "related_context",
          concern: "general",
          radius_km: 25,
          time: "latest_completed",
        },
      },
    });
    expect("choices" in output ? output.choices : undefined).toEqual([
      {
        choice_id: placeChoiceId({
          label: "Springfield, Illinois",
          lon: -89.65,
          lat: 39.78,
          boundingBox: null,
          adminContext: {},
        }),
        label: "Springfield, Illinois",
      },
      {
        choice_id: placeChoiceId({
          label: "Springfield, Missouri",
          lon: -93.29,
          lat: 37.21,
          boundingBox: null,
          adminContext: {},
        }),
        label: "Springfield, Missouri",
      },
    ]);
    const message = "message" in output ? output.message : "";
    expect(message).toContain("Several places matched “Springfield”");
    expect(message).toContain("Please choose one below");
    expect(message).toContain("current map and results have not changed");
    expect(message).not.toContain("PAUSE FOR USER");
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("returns all five checked place candidates", async () => {
    const runAnalysis = vi.fn();
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      id: `springfield-${index}`,
      label: `Springfield ${index + 1}`,
      lon: -90 - index,
      lat: 35 + index,
    }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: candidates,
    }), { headers: { "Content-Type": "application/json" } }));

    const output = await executeAnalyzeHazardTool(
      {
        place: "Springfield",
        hazard: "fire_smoke",
        analysis_scope: "single_hazard_only",
        time: "latest_completed",
      },
      toolOptions(),
      { runAnalysis, fetchImpl, now: () => NOW }
    );

    expect(output.status).toBe("needs_place_choice");
    expect("choices" in output ? output.choices : []).toHaveLength(5);
    expect("choices" in output ? output.choices?.at(-1)?.label : undefined)
      .toBe("Springfield 5");
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("sanitizes an unexpected geocoder exception in both output and visible feedback", async () => {
    const rawError = [
      "C:\\services\\geocode-handler.ts:77",
      "550e8400-e29b-41d4-a716-446655440000",
      "sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ].join(" ");
    const feedback: Array<
      Parameters<AgentPlaceLookupFeedbackSession["publish"]>[0]
    > = [];
    const publish = vi.fn(async (
      receipt: Parameters<AgentPlaceLookupFeedbackSession["publish"]>[0]
    ) => {
      feedback.push(receipt);
      return true;
    });
    const runAnalysis = vi.fn();

    const output = await executeAnalyzeHazardTool(
      {
        place: "Houston",
        hazard: "fire_smoke",
        analysis_scope: "single_hazard_only",
        time: "latest_completed",
      },
      toolOptions(),
      {
        runAnalysis,
        fetchImpl: vi.fn(async () => {
          throw new Error(rawError);
        }),
        now: () => NOW,
        beginPlaceLookupFeedback: async () => ({
          isCurrent: () => true,
          publish,
        }),
      }
    );

    expect(output).toMatchObject({
      status: "place_lookup_failed",
      message: "Place search was unavailable; no evidence query was run.",
    });
    expect(feedback).toEqual([
      expect.objectContaining({
        status: "place_lookup_failed",
        query: "Houston",
        operation: "analysis",
      }),
    ]);
    const publicText = JSON.stringify({ output, feedback });
    expect(publicText).not.toContain(rawError);
    expect(publicText).not.toContain("geocode-handler.ts");
    expect(publicText).not.toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(publicText).not.toContain("0123456789abcdef0123456789abcdef");
    expectPublicToolOutput(output);
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("does not start an analysis when a newer invalid request arrives during terminal place feedback", async () => {
    let latestInvocation = 0;
    let releaseFeedback!: () => void;
    const feedbackPending = new Promise<void>((resolve) => {
      releaseFeedback = resolve;
    });
    const beginInvocation = () => {
      const invocation = ++latestInvocation;
      return () => invocation === latestInvocation;
    };
    const terminalFeedbackStarted = vi.fn();
    const beginPlaceLookupFeedback = vi.fn(async (
      context: AgentPlaceLookupFeedbackContext
    ): Promise<AgentPlaceLookupFeedbackSession> => ({
      isCurrent: () => true,
      publish: vi.fn(async () => {
        if (context.query === "Houston") {
          terminalFeedbackStarted();
          await feedbackPending;
        }
        return true;
      }),
    }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: [{
        id: "houston-city",
        label: "Houston, Texas",
        lon: -95.3698,
        lat: 29.7604,
      }],
    }), { headers: { "Content-Type": "application/json" } }));
    const runAnalysis = vi.fn(async (request: AnalysisRequest) =>
      successfulFireAnalysis(request));
    const dependencies = {
      runAnalysis,
      fetchImpl,
      now: () => NOW,
      beginInvocation,
      beginPlaceLookupFeedback,
    };

    const older = executeAnalyzeHazardTool(
      {
        place: "Houston",
        hazard: "fire_smoke",
        analysis_scope: "single_hazard_only",
        time: "latest_completed",
      },
      toolOptions(),
      dependencies
    );
    await vi.waitFor(() => expect(terminalFeedbackStarted).toHaveBeenCalledTimes(1));

    const invalid = await executeAnalyzeHazardTool(
      { place: "Austin", hazard: "not-a-hazard", time: "latest_completed" },
      toolOptions(),
      dependencies
    );
    expect(invalid).toMatchObject({ status: "invalid_input", ui_updated: false });

    releaseFeedback();
    await expect(older).resolves.toMatchObject({
      status: "superseded",
      ui_updated: false,
    });
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("rechecks cancellation after terminal place feedback", async () => {
    let releaseFeedback!: () => void;
    const feedbackPending = new Promise<void>((resolve) => {
      releaseFeedback = resolve;
    });
    const publish = vi.fn(async () => {
      await feedbackPending;
      return true;
    });
    const controller = new AbortController();
    const runAnalysis = vi.fn();
    const pending = executeAnalyzeHazardTool(
      {
        place: "Houston",
        hazard: "fire_smoke",
        analysis_scope: "single_hazard_only",
        time: "latest_completed",
      },
      toolOptions(controller.signal),
      {
        runAnalysis,
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({
          ok: true,
          results: [{ id: "houston-city", label: "Houston", lon: -95.36, lat: 29.76 }],
        }), { headers: { "Content-Type": "application/json" } })),
        now: () => NOW,
        beginPlaceLookupFeedback: async () => ({ isCurrent: () => true, publish }),
      }
    );
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));

    controller.abort(new DOMException("cancelled", "AbortError"));
    releaseFeedback();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("tells the agent to wait for the person, then resume the unfinished task", () => {
    const tool = createAnalyzeHazardTool({ runAnalysis: vi.fn() });

    expect(tool.description).toContain("First named-place call");
    expect(tool.description).toContain("set place_choice_id=null");
    expect(tool.description).toContain("never pre-qualify place");
    expect(tool.description).toContain("ask and wait");
    expect(tool.description).toContain("After the reply");
    expect(tool.description).toContain("copy selected choice_id to place_choice_id");
    expect(tool.description).toContain("execute and finish");
    expect(tool.description).toContain("unqualified storm/thunderstorm/severe weather");
    expect(tool.description).toContain("season/place/goal alone implies none");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties.analysis_scope.description)
      .toContain("separate wind and water chains run");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties.question.description)
      .toContain("MUST copy the person's wording for unqualified storm");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties.hazard.description)
      .toContain("never infer from season/place/concern/generic conditions");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties.hazard.description)
      .toContain("Volcano + air/heat uses earth_volcanoes/related_context");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties.place.description)
      .toContain("'near my Houston home' becomes 'Houston'");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties.place_choice_id.description)
      .toContain("Initial call: use null");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties.place_choice_id.description)
      .toContain("Never derive it");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties.concern.description)
      .toContain("pets for dog/cat/animal");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties.concern.description)
      .toContain("home whenever home/roof/property/insurer appears");
    expect(ANALYZE_HAZARD_INPUT_SCHEMA.properties.concern.description)
      .toContain("Never map pet symptoms to health");
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

    if (
      ambiguous.status !== "needs_place_choice" ||
      !("choices" in ambiguous) ||
      !ambiguous.choices
    ) {
      throw new Error("Expected Springfield ambiguity choices");
    }
    const completed = await executeAnalyzeHazardTool(
      {
        place: "Springfield",
        place_choice_id: ambiguous.choices[0].choice_id,
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
        label: "Springfield, Illinois (place search result)",
        selectionMethod: "place_search",
      },
    });
    expect(completed.ui_updated).toBe(true);
  });

  it("resumes an identical-label Houston choice by stable id without looping", async () => {
    const runAnalysis = vi.fn(async (request: AnalysisRequest) => successfulFireAnalysis(request));
    const candidates = [
      {
        id: "osm-r-2688911",
        label: "Houston, Texas, United States",
        lon: -95.3676974,
        lat: 29.7589382,
        boundingBox: {
          west: -95.9,
          south: 29.5,
          east: -95.0,
          north: 30.1,
        },
      },
      {
        id: "osm-r-1840945",
        label: "Houston, Texas, United States",
        lon: -95.390805,
        lat: 31.3378465,
      },
    ];
    let lookupCount = 0;
    const fetchImpl = vi.fn(async () => {
      lookupCount += 1;
      return new Response(JSON.stringify({
        ok: true,
        results: lookupCount === 1 ? candidates : [...candidates].reverse(),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const ambiguous = await executeAnalyzeHazardTool(
      {
        place: "Houston",
        hazard: "wind_storm",
        concern: "home",
        time: "2024-07-08",
        analysis_scope: "single_hazard_only",
        question: "What official wind observations were recorded?",
      },
      toolOptions(),
      { runAnalysis, fetchImpl, now: () => NOW }
    );
    expect(ambiguous).toMatchObject({
      status: "needs_place_choice",
      ui_updated: false,
      choices: [
        { choice_id: "place-osm-r-2688911", label: "Houston, Texas, United States" },
        { choice_id: "place-osm-r-1840945", label: "Houston, Texas, United States" },
      ],
    });
    expect(runAnalysis).not.toHaveBeenCalled();

    const completed = await executeAnalyzeHazardTool(
      {
        place: "Houston",
        place_choice_id: "place-osm-r-2688911",
        hazard: "wind_storm",
        concern: "home",
        time: "2024-07-08",
        analysis_scope: "single_hazard_only",
        question: "What official wind observations were recorded?",
      },
      toolOptions(),
      { runAnalysis, fetchImpl, now: () => NOW }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0][0]).toMatchObject({
      hazardId: "wind_storm",
      concern: "home",
      placeSelection: {
        label: "Houston, Texas, United States (place search result)",
        coordinate: { lon: -95.3676974, lat: 29.7589382 },
        placeBoundingBox: {
          west: -95.9,
          south: 29.5,
          east: -95.0,
          north: 30.1,
        },
      },
    });
    expect(completed.ui_updated).toBe(true);
  });

  it("fails closed with refreshed choices when a prior place choice id no longer matches", async () => {
    const runAnalysis = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      results: [
        { id: "osm-r-2688911", label: "Houston (city), Texas", lon: -95.36, lat: 29.75 },
        { id: "osm-r-1840945", label: "Houston (county), Texas", lon: -95.39, lat: 31.33 },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const output = await executeAnalyzeHazardTool(
      {
        place: "Houston",
        place_choice_id: "place-osm-r-expired",
        hazard: "wind_storm",
        time: "2024-07-08",
        analysis_scope: "single_hazard_only",
      },
      toolOptions(),
      { runAnalysis, fetchImpl, now: () => NOW }
    );

    expect(output).toMatchObject({
      status: "needs_place_choice",
      ui_updated: false,
      choices: [
        { choice_id: "place-osm-r-2688911" },
        { choice_id: "place-osm-r-1840945" },
      ],
    });
    expect("message" in output ? output.message : "").toContain(
      "earlier choice is no longer available"
    );
    expect(runAnalysis).not.toHaveBeenCalled();
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
      status_label: "Official readings and reports returned",
      hazard_label: "Fire & Smoke",
      display_summary: expect.stringMatching(/Fire & Smoke.*official readings and reports returned/iu),
      agent_response_contract: {
        style: "plain_english",
        use_display_summary_and_labels: true,
        use_source_name: true,
        never_repeat_internal_ids_source_keys_or_enum_names: true,
      },
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
        source_name: "NOAA HMS Fire Detection Points",
        product: "NOAA satellite fire detections",
        observed: "Aug 25, 2026, 12:00 PM UTC",
        retrieved: "Aug 26, 2026, 5:00 PM UTC",
      }],
    });
    expect("evidence" in output ? output.evidence?.observations[0] : undefined)
      .toMatchObject({
        source_name: "NOAA HMS Fire Detection Points",
        observed: "Aug 25, 2026, 12:00 PM UTC",
      });
    expect("display_summary" in output ? output.display_summary : "")
      .not.toContain("noaa_hms_fire_points");
    expectPublicToolOutput(output);
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
    expect(output).toMatchObject({
      required_answer_boundary: "no_observations_do_not_prove_safety",
    });
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
        question: hazardId === "wind_storm"
          ? "What official wind observations were recorded?"
          : "What official rainfall and gage observations were recorded?",
      },
      toolOptions(),
      { runAnalysis, now: () => NOW }
    );

    expect(output).toMatchObject({ evidence_scope: evidenceScope });
  });

  it("overrides a narrow Agent scope and gathers both chains for the Houston 2026-08-28 generic storm regression", async () => {
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
        analysis_scope: "single_hazard_only",
        concern: "home",
        time: "2026-08-28",
        question: "Was there a storm around Houston on August 28, 2026?",
      },
      toolOptions(),
      { runAnalysis, now: () => new Date("2026-08-29T12:00:00.000Z") }
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
      answer_order: [
        "strongest_supported_assessment",
        "observation_values_times_and_official_citations",
        "direct_observation_then_labelled_inference",
        "confidence_and_evidence_that_would_change_it",
      ],
      overall_summary: "Flood & Heavy Rain: not supported for this area; Wind & Storm: not supported for this area",
      chains: [
        {
          hazard: "flood_storm",
          name: "Flood & Heavy Rain",
          status_summary: "not supported for this area",
          evidence_scope: "regional_water_and_rain_observations",
        },
        {
          hazard: "wind_storm",
          name: "Wind & Storm",
          status_summary: "not supported for this area",
          evidence_scope: "regional_wind_observations",
        },
      ],
    });
    expectPublicToolOutput(output);
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_OUTPUT_CHARACTERS);
  });

  it.each([
    ["wind_storm", 1],
    ["wind_storm", 25],
    ["wind_storm", 50],
    ["wind_storm", 250],
    ["flood_storm", 1],
    ["flood_storm", 25],
    ["flood_storm", 50],
    ["flood_storm", 250],
  ] as const)(
    "fails open from %s to both storm chains at %i km when the Agent omits the person's question",
    async (primaryHazard, radiusKm) => {
      const runAnalysis = vi.fn(async (request: AnalysisRequest): Promise<ActiveAnalysis> => ({
        analysisId: `analysis-${radiusKm}-${request.hazardId}`,
        origin: "agent",
        request,
        outcome: {
          hazardId: request.hazardId,
          result: { kind: "no_observation", rejectionReason: `No ${request.hazardId} observation.` },
        } as ActiveAnalysis["outcome"],
        completedAt: "2026-08-29T12:00:01.000Z",
      }));

      const output = await executeAnalyzeHazardTool(
        {
          place: "29.7604, -95.3698",
          hazard: primaryHazard,
          analysis_scope: "single_hazard_only",
          concern: "general",
          radius_km: radiusKm,
          time: "2026-08-28",
        },
        toolOptions(),
        { runAnalysis, now: () => new Date("2026-08-29T12:00:00.000Z") }
      );

      const expectedHazards = primaryHazard === "wind_storm"
        ? ["flood_storm", "wind_storm"]
        : ["wind_storm", "flood_storm"];
      expect(runAnalysis.mock.calls.map(([request]) => request.hazardId))
        .toEqual(expectedHazards);
      expect(runAnalysis.mock.calls.every(([request]) =>
        request.placeSelection.analysisArea.radiusKm === radiusKm
      )).toBe(true);
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
        },
        request: { radius_km: radiusKm, analysis_scope: "related_context" },
        chains: expectedHazards.map((hazard) => ({ hazard })),
      });
      expectPublicToolOutput(output);
    }
  );

  it("widens generic storm wording even when the Agent selects the water enum", async () => {
    const runAnalysis = vi.fn(async (request: AnalysisRequest): Promise<ActiveAnalysis> => ({
      analysisId: `analysis-water-primary-${request.hazardId}`,
      origin: "agent",
      request,
      outcome: {
        hazardId: request.hazardId,
        result: { kind: "no_observation", rejectionReason: "Bounded test result." },
      } as ActiveAnalysis["outcome"],
      completedAt: "2026-08-29T12:00:01.000Z",
    }));

    await executeAnalyzeHazardTool(
      {
        place: "29.7604, -95.3698",
        hazard: "flood_storm",
        analysis_scope: "single_hazard_only",
        radius_km: 75,
        time: "2026-08-28",
        question: "Was there a storm around Houston on August 28, 2026?",
      },
      toolOptions(),
      { runAnalysis, now: () => new Date("2026-08-29T12:00:00.000Z") }
    );

    expect(runAnalysis.mock.calls.map(([request]) => request.hazardId)).toEqual([
      "wind_storm",
      "flood_storm",
    ]);
  });

  it("keeps an explicit wind-gust storm question on the single wind chain", async () => {
    const runAnalysis = vi.fn(async (request: AnalysisRequest): Promise<ActiveAnalysis> => ({
      analysisId: "analysis-explicit-wind",
      origin: "agent",
      request,
      outcome: {
        hazardId: "wind_storm",
        result: { kind: "unsupported_coverage", rejectionReason: "Bounded test result." },
      },
      completedAt: "2026-08-29T12:00:01.000Z",
    }));

    await executeAnalyzeHazardTool(
      {
        place: "29.7604, -95.3698",
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        time: "2026-08-28",
        question: "What maximum wind gust was recorded during the storm in Houston?",
      },
      toolOptions(),
      { runAnalysis, now: () => new Date("2026-08-29T12:00:00.000Z") }
    );

    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0][0].hazardId).toBe("wind_storm");
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
      chains: [
        {
          hazard: "flood_storm",
          citation: {
            source_name: expect.stringContaining("NASA GIBS IMERG"),
            observed: expect.stringContaining("Jul 8, 2024"),
          },
        },
        {
          hazard: "wind_storm",
          citation: {
            source_name: expect.stringContaining("NOAA NCEI Global"),
            observed: expect.stringContaining("Jul 8, 2024"),
          },
        },
      ],
    });
    expectPublicToolOutput(output);
    expect(JSON.stringify(output)).not.toContain("nasa_gibs_imerg");
    expect(JSON.stringify(output)).not.toContain("noaa_ncei_global_hourly");
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
        {
          hazard: "air_quality",
          citation: {
            source_name: expect.stringContaining("NASA GIBS MODIS"),
            observed: expect.stringContaining("Aug 25, 2026"),
          },
        },
        {
          hazard: "fire_smoke",
          citation: {
            source_name: expect.stringContaining("NOAA HMS Fire"),
            observed: expect.stringContaining("Aug 25, 2026"),
          },
        },
      ],
    });
    expectPublicToolOutput(output);
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
      chains: expectedHazards.map((expectedHazard) => ({ hazard: expectedHazard })),
    });
    expectPublicToolOutput(output);
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
      chains: [
        { hazard: "air_quality" },
        { hazard: "extreme_heat" },
        { hazard: "earth_volcanoes" },
      ],
    });
    expectPublicToolOutput(output);
  });

  it("propagates caller cancellation from a related-context bundle", async () => {
    const controller = new AbortController();
    const runAnalysis = vi.fn();
    const runAnalysisBundle = vi.fn((
      _requests: AnalysisRequest[],
      _origin?: "agent",
      signal?: AbortSignal
    ): Promise<ActiveAnalysis[] | null> => new Promise((resolve) => {
      signal?.addEventListener("abort", () => resolve(null), { once: true });
    }));
    const pending = executeAnalyzeHazardTool(
      {
        place: "19.7074, -155.0885",
        hazard: "earth_volcanoes",
        time: "latest_completed",
      },
      toolOptions(controller.signal),
      { runAnalysis, runAnalysisBundle, now: () => NOW }
    );
    await vi.waitFor(() => expect(runAnalysisBundle).toHaveBeenCalledTimes(1));

    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(runAnalysis).not.toHaveBeenCalled();
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
    [
      {
        place: "Houston",
        place_choice_id: "place-!",
        hazard: "wind_storm",
        time: "2024-07-08",
      },
      "copied unchanged",
    ],
    [
      {
        place: "29.7604, -95.3698",
        place_choice_id: "place-osm-r-2688911",
        hazard: "wind_storm",
        time: "2024-07-08",
      },
      "cannot be combined",
    ],
  ])("fails closed on invalid input %#", async (input, _expectedMessage) => {
    const runAnalysis = vi.fn();
    const output = await executeAnalyzeHazardTool(
      input,
      toolOptions(),
      { runAnalysis, now: () => NOW }
    );

    expect(output.status).toBe("invalid_input");
    expect("message" in output ? output.message : "").toBe(
      "We couldn’t use this environmental request. Check the place, topic, date, and area size, then try again."
    );
    expect("message" in output ? output.message : "").not.toContain(_expectedMessage);
    expectPublicToolOutput(output);
    expect(runAnalysis).not.toHaveBeenCalled();
  });
});
