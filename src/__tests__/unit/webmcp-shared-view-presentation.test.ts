import { describe, expect, it } from "vitest";
import type { EvidenceObject } from "@/contracts/evidence";
import type { ActiveAnalysis } from "@/lib/analysis/types";
import {
  formatAnalysisPlace,
  formatAnalysisTime,
  summarizeAnalysisTrust,
} from "@/lib/analysis/presentation";
import { buildAgentCoordinateSelection } from "@/lib/location/selection";

function evidence(): EvidenceObject {
  return {
    evidenceId: "ev-shared-view",
    hazardId: "fire_smoke",
    intentId: "shared-view-test",
    evidenceState: "observations_returned",
    dataMode: "live",
    observations: ["noaa_hms_fire_points", "noaa_hms_smoke_polygons"].map(
      (sourceId, index) => ({
        observationId: `obs-${index + 1}`,
        variableName: index === 0 ? "fire detections" : "smoke extent",
        value: index + 1,
        unit: "count",
        dataMode: "live" as const,
        provenance: {
          sourceId: sourceId as "noaa_hms_fire_points" | "noaa_hms_smoke_polygons",
          sourceUrl: "https://www.ospo.noaa.gov/products/land/hms.html",
          retrievedAt: "2026-08-26T18:00:00.000Z",
          observedAt: "2026-08-25T12:00:00.000Z",
          product: "NOAA HMS",
          payloadHash: "a".repeat(64),
        },
      })
    ),
    derivedMetrics: [],
    missionAttributions: [],
    freshness: {
      status: "recent",
      classificationBasis: "age_thresholds",
      mostRecentObservationAt: "2026-08-25T12:00:00.000Z",
      evaluatedAt: "2026-08-26T18:00:00.000Z",
      ageSeconds: 108000,
      currentAgeLimitSeconds: 86400,
      recentAgeLimitSeconds: 172800,
      note: "Recent evidence.",
    },
    confidence: { level: "moderate", rationale: "Two bounded sources." },
    limitations: [{
      limitationId: "lim-regional",
      source: "product",
      description: "Regional evidence is not property-level certainty.",
      required: true,
    }],
    explanations: [],
    assembledAt: "2026-08-26T18:00:00.000Z",
  };
}

function analysis(result: ActiveAnalysis["outcome"]["result"]): ActiveAnalysis {
  return {
    analysisId: "analysis-shared-view",
    origin: "agent",
    request: {
      hazardId: "fire_smoke",
      concern: "pets",
      placeSelection: buildAgentCoordinateSelection(
        "Tucson, Arizona",
        { lat: 32.2226, lon: -110.9747 },
        15,
        "custom",
        "2026-08-25T00:00:00.000Z",
        "2026-08-25T00:00:00.000Z"
      ),
      evidenceMode: "live",
    },
    outcome: { hazardId: "fire_smoke", result } as ActiveAnalysis["outcome"],
    completedAt: "2026-08-26T18:00:01.000Z",
  };
}

describe("shared-view presentation", () => {
  it("summarizes evidence without hiding source or limitation counts", () => {
    const current = analysis({ kind: "success", evidence: evidence() });

    expect(summarizeAnalysisTrust(current)).toEqual({
      state: "observations_returned",
      stateLabel: "Observations returned",
      sourceCount: 2,
      limitationCount: 1,
      showNoDangerReminder: false,
    });
    expect(formatAnalysisPlace(current)).toBe("Tucson, Arizona");
    expect(formatAnalysisTime(current)).toBe("2026-08-25");
  });

  it("keeps source failures explicit and activates the no-danger reminder", () => {
    const current = analysis({
      kind: "source_failure",
      rejectionReason: "The official source did not respond.",
    });

    expect(summarizeAnalysisTrust(current)).toEqual({
      state: null,
      stateLabel: "Source request failed",
      sourceCount: 0,
      limitationCount: 1,
      showNoDangerReminder: true,
    });
  });
});
