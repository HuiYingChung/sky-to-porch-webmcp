/**
 * Deterministic WP-09 source-observation contracts.
 *
 * These validators sit after transport/schema parsing and before claim
 * separation. They lock the reproducible Extreme Heat path to a NASA GIBS
 * visualization and a named NOAA USCRN Heat01 station record from the
 * generated ADR-0037 allowlist (every station that publishes a Heat01 file).
 * They do not make network calls, decode temperatures from imagery, or turn
 * outdoor station evidence into indoor, household, or medical conclusions.
 */

import {
  assert,
  assertExactKeys,
  assertNonEmptyString,
  assertPlainObject,
  isFiniteNumber,
  validateLat,
  validateLon,
} from "@/contracts/common";
import { validateObservation, type Observation } from "@/contracts/evidence";
import { USCRN_HEAT01_STATIONS } from "@/data/uscrn-heat01-stations";
import { NCEI_GHCNH_PRODUCT, NCEI_GHCNH_SOURCE_ID } from "./ground-source-contract";

export const HEAT_SOURCE_IDS = [
  "nasa_gibs_modis_lst_day",
  "noaa_uscrn_heat_exposure",
  "nws_station_observations",
  "noaa_ncei_global_hourly",
] as const;

/** ADR-0038: NWS hourly station observations for recent-date metro ground evidence. */
export const NWS_SOURCE_ID = "nws_station_observations" as const;
export const NWS_OBSERVATIONS_PRODUCT = "NWS station observations (api.weather.gov)";
const NWS_STATIONS_URL_PREFIX = "https://api.weather.gov/stations/";

export const HEAT_OBSERVATION_ROLES = [
  "satellite_land_surface_temperature_visualization",
  "ground_air_temperature",
  "derived_heat_index",
] as const;

export type HeatObservationRole = (typeof HEAT_OBSERVATION_ROLES)[number];

export const GIBS_HEAT_LAYER_ID = "MODIS_Terra_Land_Surface_Temp_Day";
export const GIBS_HEAT_TILE_MATRIX_SET = "GoogleMapsCompatible_Level7";
export const USCRN_HEAT_PRODUCT = "USCRN Heat01 v1.0";
export const USCRN_TUCSON_STATION_ID = "AZ_Tucson_11_W";
export const USCRN_TUCSON_STATION_NAME = "AZ Tucson 11 W";
export const USCRN_TUCSON_COORDINATE = { lat: 32.24, lon: -111.17 } as const;

/** ADR-0037: observations must name a station from the generated allowlist. */
const USCRN_HEAT01_URL_PREFIX = "https://www.ncei.noaa.gov/pub/data/uscrn/products/heat01/";
const USCRN_STATION_BY_ID = new Map(
  USCRN_HEAT01_STATIONS.map((station) => [station.stationId, station])
);

const SUPPORTED_HEAT_DATA_MODES = new Set(["live", "fixture", "historical"]);

const GIBS_METADATA_KEYS = [
  "heatRole",
  "layerId",
  "contentType",
  "imageWidth",
  "imageHeight",
  "tileMatrixSet",
  "tileMatrix",
  "tileRow",
  "tileCol",
  "byteLength",
  "opaqueSampleCount",
  "distinctColorCount",
] as const;

const USCRN_METADATA_KEYS = [
  "heatRole",
  "stationId",
  "stationName",
  "stationLatitude",
  "stationLongitude",
  "relativeHumidityPct",
  "fieldName",
  "fileFormat",
] as const;

const NWS_METADATA_KEYS = [
  "heatRole",
  "stationId",
  "stationName",
  "stationLatitude",
  "stationLongitude",
  "relativeHumidityPct",
  "qualityControl",
  "distinctHourCount",
] as const;

const GHCNH_METADATA_KEYS = [
  "heatRole",
  "stationId",
  "stationName",
  "stationLatitude",
  "stationLongitude",
  "relativeHumidityPct",
  "qualityControl",
  "rowCountForDate",
  "distinctHourCount",
  "selectionBasis",
] as const;

const GHCNH_BY_YEAR_URL_PREFIX =
  "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/";

function requireMetadata(
  observation: Observation,
  keys: readonly string[],
  label: string
): Record<string, string | number | boolean> {
  assertPlainObject(observation.metadata, `${label}.metadata`);
  const metadata = observation.metadata as Record<string, string | number | boolean>;
  assertExactKeys(metadata, keys, `${label}.metadata`);
  return metadata;
}

function assertNonNegativeInteger(value: unknown, label: string): void {
  assert(
    Number.isInteger(value) && (value as number) >= 0,
    `${label} must be a non-negative integer`
  );
}

