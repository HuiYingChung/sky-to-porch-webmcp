import type { BoundingBox, ConcernType } from "@/contracts/common";
import type { EvidenceObject, Explanation } from "@/contracts/evidence";
import type { EvidenceExplanationStatus } from "@/lib/ai/evidence-explainer";
import type { EvidenceConflict } from "@/lib/evidence/evaluator";
import type { FloodEvidenceAssessment } from "./claim-separation";

export const FLOOD_PINNED_FIXTURE_DATE = "2024-07-08";
export const FLOOD_UNSUPPORTED_FIXTURE_DATE = "1990-01-01";
/** UXFIX-02 (ADR-0022): widened from 3 to 7 completed UTC days. */
export const FLOOD_MAX_RANGE_DAYS = 7;
/**
 * ADR-0043: start of the GIBS IMERG precipitation record. Owned here (a pure
 * module) so the server adapter and the UI calendar bounds share one value
 * and a pre-record date is rejected explicitly instead of returning seven
 * transparent tiles read as a coverage gap.
 */
export const FLOOD_EARLIEST_DATE = "2000-06-01";

export const USGS_GAGE_HEIGHT_PARAMETER = "00065";

export type FloodEvidenceMode = "live" | "fixture";

export interface FloodFixtureQueryInput {
  placeId: string;
  date: string;
  mode: "fixture";
}

export interface FloodLiveQueryInput {
  placeId: string;
  startDate: string;
  endDate: string;
  mode: "live";
  /** UXFIX-02: validated map-selected query area (required for custom-area). */
  area?: BoundingBox;
}

export type FloodQueryInput = FloodFixtureQueryInput | FloodLiveQueryInput;

export type FloodQueryRequest = FloodQueryInput & {
  concern: ConcernType;
  optionalQuestion?: string;
};

export type FloodFailureReason =
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "malformed"
  | "schema_validation"
  | "provider_failure"
  | "validation_failure";

export type FloodSourceOutcome =
  | "success"
  | "no_observation"
  | "failed"
  | "not_attempted";

export interface FloodSourceOutcomes {
  imerg: FloodSourceOutcome;
  floodExtent: FloodSourceOutcome;
  usgs: FloodSourceOutcome;
  canadaGeomet?: FloodSourceOutcome;
}

export type FloodQueryResultKind =
  | "success"
  | "inconclusive_evidence"
  | "unsupported_coverage"
  | "source_failure"
  | "unsupported_place"
  | "unsupported_date";

export interface FloodQueryResult {
  kind: FloodQueryResultKind;
  sourceOutcomes?: FloodSourceOutcomes;
  evidence?: EvidenceObject;
  assessments?: FloodEvidenceAssessment[];
  failureReason?: FloodFailureReason;
  rejectionReason?: string;
  explanation?: Explanation;
  explanationStatus?: EvidenceExplanationStatus;
  evidenceConflicts?: EvidenceConflict[];
}
