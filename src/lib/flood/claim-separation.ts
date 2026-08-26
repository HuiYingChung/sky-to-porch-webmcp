/**
 * src/lib/flood/claim-separation.ts
 *
 * Pure deterministic Flood evidence-separation function.
 *
 * Converts a validated Flood EvidenceObject into a fixed-order structured
 * separation of six evidence categories. Does not mutate input, produce prose,
 * infer numeric rainfall from GIBS imagery, or draw property/route conclusions
 * from regional evidence.
 *
 * Safety rules enforced:
 *   - Fails closed on invalid input (validateEvidenceObject).
 *   - Requires hazardId === "flood_storm".
 *   - Shape validation for every matching GIBS/USGS observation runs before
 *     any blocked-state suppression; an invalid shape fails closed regardless
 *     of evidenceState or dataMode.
 *   - A GIBS observation must carry textValue (not numeric value) and its
 *     dataMode must match the parent EvidenceObject.
 *   - A USGS observation must carry numeric value, unit exactly "ft", and
 *     metadata with a non-whitespace siteId and parameterCd === "00065".
 *   - source_failure, no_observation, unsupported_coverage, stale_data,
 *     inconclusive_evidence, failed, and unavailable yield not_provided only
 *     after all matching observations pass shape validation.
 *   - A VIIRS flood-extent observation must remain visual-only and is the only
 *     source that may populate the surface-water category.
 *   - route_disruption and property_impact are always not_supported.
 */

import { validateEvidenceObject, type EvidenceObject, type Observation } from "@/contracts/evidence";
import { type SourceId } from "@/contracts/dataset-registry";

// ---------------------------------------------------------------------------
// Public API — locked by WP-08 prompt
// ---------------------------------------------------------------------------

export const FLOOD_EVIDENCE_CODES = [
  "satellite_precipitation_visualization",
  "ground_gage_height",
  "surface_water",
  "official_warning",
  "route_disruption",
  "property_impact",
] as const;

export type FloodEvidenceCode = (typeof FLOOD_EVIDENCE_CODES)[number];

export type FloodEvidenceStatus =
  | "evidence_present"
  | "not_provided"
  | "not_supported";

export type FloodEvidenceAssessment = {
  code: FloodEvidenceCode;
  status: FloodEvidenceStatus;
  observationIds: string[];
  sourceIds: SourceId[];
};

// ---------------------------------------------------------------------------
// Non-supporting evidence states (rule 9)
// ---------------------------------------------------------------------------

const NON_SUPPORTING_STATES = new Set([
  "no_observation",
  "source_failure",
  "unsupported_coverage",
  "stale_data",
  "inconclusive_evidence",
]);

const NON_SUPPORTING_DATA_MODES = new Set(["failed", "unavailable"]);

// ---------------------------------------------------------------------------
// GIBS observation shape validation (rules 5 + 6)
// Throws on any locked-shape violation; returns true when the observation
// is fully valid. Called for every nasa_gibs_imerg observation regardless
// of evidenceState — shape validation precedes state suppression.
// ---------------------------------------------------------------------------

function assertGibsShape(obs: Observation, parentDataMode: string): void {
  // Rule 6: any numeric GIBS observation fails closed immediately
  if (obs.value !== undefined) {
    throw new Error(
      `GIBS observation ${obs.observationId} has numeric value — numeric rainfall must not be inferred from imagery`
    );
  }
  // Rule 5c: must be text-valued
  if (obs.textValue === undefined) {
    throw new Error(
      `GIBS observation ${obs.observationId} has neither value nor textValue`
    );
  }
  // Rule 5d: dataMode must match the parent EvidenceObject
  if (obs.dataMode !== parentDataMode) {
    throw new Error(
      `GIBS observation ${obs.observationId} dataMode "${obs.dataMode}" does not match EvidenceObject dataMode "${parentDataMode}"`
    );
  }
}

// ---------------------------------------------------------------------------
// USGS observation shape validation (rules 7 + 8)
// Throws on any locked-shape violation. Called for every
// usgs_instantaneous_values observation regardless of evidenceState.
// ---------------------------------------------------------------------------

function assertUsgsShape(obs: Observation): void {
  // Rule 8: must be numeric
  if (obs.value === undefined) {
    throw new Error(
      `USGS observation ${obs.observationId} is not numeric — expected gage height value`
    );
  }
  // Rule 7: exact unit "ft"
  if (obs.unit !== "ft") {
    throw new Error(
      `USGS observation ${obs.observationId} has unit "${obs.unit}" — expected "ft"`
    );
  }
  const meta = obs.metadata as Record<string, string | number | boolean> | undefined;
  if (!meta) {
    throw new Error(
      `USGS observation ${obs.observationId} is missing required metadata (siteId, parameterCd)`
    );
  }
  // siteId must be a non-whitespace string
  if (typeof meta.siteId !== "string" || meta.siteId.trim().length === 0) {
    throw new Error(
      `USGS observation ${obs.observationId} metadata.siteId is missing or blank`
    );
  }
  if (meta.parameterCd !== "00065") {
    throw new Error(
      `USGS observation ${obs.observationId} metadata.parameterCd "${meta.parameterCd}" — expected "00065"`
    );
  }
}