function assertPositiveInteger(value: unknown, label: string): void {
  assert(
    Number.isInteger(value) && (value as number) > 0,
    `${label} must be a positive integer`
  );
}

function assertSupportedMode(observation: Observation): void {
  assert(
    SUPPORTED_HEAT_DATA_MODES.has(observation.dataMode),
    `heat observation dataMode must be live, fixture, or historical, got "${observation.dataMode}"`
  );
}

function assertOneHourEndingAtObservedTime(observation: Observation): void {
  assert(
    observation.provenance.observedAt !== "unknown",
    "USCRN Heat01 observation time must be known"
  );
  assertNonEmptyString(observation.periodStart, "USCRN periodStart");
  assertNonEmptyString(observation.periodEnd, "USCRN periodEnd");

  const startMs = Date.parse(observation.periodStart as string);
  const endMs = Date.parse(observation.periodEnd as string);
  const observedMs = Date.parse(observation.provenance.observedAt as string);
  assert(endMs - startMs === 60 * 60 * 1000, "USCRN period must span exactly one hour");
  assert(endMs === observedMs, "USCRN periodEnd must equal provenance.observedAt");
}

/** Validate the NASA GIBS LST observation as visualization-only evidence. */
export function assertGibsHeatVisualizationObservation(
  value: unknown
): asserts value is Observation {
  validateObservation(value);
  const observation = value as Observation;
  assertSupportedMode(observation);

  assert(
    observation.provenance.sourceId === "nasa_gibs_modis_lst_day",
    "GIBS heat observation must use nasa_gibs_modis_lst_day"
  );
  assert(
    observation.provenance.product === GIBS_HEAT_LAYER_ID,
    `GIBS heat product must be ${GIBS_HEAT_LAYER_ID}`
  );
  assert(
    observation.provenance.sourceUrl?.startsWith(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
    ) === true,
    "GIBS heat sourceUrl must use the approved HTTPS WMTS host and projection"
  );
  assert(
    observation.provenance.observedAt !== "unknown",
    "GIBS heat observation time must be known"
  );
  assert(
    observation.variableName === "Land-surface temperature visualization",
    "GIBS heat variableName must identify a land-surface temperature visualization"
  );
  assert(
    observation.textValue === "visualization_available",
    "GIBS heat observation must be the locked visualization_available text value"
  );
  assert(
    observation.value === undefined && observation.unit === undefined,
    "GIBS heat visualization must not contain a numeric value or temperature unit"
  );

  const metadata = requireMetadata(observation, GIBS_METADATA_KEYS, "GIBS heat");
  assert(
    metadata.heatRole === "satellite_land_surface_temperature_visualization",
    "GIBS heatRole must remain satellite land-surface temperature visualization"
  );
  assert(metadata.layerId === GIBS_HEAT_LAYER_ID, "GIBS metadata layerId mismatch");
  assert(metadata.contentType === "image/png", "GIBS contentType must be image/png");
  assert(metadata.imageWidth === 256, "GIBS imageWidth must be 256");
  assert(metadata.imageHeight === 256, "GIBS imageHeight must be 256");
  assert(
    metadata.tileMatrixSet === GIBS_HEAT_TILE_MATRIX_SET,
    `GIBS tileMatrixSet must be ${GIBS_HEAT_TILE_MATRIX_SET}`
  );
  assert(
    observation.provenance.sourceUrl?.includes(`/${GIBS_HEAT_TILE_MATRIX_SET}/`) === true,
    `GIBS sourceUrl must use TileMatrixSet ${GIBS_HEAT_TILE_MATRIX_SET}`
  );
  assertNonNegativeInteger(metadata.tileMatrix, "GIBS tileMatrix");
  assertNonNegativeInteger(metadata.tileRow, "GIBS tileRow");
  assertNonNegativeInteger(metadata.tileCol, "GIBS tileCol");
  assertPositiveInteger(metadata.byteLength, "GIBS byteLength");
  assertPositiveInteger(metadata.opaqueSampleCount, "GIBS opaqueSampleCount");
  assertPositiveInteger(metadata.distinctColorCount, "GIBS distinctColorCount");
  assert(
    (metadata.opaqueSampleCount as number) <= 256,
    "GIBS opaqueSampleCount may not exceed the locked 256-sample inspection"
  );
  assert(
    (metadata.distinctColorCount as number) <= 256,
    "GIBS distinctColorCount may not exceed the locked 256-sample inspection"
  );
}

