import type { FailureGapStatusState } from "@/components/states/failure-gap-status";
import type { EvidenceObject } from "@/contracts/evidence";
import type { CoverageGapQueryResult } from "@/lib/coverage-gap/types";
import type { DroughtQueryResult } from "@/lib/drought/types";
import type { FireQueryResult } from "@/lib/fire/types";
import type { FloodQueryResult } from "@/lib/flood/types";
import type { HeatQueryResult } from "@/lib/heat/types";
import type { StormQueryResult } from "@/lib/storm/types";

export type FailureGapMappableResult =
  | FireQueryResult
  | FloodQueryResult
  | HeatQueryResult
  | DroughtQueryResult
  | StormQueryResult
  | CoverageGapQueryResult;

export interface FailureGapMapping {
  states: FailureGapStatusState[];
  hasPresentableEvidence: boolean;
}

type FailureGapTab = "meaning" | "evidence" | "missions";

function resultEvidence(result: FailureGapMappableResult): EvidenceObject | undefined {
  return result.evidence;
}

function resultFailureReason(result: FailureGapMappableResult): string | undefined {
  return "failureReason" in result ? result.failureReason : undefined;
}

function hasExplicitPartialSourceFailure(result: FailureGapMappableResult): boolean {
  if ("sourceOutcomes" in result && result.sourceOutcomes) {
    const outcomes = Object.values(result.sourceOutcomes as Record<string, string>);
    if (
      outcomes.some((outcome) =>
        outcome === "failed" ||
        outcome === "source_failure" ||
        outcome === "credential_gate_closed"
      )
    ) {
      return true;
    }
  }

  if ("temporalCoverage" in result && result.temporalCoverage) {
    return result.temporalCoverage.days.some(
      (day) =>
        day.status === "failed" ||
        day.fireStatus === "failed" ||
        day.smokeStatus === "failed"
    );
  }
  return false;
}

function stateWithEvidenceMode(
  kind: Exclude<FailureGapStatusState["kind"], "demo_fixture">,
  evidence: EvidenceObject | undefined
): FailureGapStatusState {
  return evidence ? { kind, dataMode: evidence.dataMode } : { kind };
}

function primaryResultState(
  result: FailureGapMappableResult,
  evidence: EvidenceObject | undefined
): FailureGapStatusState | null {
  if (result.kind === "unsupported_place" || result.kind === "unsupported_coverage") {
    return stateWithEvidenceMode("invalid_location", evidence);
  }
  if (result.kind === "unsupported_date") {
    return stateWithEvidenceMode("unsupported_date", evidence);
  }
  if (result.kind === "no_observation" || evidence?.evidenceState === "no_observation") {
    return stateWithEvidenceMode("no_observation", evidence);
  }
  if (
    result.kind !== "source_failure" &&
    evidence?.evidenceState !== "source_failure" &&
    !hasExplicitPartialSourceFailure(result)
  ) {
    return null;
  }

  const reason = resultFailureReason(result);
  if (reason === "rate_limited") {
    return stateWithEvidenceMode("rate_limited", evidence);
  }
  if (reason === "schema_validation" || reason === "malformed") {
    return stateWithEvidenceMode("upstream_schema_change", evidence);
  }
  return stateWithEvidenceMode("source_failure", evidence);
}

function pushUnique(
  states: FailureGapStatusState[],
  candidate: FailureGapStatusState | null
): void {
  if (candidate && !states.some((state) => state.kind === candidate.kind)) {
    states.push(candidate);
  }
}

/**
 * Maps only allowlisted, unambiguous result fields into WP-14 UI states.
 *
 * `inconclusive_evidence` is intentionally not assumed to mean source conflict:
 * current contracts also use it for partial-but-valid source coverage. Those
 * domain-specific observations and gaps remain visible in their existing panel.
 */
export function mapFailureGapStates(
  result: FailureGapMappableResult,
  tab: FailureGapTab
): FailureGapMapping {
  const evidence = resultEvidence(result);
  const states: FailureGapStatusState[] = [];

  pushUnique(states, primaryResultState(result, evidence));

  if (evidence?.freshness.status === "stale") {
    pushUnique(states, stateWithEvidenceMode("stale_data", evidence));
  }
  if (evidence?.dataMode === "fixture") {
    pushUnique(states, { kind: "demo_fixture", dataMode: "fixture" });
  }
  if (
    "evidenceConflicts" in result &&
    result.evidenceConflicts?.some((conflict) => conflict.code === "source_disagreement")
  ) {
    pushUnique(states, stateWithEvidenceMode("conflicting_sources", evidence));
  }
  if (tab === "meaning") {
  }
  if (
    tab === "missions" &&
    evidence &&
    evidence.missionAttributions.length === 0 &&
    evidence.observations.length + evidence.derivedMetrics.length > 0
  ) {
    pushUnique(states, stateWithEvidenceMode("missing_mission_metadata", evidence));
  }

  return {
    states,
    hasPresentableEvidence: Boolean(
      evidence && evidence.observations.length + evidence.derivedMetrics.length > 0
    ),
  };
}
