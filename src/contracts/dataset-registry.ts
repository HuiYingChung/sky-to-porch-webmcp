/**
 * src/contracts/dataset-registry.ts
 *
 * Dataset Registry contracts — schema and runtime validators for registered
 * data sources. Every dataset used by the application must be explicitly
 * registered with an approved decision.
 *
 * No unregistered source may be queried. Allowlisting is enforced here.
 */

import {
  type HazardId,
  type DataMode,
  validateHazardId,
  validateDataMode,
  assert,
  assertPlainObject,
  assertExactKeys,
  assertNonEmptyString,
  assertStringArray,
} from "./common.js";

// ---------------------------------------------------------------------------
// Locked source IDs (allowlist) — matches the WP-02 registry
// ---------------------------------------------------------------------------

export const SOURCE_IDS = [
  "noaa_hms_fire_points",
  "noaa_hms_smoke_polygons",
  "nasa_firms",
  "nasa_gibs_imerg",
  "nasa_imerg_raw",
  "usgs_instantaneous_values",
  "noaa_ncei_storm_events",
  "nasa_gibs_modis_lst_day",
  "noaa_uscrn_heat_exposure",
  "nws_station_observations",
  "noaa_ncei_global_hourly",
  "nasa_ecostress",
  "nasa_gibs_modis_ndvi_16day",
  "nasa_smap",
  "nasa_tempo",
  "airnow",
  "airnow_daily_data",
  "nasa_gibs_modis_aod",
  "nasa_lance_flood_extent",
  "noaa_nws_alerts",
  "canada_cwfis_fire",
  "canada_geomet",
  "canada_drought_monitor",
  "mexico_conabio_satif",
  "mexico_conagua_hydrology",
  "mexico_drought_monitor",
  "mexico_sinaica",
  "nasa_gibs_omps_so2",
  "usgs_earthquake_geojson",
  "usgs_volcano_hans",
  "us_drought_monitor_rest",
  "us_census_tigerweb_state_boundaries",
  "earth_volcano_satellite_primary",
  "ai_in_space_lab",
] as const;

export type SourceId = (typeof SOURCE_IDS)[number];

/** Sources approved for deterministic queries in the current product scope. */
export const QUERYABLE_SOURCE_IDS = [
  "noaa_hms_fire_points",
  "noaa_hms_smoke_polygons",
  "nasa_firms",
  "nasa_gibs_imerg",
  "usgs_instantaneous_values",
  "noaa_ncei_storm_events",
  "nasa_gibs_modis_lst_day",
  "noaa_uscrn_heat_exposure",
  "nws_station_observations",
  "noaa_ncei_global_hourly",
  "nasa_gibs_modis_ndvi_16day",
  "airnow_daily_data",
  "nasa_gibs_modis_aod",
  "nasa_lance_flood_extent",
  "nasa_gibs_omps_so2",
  "usgs_earthquake_geojson",
  "usgs_volcano_hans",
  "us_drought_monitor_rest",
  "us_census_tigerweb_state_boundaries",
] as const satisfies readonly SourceId[];

export type QueryableSourceId = (typeof QUERYABLE_SOURCE_IDS)[number];

export const REGISTRY_DECISIONS = ["go", "go_supporting", "go_supporting_only", "defer", "reject"] as const;

export type RegistryDecision = (typeof REGISTRY_DECISIONS)[number];

// ---------------------------------------------------------------------------
// DatasetRegistryEntry type
// ---------------------------------------------------------------------------

