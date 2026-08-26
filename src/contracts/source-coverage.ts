import type { HazardId } from "./common";
import type { SourceId } from "./dataset-registry";

export const COVERAGE_LEVELS = ["global", "north_america", "national", "regional"] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

export const SOURCE_KINDS = [
  "satellite",
  "ground_station",
  "official_alert",
  "official_event",
  "blended_official",
] as const;
export type CoverageSourceKind = (typeof SOURCE_KINDS)[number];

export const INTEGRATION_STATUSES = [
  "live_integrated",
  "live_key_required",
  "prepared_for_live",
  "registered_deferred",
  "supporting_only",
] as const;
export type CoverageIntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export interface SatelliteIdentity {
  platform: string;
  sensor: string;
  product: string;
}

/**
 * Product-facing coverage facts. These facts never authorize a request by
 * themselves; the governed dataset registry and source adapter still own that.
 */
export interface SourceCoverageProfile {
  sourceId: SourceId;
  hazardIds: readonly HazardId[];
  level: CoverageLevel;
  kind: CoverageSourceKind;
  integrationStatus: CoverageIntegrationStatus;
  evidenceRole: "primary" | "supporting";
  regionLabel: string;
  countryCodes: readonly string[];
  temporalCoverage: string;
  updateCadence: string;
  spatialResolution: string;
  coverageNote: string;
  liveGateNote: string;
  /**
   * UTC date (YYYY-MM-DD) of the most recent authorized bounded gate pass this
   * profile can cite. Optional: set only when repository evidence names a
   * concrete date; it is a verification timestamp, not a coverage claim.
   */
  lastVerifiedDate?: string;
  satellite?: SatelliteIdentity;
}
