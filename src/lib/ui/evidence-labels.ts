import type { DataMode, EvidenceState } from "@/contracts/common";

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

export function evidenceStateLabel(state: EvidenceState): string {
  return EVIDENCE_STATE_LABELS[state];
}

export function dataModeLabel(mode: DataMode): string {
  return DATA_MODE_LABELS[mode];
}
