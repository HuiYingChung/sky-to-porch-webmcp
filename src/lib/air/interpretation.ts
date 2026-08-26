/**
 * ADR-0045: deterministic interpretation of validated Air Quality evidence.
 *
 * Pure functions that read already-validated AirNow daily monitoring-site AQI
 * rows out of an EvidenceObject and classify the peak value against the
 * official U.S. EPA AQI categories. No value is invented: every number in the
 * result is copied verbatim from a validated observation, and satellite-only
 * evidence yields severity "unknown" rather than a guess.
 */

import type { EvidenceObject, Observation } from "@/contracts/evidence";

export type AirSeverity =
  | "good"
  | "moderate"
  | "unhealthy_for_sensitive_groups"
  | "unhealthy"
  | "very_unhealthy"
  | "hazardous"
  | "unknown";

export interface AirEvidenceInterpretation {
  hasMonitorData: boolean;
  /** Peak daily AQI across all in-area monitoring-site rows. */
  peakAqi?: number;
  /** Plain pollutant name for the peak row (e.g. "PM2.5", "ozone"). */
  peakPollutant?: string;
  /** Monitoring-site name for the peak row, when reported. */
  peakSiteName?: string;
  /** Count of validated in-area monitoring-site AQI rows. */
  monitorRowCount: number;
  severity: AirSeverity;
}

/** Official EPA category names, verbatim. */
export const AIR_SEVERITY_LABELS: Record<Exclude<AirSeverity, "unknown">, string> = {
  good: "Good",
  moderate: "Moderate",
  unhealthy_for_sensitive_groups: "Unhealthy for Sensitive Groups",
  unhealthy: "Unhealthy",
  very_unhealthy: "Very Unhealthy",
  hazardous: "Hazardous",
};

/** Official EPA AQI ranges, used only to describe the category in prose. */
export const AIR_SEVERITY_RANGES: Record<Exclude<AirSeverity, "unknown">, string> = {
  good: "0–50",
  moderate: "51–100",
  unhealthy_for_sensitive_groups: "101–150",
  unhealthy: "151–200",
  very_unhealthy: "201–300",
  hazardous: "301 and higher",
};

/**
 * Official EPA AQI category for one AQI value:
 * 0–50 Good; 51–100 Moderate; 101–150 Unhealthy for Sensitive Groups;
 * 151–200 Unhealthy; 201–300 Very Unhealthy; 301+ Hazardous.
 */
export function airSeverityForAqi(aqi: number): Exclude<AirSeverity, "unknown"> {
  if (aqi >= 301) return "hazardous";
  if (aqi >= 201) return "very_unhealthy";
  if (aqi >= 151) return "unhealthy";
  if (aqi >= 101) return "unhealthy_for_sensitive_groups";
  if (aqi >= 51) return "moderate";
  return "good";
}

/** AirNow daily variableNames look like "PM2.5-24HR outdoor daily AQI". */
const POLLUTANT_LABELS: Record<string, string> = {
  "OZONE-8HR": "ozone",
  "PM2.5-24HR": "PM2.5",
  "PM10-24HR": "PM10",
};

function pollutantLabel(variableName: string): string | undefined {
  const parameter = variableName.split(" ")[0];
  if (!parameter) return undefined;
  return POLLUTANT_LABELS[parameter] ?? parameter;
}

function isMonitorAqiObservation(observation: Observation): boolean {
  return observation.provenance.sourceId === "airnow_daily_data" &&
    observation.unit === "AQI" &&
    typeof observation.value === "number" &&
    Number.isFinite(observation.value);
}

/**
 * Scan validated observations for AirNow daily monitoring-site AQI rows and
 * classify the peak against the official EPA categories. Evidence without any
 * monitoring-site row (satellite-only) is "unknown", never "good".
 */
export function interpretAirEvidence(evidence: EvidenceObject): AirEvidenceInterpretation {
  const rows = evidence.observations.filter(isMonitorAqiObservation);
  if (rows.length === 0) return { hasMonitorData: false, monitorRowCount: 0, severity: "unknown" };

  const peak = [...rows].sort(
    (left, right) => (right.value as number) - (left.value as number) ||
      left.observationId.localeCompare(right.observationId)
  )[0];
  const siteName = peak.metadata?.siteName;
  return {
    hasMonitorData: true,
    peakAqi: peak.value as number,
    ...(pollutantLabel(peak.variableName)
      ? { peakPollutant: pollutantLabel(peak.variableName) }
      : {}),
    ...(typeof siteName === "string" ? { peakSiteName: siteName } : {}),
    monitorRowCount: rows.length,
    severity: airSeverityForAqi(peak.value as number),
  };
}
