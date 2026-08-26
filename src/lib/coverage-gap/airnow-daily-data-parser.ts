/**
 * src/lib/coverage-gap/airnow-daily-data-parser.ts
 *
 * WP-11 — Pure deterministic parser for caller-supplied AirNow
 * `daily_data_v2.dat` pipe-delimited text.
 *
 * Contract:
 *   parseAirNowDailyData(text, expectedDate, area)
 *     → { kind: "records",       records: AirNowDailyRecord[] }
 *     → { kind: "no_observation" }
 *     → { kind: "source_failure", reason: "oversize" | "schema_validation" }
 *
 * This parser does NOT fetch, calculate AQI, construct EvidenceObjects,
 * import the existing AirNow adapter, add dependencies, or change any
 * registry / route / UI state.
 */

import type { BoundingBox } from "@/contracts/common";
import { validateQueryArea } from "@/lib/location/query-area";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum non-empty lines accepted before the oversize guard fires. */
export const AIRNOW_DAILY_MAX_LINES = 50_000;

/** Expected number of pipe-delimited fields per data line. */
const FIELD_COUNT = 13;

/**
 * Retained parameter specs: [normalized parameter name, unit, averaging period (h)].
 * Source: AirNow Daily Data Fact Sheet.
 */
const RETAINED_PARAMS: ReadonlyArray<readonly [string, string, number]> = [
  ["OZONE-8HR", "PPB", 8],
  ["PM2.5-24HR", "UG/M3", 24],
  ["PM10-24HR", "UG/M3", 24],
];

/**
 * Official AQI category codes and their inclusive AQI ranges.
 * Source: AirNow Daily Data File fact sheet, "AQI Category" field.
 * Index = category code; value = [inclusive lo, inclusive hi].
 */
const AQI_CATEGORY_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 50],    // 0 Good
  [51, 100],  // 1 Moderate
  [101, 150], // 2 Unhealthy for Sensitive Groups
  [151, 200], // 3 Unhealthy
  [201, 300], // 4 Very Unhealthy
  [301, 500], // 5 Hazardous
];

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface AirNowDailyRecord {
  /** Date the record represents, ISO YYYY-MM-DD. */
  isoDate: string;
  /** Nine-digit AQSID (state + county + site). */
  aqsid: string;
  /** Full AQSID as supplied by the data file ("840" + 9-digit AQSID). */
  fullAqsid: string;
  /** Site name exactly as in the data file (trimmed). */
  siteName: string;
  /** Normalized parameter name, e.g. "OZONE-8HR". */
  parameter: string;
  /** Reporting units, e.g. "PPB". */
  reportingUnits: string;
  /** Numeric concentration value. */
  value: number;
  /** Averaging period in hours. */
  averagingPeriod: number;
  /** Data source name (trimmed). */
  dataSource: string;
  /** AQI value (0–500). */
  aqi: number;
  /** AQI category code (0–5). */
  aqiCategory: number;
  /** WGS-84 latitude. */
  lat: number;
  /** WGS-84 longitude. */
  lon: number;
  /** Fixed qualifiers applied to every returned record. */
  qualifiers: [
    "outdoor_monitoring_site",
    "preliminary_airnow_data",
    "not_indoor_air",
    "not_personal_exposure",
    "not_regulatory_data",
  ];
}

export type AirNowDailyParseResult =
  | { kind: "records"; records: AirNowDailyRecord[] }
  | { kind: "no_observation" }
  | { kind: "source_failure"; reason: "oversize" | "schema_validation" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate a YYYY-MM-DD date without guessing century. Returns true if valid. */
function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === s;
}

/**
 * Convert a file-field `MM/DD/YY` date to ISO `YYYY-MM-DD` using the century
 * explicitly carried by `expectedDate`. No independent century inference.
 *
 * The prompt says "match MM/DD/YY to the supplied ISO date without
 * independently guessing the century", so we extract the century from
 * expectedDate and reconstruct the full year.
 */
function mmDDyyToIso(fieldDate: string, expectedDate: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/u.exec(fieldDate);
  if (!m) return null;
  const century = expectedDate.slice(0, 2); // e.g. "20"
  const year = `${century}${m[3]}`;         // e.g. "2024"
  const candidate = `${year}-${m[1]}-${m[2]}`;
  return isValidIsoDate(candidate) ? candidate : null;
}

