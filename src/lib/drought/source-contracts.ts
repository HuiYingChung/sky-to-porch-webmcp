/**
 * Deterministic WP-10 Drought & Land source-contract preparation.
 *
 * This module builds allowlisted request descriptions and validates normalized,
 * synthetic fixture observations. It never performs a network request. The
 * bounded development-live adapter is separate; these fixture validators keep
 * deterministic fixture observations explicitly labelled as fixtures.
 */

import {
  assert,
  assertExactKeys,
  assertPlainObject,
  assertStringArray,
  isFiniteNumber,
  type BoundingBox,
} from "@/contracts/common";
import { validateObservation, type Observation } from "@/contracts/evidence";
import {
  getUsAdministrativeArea,
  validateUsAdministrativeArea,
  type UsAdministrativeArea,
} from "@/data/us-administrative-areas";

export const DROUGHT_SOURCE_IDS = [
  "nasa_gibs_modis_ndvi_16day",
  "us_drought_monitor_rest",
] as const;

export const DROUGHT_OBSERVATION_ROLES = [
  "satellite_vegetation_visualization",
  "regional_drought_statistics",
] as const;

export const GIBS_DROUGHT_LAYER_ID = "MODIS_Terra_L3_NDVI_16Day_v6.1_STD";
export const GIBS_DROUGHT_PRODUCT =
  "NASA GIBS MODIS Terra L3 NDVI 16-Day v6.1 Standard visualization";
export const GIBS_DROUGHT_WMS_ENDPOINT =
  "https://gibs.earthdata.nasa.gov/wms/epsg4326/std/wms.cgi";
export const GIBS_DROUGHT_DOMAINS_ENDPOINT_ROOT =
  "https://gitc.earthdata.nasa.gov/wmts/epsg4326/std/1.0.0";
export const GIBS_DROUGHT_BBOX = "-115,31,-109,37";
export const GIBS_DROUGHT_IMAGE_SIZE = 256;
export const GIBS_DROUGHT_TILE_MATRIX_SET = "250m";
export const GIBS_DROUGHT_NATIVE_SCALE_METERS = 250;
export const GIBS_DROUGHT_COMPOSITE_DAYS = 16;

export const USDM_ENDPOINT_ROOT = "https://usdmdataservices.unl.edu/api";
export const USDM_DROUGHT_PRODUCT = "U.S. Drought Monitor percent-of-area statistics";
export const USDM_ARIZONA_STATE_FIPS = "04";
export const USDM_ARIZONA_AREA_NAME = "Arizona";
export const USDM_STATISTICS_TYPE = "1";
export const USDM_JSON_ACCEPT = "application/json";
export const USDM_PERCENT_TOLERANCE = 0.01;

export const DROUGHT_SYNTHETIC_FIXTURE_KIND =
  "synthetic_contract_fixture_no_source_payload";

const GIBS_REQUEST_PARAMETER_KEYS = [
  "SERVICE",
  "REQUEST",
  "VERSION",
  "LAYERS",
  "STYLES",
  "SRS",
  "BBOX",
  "WIDTH",
  "HEIGHT",
  "TIME",
  "FORMAT",
  "TRANSPARENT",
] as const;

const USDM_REQUEST_PARAMETER_KEYS = [
  "areaType",
  "aoi",
  "startDate",
  "endDate",
  "statisticsType",
  "accept",
] as const;

const GIBS_METADATA_KEYS = [
  "droughtRole",
  "layerId",
  "contentType",
  "imageWidth",
  "imageHeight",
  "nativeScaleMeters",
  "compositePeriodDays",
  "boundingBox",
  "byteLength",
  "opaqueSampleCount",
  "distinctColorCount",
  "fixtureKind",
] as const;

const USDM_STATISTICS_METADATA_KEYS = [
  "droughtRole",
  "areaType",
  "stateFips",
  "areaName",
  "statisticsFormat",
  "unit",
  "mapValidDay",
  "releaseDay",
  "cadenceDays",
  "nonePct",
  "d0Pct",
  "d1Pct",
  "d2Pct",
  "d3Pct",
  "d4Pct",
  "fixtureKind",
] as const;

const USDM_NO_OBSERVATION_METADATA_KEYS = [
  "droughtRole",
  "areaType",
  "stateFips",
  "areaName",
  "statisticsFormat",
  "mapValidDay",
  "releaseDay",
  "cadenceDays",
  "resultRowCount",
  "fixtureKind",
] as const;