export interface DatasetRegistryEntry {
  sourceId: SourceId;
  displayName: string;
  agency: string;
  hazardIds: HazardId[];
  decision: RegistryDecision;
  /** Narrow role description. Must be explicit and non-empty. */
  role: string;
  endpointTemplate: string;
  /** Whether an API key or login credential is required. */
  requiresCredential: boolean;
  /** Free-text authentication note. */
  authNote: string;
  /** Official documentation or overview URL. */
  documentationUrl: string;
  /** Required limitations that must accompany any evidence from this source. */
  requiredLimitations: string[];
  /**
   * Supported data modes for this source. Live calls return "live";
   * test fixtures use "fixture".
   */
  supportedDataModes: DataMode[];
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateSourceId(v: unknown): asserts v is SourceId {
  assert(
    typeof v === "string" && (SOURCE_IDS as readonly string[]).includes(v),
    `sourceId must be one of [${SOURCE_IDS.join(", ")}], got "${v}"`
  );
}

export function validateQueryableSourceId(v: unknown): asserts v is QueryableSourceId {
  assert(
    typeof v === "string" && (QUERYABLE_SOURCE_IDS as readonly string[]).includes(v),
    `sourceId must be an approved queryable source [${QUERYABLE_SOURCE_IDS.join(", ")}], got "${v}"`
  );
}

export function validateRegistryDecision(v: unknown): asserts v is RegistryDecision {
  assert(
    typeof v === "string" && (REGISTRY_DECISIONS as readonly string[]).includes(v),
    `decision must be one of [${REGISTRY_DECISIONS.join(", ")}], got "${v}"`
  );
}

export function validateDatasetRegistryEntry(v: unknown): asserts v is DatasetRegistryEntry {
  assertPlainObject(v, "DatasetRegistryEntry");
  const obj = v as Record<string, unknown>;
  assertExactKeys(
    obj,
    [
      "sourceId",
      "displayName",
      "agency",
      "hazardIds",
      "decision",
      "role",
      "endpointTemplate",
      "requiresCredential",
      "authNote",
      "documentationUrl",
      "requiredLimitations",
      "supportedDataModes",
    ],
    "DatasetRegistryEntry"
  );

  assert("sourceId" in obj, "sourceId is required");
  validateSourceId(obj.sourceId);

  assertNonEmptyString(obj.displayName, "displayName");
  assertNonEmptyString(obj.agency, "agency");

  assert(Array.isArray(obj.hazardIds) && obj.hazardIds.length > 0, "hazardIds must be a non-empty array");
  for (const hid of obj.hazardIds as unknown[]) {
    validateHazardId(hid);
  }
  assert(
    new Set(obj.hazardIds as string[]).size === (obj.hazardIds as string[]).length,
    "hazardIds must not contain duplicates"
  );

  assert("decision" in obj, "decision is required");
  validateRegistryDecision(obj.decision);

  assertNonEmptyString(obj.role, "role");
  assertNonEmptyString(obj.endpointTemplate, "endpointTemplate");
  assert(
    obj.endpointTemplate.startsWith("https://"),
    "endpointTemplate must use an HTTPS official or reference URL"
  );
  assert(typeof obj.requiresCredential === "boolean", "requiresCredential must be a boolean");
  assert(typeof obj.authNote === "string", "authNote must be a string");
  assertNonEmptyString(obj.documentationUrl, "documentationUrl");
  assert(obj.documentationUrl.startsWith("https://"), "documentationUrl must use HTTPS");

  assertStringArray(obj.requiredLimitations, "requiredLimitations", {
    nonEmpty: true,
    unique: true,
  });

  assert(Array.isArray(obj.supportedDataModes) && obj.supportedDataModes.length > 0, "supportedDataModes must be a non-empty array");
  for (const mode of obj.supportedDataModes as unknown[]) {
    validateDataMode(mode);
  }
  assert(
    new Set(obj.supportedDataModes as string[]).size ===
      (obj.supportedDataModes as string[]).length,
    "supportedDataModes must not contain duplicates"
  );

  const isQueryable = (QUERYABLE_SOURCE_IDS as readonly string[]).includes(obj.sourceId as string);
  const isActive = (obj.decision as string).startsWith("go");
  assert(
    isActive === isQueryable,
    `decision ${obj.decision} and queryable allowlist disagree for ${obj.sourceId}`
  );
  if (!isActive) {
    assert(
      (obj.supportedDataModes as string[]).every((mode) => mode === "unavailable"),
      `deferred or rejected source ${obj.sourceId} must expose only unavailable mode`
    );
  }
}
