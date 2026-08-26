/**
 * src/contracts/common.ts
 *
 * Shared primitive contracts, locked vocabulary enumerations, and runtime
 * validators used across all WP-02 contracts.
 *
 * Deterministic code owns: validation, allowlisting, freshness, provenance,
 * required limitation injection, and the final decision that an object is
 * safe to present.
 *
 * No data != no danger: empty, unsupported, stale, and failure states are
 * explicitly modelled and must never be collapsed to a positive claim.
 */

// ---------------------------------------------------------------------------
// Locked hazard identifiers — do not rename or extend without an approved ADR
// ---------------------------------------------------------------------------

export const HAZARD_IDS = [
  "fire_smoke",
  "flood_storm",
  "extreme_heat",
  "drought_land",
  "air_quality",
  "earth_volcanoes",
] as const;

export type HazardId = (typeof HAZARD_IDS)[number];

// ---------------------------------------------------------------------------
// Evidence states — must distinguish each named state separately
// ---------------------------------------------------------------------------

export const EVIDENCE_STATES = [
  "observations_returned",
  "no_observation",
  "source_failure",
  "unsupported_coverage",
  "stale_data",
  "inconclusive_evidence",
  "valid_observation_no_anomaly",
  "no_active_official_alert",
] as const;

export type EvidenceState = (typeof EVIDENCE_STATES)[number];

// ---------------------------------------------------------------------------
// Data modes — must distinguish each named mode separately
// ---------------------------------------------------------------------------

export const DATA_MODES = [
  "live",
  "fixture",
  "cached",
  "historical",
  "simulated",
  "unavailable",
  "failed",
] as const;

export type DataMode = (typeof DATA_MODES)[number];

// ---------------------------------------------------------------------------
// Concern types
// ---------------------------------------------------------------------------

export const CONCERN_TYPES = [
  "home",
  "health",
  "pets",
  "travel",
  "power_internet",
  "community",
] as const;

export type ConcernType = (typeof CONCERN_TYPES)[number];

// ---------------------------------------------------------------------------
// Time range types
// ---------------------------------------------------------------------------

export const TIME_RANGE_TYPES = [
  "latest",
  "past_24h",
  "past_7d",
  "past_30d",
  "custom",
] as const;

export type TimeRangeType = (typeof TIME_RANGE_TYPES)[number];

// ---------------------------------------------------------------------------
// BoundingBox — lon/lat rectangle
// ---------------------------------------------------------------------------

export interface BoundingBox {
  /** Western longitude bound (−180 to 180) */
  west: number;
  /** Southern latitude bound (−90 to 90) */
  south: number;
  /** Eastern longitude bound (−180 to 180) */
  east: number;
  /** Northern latitude bound (−90 to 90) */
  north: number;
}

// ---------------------------------------------------------------------------
// Coordinate — lon/lat point
// ---------------------------------------------------------------------------

export interface Coordinate {
  /** Longitude (−180 to 180) */
  lon: number;
  /** Latitude (−90 to 90) */
  lat: number;
}

// ---------------------------------------------------------------------------
// Runtime validators
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Asserts condition; throws ValidationError with message if false. */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ValidationError(message);
}

/** Validates and returns a plain record (arrays and class instances rejected). */
export function assertPlainObject(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  assert(typeof value === "object" && value !== null, `${label} must be an object`);
  assert(!Array.isArray(value), `${label} must not be an array`);
  const prototype = Object.getPrototypeOf(value);
  assert(
    prototype === Object.prototype || prototype === null,
    `${label} must be a plain object`
  );
}

/** Rejects unexpected properties so upstream schema drift fails closed. */
export function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  assert(
    unexpected.length === 0,
    `${label} contains unexpected field(s): ${unexpected.join(", ")}`
  );
}

/** Validates a non-empty string without silently trimming or coercing it. */
export function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === "string" && value.trim().length > 0,
    `${label} must be a non-empty string`
  );
}

/** Validates a string array and optionally requires at least one entry. */
export function assertStringArray(
  value: unknown,
  label: string,
  options: { nonEmpty?: boolean; unique?: boolean } = {}
): asserts value is string[] {
  assert(Array.isArray(value), `${label} must be an array`);
  if (options.nonEmpty) {
    assert(value.length > 0, `${label} must be a non-empty array`);
  }
  for (const item of value) {
    assertNonEmptyString(item, `each ${label} item`);
  }
  if (options.unique) {
    assert(new Set(value).size === value.length, `${label} must not contain duplicates`);
  }
}

/** Returns true for a finite, non-NaN number. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Validates a longitude value is in [−180, 180]. */
export function validateLon(v: number, label = "lon"): void {
  assert(isFiniteNumber(v), `${label} must be a finite number`);
  assert(v >= -180 && v <= 180, `${label} must be in [-180, 180], got ${v}`);
}

