/// <reference types="webmcp-types" />

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisOutcome, AnalysisRequest } from "@/lib/analysis/types";
import { QueryProvider, useQueryDraft } from "@/components/query/query-provider";
import { InsightNavigation } from "@/components/navigation/insight-navigation";

const pending: Array<{
  request: AnalysisRequest;
  resolve: (outcome: AnalysisOutcome) => void;
  reject: (reason?: unknown) => void;
}> = [];

vi.mock("@/lib/analysis/client", () => ({
  executeAnalysisRequest: vi.fn((request: AnalysisRequest) =>
    new Promise<AnalysisOutcome>((resolve, reject) => pending.push({ request, resolve, reject }))
  ),
}));

let container: HTMLElement;
let root: Root;
let registeredTools: WebMCP.ModelContextTool[];

function ProgressProbe() {
  const { agentInvestigation } = useQueryDraft();
  return (
    <output
      data-testid="progress-probe"
      data-phase={agentInvestigation?.phase ?? "none"}
      data-completed={agentInvestigation?.completedChains ?? -1}
      data-total={agentInvestigation?.totalChains ?? -1}
      data-kind={agentInvestigation?.kind ?? "none"}
    />
  );
}

function byTestId(id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Missing ${id}`);
  return element;
}

function resolvePending(index: number) {
  const item = pending[index];
  item.resolve({
    hazardId: item.request.hazardId,
    result: {
      kind: "unsupported_coverage",
      rejectionReason: `No direct ${item.request.hazardId} observation in this UI fixture.`,
    },
  } as AnalysisOutcome);
}

beforeEach(async () => {
  pending.length = 0;
  registeredTools = [];
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: {
      registerTool: vi.fn(async (tool: WebMCP.ModelContextTool) => {
        registeredTools.push(tool);
      }),
    },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      <QueryProvider>
        <ProgressProbe />
        <InsightNavigation idPrefix="agent-test-" />
      </QueryProvider>
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("visible Agent investigation workflow", () => {
  it("shows per-chain progress, then keeps all comparison results linked", async () => {
    const tool = registeredTools.find((candidate) =>
      candidate.name === "compare_environmental_evidence"
    );
    if (!tool) throw new Error("comparison tool was not registered");

    let execution: Promise<unknown>;
    await act(async () => {
      execution = Promise.resolve(tool.execute({
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
        question: "Compare the storm evidence.",
      }, { signal: new AbortController().signal }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pending).toHaveLength(4);
    expect(byTestId("progress-probe")).toMatchObject({
      dataset: expect.objectContaining({
        phase: "retrieving",
        completed: "0",
        total: "4",
        kind: "comparison",
      }),
    });
    expect(byTestId("agent-investigation-progress").textContent)
      .toMatch(/0\/4 evidence chains complete/iu);

    await act(async () => {
      resolvePending(0);
      await Promise.resolve();
    });
    expect(byTestId("progress-probe").dataset.completed).toBe("1");

    await act(async () => {
      resolvePending(1);
      resolvePending(2);
      resolvePending(3);
      await execution!;
    });

    expect(byTestId("progress-probe").dataset).toMatchObject({
      phase: "complete",
      completed: "4",
      total: "4",
    });
    expect(byTestId("agent-analysis-notice").textContent)
      .toMatch(/Agent made this view more useful/iu);
    expect(byTestId("agent-analysis-receipt").textContent)
      .toMatch(/Compared 2 scenarios across 4 separate evidence chains/iu);
    expect(container.textContent).not.toContain("wind_storm");
    expect(container.textContent).not.toContain("flood_storm");
    for (const id of [
      "agent-view-baseline-flood_storm-result",
      "agent-view-baseline-wind_storm-result",
      "agent-view-comparison-flood_storm-result",
      "agent-view-comparison-wind_storm-result",
    ]) {
      expect(byTestId(id).tagName).toBe("BUTTON");
    }
  });

  it("leaves a plain visible failure result when a single Agent check throws", async () => {
    const tool = registeredTools.find((candidate) =>
      candidate.name === "analyze_environmental_hazard"
    );
    if (!tool) throw new Error("analysis tool was not registered");

    let execution: Promise<unknown>;
    await act(async () => {
      execution = Promise.resolve(tool.execute({
        place: "29.7604, -95.3698",
        radius_km: 50,
        time: "2024-07-08",
        hazard: "wind_storm",
        analysis_scope: "single_hazard_only",
        question: "What wind information is available?",
      }, { signal: new AbortController().signal }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pending).toHaveLength(1);
    expect(byTestId("progress-probe").dataset.phase).toBe("retrieving");
    const rawFailure = "private provider detail must stay hidden";
    let output: unknown;
    await act(async () => {
      pending[0].reject(new Error(rawFailure));
      output = await execution!;
    });

    expect(output).toMatchObject({ status: "source_failure", ui_updated: true });
    expect(JSON.stringify(output)).not.toContain(rawFailure);
    expect(byTestId("progress-probe").dataset.phase).toBe("complete");
    expect(byTestId("result-failure-gap-statuses").textContent)
      .toMatch(/Source unavailable/iu);
    expect(byTestId("wind-rejection-panel").textContent)
      .toMatch(/this check couldn't be completed/iu);
    expect(container.textContent).not.toContain(rawFailure);
    expect(container.querySelector("[data-testid='agent-investigation-progress']")).toBeNull();
  });

  it("sanitizes and attributes a non-final failed chain in an Agent comparison", async () => {
    const tool = registeredTools.find((candidate) =>
      candidate.name === "compare_environmental_evidence"
    );
    if (!tool) throw new Error("comparison tool was not registered");

    let execution: Promise<unknown>;
    await act(async () => {
      execution = Promise.resolve(tool.execute({
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
        question: "Compare the storm information.",
      }, { signal: new AbortController().signal }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pending).toHaveLength(4);
    const rawFailure = "raw comparison failure detail from internal-client.ts:42";
    let output: unknown;
    await act(async () => {
      pending[0].reject(new Error(rawFailure));
      resolvePending(1);
      resolvePending(2);
      resolvePending(3);
      output = await execution!;
    });

    const scenarios = (output as {
      scenarios: Array<{
        id: string;
        chains: Array<{ hazard: string; status_summary: string }>;
      }>;
    }).scenarios;
    expect(scenarios).toMatchObject([
      {
        id: "baseline",
        chains: [
          { hazard: "flood_storm", status_summary: "official source unavailable" },
          { hazard: "wind_storm", status_summary: "not supported for this area" },
        ],
      },
      {
        id: "comparison",
        chains: [
          { hazard: "flood_storm", status_summary: "not supported for this area" },
          { hazard: "wind_storm", status_summary: "not supported for this area" },
        ],
      },
    ]);
    expect(JSON.stringify(output)).not.toContain(rawFailure);
    expect(byTestId("progress-probe").dataset.phase).toBe("complete");
    expect(byTestId("agent-baseline-flood_storm-result-summary").textContent)
      .toMatch(/Source request failed/iu);
    expect(byTestId("flood-rejection-panel").textContent)
      .toMatch(/couldn't complete this check/iu);
    expect(container.textContent).not.toContain(rawFailure);
    expect(container.querySelector("[data-testid='agent-investigation-progress']")).toBeNull();
  });
});