/** Validate that `aqi` lies within the expected range for `category`. */
function aqiMatchesCategory(aqi: number, category: number): boolean {
  if (category < 0 || category > 5) return false;
  const range = AQI_CATEGORY_RANGES[category];
  if (!range) return false;
  return aqi >= range[0] && aqi <= range[1];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse caller-supplied AirNow `daily_data_v2.dat` text.
 *
 * @param text         Raw pipe-delimited file content.
 * @param expectedDate ISO YYYY-MM-DD date to match.
 * @param area         Validated BoundingBox from validateQueryArea (re-validated internally).
 */
export function parseAirNowDailyData(
  text: string,
  expectedDate: string,
  area: unknown,
): AirNowDailyParseResult {
  // --- validate inputs ---
  if (!isValidIsoDate(expectedDate)) {
    return { kind: "source_failure", reason: "schema_validation" };
  }
  let bbox: BoundingBox;
  try {
    bbox = validateQueryArea(area);
  } catch {
    return { kind: "source_failure", reason: "schema_validation" };
  }

  // --- split lines and enforce oversize guard ---
  const allLines = text.split("\n");
  const nonEmptyLines: string[] = [];
  for (const line of allLines) {
    if (line.trim().length > 0) {
      nonEmptyLines.push(line);
      if (nonEmptyLines.length > AIRNOW_DAILY_MAX_LINES) {
        return { kind: "source_failure", reason: "oversize" };
      }
    }
  }

  const retained: AirNowDailyRecord[] = [];

  for (const raw of nonEmptyLines) {
    // --- field count ---
    const fields = raw.split("|");
    if (fields.length !== FIELD_COUNT) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    const [
      rawDate, rawAqsid, rawSiteName, rawParameter, rawUnits,
      rawValue, rawAvgPeriod, rawDataSource, rawAqi, rawCategory,
      rawLat, rawLon, rawFullAqsid,
    ] = fields.map((f) => f.trim());

    // --- date match ---
    const rowDate = mmDDyyToIso(rawDate, expectedDate);
    if (rowDate === null) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    if (rowDate !== expectedDate) {
      // Valid date but not the requested date — skip row (not a failure)
      continue;
    }

    // --- AQSID: nine-digit U.S. check and full AQSID prefix ---
    if (!/^\d{9}$/u.test(rawAqsid)) {
      // Non-U.S. (non-nine-digit) AQSID — ignore
      continue;
    }
    if (rawFullAqsid.slice(0, 3) !== "840") {
      // Full AQSID does not have U.S. prefix 840 — ignore
      continue;
    }
    if (rawFullAqsid.slice(3) !== rawAqsid) {
      // Full AQSID digits don't match AQSID — schema failure
      return { kind: "source_failure", reason: "schema_validation" };
    }

    // --- parameter filter ---
    const paramUpper = rawParameter.toUpperCase();
    const unitsUpper = rawUnits.toUpperCase();
    const supportedParameterAndUnits = RETAINED_PARAMS.some(
      ([p, u]) => p === paramUpper && u === unitsUpper,
    );
    if (!supportedParameterAndUnits) {
      // Unsupported parameter/unit rows are irrelevant even when their
      // averaging-period field is blank.
      continue;
    }
    // For an otherwise applicable row, a blank averaging period is malformed
    // and must fail closed before Number conversion.
    if (rawAvgPeriod.length === 0) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    const avgPeriodNum = Number(rawAvgPeriod);
    const paramSpec = RETAINED_PARAMS.find(
      ([p, u, a]) => p === paramUpper && u === unitsUpper && a === avgPeriodNum,
    );
    if (!paramSpec) {
      // Unsupported parameter — ignore row
      continue;
    }

    // --- AQI ---
    // Blank AQI token must fail closed before Number conversion.
    if (rawAqi.length === 0) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    const aqiNum = Number(rawAqi);
    if (!Number.isFinite(aqiNum)) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    if (aqiNum === -999) {
      // Documented unavailable AQI — skip
      continue;
    }
    if (aqiNum < 0 || aqiNum > 500) {
      return { kind: "source_failure", reason: "schema_validation" };
    }

    // --- AQI category ---
    // Blank category token must fail closed before Number conversion.
    if (rawCategory.length === 0) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    const catNum = Number(rawCategory);
    if (!Number.isInteger(catNum) || catNum < 0 || catNum > 5) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    if (!aqiMatchesCategory(aqiNum, catNum)) {
      return { kind: "source_failure", reason: "schema_validation" };
    }

    // --- coordinates ---
    // Blank lat/lon tokens must fail closed before Number conversion.
    if (rawLat.length === 0 || rawLon.length === 0) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    const latNum = Number(rawLat);
    const lonNum = Number(rawLon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    // Outside the requested area — ignore (not a failure)
    if (lonNum < bbox.west || lonNum > bbox.east || latNum < bbox.south || latNum > bbox.north) {
      continue;
    }

    // --- value ---
    // Blank value token must fail closed before Number conversion.
    if (rawValue.length === 0) {
      return { kind: "source_failure", reason: "schema_validation" };
    }
    const valueNum = Number(rawValue);
    if (!Number.isFinite(valueNum)) {
      return { kind: "source_failure", reason: "schema_validation" };
    }

    retained.push({
      isoDate: rowDate,
      aqsid: rawAqsid,
      fullAqsid: rawFullAqsid,
      siteName: rawSiteName,
      parameter: paramUpper,
      reportingUnits: unitsUpper,
      value: valueNum,
      averagingPeriod: avgPeriodNum,
      dataSource: rawDataSource,
      aqi: aqiNum,
      aqiCategory: catNum,
      lat: latNum,
      lon: lonNum,
      qualifiers: [
        "outdoor_monitoring_site",
        "preliminary_airnow_data",
        "not_indoor_air",
        "not_personal_exposure",
        "not_regulatory_data",
      ],
    });
  }

  if (retained.length === 0) {
    return { kind: "no_observation" };
  }
  return { kind: "records", records: retained };
}
