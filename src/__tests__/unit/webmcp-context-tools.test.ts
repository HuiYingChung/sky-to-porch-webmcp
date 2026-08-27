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
      observations: [{
        observationId: `obs-${hazardId}`,
        variableName: hazardId === "wind_storm" ? "Peak wind gust" : "Gage height",
        value: hazardId === "wind_storm" ? 39.6 : 4.2,
        unit: hazardId === "wind_storm" ? "m/s" : "m",
        dataMode: "historical" as const,
        provenance: {
          sourceId: hazardId === "wind_storm"
            ? "noaa_ncei_global_hourly" as const
            : "usgs_instantaneous_values" as const,
          sourceUrl: `https://example.test/${hazardId}`,
          retrievedAt: "2026-08-26T11:00:00.000Z",
          observedAt: "2024-07-08T14:35:00.000Z",
          product: hazardId === "wind_storm" ? "NOAA GHCNh" : "USGS IV",
          payloadHash: "a".repeat(64),
        },
      }],
      derivedMetrics: [],
      missionAttributions: [],
      freshness: {
        status: "unknown" as const,
        classificationBasis: "age_thresholds" as const,
        mostRecentObservationAt: "2024-07-08T14:35:00.000Z",
        ageSeconds: 67200000,
        currentAgeLimitSeconds: 86400,
        recentAgeLimitSeconds: 172800,
        evaluatedAt: "2026-08-26T12:00:00.000Z",
        note: "test",
      },
      confidence: { level: "moderate" as const, rationale: "test" },
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
          assessmentSummary: "Official regional wind evidence makes wind contribution plausible.",
          assessmentConfidence: "moderate" as const,
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
    expect(wind).toMatchObject({ evidence_scope: "regional_wind_observations" });
    expect(flood).toMatchObject({ evidence_scope: "regional_water_and_rain_observations" });
  });

  it("inspects related context as separate non-causal chains", async () => {
    const output = await createInspectEvidenceTool(
      analysis("wind_storm", "home"),
      [analysis("flood_storm", "home")]
    ).execute({}, options);
    expect(output).toMatchObject({
      hazard: "wind_storm",
      relationship: "related_evidence_for_assessment",
      inference_guidance: "state_strongest_supported_inference_and_confidence",
      answer_order: [
        "strongest_supported_assessment",
        "observation_values_times_and_official_citations",
        "direct_observation_then_labelled_inference",
        "confidence_and_evidence_that_would_change_it",
      ],
      support: {
        level: "official_observations_in_every_chain",
        chains_with_observations: 2,
      },
      related_chains: [
        {
          hazard: "flood_storm",
          evidence_scope: "regional_water_and_rain_observations",
          strongest_observation: { name: "Gage height", value: 4.2 },
        },
      ],
    });
    expect(output).toMatchObject({
      citations: [
        { hazard: "wind_storm", source: "noaa_ncei_global_hourly", product: "NOAA GHCNh" },
        { hazard: "flood_storm", source: "usgs_instantaneous_values", product: "USGS IV" },
      ],
    });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS);
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
      evidence_scope: "regional_wind_observations",
      assessment: "Official regional wind evidence makes wind contribution plausible.",
      confidence: "moderate",
      no_claim_decision: true,
    });
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(MAX_CONTEXT_TOOL_OUTPUT_CHARACTERS);
  });
});