const GIBS_QUALIFIERS = [
  "synthetic_fixture",
  "visualization_only",
  "numeric_ndvi_not_inferred",
  "regional_not_property",
] as const;

const USDM_QUALIFIERS = [
  "synthetic_fixture",
  "regional_state_scale",
  "weekly_product",
  "d0_is_not_drought",
  "property_inference_not_supported",
] as const;

export interface GibsNdviInspection {
  contentType: string;
  imageWidth: number;
  imageHeight: number;
  byteLength: number;
  opaqueSampleCount: number;
  distinctColorCount: number;
}

export interface UsdmTraditionalPercentSummary {
  nonePct: number;
  d0Pct: number;
  d1Pct: number;
  d2Pct: number;
  d3Pct: number;
  d4Pct: number;
}

export interface UsdmRequestDescription {
  url: string;
  headers: Readonly<{ Accept: typeof USDM_JSON_ACCEPT }>;
  requestParameters: Record<(typeof USDM_REQUEST_PARAMETER_KEYS)[number], string>;
}

export interface UsdmAdministrativeRequestDescription extends UsdmRequestDescription {
  administrativeArea: UsAdministrativeArea;
  productScale: "state_or_territory_percent_of_area";
  propertyScaleSupported: false;
}

function assertIsoDate(value: string, label: string): void {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value), `${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  assert(
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value,
    `${label} must be a real calendar date`
  );
}

function assertTuesday(value: string, label: string): void {
  assertIsoDate(value, label);
  assert(
    new Date(`${value}T00:00:00Z`).getUTCDay() === 2,
    `${label} must be a Tuesday USDM map-valid date`
  );
}

function toUsdmDate(value: string): string {
  assertTuesday(value, "USDM date");
  const [year, month, day] = value.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

function observedAtForDate(value: string): string {
  return `${value}T00:00:00Z`;
}

/** Build, but do not send, the GIBS time-domain request for a bounded window. */
export function buildGibsNdviDescribeDomainsUrl(
  startDate: string,
  endDate: string
): string {
  assertIsoDate(startDate, "GIBS start date");
  assertIsoDate(endDate, "GIBS end date");
  assert(startDate <= endDate, "GIBS time-domain start date must not follow end date");
  return (
    `${GIBS_DROUGHT_DOMAINS_ENDPOINT_ROOT}/` +
    `${encodeURIComponent(GIBS_DROUGHT_LAYER_ID)}/default/` +
    `${encodeURIComponent(GIBS_DROUGHT_TILE_MATRIX_SET)}/all/` +
    `${startDate}--${endDate}.xml`
  );
}

function assertNonNegativeInteger(value: unknown, label: string): void {
  assert(
    Number.isInteger(value) && (value as number) >= 0,
    `${label} must be a non-negative integer`
  );
}

function assertPercent(value: unknown, label: string): asserts value is number {
  assert(
    isFiniteNumber(value) && value >= 0 && value <= 100,
    `${label} must be a finite percentage in [0, 100]`
  );
}

function requireMetadata(
  observation: Observation,
  keys: readonly string[],
  label: string
): Record<string, string | number | boolean> {
  assertPlainObject(observation.metadata, `${label}.metadata`);
  assertExactKeys(observation.metadata, keys, `${label}.metadata`);
  for (const key of keys) {
    assert(key in observation.metadata, `${label}.metadata.${key} is required`);
  }
  return observation.metadata as Record<string, string | number | boolean>;
}

function assertRequestParameters(
  observation: Observation,
  expected: Record<string, string>,
  keys: readonly string[],
  label: string
): void {
  assertPlainObject(observation.provenance.requestParameters, `${label}.requestParameters`);
  assertExactKeys(
    observation.provenance.requestParameters,
    keys,
    `${label}.requestParameters`
  );
  for (const key of keys) {
    assert(
      observation.provenance.requestParameters[key] === expected[key],
      `${label}.requestParameters.${key} must be ${expected[key]}`
    );
  }
}

function assertExactQualifiers(
  observation: Observation,
  expected: readonly string[],
  label: string
): void {
  assertStringArray(observation.qualifiers, `${label}.qualifiers`, {
    nonEmpty: true,
    unique: true,
  });
  assert(
    JSON.stringify(observation.qualifiers) === JSON.stringify(expected),
    `${label}.qualifiers must preserve the locked boundary set and order`
  );
}

function assertFixtureOnly(observation: Observation, label: string): void {
  assert(
    observation.dataMode === "fixture",
    `${label} fixture validator is fixture-only and requires an explicitly labelled deterministic fixture`
  );
}

/**
 * Build, but do not send, the locked GIBS WMS request URL.
 *
 * The caller must first resolve an available 16-day composite date from the
 * GIBS time domain. Keeping that resolution outside this fixture validator
 * preserves arbitrary user dates without pretending every calendar day is a
 * native observation date.
 */
export function gibsNdviBoundingBox(area?: BoundingBox): string {
  return area
    ? [area.west, area.south, area.east, area.north].map(String).join(",")
    : GIBS_DROUGHT_BBOX;
}

export function buildGibsNdviWmsUrl(date: string, area?: BoundingBox): string {
  assertIsoDate(date, "GIBS date");
  const parameters = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    LAYERS: GIBS_DROUGHT_LAYER_ID,
    STYLES: "",
    SRS: "EPSG:4326",
    BBOX: gibsNdviBoundingBox(area),
    WIDTH: String(GIBS_DROUGHT_IMAGE_SIZE),
    HEIGHT: String(GIBS_DROUGHT_IMAGE_SIZE),
    TIME: date,
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  });
  return `${GIBS_DROUGHT_WMS_ENDPOINT}?${parameters.toString()}`;
}

export function gibsNdviRequestParameters(
  date: string,
  area?: BoundingBox
): Record<string, string> {
  assertIsoDate(date, "GIBS date");
  return {
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.1.1",
    LAYERS: GIBS_DROUGHT_LAYER_ID,
    STYLES: "",
    SRS: "EPSG:4326",
    BBOX: gibsNdviBoundingBox(area),
    WIDTH: String(GIBS_DROUGHT_IMAGE_SIZE),
    HEIGHT: String(GIBS_DROUGHT_IMAGE_SIZE),
    TIME: date,
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  };
}

/** Build, but do not send, an allowlisted state/territory USDM request. */
export function buildUsdmAdministrativePercentRequest(
  date: string,
  area: unknown
): UsdmAdministrativeRequestDescription {
  const administrativeArea = validateUsAdministrativeArea(area);
  const serviceDate = toUsdmDate(date);
  const requestParameters = {
    areaType: "StateStatistics",
    aoi: administrativeArea.fips,
    startDate: serviceDate,
    endDate: serviceDate,
    statisticsType: USDM_STATISTICS_TYPE,
    accept: USDM_JSON_ACCEPT,
  } as const;
  const parameters = new URLSearchParams({
    aoi: requestParameters.aoi,
    startdate: requestParameters.startDate,
    enddate: requestParameters.endDate,
    statisticsType: requestParameters.statisticsType,
  });
  return {
    url:
      `${USDM_ENDPOINT_ROOT}/${requestParameters.areaType}/` +
      `GetDroughtSeverityStatisticsByAreaPercent?${parameters.toString()}`,
    headers: { Accept: USDM_JSON_ACCEPT },
    requestParameters: { ...requestParameters },
    administrativeArea,
    productScale: "state_or_territory_percent_of_area",
    propertyScaleSupported: false,
  };
}

/** Backward-compatible fixed Arizona builder retained for accepted fixtures. */
export function buildUsdmArizonaPercentRequest(date: string): UsdmRequestDescription {
  const area = getUsAdministrativeArea(USDM_ARIZONA_STATE_FIPS);
  if (!area) throw new Error("Arizona administrative area is missing");
  const request = buildUsdmAdministrativePercentRequest(date, area);
  return {
    url: request.url,
    headers: request.headers,
    requestParameters: request.requestParameters,
  };
}

/** Validate normalized PNG inspection facts without interpreting image colors. */
export function validateGibsNdviInspection(
  value: unknown
): asserts value is GibsNdviInspection {
  assertPlainObject(value, "GIBS NDVI inspection");
  assertExactKeys(
    value,
    [
      "contentType",
      "imageWidth",
      "imageHeight",
      "byteLength",
      "opaqueSampleCount",
      "distinctColorCount",
    ],
    "GIBS NDVI inspection"
  );
  for (const key of [
    "contentType",
    "imageWidth",
    "imageHeight",
    "byteLength",
    "opaqueSampleCount",
    "distinctColorCount",
  ]) {
    assert(key in value, `GIBS NDVI inspection.${key} is required`);
  }
  assert(value.contentType === "image/png", "GIBS NDVI contentType must be image/png");
  assert(
    value.imageWidth === GIBS_DROUGHT_IMAGE_SIZE &&
      value.imageHeight === GIBS_DROUGHT_IMAGE_SIZE,
    `GIBS NDVI image must be ${GIBS_DROUGHT_IMAGE_SIZE}x${GIBS_DROUGHT_IMAGE_SIZE}`
  );
  assertNonNegativeInteger(value.byteLength, "GIBS NDVI byteLength");
  assertNonNegativeInteger(value.opaqueSampleCount, "GIBS NDVI opaqueSampleCount");
  assertNonNegativeInteger(value.distinctColorCount, "GIBS NDVI distinctColorCount");
  assert(
    (value.opaqueSampleCount as number) <= 256 &&
      (value.distinctColorCount as number) <= 256,
    "GIBS NDVI inspection counts may not exceed the locked 256-sample inspection"
  );
}

/** Validate documented traditional/cumulative USDM percentage relationships. */
export function validateUsdmTraditionalPercentSummary(
  value: unknown
): asserts value is UsdmTraditionalPercentSummary {
  assertPlainObject(value, "USDM traditional percent summary");
  const keys = ["nonePct", "d0Pct", "d1Pct", "d2Pct", "d3Pct", "d4Pct"] as const;
  assertExactKeys(value, keys, "USDM traditional percent summary");
  for (const key of keys) {
    assert(key in value, `USDM traditional percent summary.${key} is required`);
    assertPercent(value[key], `USDM ${key}`);
  }
  const summary = value as unknown as UsdmTraditionalPercentSummary;
  assert(
    Math.abs(summary.nonePct + summary.d0Pct - 100) <= USDM_PERCENT_TOLERANCE,
    "USDM traditional percentages require None + D0-or-worse to equal 100"
  );
  assert(
    summary.d0Pct + USDM_PERCENT_TOLERANCE >= summary.d1Pct &&
      summary.d1Pct + USDM_PERCENT_TOLERANCE >= summary.d2Pct &&
      summary.d2Pct + USDM_PERCENT_TOLERANCE >= summary.d3Pct &&
      summary.d3Pct + USDM_PERCENT_TOLERANCE >= summary.d4Pct,
    "USDM traditional cumulative percentages must satisfy D0 >= D1 >= D2 >= D3 >= D4"
  );
}

/** Validate the fixture-only NASA GIBS NDVI visualization observation. */
export function assertGibsDroughtVegetationObservation(
  value: unknown
): asserts value is Observation {
  validateObservation(value);
  const observation = value as Observation;
  assertFixtureOnly(observation, "GIBS drought observation");
  assert(
    observation.provenance.sourceId === "nasa_gibs_modis_ndvi_16day",
    "GIBS drought observation must use nasa_gibs_modis_ndvi_16day"
  );
  assert(
    observation.provenance.product === GIBS_DROUGHT_PRODUCT,
    `GIBS drought product must be ${GIBS_DROUGHT_PRODUCT}`
  );
  assert(
    observation.provenance.observedAt !== "unknown",
    "GIBS drought visualization time must be known"
  );
  const date = observation.provenance.observedAt.slice(0, 10);
  const expectedParameters = gibsNdviRequestParameters(date);
  assert(
    observation.provenance.observedAt === observedAtForDate(date),
    "GIBS drought observedAt must equal the requested WMS date at 00:00:00Z"
  );
  assert(
    observation.provenance.sourceUrl === buildGibsNdviWmsUrl(date),
    "GIBS drought sourceUrl must equal the locked WMS request"
  );
  assertRequestParameters(
    observation,
    expectedParameters,
    GIBS_REQUEST_PARAMETER_KEYS,
    "GIBS drought"
  );
  assert(
    observation.variableName === "16-day NDVI visualization",
    "GIBS drought variableName must identify a 16-day NDVI visualization"
  );
  assert(
    observation.textValue === "synthetic_visualization_contract_fixture",
    "GIBS drought fixture must use the explicit synthetic visualization marker"
  );
  assert(
    observation.value === undefined && observation.unit === undefined,
    "GIBS drought visualization must not contain numeric NDVI or a unit"
  );
  assert(
    observation.periodStart === undefined && observation.periodEnd === undefined,
    "GIBS drought fixture must not invent composite constituent dates"
  );
  assertExactQualifiers(observation, GIBS_QUALIFIERS, "GIBS drought");

  const metadata = requireMetadata(observation, GIBS_METADATA_KEYS, "GIBS drought");
  assert(
    metadata.droughtRole === "satellite_vegetation_visualization",
    "GIBS droughtRole must remain satellite_vegetation_visualization"
  );
  assert(metadata.layerId === GIBS_DROUGHT_LAYER_ID, "GIBS drought layerId mismatch");
  assert(
    metadata.nativeScaleMeters === GIBS_DROUGHT_NATIVE_SCALE_METERS,
    "GIBS drought nativeScaleMeters must remain 250"
  );
  assert(
    metadata.compositePeriodDays === GIBS_DROUGHT_COMPOSITE_DAYS,
    "GIBS drought compositePeriodDays must remain 16"
  );
  assert(metadata.boundingBox === GIBS_DROUGHT_BBOX, "GIBS drought boundingBox mismatch");
  assert(
    metadata.fixtureKind === DROUGHT_SYNTHETIC_FIXTURE_KIND,
    "GIBS drought fixtureKind must disclose that no source payload was retrieved"
  );
  validateGibsNdviInspection({
    contentType: metadata.contentType,
    imageWidth: metadata.imageWidth,
    imageHeight: metadata.imageHeight,
    byteLength: metadata.byteLength,
    opaqueSampleCount: metadata.opaqueSampleCount,
    distinctColorCount: metadata.distinctColorCount,
  });
  assert(
    metadata.byteLength === 0 &&
      metadata.opaqueSampleCount === 0 &&
      metadata.distinctColorCount === 0,
    "synthetic GIBS contract fixture must not impersonate inspected source-payload bytes or pixels"
  );
}

function assertUsdmBaseObservation(
  observation: Observation,
  date: string,
  label: string
): UsdmRequestDescription {
  assertFixtureOnly(observation, label);
  assert(
    observation.provenance.sourceId === "us_drought_monitor_rest",
    `${label} must use us_drought_monitor_rest`
  );
  assert(
    observation.provenance.product === USDM_DROUGHT_PRODUCT,
    `${label} product must be ${USDM_DROUGHT_PRODUCT}`
  );
  assertTuesday(date, `${label} observed date`);
  assert(
    observation.provenance.observedAt === observedAtForDate(date),
    `${label} observedAt must be the Tuesday map-valid date at 00:00:00Z`
  );
  const request = buildUsdmArizonaPercentRequest(date);
  assert(
    observation.provenance.sourceUrl === request.url,
    `${label} sourceUrl must equal the locked Arizona percent-area request`
  );
  assertRequestParameters(
    observation,
    request.requestParameters,
    USDM_REQUEST_PARAMETER_KEYS,
    label
  );
  assert(
    observation.periodStart === undefined && observation.periodEnd === undefined,
    `${label} must not invent sub-week observation periods`
  );
  return request;
}

/** Validate a fixture-only normalized USDM traditional percentage observation. */
export function assertUsdmRegionalDroughtObservation(
  value: unknown
): asserts value is Observation {
  validateObservation(value);
  const observation = value as Observation;
  assert(
    observation.provenance.observedAt !== "unknown",
    "USDM statistics observedAt must be known"
  );
  const date = observation.provenance.observedAt.slice(0, 10);
  assertUsdmBaseObservation(observation, date, "USDM drought statistics");
  assert(
    observation.provenance.sourceRecordId ===
      `synthetic-contract-fixture#StateStatistics#${USDM_ARIZONA_STATE_FIPS}#${date}`,
    "USDM fixture sourceRecordId must identify the synthetic state/date contract row"
  );
  assert(
    observation.variableName === "Regional drought area statistics",
    "USDM variableName must identify regional drought area statistics"
  );
  assert(
    observation.textValue === "synthetic_regional_statistics_contract_fixture",
    "USDM fixture must use the explicit synthetic statistics marker"
  );
  assert(
    observation.value === undefined && observation.unit === undefined,
    "USDM statistics container must not collapse separate percentages into one numeric value"
  );
  assertExactQualifiers(observation, USDM_QUALIFIERS, "USDM drought statistics");

  const metadata = requireMetadata(
    observation,
    USDM_STATISTICS_METADATA_KEYS,
    "USDM drought statistics"
  );
  assert(
    metadata.droughtRole === "regional_drought_statistics",
    "USDM droughtRole must remain regional_drought_statistics"
  );
  assert(metadata.areaType === "StateStatistics", "USDM areaType must be StateStatistics");
  assert(metadata.stateFips === USDM_ARIZONA_STATE_FIPS, "USDM stateFips must be 04");
  assert(metadata.areaName === USDM_ARIZONA_AREA_NAME, "USDM areaName must be Arizona");
  assert(
    metadata.statisticsFormat === "traditional_cumulative_percent_of_area",
    "USDM statisticsFormat must remain traditional cumulative percent of area"
  );
  assert(metadata.unit === "percent", "USDM normalized metadata unit must be percent");
  assert(metadata.mapValidDay === "Tuesday", "USDM mapValidDay must be Tuesday");
  assert(metadata.releaseDay === "Thursday", "USDM releaseDay must be Thursday");
  assert(metadata.cadenceDays === 7, "USDM cadenceDays must be 7");
  assert(
    metadata.fixtureKind === DROUGHT_SYNTHETIC_FIXTURE_KIND,
    "USDM fixtureKind must disclose that no source payload was retrieved"
  );
  validateUsdmTraditionalPercentSummary({
    nonePct: metadata.nonePct,
    d0Pct: metadata.d0Pct,
    d1Pct: metadata.d1Pct,
    d2Pct: metadata.d2Pct,
    d3Pct: metadata.d3Pct,
    d4Pct: metadata.d4Pct,
  });
}

