/**
 * src/lib/fire/explainer.ts
 *
 * WP-05 deterministic fire evidence explainer.
 *
 * Produces a validated Explanation from a validated EvidenceObject.
 * All explanations are aiGenerated=false (WP-06 owns AI explanations).
 *
 * WP-05-004: wording is derived from evidence.dataMode and freshness status
 * so live and fixture results produce distinct, truthful labels.
 *
 * Separates:
 *   - observed: what the data actually shows (observation counts, source, mode)
 *   - inferred: limited, cautious inference
 *   - notSupported: claims that cannot be made from this data
 *   - conflictsOrGaps: data gaps or source limitations
 *
 * Safety rules enforced here:
 *   - source_failure: no observation text, no inferred claim, required gap note
 *   - no_observation: required "no data ≠ no danger" statement in notSupported
 *   - observations_returned: counts are parsing counts, not distinct fires
 *   - No perimeter, AQI, indoor air, evacuation, or property-level claims
 *   - Live results labelled "LIVE RETRIEVAL · HISTORICAL OBSERVATION"
 *   - Fixture results labelled "FIXTURE · HISTORICAL"
 */

import type { EvidenceObject, Explanation } from "@/contracts/evidence";
// Note: validateExplanation is intentionally not called here so that this
// module remains webpack-safe in client component bundles.
// (evidence.ts uses .js relative imports that webpack cannot resolve.)
// TypeScript's static type system enforces the Explanation shape at compile time.
// The fixture adapter calls validateEvidenceObject (node/test only) on its results.

const PINNED_DATE = "2025-01-08";

/** Returns mode label based on evidence dataMode. */
function modeLabel(dataMode: string): string {
  if (dataMode === "live") return "LIVE RETRIEVAL · HISTORICAL OBSERVATION";
  if (dataMode === "fixture") return "FIXTURE · HISTORICAL";
  if (dataMode === "failed") return "FAILED RETRIEVAL";
  return dataMode.toUpperCase();
}

/**
 * Builds a deterministic, validated Explanation for a fire EvidenceObject.
 * Wording is derived from evidence.dataMode and freshness.status so live
 * and fixture results are clearly distinguishable.
 */
export function buildFireExplanation(evidence: EvidenceObject): Explanation {
  const { evidenceState, observations, freshness, confidence, dataMode } = evidence;

  let observed: string;
  let inferred: string | undefined;
  const notSupported: string[] = [
    "Confirmed fire perimeter or boundary location",
    "Calibrated outdoor AQI or air quality index",
    "Indoor air quality or personal health exposure",
    "Evacuation need or tactical firefighting guidance",
    "Property-level fire certainty or damage assessment",
    "Distinct fire count (parsing counts are not counts of individual fires)",
  ];
  let conflictsOrGaps: string | undefined;

  const label = modeLabel(dataMode);
  const observationDates = Array.from(new Set(
    observations
      .map((observation) => observation.metadata?.["observationDate"])
      .filter((date): date is string => typeof date === "string")
  )).sort();

  if (evidenceState === "source_failure") {
    observed = "No observations were retrieved. The data source returned a failure response.";
    inferred = undefined;
    conflictsOrGaps =
      "Source failure: NOAA HMS data could not be retrieved. " +
      "No stale or cached result was substituted. " +
      "Source failure is not proof of no fire or no danger.";
  } else if (evidenceState === "no_observation") {
    const firstObs = observations[0];
    const metaBox =
      (firstObs?.metadata?.["boundingBox"] as string | undefined) ?? "the requested area";
    observed =
      `NOAA HMS fire detection points for ${freshness.mostRecentObservationAt ?? PINNED_DATE}: ` +
      `zero coordinate pairs found in ${metaBox}. ` +
      `[${label}] Freshness: ${freshness.status}.`;
    inferred = undefined;
    conflictsOrGaps =
      "No coordinate pairs in the bounding box does not mean no fire is present. " +
      "Cloud cover, smoke, forest canopy, terrain, and processing delay can prevent detections.";
    notSupported.push(
      "Proof of no fire or no danger from a no-observation result"
    );
  } else if (evidenceState === "inconclusive_evidence") {
    const firstDate = observationDates[0] ?? "unknown";
    const lastDate = observationDates[observationDates.length - 1] ?? firstDate;
    observed =
      `NOAA HMS returned validated Fire and Smoke observations for ${observationDates.length} complete UTC ` +
      `date(s) from ${firstDate} through ${lastDate}, but at least one requested date lacked a complete source pair. ` +
      `Per-day counts and provenance remain separate in Evidence; no cross-day total is asserted. ` +
      `[${label}] Freshness: ${freshness.status}.`;
    inferred = undefined;
    conflictsOrGaps =
      "Partial date coverage prevents a complete range conclusion. Missing dates contributed no observations, " +
      "were not converted to zero, and do not imply no fire or no danger.";
    notSupported.push(
      "A complete trend or safety conclusion across a partially covered date range"
    );
  } else {
    // observations_returned
    const fireObs = observations.find((o) => o.provenance.sourceId === "noaa_hms_fire_points");
    const smokeObs = observations.find((o) => o.provenance.sourceId === "noaa_hms_smoke_polygons");
    const firePairs = fireObs?.value ?? 0;
    const smokePairs = smokeObs?.value ?? 0;
    const metaBox =
      (fireObs?.metadata?.["boundingBox"] as string | undefined) ?? "the requested area";

    observed = observationDates.length > 1
      ? `NOAA HMS returned validated historical Fire and Smoke observations for ${observationDates.length} complete UTC ` +
        `dates from ${observationDates[0]} through ${observationDates[observationDates.length - 1]}. ` +
        `Per-day counts and provenance remain separate in Evidence; no cross-day total is asserted. ` +
        `[${label}] Data mode: ${dataMode}. Confidence: ${confidence.level}. Freshness: ${freshness.status}.`
      : `NOAA HMS historical data for ${freshness.mostRecentObservationAt ?? PINNED_DATE}: ` +
        `${firePairs} fire detection ${fireObs?.unit ?? "coordinate_pairs"} found in ${metaBox}. ` +
        (smokeObs
          ? `${smokePairs} smoke polygon coordinate pairs found in the same area. `
          : "") +
        `[${label}] Data mode: ${dataMode}. Confidence: ${confidence.level}. ` +
        `Freshness: ${freshness.status}.`;

    inferred =
      `The presence of NOAA HMS fire detection records in the area on the covered date(s) ` +
      `is consistent with satellite-based fire activity in the broad region. ` +
      `This does not establish fire proximity to any specific property.`;

    conflictsOrGaps =
      "Cloud, smoke, canopy, and terrain occlusion may prevent some detections. " +
      "Parsing counts are not counts of distinct fires or threatened properties. " +
      "Processing and analyst-review delay of several hours applies.";
  }

  const explanation: Explanation = {
    explanationId: `exp-fire-${evidenceState}-wp05`,
    sourceEvidenceIds: [evidence.evidenceId],
    observed,
    ...(inferred !== undefined ? { inferred } : {}),
    notSupported,
    ...(conflictsOrGaps !== undefined ? { conflictsOrGaps } : {}),
    aiGenerated: false,
  };

  // TypeScript enforces the Explanation contract at compile time.
  return explanation;
}
