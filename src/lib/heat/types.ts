import type { BoundingBox, ConcernType } from "@/contracts/common";
import type { EvidenceObject, Explanation } from "@/contracts/evidence";
import type { EvidenceExplanationStatus } from "@/lib/ai/evidence-explainer";
import type { EvidenceConflict } from "@/lib/evidence/evaluator";
import type { HeatEvidenceAssessment } from "./claim-separation";

export const HEAT_PINNED_FIXTURE_DATE = "2024-07-11";
export const HEAT_UNSUPPORTED_FIXTURE_DATE = "1990-01-01";

/**
 * ADR-0041: marks an unsupported_coverage result whose transparent GIBS tile
 * is for a date so recent that the imagery is likely still unpublished rather
 * than truly outside coverage. Kept here (a pure module) so the deterministic
 * explainer can branch its wording without importing the server-only adapter.
 */
export const HEAT_GIBS_UNPUBLISHED_LIMITATION_ID =
  "lim-adr0041-gibs-imagery-possibly-unpublished";

export type HeatEvidenceMode = "live" | "fixture";

export interface HeatFixtureQueryInput {
  placeId: string;
  date: string;
  mode: "fixture";
}

export interface HeatLiveQueryInput {
  placeId: string;
  date: string;
  mode: "live";
  /** UXFIX-02: validated map-selected query area (required for custom-area). */
  area?: BoundingBox;
}

export type HeatQueryInput = HeatFixtureQueryInput | HeatLiveQueryInput;
export type HeatQueryRequest = HeatQueryInput & {
  concern: ConcernType;
  optionalQuestion?: string;
};

export type HeatFailureReason =
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "malformed"
  | "schema_validation"
  | "provider_failure"
  | "validation_failure";

export type HeatFailureStage =
  | "gibs_transport"
  | "noaa_transport"
  | "gibs_payload"
  | "noaa_payload"
  | "nws_transport"
  | "nws_payload"
  | "ghcnh_discovery"
  | "ghcnh_station_year"
  | "evidence_assembly";

export type HeatQueryResultKind =
  | "success"
  | "inconclusive_evidence"
  | "unsupported_coverage"
  | "source_failure"
  | "unsupported_place"
  | "unsupported_date";

export interface HeatQueryResult {
  kind: HeatQueryResultKind;
  evidence?: EvidenceObject;
  assessments?: HeatEvidenceAssessment[];
  failureReason?: HeatFailureReason;
  failureStage?: HeatFailureStage;
  rejectionReason?: string;
  explanation?: Explanation;
  explanationStatus?: EvidenceExplanationStatus;
  evidenceConflicts?: EvidenceConflict[];
}
