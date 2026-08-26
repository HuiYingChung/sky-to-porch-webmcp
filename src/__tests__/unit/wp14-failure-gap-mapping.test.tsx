import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ResultFailureGapBoundary } from "@/components/states/result-failure-gap-boundary";
import { DroughtEvidenceInsightPanel } from "@/components/drought/drought-evidence-panel";
import { FloodEvidenceInsightPanel } from "@/components/flood/flood-evidence-panel";
import type { EvidenceObject, Observation } from "@/contracts/evidence";
import type { FireQueryResult } from "@/lib/fire/types";
import type { FloodQueryResult } from "@/lib/flood/types";
import type { DroughtQueryResult } from "@/lib/drought/types";
import type { HeatQueryResult } from "@/lib/heat/types";
import { mapFailureGapStates } from "@/lib/ui/failure-gap-mapping";

function evidence(
  overrides: Partial<EvidenceObject> = {}
): EvidenceObject {
  return {
    evidenceId: "evd-wp14-test",
    hazardId: "extreme_heat",
    intentId: "intent-wp14-test",
    evidenceState: "observations_returned",
    dataMode: "live",
    observations: [],
    derivedMetrics: [],
    missionAttributions: [],
    freshness: {
      status: "current",
      classificationBasis: "age_thresholds",
      evaluatedAt: "2026-08-18T22:00:00Z",
      note: "Current for this deterministic test.",
    },
    confidence: { level: "low", rationale: "Deterministic test evidence." },
    limitations: [],
    explanations: [],
    assembledAt: "2026-08-18T22:00:00Z",
    ...overrides,
  };
}

const observation: Observation = {
  observationId: "obs-wp14-test",
  provenance: {
    sourceId: "us_drought_monitor_rest",
    sourceUrl: "https://droughtmonitor.unl.edu/",
    retrievedAt: "2026-08-18T22:00:00Z",
    observedAt: "2026-08-12T00:00:00Z",
    product: "Deterministic WP-14 test product",
    payloadHash: "a".repeat(64),
  },
  variableName: "Regional drought category",
  textValue: "deterministic_test_value",
  dataMode: "live",
};

describe("mapFailureGapStates", () => {
  it("maps exact rejection and source failure reasons without guessing", () => {
    const unsupported = mapFailureGapStates(
      { kind: "unsupported_place" } as FireQueryResult,
      "meaning"
    );
    const rateLimited = mapFailureGapStates(
      { kind: "source_failure", failureReason: "rate_limited" } as FireQueryResult,
      "meaning"
    );
    const schemaChange = mapFailureGapStates(
      { kind: "source_failure", failureReason: "schema_validation" } as FireQueryResult,
      "meaning"
    );
    const transportTimeout = mapFailureGapStates(
      { kind: "source_failure", failureReason: "timeout" } as FireQueryResult,
      "meaning"
    );

    expect(unsupported.states.map((state) => state.kind)).toEqual(["invalid_location"]);
    expect(rateLimited.states.map((state) => state.kind)).toEqual(["rate_limited"]);
    expect(schemaChange.states.map((state) => state.kind)).toEqual(["upstream_schema_change"]);
    expect(transportTimeout.states.map((state) => state.kind)).toEqual(["source_failure"]);
  });

  it("keeps dated and fixture evidence visible while disclosing both states", () => {
    const result = {
      kind: "success",
      evidence: evidence({
        dataMode: "fixture",
        observations: [observation],
        freshness: {
          status: "stale",
          classificationBasis: "age_thresholds",
          evaluatedAt: "2026-08-18T22:00:00Z",
          note: "Stale deterministic test evidence.",
        },
      }),
    } as HeatQueryResult;

    const mapping = mapFailureGapStates(result, "evidence");
    expect(mapping.hasPresentableEvidence).toBe(true);
    expect(mapping.states.map((state) => state.kind)).toEqual([
      "stale_data",
      "demo_fixture",
    ]);
  });

  it("maps an AI timeout only on Meaning and never discards validated evidence", () => {
    const result = {
      kind: "success",
      evidence: evidence({ observations: [observation] }),
      explanationStatus: {
        mode: "deterministic",
        reason: "ai_unavailable",
        provider: "openai",
        providerFailureReason: "timeout",
      },
    } as HeatQueryResult;

    expect(mapFailureGapStates(result, "meaning").states.map((state) => state.kind))
      .toEqual(["ai_timeout"]);
    expect(mapFailureGapStates(result, "evidence").states).toEqual([]);
    expect(mapFailureGapStates(result, "meaning").hasPresentableEvidence).toBe(true);
  });

  it("shows missing mission metadata only when evidence exists on Missions", () => {
    const result = {
      kind: "success",
      evidence: evidence({ observations: [observation], missionAttributions: [] }),
    } as HeatQueryResult;

    expect(mapFailureGapStates(result, "meaning").states).toEqual([]);
    expect(mapFailureGapStates(result, "missions").states.map((state) => state.kind))
      .toEqual(["missing_mission_metadata"]);
  });

  it("does not mislabel ambiguous inconclusive evidence as source conflict", () => {
    const result = {
      kind: "inconclusive_evidence",
      evidence: evidence({ observations: [observation] }),
    } as HeatQueryResult;

    expect(mapFailureGapStates(result, "meaning").states).toEqual([]);
    expect(mapFailureGapStates(result, "meaning").hasPresentableEvidence).toBe(true);
  });

  it("shows conflict only from the evaluator's structured source-disagreement signal", () => {
    const result = {
      kind: "inconclusive_evidence",
      evidence: evidence({ observations: [observation] }),
      evidenceConflicts: [{
        code: "source_disagreement",
        observationIds: ["obs-wp14-test"],
      }],
    } as HeatQueryResult;

    expect(mapFailureGapStates(result, "evidence").states.map((state) => state.kind))
      .toEqual(["conflicting_sources"]);
  });

  it("keeps partial evidence primary while disclosing an explicit failed source", () => {
    const drought = {
      kind: "inconclusive_evidence",
      sourceOutcomes: { gibs: "failed", usdm: "success" },
      evidence: evidence({ observations: [observation] }),
    } as DroughtQueryResult;
    const flood = {
      kind: "inconclusive_evidence",
      sourceOutcomes: { imerg: "success", floodExtent: "failed", usgs: "success" },
      evidence: evidence({ observations: [observation] }),
    } as FloodQueryResult;

    for (const result of [drought, flood]) {
      const mapping = mapFailureGapStates(result, "evidence");
      expect(mapping.states.map((state) => state.kind)).toEqual(["source_failure"]);
      expect(mapping.hasPresentableEvidence).toBe(true);
    }
  });

  it("does not turn unsupported-only Fire coverage into a generic failure", () => {
    const result = {
      kind: "partial_coverage",
      temporalCoverage: {
        requestType: "custom",
        status: "partial",
        days: [{
          date: "2026-08-18",
          status: "unsupported",
          fireStatus: "missing",
          smokeStatus: "missing",
        }],
      },
      evidence: evidence({ observations: [observation] }),
    } as FireQueryResult;

    expect(mapFailureGapStates(result, "evidence").states).toEqual([]);
  });
});