function assertUscrnObservation(
  value: unknown,
  role: "ground_air_temperature" | "derived_heat_index",
  variableName: "Hourly air temperature" | "Hourly heat index",
  fieldName: "DRY_BULB_TEMPERATURE_C" | "HEAT_INDEX_C"
): asserts value is Observation {
  validateObservation(value);
  const observation = value as Observation;
  assertSupportedMode(observation);

  assert(
    observation.provenance.sourceId === "noaa_uscrn_heat_exposure",
    "USCRN heat observation must use noaa_uscrn_heat_exposure"
  );
  assert(
    observation.provenance.product === USCRN_HEAT_PRODUCT,
    `USCRN heat product must be ${USCRN_HEAT_PRODUCT}`
  );
  const metadataStationId = (observation.metadata as Record<string, unknown> | undefined)
    ?.stationId;
  assert(
    typeof metadataStationId === "string" && USCRN_STATION_BY_ID.has(metadataStationId),
    "USCRN stationId must name an allowlisted Heat01 station (ADR-0037)"
  );
  const allowlisted = USCRN_STATION_BY_ID.get(metadataStationId as string)!;
  assert(
    observation.provenance.sourceUrl ===
      `${USCRN_HEAT01_URL_PREFIX}CRNHE0101-${allowlisted.stationId}.csv`,
    "USCRN heat sourceUrl must be the allowlisted station's fixed Heat01 file"
  );
  assert(
    observation.provenance.sourceRecordId?.startsWith(
      `CRNHE0101-${allowlisted.stationId}.csv#`
    ) === true,
    "USCRN heat sourceRecordId must identify the station's fixed file and UTC row"
  );
  assertOneHourEndingAtObservedTime(observation);
  assert(observation.variableName === variableName, `USCRN variableName must be ${variableName}`);
  assert(isFiniteNumber(observation.value), "USCRN heat observation must be numeric");
  assert(observation.unit === "degC", "USCRN heat observation unit must be degC");
  assert(
    (observation.value as number) >= -100 && (observation.value as number) <= 100,
    "USCRN Celsius value must be in the fail-closed range [-100, 100]"
  );

  const metadata = requireMetadata(observation, USCRN_METADATA_KEYS, "USCRN heat");
  assert(metadata.heatRole === role, `USCRN heatRole must be ${role}`);
  assert(metadata.stationId === allowlisted.stationId, "USCRN stationId mismatch");
  assert(metadata.stationName === allowlisted.stationName, "USCRN stationName mismatch");
  assert(isFiniteNumber(metadata.stationLatitude), "USCRN stationLatitude must be numeric");
  assert(isFiniteNumber(metadata.stationLongitude), "USCRN stationLongitude must be numeric");
  validateLat(metadata.stationLatitude as number, "USCRN stationLatitude");
  validateLon(metadata.stationLongitude as number, "USCRN stationLongitude");
  assert(
    metadata.stationLatitude === allowlisted.lat &&
      metadata.stationLongitude === allowlisted.lon,
    "USCRN observation must remain locked to the allowlisted station coordinates"
  );
  assert(isFiniteNumber(metadata.relativeHumidityPct), "USCRN relativeHumidityPct must be numeric");
  assert(
    (metadata.relativeHumidityPct as number) >= 0 &&
      (metadata.relativeHumidityPct as number) <= 100,
    "USCRN relativeHumidityPct must be in [0, 100]"
  );
  assert(metadata.fieldName === fieldName, `USCRN fieldName must be ${fieldName}`);
  assert(metadata.fileFormat === "CRNHE0101", "USCRN fileFormat must be CRNHE0101");
}

/**
 * ADR-0038: validate an NWS station observation (hourly METAR-cadence air
 * temperature, with the NWS-provided heat index when the service computed
 * one). NWS observations are instantaneous readings, not one-hour periods.
 */
