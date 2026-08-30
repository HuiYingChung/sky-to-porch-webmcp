/// <reference types="webmcp-types" />

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebMcpBridge } from "@/components/webmcp/webmcp-bridge";
import type { ActiveAnalysis } from "@/lib/analysis/types";
import { buildAgentCoordinateSelection } from "@/lib/location/selection";

function windHomeAnalysis(): ActiveAnalysis {
  return {
    analysisId: "analysis-wind-home",
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
  it("registers the four baseline tools and unregisters them through one lifecycle signal", async () => {
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
    ]);
    const baselineSignals = registerTool.mock.calls.map(([, options]) => options.signal);
    expect(baselineSignals.every((signal) => signal.aborted === false)).toBe(true);
    expect(new Set(baselineSignals).size).toBe(1);
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      "registering",
      "ready",
    ]);

    act(() => root?.unmount());
    root = null;
    expect(baselineSignals.every((signal) => signal.aborted === true)).toBe(true);
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

  it("aborts the entire baseline registration group if one tool fails", async () => {
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
    expect(signals).toHaveLength(4);
    expect(new Set(signals).size).toBe(1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      "WebMCP baseline tool registration failed",
      failure
    );
    consoleError.mockRestore();
  });

  it("registers scoped inspection and claim tools only while a Home + Wind result is active", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
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
          activeAnalysis={windHomeAnalysis()}
          onOpenStormClaimDiscussion={vi.fn()}
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
    const contextualSignals = registerTool.mock.calls.slice(4).map(([, options]) => options.signal);
    expect(contextualSignals.every((signal) => signal.aborted === false)).toBe(true);

    act(() => root?.unmount());
    root = null;
    expect(contextualSignals.every((signal) => signal.aborted === true)).toBe(true);
  });
});
