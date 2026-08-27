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
  it("registers once and unregisters through the registration AbortSignal", async () => {
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

    expect(registerTool).toHaveBeenCalledTimes(1);
    const [tool, registrationOptions] = registerTool.mock.calls[0] as [
      WebMCP.ModelContextTool,
      WebMCP.ModelContextRegisterToolOptions,
    ];
    expect(tool.name).toBe("analyze_environmental_hazard");
    expect(registrationOptions.signal?.aborted).toBe(false);
    expect(onStatusChange.mock.calls.map(([status]) => status)).toEqual([
      "registering",
      "ready",
    ]);

    act(() => root?.unmount());
    root = null;
    expect(registrationOptions.signal?.aborted).toBe(true);
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
      "inspect_current_environmental_evidence",
      "prepare_storm_claim_discussion",
    ]);
    const contextualSignals = registerTool.mock.calls.slice(1).map(([, options]) => options.signal);
    expect(contextualSignals.every((signal) => signal.aborted === false)).toBe(true);

    act(() => root?.unmount());
    root = null;
    expect(contextualSignals.every((signal) => signal.aborted === true)).toBe(true);
  });
});