/** Validates a latitude value is in [−90, 90]. */
export function validateLat(v: number, label = "lat"): void {
  assert(isFiniteNumber(v), `${label} must be a finite number`);
  assert(v >= -90 && v <= 90, `${label} must be in [-90, 90], got ${v}`);
}

/** Validates a Coordinate object. */
export function validateCoordinate(c: unknown): asserts c is Coordinate {
  assertPlainObject(c, "coordinate");
  const obj = c as Record<string, unknown>;
  assertExactKeys(obj, ["lon", "lat"], "coordinate");
  assert("lon" in obj, "coordinate must have lon");
  assert("lat" in obj, "coordinate must have lat");
  validateLon(obj.lon as number, "coordinate.lon");
  validateLat(obj.lat as number, "coordinate.lat");
}

/** Validates a BoundingBox; west < east, south < north. */
export function validateBoundingBox(b: unknown): asserts b is BoundingBox {
  assertPlainObject(b, "bounding box");
  const obj = b as Record<string, unknown>;
  assertExactKeys(obj, ["west", "south", "east", "north"], "bounding box");
  for (const k of ["west", "south", "east", "north"]) {
    assert(k in obj, `bounding box must have ${k}`);
  }
  validateLon(obj.west as number, "bbox.west");
  validateLat(obj.south as number, "bbox.south");
  validateLon(obj.east as number, "bbox.east");
  validateLat(obj.north as number, "bbox.north");
  assert(
    (obj.west as number) < (obj.east as number),
    `bbox.west (${obj.west}) must be less than bbox.east (${obj.east})`
  );
  assert(
    (obj.south as number) < (obj.north as number),
    `bbox.south (${obj.south}) must be less than bbox.north (${obj.north})`
  );
}

/** Validates an ISO-8601 timestamp string. */
export function validateTimestamp(v: unknown, label = "timestamp"): void {
  assertNonEmptyString(v, label);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      v
    );
  assert(match !== null, `${label} must be a complete ISO-8601 timestamp with Z or an offset: "${v}"`);

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  assert(month >= 1 && month <= 12, `${label} has an invalid month: "${v}"`);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  assert(day >= 1 && day <= daysInMonth, `${label} has an invalid calendar day: "${v}"`);
  assert(hour >= 0 && hour <= 23, `${label} has an invalid hour: "${v}"`);
  assert(minute >= 0 && minute <= 59, `${label} has an invalid minute: "${v}"`);
  assert(second >= 0 && second <= 59, `${label} has an invalid second: "${v}"`);
  if (zone !== "Z") {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    assert(
      offsetHour >= 0 && offsetHour <= 14 && offsetMinute >= 0 && offsetMinute <= 59,
      `${label} has an invalid UTC offset: "${v}"`
    );
    assert(offsetHour < 14 || offsetMinute === 0, `${label} offset may not exceed 14:00: "${v}"`);
  }

  const timestamp = Date.parse(v);
  assert(Number.isFinite(timestamp), `${label} is not a valid ISO-8601 timestamp: "${v}"`);
}

/**
 * Validates that startTs <= endTs when both are defined.
 * Each must be a valid ISO-8601 string.
 */
export function validateTimestampRange(
  startTs: unknown,
  endTs: unknown,
  label = "timestamp range"
): void {
  validateTimestamp(startTs, `${label} start`);
  validateTimestamp(endTs, `${label} end`);
  assert(
    new Date(startTs as string).getTime() <= new Date(endTs as string).getTime(),
    `${label} start must be <= end: "${startTs}" > "${endTs}"`
  );
}

/** Validates a hazard ID is in the locked HAZARD_IDS list. */
export function validateHazardId(v: unknown): asserts v is HazardId {
  assert(
    typeof v === "string" && (HAZARD_IDS as readonly string[]).includes(v),
    `hazardId must be one of [${HAZARD_IDS.join(", ")}], got "${v}"`
  );
}

/** Validates an evidence state is in the locked EVIDENCE_STATES list. */
export function validateEvidenceState(v: unknown): asserts v is EvidenceState {
  assert(
    typeof v === "string" && (EVIDENCE_STATES as readonly string[]).includes(v),
    `evidenceState must be one of [${EVIDENCE_STATES.join(", ")}], got "${v}"`
  );
}

/** Validates a data mode is in the locked DATA_MODES list. */
export function validateDataMode(v: unknown): asserts v is DataMode {
  assert(
    typeof v === "string" && (DATA_MODES as readonly string[]).includes(v),
    `dataMode must be one of [${DATA_MODES.join(", ")}], got "${v}"`
  );
}
