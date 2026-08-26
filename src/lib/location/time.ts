/**
 * src/lib/location/time.ts
 *
 * WP-04 normalized time selection state.
 *
 * Supports the locked TIME_RANGE_TYPES from WP-02:
 *   latest, past_24h, past_7d, past_30d, custom
 *
 * Custom time requires complete ISO-8601 start/end values with start <= end.
 * Time choices remain requests until the selected adapter proves actual source
 * coverage. The limitation is injected into validated state and displayed.
 *
 * Reuses TIME_RANGE_TYPES, validateTimestampRange, and ValidationError from
 * WP-02 contracts. Does not duplicate or rename their values.
 */

import {
  type TimeRangeType,
  TIME_RANGE_TYPES,
  assert,
} from "@/contracts/common";
import { validateTimestampRange } from "@/contracts/common";

export type { TimeRangeType };

/**
 * Validated normalized time selection.
 * Produced only by validateAndBuildTimeSelection; never constructed directly.
 */
export interface TimeSelection {
  /** Time range type (locked vocabulary). */
  type: TimeRangeType;
  /**
   * ISO-8601 start timestamp. Present only for custom type.
   * Validated: start <= end.
   */
  startTs?: string;
  /**
   * ISO-8601 end timestamp. Present only for custom type.
   * Validated: start <= end.
   */
  endTs?: string;
  /**
   * Always present limitation: time choices are requests until the selected
   * adapter proves source coverage.
   */
  coverageLimitation: string;
}

/**
 * Standard coverage limitation injected into every TimeSelection.
 * Must be displayed wherever the time selection is shown.
 */
export const TIME_COVERAGE_LIMITATION =
  "Time range is a request. The selected source confirms supported dates during retrieval. " +
  "Missing, incomplete, or unsupported coverage must remain explicit.";

/**
 * Validates a time range type string.
 * Throws ValidationError if invalid.
 */
export function validateTimeRangeType(v: unknown): asserts v is TimeRangeType {
  assert(
    typeof v === "string" && (TIME_RANGE_TYPES as readonly string[]).includes(v),
    `timeRangeType must be one of [${TIME_RANGE_TYPES.join(", ")}], got "${v}"`
  );
}

/**
 * Validates inputs and builds a TimeSelection.
 * For "custom" type, startTs and endTs must be complete ISO-8601 strings
 * with start <= end.
 * Throws ValidationError if any input is invalid.
 */
export function validateAndBuildTimeSelection(
  type: unknown,
  startTs?: unknown,
  endTs?: unknown
): TimeSelection {
  validateTimeRangeType(type);
  const t = type as TimeRangeType;

  if (t === "custom") {
    assert(
      typeof startTs === "string" && startTs.trim().length > 0,
      'Custom time range requires a non-empty startTs'
    );
    assert(
      typeof endTs === "string" && endTs.trim().length > 0,
      'Custom time range requires a non-empty endTs'
    );
    validateTimestampRange(startTs, endTs, "custom time range");
    return {
      type: t,
      startTs: startTs as string,
      endTs: endTs as string,
      coverageLimitation: TIME_COVERAGE_LIMITATION,
    };
  }

  // For non-custom types, startTs and endTs must not be present
  assert(
    startTs === undefined || startTs === null || startTs === "",
    `startTs must not be provided for non-custom time range type "${t}"`
  );
  assert(
    endTs === undefined || endTs === null || endTs === "",
    `endTs must not be provided for non-custom time range type "${t}"`
  );

  return {
    type: t,
    coverageLimitation: TIME_COVERAGE_LIMITATION,
  };
}

/** Human-readable display labels for each TimeRangeType. */
export const TIME_RANGE_DISPLAY_LABELS: Record<TimeRangeType, string> = {
  latest: "Latest available data",
  past_24h: "Past 24 hours",
  past_7d: "Past 7 days",
  past_30d: "Past 30 days",
  custom: "Custom range",
};
