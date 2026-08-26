import type { EvidenceState } from "@/contracts/common";
import type { EvidenceObject } from "@/contracts/evidence";
import type { ActiveAnalysis } from "@/lib/analysis/types";
import { TIME_RANGE_DISPLAY_LABELS } from "@/lib/location/time";

export interface AnalysisTrustSummary {
  state: EvidenceState | null;
  stateLabel: string;
  sourceCount: number;
  limitationCount: number;
  showNoDangerReminder: boolean;
}

const EVIDENCE_STATE_LABELS: Record<EvidenceState, string> = {
  observations_returned: "Observations returned",
  no_observation: "No matching observation returned",
  source_failure: "Source request failed",
  unsupported_coverage: "Source coverage unavailable",
  stale_data: "Evidence is stale",
  inconclusive_evidence: "Evidence is inconclusive",
  valid_observation_no_anomaly: "Valid observation · no anomaly reported",
  no_active_official_alert: "No active official alert reported",
};

const RESULT_KIND_LABELS: Record<string, string> = {
  success: "Observations returned",
  no_observation: "No matching observation returned",
  source_failure: "Source request failed",
  unsupported_place: "Source coverage unavailable",
  unsupported_date: "Source coverage unavailable",
  unsupported_coverage: "Source coverage unavailable",
  partial_coverage: "Evidence is incomplete",
  inconclusive_evidence: "Evidence is inconclusive",
};

function resultDetails(analysis: ActiveAnalysis): {
  kind: string;
  evidence?: EvidenceObject;
  limitationCount: number;
} {
  const result = analysis.outcome.result as {
    kind: string;
    evidence?: EvidenceObject;
    limitations?: string[];
    rejectionReason?: string;
  };
  const fallbackLimitations = [
    ...(result.limitations ?? []),
    ...(result.rejectionReason ? [result.rejectionReason] : []),
  ];
  return {
    kind: result.kind,
    ...(result.evidence ? { evidence: result.evidence } : {}),
    limitationCount: result.evidence
      ? result.evidence.limitations.length
      : new Set(fallbackLimitations).size,
  };
}

export function summarizeAnalysisTrust(
  analysis: ActiveAnalysis
): AnalysisTrustSummary {
  const details = resultDetails(analysis);
  const state = details.evidence?.evidenceState ?? null;
  const sourceCount = details.evidence
    ? new Set(
        details.evidence.observations.map(
          (observation) => observation.provenance.sourceId
        )
      ).size
    : 0;
  const stateLabel = state
    ? EVIDENCE_STATE_LABELS[state]
    : RESULT_KIND_LABELS[details.kind] ?? "Evidence status unavailable";
  const showNoDangerReminder = state !== "observations_returned" ||
    details.kind !== "success";

  return {
    state,
    stateLabel,
    sourceCount,
    limitationCount: details.limitationCount,
    showNoDangerReminder,
  };
}

export function formatAnalysisTime(analysis: ActiveAnalysis): string {
  const time = analysis.request.placeSelection.timeSelection;
  if (time.type !== "custom") return TIME_RANGE_DISPLAY_LABELS[time.type];
  const start = time.startTs?.slice(0, 10);
  const end = time.endTs?.slice(0, 10);
  if (!start || !end) return TIME_RANGE_DISPLAY_LABELS.custom;
  return start === end ? start : `${start}–${end}`;
}

export function formatAnalysisPlace(analysis: ActiveAnalysis): string {
  return analysis.request.placeSelection.label.replace(
    /\s+\((?:agent coordinates|OSM search)\)$/u,
    ""
  );
}
