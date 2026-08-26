/**
 * src/contracts/intent.ts
 *
 * Intent contract — the structured user request that deterministic code
 * produces from the raw query inputs. The AI receives only the validated
 * Intent, never raw user text destined for tool calls.
 */

import {
  type HazardId,
  type ConcernType,
  type TimeRangeType,
  type BoundingBox,
  type Coordinate,
  validateHazardId,
  validateCoordinate,
  validateBoundingBox,
  validateTimestamp,
  validateTimestampRange,
  assert,
  assertPlainObject,
  assertExactKeys,
  assertNonEmptyString,
  TIME_RANGE_TYPES,
  CONCERN_TYPES,
} from "./common.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeRange {
  type: TimeRangeType;
  /** Required when type is "custom"; ISO-8601. */
  startTs?: string;
  /** Required when type is "custom"; ISO-8601. */
  endTs?: string;
}

export interface PlaceSpec {
  /** Human-readable display label. */
  label: string;
  /** Centroid of the place (WGS-84). */
  coordinate: Coordinate;
  /**
   * Optional analysis bounding box. When omitted, callers derive a
   * default box from the coordinate and a source-appropriate radius.
   */
  boundingBox?: BoundingBox;
}

export interface Intent {
  /** Monotonic ID assigned deterministically. */
  intentId: string;
  hazardId: HazardId;
  place: PlaceSpec;
  timeRange: TimeRange;
  concern: ConcernType;
  /**
   * Optional free-text question from the user.
   * The AI may answer it only from validated evidence and limitations; it must
   * not use it to select tools, invent data, or expand beyond that evidence.
   */
  optionalQuestion?: string;
  /** ISO-8601 timestamp when this Intent was created. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateTimeRange(v: unknown): asserts v is TimeRange {
  assertPlainObject(v, "timeRange");
  const obj = v as Record<string, unknown>;
  assertExactKeys(obj, ["type", "startTs", "endTs"], "timeRange");
  const validTypes: readonly TimeRangeType[] = TIME_RANGE_TYPES;
  assert(
    typeof obj.type === "string" && validTypes.includes(obj.type as TimeRangeType),
    `timeRange.type must be one of [${validTypes.join(", ")}], got "${obj.type}"`
  );
  if (obj.type === "custom") {
    assert("startTs" in obj, 'timeRange.startTs is required when type is "custom"');
    assert("endTs" in obj, 'timeRange.endTs is required when type is "custom"');
    validateTimestampRange(obj.startTs, obj.endTs, "timeRange");
  } else {
    assert(
      obj.startTs === undefined && obj.endTs === undefined,
      'timeRange.startTs and endTs are allowed only when type is "custom"'
    );
  }
}

export function validatePlaceSpec(v: unknown): asserts v is PlaceSpec {
  assertPlainObject(v, "place");
  const obj = v as Record<string, unknown>;
  assertExactKeys(obj, ["label", "coordinate", "boundingBox"], "place");
  assertNonEmptyString(obj.label, "place.label");
  assert("coordinate" in obj, "place.coordinate is required");
  validateCoordinate(obj.coordinate);
  if ("boundingBox" in obj && obj.boundingBox !== undefined) {
    validateBoundingBox(obj.boundingBox);
  }
}

export function validateIntent(v: unknown): asserts v is Intent {
  assertPlainObject(v, "intent");
  const obj = v as Record<string, unknown>;
  assertExactKeys(
    obj,
    ["intentId", "hazardId", "place", "timeRange", "concern", "optionalQuestion", "createdAt"],
    "intent"
  );
  assertNonEmptyString(obj.intentId, "intentId");
  assert("hazardId" in obj, "hazardId is required");
  validateHazardId(obj.hazardId);
  assert("place" in obj, "place is required");
  validatePlaceSpec(obj.place);
  assert("timeRange" in obj, "timeRange is required");
  validateTimeRange(obj.timeRange);
  const validConcerns: readonly ConcernType[] = CONCERN_TYPES;
  assert(
    typeof obj.concern === "string" && validConcerns.includes(obj.concern as ConcernType),
    `concern must be one of [${validConcerns.join(", ")}], got "${obj.concern}"`
  );
  if (obj.optionalQuestion !== undefined) {
    assertNonEmptyString(obj.optionalQuestion, "intent.optionalQuestion");
  }
  assert("createdAt" in obj, "createdAt is required");
  validateTimestamp(obj.createdAt, "intent.createdAt");
}
