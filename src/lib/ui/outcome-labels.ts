/**
 * PR4b batch 2: one shared plain-language vocabulary for per-source retrieval
 * outcomes. Panels previously interpolated raw enum values ("success",
 * "no_observation", "out_of_scope") straight into user-facing sentences.
 */

const SOURCE_OUTCOME_LABELS: Record<string, string> = {
  success: "succeeded",
  no_observation: "returned nothing",
  source_failure: "failed",
  failed: "failed",
  not_attempted: "not attempted",
  out_of_scope: "out of scope",
  credential_gate_closed: "blocked by a missing credential",
};

/** Plain-language label for a per-source outcome; unknown values never leak raw codes. */
export function sourceOutcomeLabel(outcome: unknown): string {
  return typeof outcome === "string"
    ? SOURCE_OUTCOME_LABELS[outcome] ?? "status unavailable"
    : "status unavailable";
}
