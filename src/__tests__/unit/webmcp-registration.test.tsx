/// <reference types="webmcp-types" />

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebMcpBridge } from "@/components/webmcp/webmcp-bridge";
import type { ActiveAnalysis, AnalysisRequest } from "@/lib/analysis/types";
import { buildAgentCoordinateSelection } from "@/lib/location/selection";
import { createInitialEnvironmentalMapState } from "@/lib/map/environmental-map-state";

const REGISTERED_TOOL_NAMES = [
  "analyze_environmental_hazard",
  "compare_environmental_evidence",
  "get_sky_to_porch_help_and_demos",
  "get_environmental_source_coverage",
  "look_up_place_location",
  "set_environmental_map_layers",
  "inspect_current_environmental_evidence",
  "prepare_storm_claim_discussion",
] as const;

function windHomeAnalysis(analysisId = "analysis-wind-home"): ActiveAnalysis {
  return {
    analysisId,
    origin: "agent",
    request: {
      hazardId: "wind_storm",
      concern: "home",
      placeSelection: buildAgentCoordinateSelection(
        "Houston",
        { lon: -95.36, lat: 29.76 },
        25,
        "custom",
        "2024-07-08T00:00:00.000Z",
        "2024-07-08T23:59:59.000Z"
      ),
    },
    outcome: {
      hazardId: "wind_storm",
      result: {
        kind: "success",
        claimDiscussion: {
          title: "Storm claim discussion preparation",
          assessmentSummary: "Official regional wind evidence makes wind contribution plausible.",
          assessmentConfidence: "moderate",
          supportedStatements: ["Regional wind context is present."],
          notEstablished: ["Property damage is not established."],
          documentationChecklist: ["Photograph observed damage."],
          officialGuidance: [{ label: "TDI", url: "https://www.tdi.texas.gov/" }],
        },
      },
    },
    completedAt: "2026-08-26T12:00:00.000Z",
  };
}

function relatedFloodAnalysis(
  analysisId: string,
  kind: "no_observation" | "source_failure"
): ActiveAnalysis {
  const related = windHomeAnalysis(analysisId);
  related.request.hazardId = "flood_storm";
  related.request.concern = "general";
  related.outcome = {
    hazardId: "flood_storm",
    result: { kind },
  } as ActiveAnalysis["outcome"];
  return related;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  Reflect.deleteProperty(document, "modelContext");
  vi.unstubAllGlobals();
});

