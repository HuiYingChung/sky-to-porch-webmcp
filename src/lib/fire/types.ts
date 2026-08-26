/**
 * WP-05 Fire & Smoke shared query/result types.
 *
 * Fixture mode remains pinned to the immutable 2025-01-08 regression data.
 * Live mode accepts only bounded server-resolved UTC date selections.
 */

import type { EvidenceObject, Explanation } from "@/contracts/evidence";
import type { BoundingBox, ConcernType } from "@/contracts/common";
import type { EvidenceExplanationStatus } from "@/lib/ai/evidence-explainer";
import type { EvidenceConflict } from "@/lib/evidence/evaluator";

export type FireFixtureKey =
  | "los-angeles-2025-01-08"
  | "lake-michigan-2025-01-08"
  | "source-failure";

export const PINNED_FIXTURE_DATE = "2025-01-08";
export const HMS_COMMON_START_DATE = "2005-08-05";
export const HMS_MAX_RANGE_DAYS = 7;

export const LA_FIRE_BOX: BoundingBox = {
  west: -119,
  south: 33,
  east: -117,
  north: 35,
};

export const LAKE_MICHIGAN_FIRE_BOX: BoundingBox = {
  west: -87,
  south: 43,
  east: -86.9,
  north: 43.1,
};

export type FireEvidenceMode = "live" | "fixture";

export type FireLiveTimeSelection =
  | {
      kind: "latest";
      /** Latest completed day, or seven UTC days ending on that day. */
      days: 1 | 7;
    }
  | {
      kind: "range";
      /** Inclusive strict YYYY-MM-DD UTC calendar dates. */
      startDate: string;
      endDate: string;
    };

export interface FireFixtureQueryInput {
  placeId: string;
  date: string;
  mode: "fixture";
}

export interface FireLiveTemporalQueryInput {
  placeId: string;
  mode: "live";
  time: FireLiveTimeSelection;
  /**
   * UXFIX-02: validated user-selected query area (required when
   * placeId === "custom-area"; absent for registered demo places).
   */
  area?: BoundingBox;
}

/**
 * Compatibility input for the immutable 2025-01-08 live-smoke regression.
 * New product UI requests use FireLiveTemporalQueryInput.
 */
export interface FireLiveLegacyRegressionInput {
  placeId: string;
  mode: "live";
  date: string;
}

export type FireLiveQueryInput =
  | FireLiveTemporalQueryInput
  | FireLiveLegacyRegressionInput;

export type FireQueryInput = FireFixtureQueryInput | FireLiveQueryInput;

/** Exact client-to-server request shape for WP-07 explanation integration. */
export type FireQueryRequest =
  | (FireFixtureQueryInput & { concern: ConcernType; optionalQuestion?: string })
  | (FireLiveTemporalQueryInput & { concern: ConcernType; optionalQuestion?: string })
  | (FireLiveLegacyRegressionInput & { concern: ConcernType; optionalQuestion?: string });

export type FireCoverageStatus = "complete" | "partial" | "unsupported" | "failed";
export type FireCoverageDayStatus = "complete" | "unsupported" | "failed";
export type FireCoverageSourceStatus =
  | "complete"
  | "missing"
  | "incomplete"
  | "failed"
  | "not_checked";

export interface FireCoverageDay {
  date: string;
  status: FireCoverageDayStatus;
  fireStatus: FireCoverageSourceStatus;
  smokeStatus: FireCoverageSourceStatus;
}

export interface FireTemporalCoverage {
  requestType: "latest" | "latest_7d" | "custom" | "legacy_regression";
  status: FireCoverageStatus;
  requestedStartDate?: string;
  requestedEndDate?: string;
  resolvedStartDate?: string;
  resolvedEndDate?: string;
  /** Every requested or latest-resolution candidate day examined. */
  days: FireCoverageDay[];
}

export type FireFailureReason =
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "malformed"
  | "schema_validation"
  | "provider_failure"
  | "validation_failure";

export type FireQueryResultKind =
  | "success"
  | "no_observation"
  | "partial_coverage"
  | "source_failure"
  | "unsupported_place"
  | "unsupported_date";

export interface FireQueryResult {
  kind: FireQueryResultKind;
  /** Present only when a validated EvidenceObject is safe to display. */
  evidence?: EvidenceObject;
  /** Live-mode date resolution and per-day common-source coverage. */
  temporalCoverage?: FireTemporalCoverage;
  /** Provider-detail-free category for a failed live retrieval. */
  failureReason?: FireFailureReason;
  /** Safe visible reason for unsupported place/date queries. */
  rejectionReason?: string;
  /** Server-rendered, runtime-validated explanation for this exact evidence. */
  explanation?: Explanation;
  /** Truthful provider/model provenance or deterministic fallback reason. */
  explanationStatus?: EvidenceExplanationStatus;
  /** Structured evaluator findings retained for deterministic UI mapping. */
  evidenceConflicts?: EvidenceConflict[];
}
