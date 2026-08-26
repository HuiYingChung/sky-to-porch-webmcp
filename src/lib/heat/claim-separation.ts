/**
 * src/lib/heat/claim-separation.ts
 *
 * WP-09 bounded deterministic Heat claim-separation function.
 *
 * Converts a validated Extreme Heat EvidenceObject into a fixed-order
 * structured separation of six locked categories. Makes no network,
 * filesystem, environment, timer, random, or provider call.
 *
 * GIBS is visualization-only; indoor temperature, household heat certainty,
 * and individual medical risk are always not_supported.
 */

import { validateEvidenceObject, type EvidenceObject } from "@/contracts/evidence";
import { type SourceId } from "@/contracts/dataset-registry";
import { validateHeatSourceObservation } from "./source-contracts";

// ---------------------------------------------------------------------------
// Locked public API
// ---------------------------------------------------------------------------

export const HEAT_EVIDENCE_CODES = [
  "satellite_land_surface_temperature_visualization",
  "ground_air_temperature",
  "derived_heat_index",
  "indoor_temperature",
  "household_heat_certainty",
  "individual_medical_risk",
] as const;

export type HeatEvidenceCode = (typeof HEAT_EVIDENCE_CODES)[number];

export type HeatEvidenceStatus =
  | "evidence_present"
  | "not_provided"
  | "not_supported";

export type HeatEvidenceAssessment = {
  code: HeatEvidenceCode;
  status: HeatEvidenceStatus;
  observationIds: string[];
  sourceIds: SourceId[];
};

// ---------------------------------------------------------------------------
// Suppression conditions (behavior rule 9)
// ---------------------------------------------------------------------------

const SUPPRESSED_DATA_MODES = new Set(["failed", "unavailable"]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeSuppressed(code: HeatEvidenceCode): HeatEvidenceAssessment {
  return { code, status: "not_provided", observationIds: [], sourceIds: [] };
}

function makeNotSupported(code: HeatEvidenceCode): HeatEvidenceAssessment {
  return { code, status: "not_supported", observationIds: [], sourceIds: [] };
}

function sortedUnique(arr: string[]): string[] {
  return [...new Set(arr)].sort();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Converts a validated Extreme Heat EvidenceObject into exactly six
 * HeatEvidenceAssessment entries in HEAT_EVIDENCE_CODES order.
 *
 * Fails closed on invalid input, wrong hazard, malformed matching
 * observations, and any forbidden claim.
 */
export function separateHeatEvidence(
  evidence: EvidenceObject
): HeatEvidenceAssessment[] {
  // Rule 1: validate first, fail closed on invalid input.
  validateEvidenceObject(evidence);

  // Rule 2: require extreme_heat hazard.
  if (evidence.hazardId !== "extreme_heat") {
    throw new Error(
      `separateHeatEvidence requires hazardId "extreme_heat", got "${evidence.hazardId}"`
    );
  }

  // Rules 10 & 14: the three safety-locked categories are always not_supported.
  const indoorTemp = makeNotSupported("indoor_temperature");
  const householdCertainty = makeNotSupported("household_heat_certainty");
  const medicalRisk = makeNotSupported("individual_medical_risk");

  // Rules 5–8: collect and validate matching heat-source observations BEFORE
  // state/data-mode suppression check (rule 5). A malformed matching
  // observation fails closed instead of being hidden behind a blocked state.
  const gibsIds: string[] = [];
  const gibsSources: SourceId[] = [];
  const airTempIds: string[] = [];
  const airTempSources: SourceId[] = [];
  const heatIndexIds: string[] = [];
  const heatIndexSources: SourceId[] = [];

  for (const obs of evidence.observations) {
    const sid = obs.provenance.sourceId;
    if (
      sid !== "nasa_gibs_modis_lst_day" &&
      sid !== "noaa_uscrn_heat_exposure" &&
      sid !== "nws_station_observations" &&
      sid !== "noaa_ncei_global_hourly"
    ) {
      // Rule 13: unrelated observations are ignored.
      continue;
    }

    // Rule 5: validate BEFORE suppression check. Throws (fails closed) if malformed.
    validateHeatSourceObservation(obs);

    // Collect by validated role.
    const role = (obs.metadata as Record<string, string | number | boolean>)
      .heatRole as string;

    if (role === "satellite_land_surface_temperature_visualization") {
      gibsIds.push(obs.observationId);
      gibsSources.push(sid as SourceId);
    } else if (role === "ground_air_temperature") {
      airTempIds.push(obs.observationId);
      airTempSources.push(sid as SourceId);
    } else if (role === "derived_heat_index") {
      heatIndexIds.push(obs.observationId);
      heatIndexSources.push(sid as SourceId);
    }
    // Any other role would have already thrown in validateHeatSourceObservation.
  }

  // Rule 9: source-backed evidence_present is only allowed when
  // evidenceState is "observations_returned" and dataMode is not failed/unavailable.
  // Every other valid evidence state returns not_provided.
  // Note: suppression check happens AFTER matching obs validation (rule 5).
  const suppressed =
    evidence.evidenceState !== "observations_returned" ||
    SUPPRESSED_DATA_MODES.has(evidence.dataMode);

  if (suppressed) {
    return [
      makeSuppressed("satellite_land_surface_temperature_visualization"),
      makeSuppressed("ground_air_temperature"),
      makeSuppressed("derived_heat_index"),
      indoorTemp,
      householdCertainty,
      medicalRisk,
    ];
  }

  // Rule 12: evidence_present IDs are unique and sorted.
  function buildAssessment(
    code: HeatEvidenceCode,
    ids: string[],
    sources: SourceId[]
  ): HeatEvidenceAssessment {
    if (ids.length === 0) {
      return makeSuppressed(code);
    }
    return {
      code,
      status: "evidence_present",
      observationIds: sortedUnique(ids),
      sourceIds: sortedUnique(sources) as SourceId[],
    };
  }

  // Rules 6–8: build the three source-backed assessments.
  const gibs = buildAssessment(
    "satellite_land_surface_temperature_visualization",
    gibsIds,
    gibsSources
  );
  const airTemp = buildAssessment("ground_air_temperature", airTempIds, airTempSources);
  const heatIndex = buildAssessment("derived_heat_index", heatIndexIds, heatIndexSources);

  // Rule 4: always return exactly six assessments in HEAT_EVIDENCE_CODES order.
  return [gibs, airTemp, heatIndex, indoorTemp, householdCertainty, medicalRisk];
}