function render(ui: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}

function cleanup(container: HTMLElement, root: Root): void {
  act(() => root.unmount());
  container.remove();
}

describe("ResultFailureGapBoundary evidence-first ordering", () => {
  it("renders validated evidence before a partial source failure status", () => {
    const result = {
      kind: "source_failure",
      failureReason: "network",
      evidence: evidence({ observations: [observation] }),
    } as HeatQueryResult;
    const rendered = render(
      <ResultFailureGapBoundary result={result} tab="evidence">
        <div data-testid="validated-evidence">Validated evidence</div>
      </ResultFailureGapBoundary>
    );
    const boundary = rendered.container.querySelector(
      "[data-testid='result-failure-gap-boundary']"
    );
    expect(boundary?.children[0]?.getAttribute("data-testid")).toBe("validated-evidence");
    expect(boundary?.children[1]?.getAttribute("data-testid"))
      .toBe("result-failure-gap-statuses");
    expect(rendered.container.textContent).toContain("separately validated evidence");
    cleanup(rendered.container, rendered.root);
  });

  it("renders a total failure status before the no-evidence detail", () => {
    const result = {
      kind: "source_failure",
      failureReason: "network",
    } as HeatQueryResult;
    const rendered = render(
      <ResultFailureGapBoundary result={result} tab="evidence">
        <div data-testid="no-evidence-detail">No evidence detail</div>
      </ResultFailureGapBoundary>
    );
    const boundary = rendered.container.querySelector(
      "[data-testid='result-failure-gap-boundary']"
    );
    expect(boundary?.children[0]?.getAttribute("data-testid"))
      .toBe("result-failure-gap-statuses");
    expect(boundary?.children[1]?.getAttribute("data-testid")).toBe("no-evidence-detail");
    cleanup(rendered.container, rendered.root);
  });

  it("keeps each Flood source outcome visible beside partial evidence", () => {
    const result = {
      kind: "inconclusive_evidence",
      sourceOutcomes: { imerg: "success", floodExtent: "failed", usgs: "no_observation" },
      evidence: evidence({ evidenceState: "inconclusive_evidence" }),
      assessments: [],
    } as FloodQueryResult;
    const rendered = render(
      <FloodEvidenceInsightPanel
        result={result}
        tab="evidence"
        missionSelection={{}}
        onMissionSelectionChange={() => undefined}
      />
    );
    const outcomes = rendered.container.querySelector("[data-testid='flood-source-outcomes']");
    expect(outcomes?.textContent).toContain("satellite precipitation succeeded");
    expect(outcomes?.textContent).toContain("flood-extent imagery failed");
    expect(outcomes?.textContent).toContain("ground gage returned nothing");
    cleanup(rendered.container, rendered.root);
  });

  it("keeps each Drought source outcome visible beside partial evidence", () => {
    const result = {
      kind: "inconclusive_evidence",
      sourceOutcomes: { gibs: "failed", usdm: "success", administrativeArea: "success" },
      evidence: evidence({ observations: [observation] }),
    } as DroughtQueryResult;
    const rendered = render(
      <DroughtEvidenceInsightPanel
        result={result}
        tab="evidence"
        missionSelection={{}}
        onMissionSelectionChange={() => undefined}
      />
    );
    const outcomes = rendered.container.querySelector("[data-testid='drought-source-outcomes']");
    expect(outcomes?.textContent).toContain("NASA GIBS failed");
    expect(outcomes?.textContent).toContain("U.S. Drought Monitor succeeded");
    expect(outcomes?.textContent).toContain("administrative-area lookup succeeded");
    cleanup(rendered.container, rendered.root);
  });
});
