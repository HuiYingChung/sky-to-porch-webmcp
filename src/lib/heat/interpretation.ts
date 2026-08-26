/**
 * P0-B: deterministic interpretation of validated Extreme Heat evidence.
 *
 * Pure functions that read already-validated NOAA USCRN station observations
 * out of an EvidenceObject and classify the peak reading against the NWS
 * heat-index categories (expressed in Celsius). No value is invented:
 * every number in the result comes from a validated observation, rounded to
 * one decimal (ADR-0048), and satellite-only evidence yields severity
 * "unknown" rather than a guess. The unrounded observation stays verbatim
 * in the Evidence audit trail.
 */

import type { EvidenceObject, Observation } from "@/contracts/evidence";

export type HeatSeverity =
  | "none"
  | "caution"
  | "extreme_caution"
  | "danger"
  | "extreme_danger"
  | "unknown";

export interface HeatEvidenceInterpretation {
  hasStationData: boolean;
  peakAirTempC?: number;
  peakHeatIndexC?: number;
  peakHourUtc?: string;
  stationName?: string;
  severity: HeatSeverity;
}

/** Plain-language names for the NWS heat-index categories. */
export const HEAT_SEVERITY_LABELS: Record<Exclude<HeatSeverity, "unknown" | "none">, string> = {
  caution: "caution",
  extreme_caution: "extreme caution",
  danger: "danger",
  extreme_danger: "extreme danger",
};

/**
 * ADR-0048: public NWS heat-index category boundaries in Celsius, phrased
 * for the model context so cited thresholds pass the numeric whitelist
 * (same pattern as the EPA scale in ADR-0042). Must stay in lockstep with
 * heatSeverityForCelsius below.
 */
export const HEAT_SEVERITY_SCALE_C =
  "below 26.7 none; 26.7 to 32.2 caution; 32.2 to 39.4 extreme caution; " +
  "39.4 to 51.1 danger; 51.1 and above extreme danger";

/**
 * ADR-0048: derived station values are rounded to one decimal before they
 * become the canonical numeric tokens for the deterministic Meaning, the
 * model context, and the numeric whitelist. A raw computed heat index like
 * 44.26911953571667 forces any model that cites its naturally rounded form
 * into a numeric_token_not_in_context rejection.
 */
export function roundCelsiusForClaims(valueC: number): number {
  return Math.round(valueC * 10) / 10;
}

/**
 * NWS heat-index category for one Celsius value:
 * < 26.7 none; 26.7–32.2 caution; 32.2–39.4 extreme caution;
 * 39.4–51.1 danger; >= 51.1 extreme danger.
 */
export function heatSeverityForCelsius(valueC: number): Exclude<HeatSeverity, "unknown"> {
  if (valueC >= 51.1) return "extreme_danger";
  if (valueC >= 39.4) return "danger";
  if (valueC >= 32.2) return "extreme_caution";
  if (valueC >= 26.7) return "caution";
  return "none";
}

// ADR-0038/0039: NWS and GHCNh station observations carry the same roles and
// variable names as USCRN.
const STATION_SOURCE_IDS = new Set([
  "noaa_uscrn_heat_exposure",
  "nws_station_observations",
  "noaa_ncei_global_hourly",
]);

function isStationObservation(observation: Observation, variableName: string): boolean {
  return STATION_SOURCE_IDS.has(observation.provenance.sourceId) &&
    observation.variableName === variableName &&
    typeof observation.value === "number" &&
    Number.isFinite(observation.value);
}

function peakOf(observations: Observation[]): Observation | undefined {
  return [...observations].sort(
    (left, right) => (right.value as number) - (left.value as number) ||
      String(left.provenance.observedAt).localeCompare(String(right.provenance.observedAt))
  )[0];
}

/**
 * Scan validated observations for USCRN hourly air-temperature and heat-index
 * values and classify the peak. Severity uses the peak heat index when one is
 * present and falls back to the peak air temperature; evidence without any
 * station value is "unknown", never "none".
 */
export function interpretHeatEvidence(evidence: EvidenceObject): HeatEvidenceInterpretation {
  const airObservations = evidence.observations.filter((observation) =>
    isStationObservation(observation, "Hourly air temperature")
  );
  const indexObservations = evidence.observations.filter((observation) =>
    isStationObservation(observation, "Hourly heat index")
  );
  const peakAir = peakOf(airObservations);
  const peakIndex = peakOf(indexObservations);
  const hasStationData = peakAir !== undefined || peakIndex !== undefined;
  if (!hasStationData) return { hasStationData: false, severity: "unknown" };

  const basisObservation = peakIndex ?? peakAir;
  const stationName = basisObservation?.metadata?.stationName;
  // ADR-0048: severity is classified from the same rounded value the user
  // sees, so a displayed number can never contradict its category at a
  // threshold boundary (e.g. raw 39.35 shown as 39.4 must read "danger").
  const roundedAir = peakAir ? roundCelsiusForClaims(peakAir.value as number) : undefined;
  const roundedIndex = peakIndex ? roundCelsiusForClaims(peakIndex.value as number) : undefined;
  return {
    hasStationData: true,
    ...(roundedAir !== undefined ? { peakAirTempC: roundedAir } : {}),
    ...(roundedIndex !== undefined ? { peakHeatIndexC: roundedIndex } : {}),
    ...(basisObservation && basisObservation.provenance.observedAt !== "unknown"
      ? { peakHourUtc: basisObservation.provenance.observedAt }
      : {}),
    ...(typeof stationName === "string" ? { stationName } : {}),
    severity: heatSeverityForCelsius((roundedIndex ?? roundedAir) as number),
  };
}