function assertNwsObservation(
  value: unknown,
  role: "ground_air_temperature" | "derived_heat_index",
  variableName: "Hourly air temperature" | "Hourly heat index"
): asserts value is Observation {
  validateObservation(value);
  const observation = value as Observation;
  assertSupportedMode(observation);

  assert(
    observation.provenance.sourceId === NWS_SOURCE_ID,
    `NWS heat observation must use ${NWS_SOURCE_ID}`
  );
  assert(
    observation.provenance.product === NWS_OBSERVATIONS_PRODUCT,
    `NWS heat product must be ${NWS_OBSERVATIONS_PRODUCT}`
  );
  const metadataStationId = (observation.metadata as Record<string, unknown> | undefined)
    ?.stationId;
  assert(
    typeof metadataStationId === "string" && /^[A-Z0-9]{3,8}$/u.test(metadataStationId),
    "NWS stationId must be a station identifier such as KPHX"
  );
  assert(
    observation.provenance.sourceUrl?.startsWith(
      `${NWS_STATIONS_URL_PREFIX}${metadataStationId}/observations`
    ) === true,
    "NWS heat sourceUrl must be the station's api.weather.gov observations request"
  );
  assert(
    observation.provenance.sourceRecordId?.startsWith(`${metadataStationId}#`) === true,
    "NWS heat sourceRecordId must identify the station and observation timestamp"
  );
  assert(
    observation.provenance.observedAt !== "unknown",
    "NWS observation time must be known"
  );
  assert(observation.variableName === variableName, `NWS variableName must be ${variableName}`);
  assert(isFiniteNumber(observation.value), "NWS heat observation must be numeric");
  assert(observation.unit === "degC", "NWS heat observation unit must be degC");
  assert(
    (observation.value as number) >= -100 && (observation.value as number) <= 100,
    "NWS Celsius value must be in the fail-closed range [-100, 100]"
  );

  const metadata = requireMetadata(observation, NWS_METADATA_KEYS, "NWS heat");
  assert(metadata.heatRole === role, `NWS heatRole must be ${role}`);
  assertNonEmptyString(metadata.stationName, "NWS stationName");
  assert(isFiniteNumber(metadata.stationLatitude), "NWS stationLatitude must be numeric");
  assert(isFiniteNumber(metadata.stationLongitude), "NWS stationLongitude must be numeric");
  validateLat(metadata.stationLatitude as number, "NWS stationLatitude");
  validateLon(metadata.stationLongitude as number, "NWS stationLongitude");
  assert(
    metadata.relativeHumidityPct === "unknown" ||
      (isFiniteNumber(metadata.relativeHumidityPct) &&
        (metadata.relativeHumidityPct as number) >= 0 &&
        (metadata.relativeHumidityPct as number) <= 100),
    "NWS relativeHumidityPct must be in [0, 100] or the literal \"unknown\""
  );
  assertNonEmptyString(metadata.qualityControl, "NWS qualityControl");
  assert(
    Number.isInteger(metadata.distinctHourCount) &&
      (metadata.distinctHourCount as number) >= 1 &&
      (metadata.distinctHourCount as number) <= 24,
    "NWS distinctHourCount must be an integer in [1, 24]"
  );
}

/** Validate an observed NWS hourly air-temperature reading. */
export function assertNwsAirTemperatureObservation(
  value: unknown
): asserts value is Observation {
  assertNwsObservation(value, "ground_air_temperature", "Hourly air temperature");
}

/** Validate an NWS-provided derived hourly heat-index reading. */
export function assertNwsHeatIndexObservation(
  value: unknown
): asserts value is Observation {
  assertNwsObservation(value, "derived_heat_index", "Hourly heat index");
}

/**
 * ADR-0039: validate a GHCNh historical ground observation. GHCNh publishes
 * no heat index and the product never derives one, so the only role is the
 * hourly outdoor air temperature (relative humidity rides in metadata,
 * exactly like the other station sources).
 */
