/**
 * src/lib/ui/query-draft.ts
 *
 * Typed query-draft state for WP-03/WP-04. A QueryDraft holds only the
 * hazard, concern, and optional question inputs — the fields that belong
 * to the draft and are NOT the validated place/time selection.
 *
 * Place, coordinate, radius, bounds, and time are exclusively owned by
 * PlaceSelection in QueryProvider. isDraftSubmittable requires a validated
 * PlaceSelection plus the remaining draft fields.
 *
 * Reuses HAZARD_IDS, CONCERN_TYPES from the locked WP-02 vocabulary.
 * Does not duplicate or rename their values.
 */

import type { HazardId, ConcernType } from "@/contracts/common";
import { HAZARD_IDS, CONCERN_TYPES } from "@/contracts/common";
import type { PlaceSelection } from "@/lib/location/selection";

export interface QueryDraft {
  /** Selected hazard, or null if not yet chosen. */
  hazardId: HazardId | null;
  /** Selected concern, or null if not yet chosen. */
  concern: ConcernType | null;
  /** Optional free-text question from the user. */
  optionalQuestion: string;
}

/** The empty/initial query draft. */
export function emptyDraft(): QueryDraft {
  return {
    hazardId: null,
    concern: null,
    optionalQuestion: "",
  };
}

export type QueryDraftAction =
  | { type: "SET_HAZARD"; value: HazardId | null }
  | { type: "SET_CONCERN"; value: ConcernType | null }
  | { type: "SET_OPTIONAL_QUESTION"; value: string }
  | { type: "RESET" };

/** Pure reducer for query-draft state transitions. */
export function queryDraftReducer(state: QueryDraft, action: QueryDraftAction): QueryDraft {
  switch (action.type) {
    case "SET_HAZARD":
      if (action.value !== null && !(HAZARD_IDS as readonly string[]).includes(action.value)) {
        return state; // silently ignore unknown hazard
      }
      return { ...state, hazardId: action.value };
    case "SET_CONCERN":
      if (action.value !== null && !(CONCERN_TYPES as readonly string[]).includes(action.value)) {
        return state;
      }
      return { ...state, concern: action.value };
    case "SET_OPTIONAL_QUESTION":
      return { ...state, optionalQuestion: action.value };
    case "RESET":
      return emptyDraft();
    default:
      return state;
  }
}

/**
 * Returns true when the draft has a validated place selection plus the
 * required hazard and concern fields. Does NOT validate coordinates,
 * timestamps, or identity — those are already validated in PlaceSelection.
 */
export function isDraftSubmittable(draft: QueryDraft, placeSelection: PlaceSelection | null): boolean {
  return (
    placeSelection !== null &&
    draft.hazardId !== null &&
    draft.concern !== null
  );
}

/** Human-readable labels for hazard IDs, used by the guided query UI. */
export const HAZARD_LABELS: Record<HazardId, string> = {
  fire_smoke: "Fire & Smoke",
  flood_storm: "Flood & Heavy Rain",
  wind_storm: "Wind & Storm",
  extreme_heat: "Extreme Heat",
  drought_land: "Drought & Land",
  air_quality: "Air Quality",
  earth_volcanoes: "Earth & Volcanoes",
};

/** Human-readable labels for time range types. */
export const TIME_RANGE_LABELS: Record<string, string> = {
  latest: "Latest available data",
  past_24h: "Past 24 hours",
  past_7d: "Past 7 days",
  past_30d: "Past 30 days",
  custom: "Custom range",
};

/** Human-readable labels for concern types. */
export const CONCERN_LABELS: Record<ConcernType, string> = {
  home: "Home",
  health: "Health",
  pets: "Pets",
  travel: "Travel",
  power_internet: "Power & Internet",
  community: "Community",
};