function assertFloodExtentShape(obs: Observation, parentDataMode: string): void {
  if (obs.value !== undefined || obs.textValue === undefined) {
    throw new Error(
      `Flood-extent observation ${obs.observationId} must be visual text evidence without a numeric value`
    );
  }
  if (obs.dataMode !== parentDataMode) {
    throw new Error(
      `Flood-extent observation ${obs.observationId} dataMode does not match its EvidenceObject`
    );
  }
  const metadata = obs.metadata;
  if (
    !metadata ||
    metadata.floodRole !== "satellite_flood_extent_visualization" ||
    metadata.legendStatus !== "unvalidated"
  ) {
    throw new Error(
      `Flood-extent observation ${obs.observationId} lacks the visual-only role or legend boundary`
    );
  }
  if (!(obs.qualifiers ?? []).includes("pixel_classification_not_inferred")) {
    throw new Error(
      `Flood-extent observation ${obs.observationId} lacks qualifier pixel_classification_not_inferred`
    );
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function separateFloodEvidence(evidence: EvidenceObject): FloodEvidenceAssessment[] {
  // Rule 1: fail closed on invalid input
  validateEvidenceObject(evidence);

  // Rule 2: require flood_storm hazard
  if (evidence.hazardId !== "flood_storm") {
    throw new Error(
      `separateFloodEvidence requires hazardId "flood_storm", got "${evidence.hazardId}"`
    );
  }

  // Collect all target-source observations first.
  const gibsObs = evidence.observations.filter(
    (obs) => obs.provenance.sourceId === "nasa_gibs_imerg"
  );
  const usgsObs = evidence.observations.filter(
    (obs) => obs.provenance.sourceId === "usgs_instantaneous_values"
  );
  const floodExtentObs = evidence.observations.filter(
    (obs) => obs.provenance.sourceId === "nasa_lance_flood_extent"
  );

  // Shape validation runs before any state suppression (C01 correction).
  // An observation claiming a target source role with an invalid locked shape
  // fails closed regardless of evidenceState or dataMode.
  for (const obs of gibsObs) {
    assertGibsShape(obs, evidence.dataMode);
  }
  for (const obs of usgsObs) {
    assertUsgsShape(obs);
  }
  for (const obs of floodExtentObs) {
    assertFloodExtentShape(obs, evidence.dataMode);
  }

  // Rule 9: non-supporting state or data mode → source-backed categories
  // are not_provided. Shape validation above has already passed.
  const stateBlocked =
    NON_SUPPORTING_STATES.has(evidence.evidenceState) ||
    NON_SUPPORTING_DATA_MODES.has(evidence.dataMode);

  // --- satellite_precipitation_visualization ---
  let gibsAssessment: FloodEvidenceAssessment;
  if (stateBlocked || evidence.evidenceState !== "observations_returned") {
    gibsAssessment = {
      code: "satellite_precipitation_visualization",
      status: "not_provided",
      observationIds: [],
      sourceIds: [],
    };
  } else if (gibsObs.length === 0) {
    gibsAssessment = {
      code: "satellite_precipitation_visualization",
      status: "not_provided",
      observationIds: [],
      sourceIds: [],
    };
  } else {
    const ids = [...new Set(gibsObs.map((o) => o.observationId))].sort();
    const srcIds = [...new Set(gibsObs.map((o) => o.provenance.sourceId as SourceId))].sort() as SourceId[];
    gibsAssessment = {
      code: "satellite_precipitation_visualization",
      status: "evidence_present",
      observationIds: ids,
      sourceIds: srcIds,
    };
  }

  // --- ground_gage_height ---
  let usgsAssessment: FloodEvidenceAssessment;
  if (stateBlocked || evidence.evidenceState !== "observations_returned") {
    usgsAssessment = {
      code: "ground_gage_height",
      status: "not_provided",
      observationIds: [],
      sourceIds: [],
    };
  } else if (usgsObs.length === 0) {
    usgsAssessment = {
      code: "ground_gage_height",
      status: "not_provided",
      observationIds: [],
      sourceIds: [],
    };
  } else {
    const ids = [...new Set(usgsObs.map((o) => o.observationId))].sort();
    const srcIds = [...new Set(usgsObs.map((o) => o.provenance.sourceId as SourceId))].sort() as SourceId[];
    usgsAssessment = {
      code: "ground_gage_height",
      status: "evidence_present",
      observationIds: ids,
      sourceIds: srcIds,
    };
  }

  const extentVisualizations = floodExtentObs.filter(
    (observation) =>
      observation.textValue === "flood_extent_visualization_available" &&
      !(observation.qualifiers ?? []).includes("no_observation")
  );
  const surfaceWaterAssessment: FloodEvidenceAssessment =
    stateBlocked || evidence.evidenceState !== "observations_returned" || extentVisualizations.length === 0
      ? { code: "surface_water", status: "not_provided", observationIds: [], sourceIds: [] }
      : {
          code: "surface_water",
          status: "evidence_present",
          observationIds: [...new Set(extentVisualizations.map((item) => item.observationId))].sort(),
          sourceIds: ["nasa_lance_flood_extent"],
        };

  // Official warnings remain absent; route and property claims remain unsupported.
  return [
    gibsAssessment,
    usgsAssessment,
    surfaceWaterAssessment,
    { code: "official_warning", status: "not_provided",   observationIds: [], sourceIds: [] },
    { code: "route_disruption", status: "not_supported",  observationIds: [], sourceIds: [] },
    { code: "property_impact",  status: "not_supported",  observationIds: [], sourceIds: [] },
  ];
}