/** Validate a synthetic empty-row marker without converting it into no drought. */
export function assertUsdmNoObservationMarker(
  value: unknown
): asserts value is Observation {
  validateObservation(value);
  const observation = value as Observation;
  assert(
    observation.provenance.observedAt !== "unknown",
    "USDM no-observation marker must retain the requested Tuesday date"
  );
  const date = observation.provenance.observedAt.slice(0, 10);
  assertUsdmBaseObservation(observation, date, "USDM no-observation marker");
  assert(
    observation.provenance.sourceRecordId ===
      `synthetic-contract-fixture#StateStatistics#${USDM_ARIZONA_STATE_FIPS}#${date}#no-row`,
    "USDM no-observation sourceRecordId must identify the synthetic empty-row case"
  );
  assert(
    observation.variableName === "Regional drought statistics response rows",
    "USDM no-observation variableName mismatch"
  );
  assert(
    observation.textValue === "no_regional_row_returned",
    "USDM no-observation marker must remain no_regional_row_returned"
  );
  assert(
    observation.value === undefined && observation.unit === undefined,
    "USDM no-observation marker must not invent a numeric percentage"
  );
  assertExactQualifiers(observation, USDM_QUALIFIERS, "USDM no-observation marker");
  const metadata = requireMetadata(
    observation,
    USDM_NO_OBSERVATION_METADATA_KEYS,
    "USDM no-observation marker"
  );
  assert(
    metadata.droughtRole === "regional_drought_statistics",
    "USDM no-observation droughtRole mismatch"
  );
  assert(metadata.areaType === "StateStatistics", "USDM areaType must be StateStatistics");
  assert(metadata.stateFips === USDM_ARIZONA_STATE_FIPS, "USDM stateFips must be 04");
  assert(metadata.areaName === USDM_ARIZONA_AREA_NAME, "USDM areaName must be Arizona");
  assert(
    metadata.statisticsFormat === "traditional_cumulative_percent_of_area",
    "USDM no-observation statisticsFormat mismatch"
  );
  assert(metadata.mapValidDay === "Tuesday", "USDM mapValidDay must be Tuesday");
  assert(metadata.releaseDay === "Thursday", "USDM releaseDay must be Thursday");
  assert(metadata.cadenceDays === 7, "USDM cadenceDays must be 7");
  assert(metadata.resultRowCount === 0, "USDM no-observation resultRowCount must be zero");
  assert(
    metadata.fixtureKind === DROUGHT_SYNTHETIC_FIXTURE_KIND,
    "USDM no-observation marker must disclose its synthetic fixture basis"
  );
}

/** Validate one prepared WP-10 source observation; unknown roles fail closed. */
export function validateDroughtSourceObservation(
  value: unknown
): asserts value is Observation {
  validateObservation(value);
  const observation = value as Observation;
  if (observation.provenance.sourceId === "nasa_gibs_modis_ndvi_16day") {
    assertGibsDroughtVegetationObservation(observation);
    return;
  }
  if (observation.provenance.sourceId !== "us_drought_monitor_rest") {
    throw new Error(`unsupported WP-10 drought source: ${observation.provenance.sourceId}`);
  }
  if (observation.textValue === "synthetic_regional_statistics_contract_fixture") {
    assertUsdmRegionalDroughtObservation(observation);
    return;
  }
  if (observation.textValue === "no_regional_row_returned") {
    assertUsdmNoObservationMarker(observation);
    return;
  }
  throw new Error(`unsupported USDM drought observation marker: ${String(observation.textValue)}`);
}
