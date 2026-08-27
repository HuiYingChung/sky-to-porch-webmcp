/**
 * src/lib/ui/date-input.ts
 *
 * UXFIX-01: Shared helpers for calendar-based (YYYY-MM-DD) date selection.
 *
 * The UI collects UTC calendar dates through native date inputs instead of
 * free-text ISO-8601 timestamps. The canonical PlaceSelection continues to
 * store full ISO-8601 timestamps; conversion happens at exactly one boundary
 * (these helpers), so validators, adapters, and contracts are unchanged.
 *
 * Date bounds are derived from evidenced source coverage:
 *   - Fire & Smoke: HMS_COMMON_START_DATE (2005-08-05, WP-05 verified archive
 *     boundary) through the latest completed UTC day.
 *   - Extreme Heat: 2000-02-24, the approved MODIS Terra path start used by
 *     the heat live adapter (EARLIEST_GIBS_DATE). Kept in sync manually
 *     because the live adapter is server-only (sharp import).
 *   - Flood & Heavy Rain: 2000-06-01, the start of the GIBS IMERG precipitation
 *     record used by the flood live adapter.
 * Bounds are UI affordances only. Every date remains a request that the
 * server-side adapter validates against actual source coverage (fail-closed).
 */

import type { HazardId, TimeRangeType } from "@/contracts/common";
import { HMS_COMMON_START_DATE, PINNED_FIXTURE_DATE } from "@/lib/fire/types";
import {
  FLOOD_PINNED_FIXTURE_DATE,
} from "@/lib/flood/types";
import { HEAT_PINNED_FIXTURE_DATE } from "@/lib/heat/types";
import { DROUGHT_PINNED_FIXTURE_DATE } from "@/lib/drought/types";

/** Server-only heat adapter's EARLIEST_GIBS_DATE, mirrored for UI bounds. */
export const HEAT_EARLIEST_DATE = "2000-02-24";
/** GIBS IMERG precipitation record start, mirrored for UI bounds. */
export const FLOOD_EARLIEST_DATE = "2000-06-01";

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True when the value is a complete YYYY-MM-DD date-input value. */
export function isDateInputValue(value: string): boolean {
  return DATE_INPUT_PATTERN.test(value);
}

/** Converts a YYYY-MM-DD date-input value to the canonical UTC start timestamp. */
export function dateInputToStartTs(date: string): string {
  return `${date}T00:00:00Z`;
}

/** Converts a YYYY-MM-DD date-input value to the canonical UTC end timestamp. */
export function dateInputToEndTs(date: string): string {
  return `${date}T23:59:59Z`;
}

/** Extracts the YYYY-MM-DD date-input value from an ISO-8601 timestamp. */
export function tsToDateInput(ts?: string): string {
  return typeof ts === "string" && ts.length >= 10 ? ts.slice(0, 10) : "";
}

/**
 * The latest completed UTC date (yesterday in UTC). Incomplete "today" is
 * never offered as a completed observation date.
 */
export function latestCompletedUtcDate(now: Date = new Date()): string {
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(todayUtcMs - 86_400_000).toISOString().slice(0, 10);
}

export interface CustomDateBounds {
  /** Earliest selectable YYYY-MM-DD date (inclusive). */
  minDate: string;
  /** Latest selectable YYYY-MM-DD date (inclusive). */
  maxDate: string;
  /** Sensible default date to prefill when the user has not chosen one. */
  defaultDate: string;
}

type EvidenceMode = "live" | "fixture" | null;

/**
 * Source-coverage-derived date bounds for the custom range inputs.
 * Fixture modes pin to the fixture's deterministic date so the calendar
 * cannot express a date the fixture will reject.
 */
export function customDateBounds(
  hazardId: HazardId | null,
  mode: EvidenceMode,
  now: Date = new Date()
): CustomDateBounds {
  const latest = latestCompletedUtcDate(now);
  if (hazardId === "fire_smoke") {
    if (mode === "fixture") {
      return { minDate: PINNED_FIXTURE_DATE, maxDate: PINNED_FIXTURE_DATE, defaultDate: PINNED_FIXTURE_DATE };
    }
    return { minDate: HMS_COMMON_START_DATE, maxDate: latest, defaultDate: latest };
  }
  if (hazardId === "flood_storm") {
    if (mode === "fixture") {
      return {
        minDate: FLOOD_PINNED_FIXTURE_DATE,
        maxDate: FLOOD_PINNED_FIXTURE_DATE,
        defaultDate: FLOOD_PINNED_FIXTURE_DATE,
      };
    }
    return { minDate: FLOOD_EARLIEST_DATE, maxDate: latest, defaultDate: latest };
  }
  if (hazardId === "wind_storm") {
    return { minDate: "1901-01-01", maxDate: latest, defaultDate: latest };
  }
  if (hazardId === "extreme_heat") {
    if (mode === "fixture") {
      return {
        minDate: HEAT_PINNED_FIXTURE_DATE,
        maxDate: HEAT_PINNED_FIXTURE_DATE,
        defaultDate: HEAT_PINNED_FIXTURE_DATE,
      };
    }
    return { minDate: HEAT_EARLIEST_DATE, maxDate: latest, defaultDate: latest };
  }
  if (hazardId === "drought_land") {
    if (mode === "fixture") {
      return {
        minDate: DROUGHT_PINNED_FIXTURE_DATE,
        maxDate: DROUGHT_PINNED_FIXTURE_DATE,
        defaultDate: DROUGHT_PINNED_FIXTURE_DATE,
      };
    }
    return { minDate: "2000-01-01", maxDate: latest, defaultDate: latest };
  }
  return { minDate: "2000-01-01", maxDate: latest, defaultDate: latest };
}

/**
 * Source-supported time range types for the current hazard and evidence mode.
 * undefined means all locked TIME_RANGE_TYPES remain selectable (hazards whose
 * evidence path is not yet connected).
 */
export function allowedTimeTypesForHazard(
  hazardId: HazardId | null,
  fireMode: EvidenceMode,
  // Flood and Heat support only custom dates in both modes today; their mode
  // params are accepted so call sites stay stable when that changes.
  floodMode?: EvidenceMode,
  heatMode?: EvidenceMode,
  droughtMode?: EvidenceMode
): readonly TimeRangeType[] | undefined {
  void floodMode;
  void heatMode;
  void droughtMode;
  if (
    hazardId === "flood_storm" ||
    hazardId === "wind_storm" ||
    hazardId === "extreme_heat" ||
    hazardId === "drought_land" ||
    hazardId === "air_quality" ||
    hazardId === "earth_volcanoes"
  ) return ["custom"];
  if (hazardId !== "fire_smoke") return undefined;
  return fireMode === "fixture" ? ["custom"] : ["latest", "past_7d", "custom"];
}
