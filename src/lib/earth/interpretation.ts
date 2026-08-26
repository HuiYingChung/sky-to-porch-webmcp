/**
 * ADR-0045: lightweight deterministic interpretation of validated Earth &
 * Volcanoes evidence.
 *
 * Pure counting only: observed USGS earthquake events (with the largest
 * reported magnitude) and official USGS HANS volcano activity notices.
 * Nothing here predicts, ranks danger, or links satellite imagery to events —
 * those claims are exactly what the hazard's required limitations forbid.
 */

import type { EvidenceObject, Observation } from "@/contracts/evidence";

export interface EarthEvidenceInterpretation {
  /** True when at least one observed event or official notice is present. */
  hasEventData: boolean;
  /** Count of validated observed USGS earthquake events in the area/date. */
  earthquakeCount: number;
  /** Largest reported magnitude, when any event reports one. */
  maxMagnitude?: number;
  /** Locality string of the largest-magnitude event, when reported. */
  maxMagnitudePlace?: string;
  /** Count of official USGS HANS volcano activity notices. */
  volcanoNoticeCount: number;
}

function isEarthquakeObservation(observation: Observation): boolean {
  return observation.provenance.sourceId === "usgs_earthquake_geojson";
}

function isVolcanoNoticeObservation(observation: Observation): boolean {
  return observation.provenance.sourceId === "usgs_volcano_hans";
}

/**
 * Count observed earthquake events and volcano notices, and surface the
 * largest reported magnitude verbatim. Events without a reported magnitude
 * still count but never contribute a number.
 */
export function interpretEarthEvidence(evidence: EvidenceObject): EarthEvidenceInterpretation {
  const quakes = evidence.observations.filter(isEarthquakeObservation);
  const notices = evidence.observations.filter(isVolcanoNoticeObservation);
  const withMagnitude = quakes.filter(
    (observation) =>
      typeof observation.value === "number" && Number.isFinite(observation.value)
  );
  const strongest = [...withMagnitude].sort(
    (left, right) => (right.value as number) - (left.value as number) ||
      left.observationId.localeCompare(right.observationId)
  )[0];
  const place = strongest?.metadata?.place;
  return {
    hasEventData: quakes.length > 0 || notices.length > 0,
    earthquakeCount: quakes.length,
    ...(strongest ? { maxMagnitude: strongest.value as number } : {}),
    ...(strongest && typeof place === "string" ? { maxMagnitudePlace: place } : {}),
    volcanoNoticeCount: notices.length,
  };
}
