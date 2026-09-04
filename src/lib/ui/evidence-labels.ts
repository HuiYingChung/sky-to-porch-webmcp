import type { DataMode, EvidenceState } from "@/contracts/common";
import type { ConfidenceLevel, FreshnessStatus } from "@/contracts/evidence";

const EVIDENCE_STATE_LABELS: Record<EvidenceState, string> = {
  observations_returned: "Evidence found",
  no_observation: "No matching observation",
  source_failure: "Source unavailable",
  unsupported_coverage: "Outside source coverage",
  stale_data: "Data may be stale",
  inconclusive_evidence: "Inconclusive evidence",
  valid_observation_no_anomaly: "No anomaly detected by this source",
  no_active_official_alert: "No active official alert in this source",
};

const DATA_MODE_LABELS: Record<DataMode, string> = {
  live: "Live retrieval",
  fixture: "Demo fixture",
  cached: "Cached data",
  historical: "Historical data",
  simulated: "Simulation",
  unavailable: "Unavailable",
  failed: "Retrieval failed",
};

const CONFIDENCE_LEVEL_LABELS: Record<ConfidenceLevel, string> = {
  high: "High",
  moderate: "Moderate",
  low: "Low",
  insufficient: "Insufficient evidence",
};

const FRESHNESS_STATUS_LABELS: Record<FreshnessStatus, string> = {
  current: "Current",
  recent: "Recent",
  stale: "Stale",
  historical: "Historical",
  unknown: "Unknown",
};

export function evidenceStateLabel(state: EvidenceState | string | null | undefined): string {
  return typeof state === "string"
    ? EVIDENCE_STATE_LABELS[state as EvidenceState] ?? "Evidence state unavailable"
    : "Evidence state unavailable";
}

export function dataModeLabel(mode: DataMode | string | null | undefined): string {
  return typeof mode === "string"
    ? DATA_MODE_LABELS[mode as DataMode] ?? "Data mode unavailable"
    : "Data mode unavailable";
}

export function confidenceLevelLabel(
  level: ConfidenceLevel | string | null | undefined
): string {
  return typeof level === "string"
    ? CONFIDENCE_LEVEL_LABELS[level as ConfidenceLevel] ?? "Confidence unavailable"
    : "Confidence unavailable";
}

export function freshnessStatusLabel(
  status: FreshnessStatus | string | null | undefined
): string {
  return typeof status === "string"
    ? FRESHNESS_STATUS_LABELS[status as FreshnessStatus] ?? "Freshness unavailable"
    : "Freshness unavailable";
}
