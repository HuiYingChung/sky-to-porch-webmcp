import type { ConcernType, HazardId } from "@/contracts/common";

export const VERIFICATION_SOURCE_IDS = [
  "epa_airnow",
  "epa_usfs_fire_smoke_map",
  "nws_weather",
  "noaa_storm_events",
  "noaa_nwps",
  "usgs_flood_inundation_mapper",
  "nasa_lance_flood_viewer",
  "houston_transtar_traffic",
  "houston_transtar_speed_archive",
  "inciweb_incidents",
  "usdm_map_viewer",
  "drought_gov",
  "cdc_heat_pets",
  "nws_heatrisk",
  "heat_gov",
] as const;

export type VerificationSourceId = (typeof VERIFICATION_SOURCE_IDS)[number];
export type VerificationSourceKind = "checker" | "guidance" | "incident_information";
export type VerificationScopeId = "greater_houston";

export interface VerificationSource {
  id: VerificationSourceId;
  label: string;
  owner: string;
  url: string;
  kind: VerificationSourceKind;
  hazardIds: readonly HazardId[];
  concernTypes?: readonly ConcernType[];
  /** Omit for broadly applicable sources. Scoped sources require a deterministic match. */
  scopeIds?: readonly VerificationScopeId[];
  coverageLabel: string;
  purpose: string;
  limitation: string;
  /** Curated, non-observation context the model may use for next-check wording. */
  guidanceFacts: readonly string[];
  lastVerifiedAt: string;
}

export function isVerificationSourceId(value: unknown): value is VerificationSourceId {
  return typeof value === "string" &&
    (VERIFICATION_SOURCE_IDS as readonly string[]).includes(value);
}