export function assertGhcnhAirTemperatureObservation(
  value: unknown
): asserts value is Observation {
  validateObservation(value);
  const observation = value as Observation;
  assertSupportedMode(observation);

  assert(
    observation.provenance.sourceId === NCEI_GHCNH_SOURCE_ID,
    `GHCNh heat observation must use ${NCEI_GHCNH_SOURCE_ID}`
  );
  assert(
    observation.provenance.product === NCEI_GHCNH_PRODUCT,
    `GHCNh heat product must be ${NCEI_GHCNH_PRODUCT}`
  );
  const metadataStationId = (observation.metadata as Record<string, unknown> | undefined)
    ?.stationId;
  assert(
    typeof metadataStationId === "string" && /^[A-Z0-9-]{6,20}$/u.test(metadataStationId),
    "GHCNh stationId must be a GHCN station identifier"
  );
  assert(
    observation.provenance.sourceUrl?.startsWith(GHCNH_BY_YEAR_URL_PREFIX) === true &&
      observation.provenance.sourceUrl.includes(`GHCNh_${metadataStationId}_`),
    "GHCNh heat sourceUrl must be the station's by-year PSV file"
  );
  assert(
    observation.provenance.sourceRecordId?.startsWith(`${metadataStationId}#`) === true,
    "GHCNh heat sourceRecordId must identify the station and observation timestamp"
  );
  assert(
    observation.provenance.observedAt !== "unknown",
    "GHCNh observation time must be known"
  );
  assert(
    observation.variableName === "Hourly air temperature",
    "GHCNh variableName must be Hourly air temperature"
  );
  assert(isFiniteNumber(observation.value), "GHCNh heat observation must be numeric");
  assert(observation.unit === "degC", "GHCNh heat observation unit must be degC");
  assert(
    (observation.value as number) >= -100 && (observation.value as number) <= 100,
    "GHCNh Celsius value must be in the fail-closed range [-100, 100]"
  );

  const metadata = requireMetadata(observation, GHCNH_METADATA_KEYS, "GHCNh heat");
  assert(
    metadata.heatRole === "ground_air_temperature",
    "GHCNh heatRole must be ground_air_temperature"
  );
  assertNonEmptyString(metadata.stationName, "GHCNh stationName");
  assert(isFiniteNumber(metadata.stationLatitude), "GHCNh stationLatitude must be numeric");
  assert(isFiniteNumber(metadata.stationLongitude), "GHCNh stationLongitude must be numeric");
  validateLat(metadata.stationLatitude as number, "GHCNh stationLatitude");
  validateLon(metadata.stationLongitude as number, "GHCNh stationLongitude");
  assert(
    isFiniteNumber(metadata.relativeHumidityPct) &&
      (metadata.relativeHumidityPct as number) >= 0 &&
      (metadata.relativeHumidityPct as number) <= 100,
    "GHCNh relativeHumidityPct must be in [0, 100]"
  );
  assertNonEmptyString(metadata.qualityControl, "GHCNh qualityControl");
  assert(
    Number.isInteger(metadata.rowCountForDate) && (metadata.rowCountForDate as number) >= 1,
    "GHCNh rowCountForDate must be a positive integer"
  );
  assert(
    Number.isInteger(metadata.distinctHourCount) &&
      (metadata.distinctHourCount as number) >= 1 &&
      (metadata.distinctHourCount as number) <= 24,
    "GHCNh distinctHourCount must be an integer in [1, 24]"
  );
  assertNonEmptyString(metadata.selectionBasis, "GHCNh selectionBasis");
}

/** Validate an observed USCRN hourly air-temperature field. */
export function assertUscrnAirTemperatureObservation(
  value: unknown
): asserts value is Observation {
  assertUscrnObservation(
    value,
    "ground_air_temperature",
    "Hourly air temperature",
    "DRY_BULB_TEMPERATURE_C"
  );
}

/** Validate a NOAA-provided derived USCRN hourly heat-index field. */
export function assertUscrnHeatIndexObservation(
  value: unknown
): asserts value is Observation {
  assertUscrnObservation(
    value,
    "derived_heat_index",
    "Hourly heat index",
    "HEAT_INDEX_C"
  );
}

/**
 * Validate one registered WP-09 heat-source observation and its locked role.
 * Unknown sources or roles fail closed rather than being silently ignored.
 */
export function validateHeatSourceObservation(
  value: unknown
): asserts value is Observation {
  validateObservation(value);
  const observation = value as Observation;

  if (observation.provenance.sourceId === "nasa_gibs_modis_lst_day") {
    assertGibsHeatVisualizationObservation(observation);
    return;
  }
  if (observation.provenance.sourceId === NCEI_GHCNH_SOURCE_ID) {
    const ghcnhRole = observation.metadata?.heatRole;
    if (ghcnhRole === "ground_air_temperature") {
      assertGhcnhAirTemperatureObservation(observation);
      return;
    }
    throw new Error(`unsupported GHCNh heat role: ${String(ghcnhRole)}`);
  }
  if (observation.provenance.sourceId === NWS_SOURCE_ID) {
    const nwsRole = observation.metadata?.heatRole;
    if (nwsRole === "ground_air_temperature") {
      assertNwsAirTemperatureObservation(observation);
      return;
    }
    if (nwsRole === "derived_heat_index") {
      assertNwsHeatIndexObservation(observation);
      return;
    }
    throw new Error(`unsupported NWS heat role: ${String(nwsRole)}`);
  }
  if (observation.provenance.sourceId !== "noaa_uscrn_heat_exposure") {
    throw new Error(
      `unsupported WP-09 heat source: ${observation.provenance.sourceId}`
    );
  }

  const role = observation.metadata?.heatRole;
  if (role === "ground_air_temperature") {
    assertUscrnAirTemperatureObservation(observation);
    return;
  }
  if (role === "derived_heat_index") {
    assertUscrnHeatIndexObservation(observation);
    return;
  }
  throw new Error(`unsupported NOAA USCRN heat role: ${String(role)}`);
}
