import { describe, expect, it, vi } from "vitest";
import type { ActiveAnalysis } from "@/lib/analysis/types";
import { buildAgentCoordinateSelection } from "@/lib/location/selection";
import {
  claimDiscussionForAnalysis,
  createInspectEvidenceTool,
  createStormClaimDiscussionTool,
  MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS,
} from "@/lib/webmcp/context-tools";

function analysis(hazardId: "wind_storm" | "flood_storm", concern: "home" | "travel"): ActiveAnalysis {
  const commonResult = {
    kind: "success" as const,
    evidence: {
      evidenceId: "evd-test",
      hazardId,
      intentId: "intent-test",
      evidenceState: "observations_returned" as const,
      dataMode: "historical" as const,
      observations: [],
      derivedMetrics: [],
      missionAttributions: [],
      freshness: {
        status: "unknown" as const,
        classificationBasis: "no_observation_time" as const,
        evaluatedAt: "2026-08-26T12:00:00.000Z",
        note: "test",
      },
      confidence: { level: "insufficient" as const, rationale: "test" },
      limitations: [],
      explanations: [],
      assembledAt: "2026-08-26T12:00:00.000Z",
    },
  };
  const result = hazardId === "wind_storm"
    ? {
        ...commonResult,
        claimDiscussion: {
          title: "Storm claim discussion preparation",
          supportedStatements: ["Regional wind context is present."],
          notEstablished: ["Property damage is not established."],
          documentationChecklist: ["Photograph observed damage."],
          officialGuidance: [{ label: "TDI", url: "https://www.tdi.texas.gov/" }],
        },
      }
    : commonResult;
  return {
    analysisId: `analysis-${hazardId}`,
    origin: "agent",
    request: {
      hazardId,
      concern,
      placeSelection: buildAgentCoordinateSelection(
        "Houston",
        { lon: -95.36, lat: 29.76 },
        25,
        "custom",
        "2024-07-08T00:00:00.000Z",
        "2024-07-08T23:59:59.000Z"
      ),
    },
    outcome: { hazardId, result } as ActiveAnalysis["outcome"],
    completedAt: "2026-08-26T12:00:00.000Z",
  };
}

describe("contextual WebMCP tools", () => {
  const options = { signal: new AbortController().signal } as WebMCP.ToolExecuteCallbackOptions;

  it("reports non-overlapping wind and water scopes", async () => {
    const wind = await createInspectEvidenceTool(analysis("wind_storm", "home")).execute({}, options);
    const flood = await createInspectEvidenceTool(analysis("flood_storm", "travel")).execute({}, options);
    expect(wind).toMatchObject({ evidence_scope: "wind_only_no_rain_flood_or_water_gages" });
    expect(flood).toMatchObject({ evidence_scope: "water_only_no_wind_damage_causation" });
  });

  it("registers claim preparation only for a Home + Wind result and only updates local UI", async () => {
    const open = vi.fn();
    const windHome = analysis("wind_storm", "home");
    const tool = createStormClaimDiscussionTool(windHome, open);
    expect(tool).not.toBeNull();
    expect(claimDiscussionForAnalysis(analysis("wind_storm", "travel"))).toBeNull();
    expect(createStormClaimDiscussionTool(analysis("flood_storm", "home"), open)).toBeNull();
    const output = await tool!.execute({}, options);
    expect(open).toHaveBeenCalledOnce();
    expect(output).toMatchObject({
      status: "ready_for_discussion",
      ui_updated: true,
      evidence_scope: "wind_only_no_rain_flood_or_water_gages",
      no_claim_decision: true,
    });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS);
  });
});
