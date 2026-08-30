import type { BoundingBox, ConcernType } from "@/contracts/common";
import type { EvidenceObject, Explanation } from "@/contracts/evidence";
import type { EvidenceExplanationStatus } from "@/lib/ai/evidence-explainer";
import type { EvidenceConflict } from "@/lib/evidence/evaluator";

export const DROUGHT_PINNED_FIXTURE_DATE = "2024-06-04";
export type DroughtEvidenceMode = "live" | "fixture";

export interface DroughtFixtureQueryInput {
  placeId: string;
  date: string;
  mode: "fixture";
}

export interface DroughtLiveQueryInput {
  placeId: string;
  date: string;
  mode: "live";
  /** Validated user-selected area for the global GIBS vegetation baseline. */
  area?: BoundingBox;
}

export type DroughtQueryInput =
  | DroughtFixtureQueryInput
  | DroughtLiveQueryInput;

export type DroughtQueryRequest = DroughtQueryInput & {
  concern: ConcernType;
  optionalQuestion?: string;
};

export type DroughtSourceOutcome =
  | "success"
  | "no_observation"
  | "failed"
  | "not_attempted";

export interface DroughtSourceOutcomes {
  gibs: DroughtSourceOutcome;
  usdm: DroughtSourceOutcome;
  administrativeArea?: DroughtSourceOutcome;
  canadaDrought?: DroughtSourceOutcome;
}

export type DroughtFailureReason =
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "media_type"
  | "malformed"
  | "schema_validation"
  | "provider_failure"
  | "validation_failure";

export type DroughtFailureStage =
  | "gibs_domain_transport"
  | "gibs_domain_payload"
  | "gibs_image_transport"
  | "gibs_image_payload"
  | "administrative_area_resolution"
  | "usdm_transport"
  | "usdm_payload"
  | "evidence_assembly";

export type DroughtQueryResultKind =
  | "success"
  | "inconclusive_evidence"
  | "no_observation"
  | "unsupported_coverage"
  | "source_failure"
  | "unsupported_place"
  | "unsupported_date";

export interface DroughtQueryResult {
  kind: DroughtQueryResultKind;
  sourceOutcomes: DroughtSourceOutcomes;
  evidence?: EvidenceObject;
  failureReason?: DroughtFailureReason;
  failureStage?: DroughtFailureStage;
  rejectionReason?: string;
  explanation?: Explanation;
  explanationStatus?: EvidenceExplanationStatus;
  evidenceConflicts?: EvidenceConflict[];
}