describe("WebMcpBridge", () => {
  it("publishes the full named-place lifecycle for analyze, compare, and map tools", async () => {
    vi.stubGlobal("fetch", vi.fn(async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query === "Springfield") {
        return new Response(JSON.stringify({
          ok: true,
          results: [
            {
              id: "private-illinois",
              label: "Springfield, Illinois, United States",
              lon: -89.6501,
              lat: 39.7817,
              boundingBox: {
                west: -89.7,
                south: 39.72,
                east: -89.58,
                north: 39.84,
              },
              adminContext: {
                city: "Springfield",
                state: "Illinois",
                country: "United States",
              },
            },
            {
              id: "private-massachusetts",
              label: "Springfield, Massachusetts, United States",
              lon: -72.5898,
              lat: 42.1015,
              adminContext: {
                city: "Springfield",
                state: "Massachusetts",
                country: "United States",
              },
            },
          ],
        }), { headers: { "Content-Type": "application/json" } });
      }
      if (body.query === "Atlantis") {
        return new Response(JSON.stringify({ ok: true, results: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("", { status: 429 });
    }));
    const registerTool = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    const publishAgentPlaceLookupReceipt = vi.fn().mockResolvedValue(undefined);
    const runAnalysis = vi.fn();
    const applyEnvironmentalMapUpdate = vi.fn(() => ({
      mapState: createInitialEnvironmentalMapState(),
      analysisCleared: false,
    }));
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <WebMcpBridge
          runAnalysis={runAnalysis}
          applyEnvironmentalMapUpdate={applyEnvironmentalMapUpdate}
          publishAgentPlaceLookupReceipt={publishAgentPlaceLookupReceipt}
        />
      );
    });
    const tools = registerTool.mock.calls.map(([tool]) => tool as WebMCP.ModelContextTool);
    const analyzeTool = tools.find((tool) => tool.name === "analyze_environmental_hazard");
    const compareTool = tools.find((tool) => tool.name === "compare_environmental_evidence");
    const mapTool = tools.find((tool) => tool.name === "set_environmental_map_layers");
    if (!analyzeTool || !compareTool || !mapTool) {
      throw new Error("named-place tools were not registered");
    }
    const executeOptions = { signal: new AbortController().signal };

    await expect(analyzeTool.execute({
      place: "Springfield",
      hazard: "extreme_heat",
      analysis_scope: "single_hazard_only",
      time: "2026-08-25",
    }, executeOptions)).resolves.toMatchObject({
      status: "needs_place_choice",
      ui_updated: false,
    });
    await expect(compareTool.execute({
      baseline: { place: "Atlantis", time: "2026-08-25" },
      comparison: { place: "Atlantis", time: "2026-08-26" },
      hazard: "extreme_heat",
      analysis_scope: "single_hazard_only",
    }, executeOptions)).resolves.toMatchObject({
      status: "place_not_found",
      ui_updated: false,
    });
    await expect(mapTool.execute({
      layers: { rain_satellite: true },
      place: "Rate Limited Place",
      date: "2026-08-25",
    }, executeOptions)).resolves.toMatchObject({
      status: "place_lookup_failed",
      reason: "rate_limited",
      ui_updated: false,
    });
    await expect(analyzeTool.execute({
      place: "Austin",
      hazard: "not-a-hazard",
      time: "2026-08-25",
    }, executeOptions)).resolves.toMatchObject({
      status: "invalid_input",
      ui_updated: false,
    });
    await expect(compareTool.execute({
      baseline: { place: "Austin", time: "2026-08-25" },
      comparison: {},
      hazard: "extreme_heat",
    }, executeOptions)).resolves.toMatchObject({
      status: "invalid_input",
      ui_updated: false,
    });
    await expect(mapTool.execute({
      layers: { unsupported_layer: true },
    }, executeOptions)).resolves.toMatchObject({
      status: "invalid_input",
      ui_updated: false,
    });

    expect(publishAgentPlaceLookupReceipt.mock.calls.map(([receipt]) => ({
      status: receipt.status,
      query: receipt.query,
      operation: receipt.operation,
      contextLabel: receipt.context_label,
    }))).toEqual([
      {
        status: "lookup_pending",
        query: "Springfield",
        operation: "analysis",
        contextLabel: undefined,
      },
      {
        status: "needs_place_choice",
        query: "Springfield",
        operation: "analysis",
        contextLabel: undefined,
      },
      {
        status: "lookup_pending",
        query: "Atlantis",
        operation: "comparison",
        contextLabel: "Both comparison places",
      },
      {
        status: "place_not_found",
        query: "Atlantis",
        operation: "comparison",
        contextLabel: "Both comparison places",
      },
      {
        status: "lookup_pending",
        query: "Rate Limited Place",
        operation: "map",
        contextLabel: undefined,
      },
      {
        status: "place_lookup_failed",
        query: "Rate Limited Place",
        operation: "map",
        contextLabel: undefined,
      },
      {
        status: "invalid_input",
        query: "Austin",
        operation: "analysis",
        contextLabel: undefined,
      },
      {
        status: "invalid_input",
        query: "Austin",
        operation: "comparison",
        contextLabel: "Comparison request",
      },
      {
        status: "invalid_input",
        query: "",
        operation: "map",
        contextLabel: undefined,
      },
    ]);
    expect(publishAgentPlaceLookupReceipt.mock.calls[1][0].choices).toEqual([
      expect.objectContaining({
        label: "Springfield, Illinois, United States",
        representative_point: {
          longitude: -89.6501,
          latitude: 39.7817,
        },
        bounding_box: expect.objectContaining({
          west: -89.7,
          south: 39.72,
          east: -89.58,
          north: 39.84,
        }),
        admin_context: expect.objectContaining({ state: "Illinois" }),
      }),
      expect.objectContaining({
        label: "Springfield, Massachusetts, United States",
        admin_context: expect.objectContaining({ state: "Massachusetts" }),
      }),
    ]);
    expect(publishAgentPlaceLookupReceipt.mock.calls.at(-3)?.[0].message).toBe(
      "We couldn’t start this environmental check. Check the place, topic, date, and area size, then try again. Your current map and results have not changed."
    );
    expect(publishAgentPlaceLookupReceipt.mock.calls.at(-2)?.[0].message).toBe(
      "We couldn’t start this comparison. Check the place, topic, date, and area size, then try again. Your current map and results have not changed."
    );
    expect(publishAgentPlaceLookupReceipt.mock.calls.at(-1)?.[0].message).toBe(
      "We couldn’t start this map update. Check the place, date, area size, and map choices, then try again. Your current map and results have not changed."
    );
    expect(runAnalysis).not.toHaveBeenCalled();
    expect(applyEnvironmentalMapUpdate).not.toHaveBeenCalled();
  });

  it("shares invocation order across overlapping named-place analyze and compare calls", async () => {
    const pendingByPlace = new Map<string, (response: Response) => void>();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      return new Promise<Response>((resolve) => {
        pendingByPlace.set(body.query, resolve);
      });
    }));
    const registerTool = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    const runAnalysis = vi.fn();
    const runAnalysisBundle = vi.fn(async (requests: AnalysisRequest[]) => requests.map((request, index) => ({
      analysisId: `comparison-${index}`,
      origin: "agent" as const,
      request,
      outcome: {
        hazardId: request.hazardId,
        result: {
          kind: "unsupported_coverage",
          rejectionReason: "Bounded coordinator test result.",
        },
      } as ActiveAnalysis["outcome"],
      completedAt: "2026-08-26T12:00:00.000Z",
    })));
    let latestInvocation = 0;
    const beginContextMutationInvocation = vi.fn(() => {
      const invocation = ++latestInvocation;
      return () => invocation === latestInvocation;
    });
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <WebMcpBridge
          runAnalysis={runAnalysis}
          runAnalysisBundle={runAnalysisBundle}
          beginContextMutationInvocation={beginContextMutationInvocation}
        />
      );
    });
    const tools = registerTool.mock.calls.map(([tool]) => tool as WebMCP.ModelContextTool);
    const analyzeTool = tools.find((tool) => tool.name === "analyze_environmental_hazard");
    const compareTool = tools.find((tool) => tool.name === "compare_environmental_evidence");
    if (!analyzeTool || !compareTool) throw new Error("analysis tools were not registered");
    const executeOptions = { signal: new AbortController().signal };

    const olderAnalyze = analyzeTool.execute({
      place: "Austin",
      hazard: "wind_storm",
      analysis_scope: "single_hazard_only",
      time: "2024-07-08",
      question: "What official wind observations were recorded?",
    }, executeOptions);
    await vi.waitFor(() => expect(pendingByPlace.has("Austin")).toBe(true));
    const newerCompare = compareTool.execute({
      baseline: { place: "Dallas", time: "2024-07-08" },
      comparison: { place: "Dallas", time: "2024-07-09" },
      hazard: "extreme_heat",
      analysis_scope: "single_hazard_only",
    }, executeOptions);
    await vi.waitFor(() => expect(pendingByPlace.has("Dallas")).toBe(true));

    pendingByPlace.get("Austin")?.(new Response(JSON.stringify({
      ok: true,
      results: [{ id: "osm-austin", label: "Austin, Texas", lon: -97.74, lat: 30.27 }],
    }), { headers: { "Content-Type": "application/json" } }));
    await expect(olderAnalyze).resolves.toMatchObject({
      status: "superseded",
      ui_updated: false,
    });
    expect(runAnalysis).not.toHaveBeenCalled();

    pendingByPlace.get("Dallas")?.(new Response(JSON.stringify({
      ok: true,
      results: [{ id: "osm-dallas", label: "Dallas, Texas", lon: -96.8, lat: 32.78 }],
    }), { headers: { "Content-Type": "application/json" } }));
    await expect(newerCompare).resolves.toMatchObject({
      status: "environmental_evidence_comparison",
      ui_updated: true,
    });
    expect(runAnalysisBundle).toHaveBeenCalledTimes(1);
    expect(beginContextMutationInvocation).toHaveBeenCalledTimes(2);
  });

  it("registers the complete stable tool set through one lifecycle signal", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const onStatusChange = vi.fn();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    const runAnalysis = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <WebMcpBridge
          runAnalysis={runAnalysis}
          onStatusChange={onStatusChange}
        />
      );
    });

    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual(
      REGISTERED_TOOL_NAMES
    );
    const registrationSignals = registerTool.mock.calls.map(([, options]) => options.signal);
    expect(registrationSignals.every((signal) => signal.aborted === false)).toBe(true);
    expect(new Set(registrationSignals).size).toBe(1);
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      "registering",
      "ready",
    ]);

    act(() => root?.unmount());
    root = null;
    expect(registrationSignals.every((signal) => signal.aborted === true)).toBe(true);
  });

  it("is a no-op in browsers without WebMCP", async () => {
    const onStatusChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <WebMcpBridge
          runAnalysis={vi.fn()}
          onStatusChange={onStatusChange}
        />
      );
    });

    expect(container.innerHTML).toBe("");
    expect(onStatusChange).toHaveBeenCalledWith("unsupported");
  });

  it("aborts the complete registration group if one tool fails", async () => {
    const signals: AbortSignal[] = [];
    const failure = new Error("coverage registration failed");
    const registerTool = vi.fn().mockImplementation(
      (tool: WebMCP.ModelContextTool, options: WebMCP.ModelContextRegisterToolOptions) => {
        signals.push(options.signal!);
        return tool.name === "get_environmental_source_coverage"
          ? Promise.reject(failure)
          : Promise.resolve();
      }
    );
    const onStatusChange = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <WebMcpBridge
          runAnalysis={vi.fn()}
          onStatusChange={onStatusChange}
        />
      );
    });

    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      "registering",
      "error",
    ]);
    expect(signals).toHaveLength(REGISTERED_TOOL_NAMES.length);
    expect(new Set(signals).size).toBe(1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      "WebMCP tool registration failed",
      failure
    );
    consoleError.mockRestore();
  });

  it("keeps captured contextual handles stable while they read the latest committed state", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const runAnalysis = vi.fn();
    const secondRunAnalysis = vi.fn();
    const firstOpen = vi.fn();
    const secondOpen = vi.fn();
    const firstStatus = vi.fn();
    const secondStatus = vi.fn();
    const firstRelated = relatedFloodAnalysis("related-first", "no_observation");
    const secondRelated = relatedFloodAnalysis("related-second", "source_failure");
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container!);
      root.render(
        <WebMcpBridge
          runAnalysis={runAnalysis}
          onOpenStormClaimDiscussion={firstOpen}
          onStatusChange={firstStatus}
        />
      );
    });

    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual(
      REGISTERED_TOOL_NAMES
    );
    const registeredTools = registerTool.mock.calls.map(([tool]) => tool as WebMCP.ModelContextTool);
    const inspectTool = registeredTools.find(
      (tool) => tool.name === "inspect_current_environmental_evidence"
    );
    const claimTool = registeredTools.find(
      (tool) => tool.name === "prepare_storm_claim_discussion"
    );
    if (!inspectTool || !claimTool) throw new Error("stable contextual tools were not registered");
    const registrationSignals = registerTool.mock.calls.map(([, options]) => options.signal as AbortSignal);
    const executeOptions = { signal: new AbortController().signal };

    await expect(inspectTool.execute({}, executeOptions)).resolves.toMatchObject({
      status: "no_active_analysis",
      ui_updated: false,
    });
    await expect(claimTool.execute({}, executeOptions)).resolves.toMatchObject({
      status: "no_active_analysis",
      ui_updated: false,
    });

    await act(async () => {
      root?.render(
        <WebMcpBridge
          runAnalysis={runAnalysis}
          activeAnalysis={windHomeAnalysis("analysis-first")}
          relatedAnalyses={[firstRelated]}
          onOpenStormClaimDiscussion={firstOpen}
          onStatusChange={firstStatus}
        />
      );
    });

    expect(registerTool).toHaveBeenCalledTimes(REGISTERED_TOOL_NAMES.length);
    expect(registrationSignals.every((signal) => signal.aborted === false)).toBe(true);
    expect(firstStatus.mock.calls.map(([status]) => status)).toEqual(["registering", "ready"]);
    expect(secondStatus).not.toHaveBeenCalled();
    const firstInspectResult = await inspectTool.execute({}, executeOptions);
    expect(firstInspectResult).toMatchObject({
      status: "no_evidence",
      related_chains: [{ hazard: "flood_storm", status: "no_observation" }],
    });
    expect(firstInspectResult).not.toHaveProperty("analysis_id");
    const firstClaimResult = await claimTool.execute({}, executeOptions);
    expect(firstClaimResult).toMatchObject({
      status: "ready_for_discussion",
      ui_updated: true,
    });
    expect(firstClaimResult).not.toHaveProperty("analysis_id");
    expect(firstOpen).toHaveBeenCalledOnce();

    await act(async () => {
      root?.render(
        <WebMcpBridge
          runAnalysis={secondRunAnalysis}
          activeAnalysis={windHomeAnalysis("analysis-second")}
          relatedAnalyses={[secondRelated]}
          onOpenStormClaimDiscussion={secondOpen}
          onStatusChange={secondStatus}
        />
      );
    });

    expect(registerTool).toHaveBeenCalledTimes(REGISTERED_TOOL_NAMES.length);
    expect(registrationSignals.every((signal) => signal.aborted === false)).toBe(true);
    expect(firstStatus.mock.calls.map(([status]) => status)).toEqual(["registering", "ready"]);
    expect(secondStatus).not.toHaveBeenCalled();
    const secondInspectResult = await inspectTool.execute({}, executeOptions);
    expect(secondInspectResult).toMatchObject({
      status: "no_evidence",
      related_chains: [{ hazard: "flood_storm", status: "source_failure" }],
    });
    expect(secondInspectResult).not.toHaveProperty("analysis_id");
    const secondClaimResult = await claimTool.execute({}, executeOptions);
    expect(secondClaimResult).toMatchObject({
      status: "ready_for_discussion",
      ui_updated: true,
    });
    expect(secondClaimResult).not.toHaveProperty("analysis_id");
    expect(firstOpen).toHaveBeenCalledOnce();
    expect(secondOpen).toHaveBeenCalledOnce();

    const travelAnalysis = windHomeAnalysis("analysis-travel");
    travelAnalysis.request.concern = "travel";
    await act(async () => {
      root?.render(
        <WebMcpBridge
          runAnalysis={secondRunAnalysis}
          activeAnalysis={travelAnalysis}
          onOpenStormClaimDiscussion={secondOpen}
          onStatusChange={secondStatus}
        />
      );
    });

    expect(registerTool).toHaveBeenCalledTimes(REGISTERED_TOOL_NAMES.length);
    expect(registrationSignals.every((signal) => signal.aborted === false)).toBe(true);
    const travelInspectResult = await inspectTool.execute({}, executeOptions);
    expect(travelInspectResult).not.toHaveProperty("analysis_id");
    const travelClaimResult = await claimTool.execute({}, executeOptions);
    expect(travelClaimResult).toMatchObject({
      status: "not_available_for_current_result",
      ui_updated: false,
    });
    expect(travelClaimResult).not.toHaveProperty("analysis_id");
    expect(secondOpen).toHaveBeenCalledOnce();

    await act(async () => {
      root?.render(
        <WebMcpBridge
          runAnalysis={secondRunAnalysis}
          activeAnalysis={null}
          onOpenStormClaimDiscussion={secondOpen}
          onStatusChange={secondStatus}
        />
      );
    });

    expect(registerTool).toHaveBeenCalledTimes(REGISTERED_TOOL_NAMES.length);
    expect(registrationSignals.every((signal) => signal.aborted === false)).toBe(true);
    await expect(inspectTool.execute({}, executeOptions)).resolves.toMatchObject({
      status: "no_active_analysis",
      ui_updated: false,
    });
    await expect(claimTool.execute({}, executeOptions)).resolves.toMatchObject({
      status: "no_active_analysis",
      ui_updated: false,
    });

    act(() => root?.unmount());
    root = null;
    expect(registrationSignals.every((signal) => signal.aborted === true)).toBe(true);
  });
});
