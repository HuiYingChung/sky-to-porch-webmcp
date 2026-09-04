/// <reference types="webmcp-types" />

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebMcpBridge } from "@/components/webmcp/webmcp-bridge";
import type { ActiveAnalysis } from "@/lib/analysis/types";
import { buildAgentCoordinateSelection } from "@/lib/location/selection";

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
});

describe("WebMcpBridge", () => {
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

    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
      "analyze_environmental_hazard",
      "compare_environmental_evidence",
      "get_sky_to_porch_help_and_demos",
      "get_environmental_source_coverage",
      "inspect_current_environmental_evidence",
      "prepare_storm_claim_discussion",
    ]);
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
    expect(signals).toHaveLength(6);
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

    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
      "analyze_environmental_hazard",
      "compare_environmental_evidence",
      "get_sky_to_porch_help_and_demos",
      "get_environmental_source_coverage",
      "inspect_current_environmental_evidence",
      "prepare_storm_claim_discussion",
    ]);
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

    expect(registerTool).toHaveBeenCalledTimes(6);
    expect(registrationSignals.every((signal) => signal.aborted === false)).toBe(true);
    expect(firstStatus.mock.calls.map(([status]) => status)).toEqual(["registering", "ready"]);
    expect(secondStatus).not.toHaveBeenCalled();
    await expect(inspectTool.execute({}, executeOptions)).resolves.toMatchObject({
      status: "no_evidence",
      analysis_id: "analysis-first",
      related_chains: [{ hazard: "flood_storm", status: "no_observation" }],
    });
    await expect(claimTool.execute({}, executeOptions)).resolves.toMatchObject({
      status: "ready_for_discussion",
      analysis_id: "analysis-first",
      ui_updated: true,
    });
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

    expect(registerTool).toHaveBeenCalledTimes(6);
    expect(registrationSignals.every((signal) => signal.aborted === false)).toBe(true);
    expect(firstStatus.mock.calls.map(([status]) => status)).toEqual(["registering", "ready"]);
    expect(secondStatus).not.toHaveBeenCalled();
    await expect(inspectTool.execute({}, executeOptions)).resolves.toMatchObject({
      status: "no_evidence",
      analysis_id: "analysis-second",
      related_chains: [{ hazard: "flood_storm", status: "source_failure" }],
    });
    await expect(claimTool.execute({}, executeOptions)).resolves.toMatchObject({
      status: "ready_for_discussion",
      analysis_id: "analysis-second",
      ui_updated: true,
    });
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

    expect(registerTool).toHaveBeenCalledTimes(6);
    expect(registrationSignals.every((signal) => signal.aborted === false)).toBe(true);
    await expect(inspectTool.execute({}, executeOptions)).resolves.toMatchObject({
      analysis_id: "analysis-travel",
    });
    await expect(claimTool.execute({}, executeOptions)).resolves.toMatchObject({
      status: "not_available_for_current_result",
      analysis_id: "analysis-travel",
      ui_updated: false,
    });
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

    expect(registerTool).toHaveBeenCalledTimes(6);
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
