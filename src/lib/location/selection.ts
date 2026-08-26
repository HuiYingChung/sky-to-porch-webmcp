/**
 * src/lib/location/selection.ts
 *
 * WP-04 place selection state.
 *
 * A PlaceSelection is a validated canonical selection combining:
 *   - A place label (from demo index or "Map point")
 *   - A WGS-84 coordinate
 *   - Whether the coordinate was selected from the map (not a geocoded place)
 *   - An analysis area (radius + derived bounding box)
 *   - A normalized time selection
 *
 * The selection is produced by specific factory functions; never constructed
 * directly. Map-selected points are labeled as "Map point" — not
 * geocoded places.
 *
 * Reuses validators from WP-02 contracts. No geocoder is called.
 */

import type { Coordinate } from "@/contracts/common";
import { validateCoordinate, ValidationError } from "@/contracts/common";
import type { AnalysisArea } from "./area";
import { validateAndBuildArea, AREA_RADIUS_MIN_KM, AREA_RADIUS_MAX_KM } from "./area";
import type { TimeSelection } from "./time";
import { validateAndBuildTimeSelection } from "./time";
import type { DemoPlace } from "@/data/places/wp04-demo-places";

export { AREA_RADIUS_MIN_KM, AREA_RADIUS_MAX_KM };

export type SelectionMethod =
  | "demo_place"
  | "place_search"
  | "map_click"
  | "agent_coordinate";

/**
 * A validated canonical selection. Produced only by factory functions below.
 */
export interface PlaceSelection {
  /** Human-readable label. For demo places: the place label.
   *  For map-selected points: "Map point". Never a geocoded address. */
  label: string;
  /** Whether this selection came from the map (not a demo place). */
  isMapSelection: boolean;
  /** Deterministic origin of the canonical selection. */
  selectionMethod: SelectionMethod;
  /**
   * ADR-0044: registered demo-place id carried explicitly when the selection
   * came from a demo place, so fixture routing never guesses from label text.
   */
  demoPlaceId?: string;
  /** WGS-84 coordinate. */
  coordinate: Coordinate;
  /** Validated analysis area including derived bounding box. */
  analysisArea: AnalysisArea;
  /** Validated time selection. */
  timeSelection: TimeSelection;
}

/**
 * Updates radius and/or time parameters on an existing PlaceSelection without
 * changing the label, coordinate, or isMapSelection identity.
 *
 * - Preserves the label and coordinate from the base selection.
 * - Validates the new radius and time parameters using the same validators.
 * - Throws ValidationError if the new parameters are invalid; the base selection
 *   is then left unchanged.
 *
 * This is the correct update path when the user changes radius or time after
 * a place has already been selected — no reselection is required.
 */
export function updateSelectionParams(
  base: PlaceSelection,
  radiusKm: unknown,
  timeType: unknown,
  startTs?: unknown,
  endTs?: unknown
): PlaceSelection {
  const analysisArea = validateAndBuildArea(base.coordinate, radiusKm);
  const timeSelection = validateAndBuildTimeSelection(timeType, startTs, endTs);
  return {
    label: base.label,
    isMapSelection: base.isMapSelection,
    selectionMethod: base.selectionMethod,
    ...(base.demoPlaceId !== undefined ? { demoPlaceId: base.demoPlaceId } : {}),
    coordinate: base.coordinate,
    analysisArea,
    timeSelection,
  };
}

/**
 * Creates a PlaceSelection from a demo place.
 * Throws ValidationError if area or time inputs are invalid.
 */
export function buildDemoPlaceSelection(
  place: DemoPlace,
  radiusKm: unknown,
  timeType: unknown,
  startTs?: unknown,
  endTs?: unknown
): PlaceSelection {
  const analysisArea = validateAndBuildArea(place.center, radiusKm);
  const timeSelection = validateAndBuildTimeSelection(timeType, startTs, endTs);
  return {
    label: place.label,
    isMapSelection: false,
    selectionMethod: "demo_place",
    demoPlaceId: place.id,
    coordinate: place.center,
    analysisArea,
    timeSelection,
  };
}

/**
 * Creates a PlaceSelection from a map-selected coordinate.
 * The label is always "Map point" — never a geocoded address.
 * Throws ValidationError if coordinate, area, or time inputs are invalid.
 */
/**
 * UXFIX-02 (W8): Creates a PlaceSelection from a geocoder search result.
 * The label carries an explicit "(OSM search)" suffix so a search result is
 * never mistaken for an authoritative or demo place. isMapSelection is true:
 * evidence queries route through the same validated custom-area path as a
 * map click.
 */
export function buildGeocodedPlaceSelection(
  label: unknown,
  coordinate: unknown,
  radiusKm: unknown,
  timeType: unknown,
  startTs?: unknown,
  endTs?: unknown
): PlaceSelection {
  if (typeof label !== "string" || label.trim().length === 0 || label.length > 200) {
    throw new ValidationError("geocoded label must be a non-empty string");
  }
  validateCoordinate(coordinate);
  const coord = coordinate as Coordinate;
  const analysisArea = validateAndBuildArea(coord, radiusKm);
  const timeSelection = validateAndBuildTimeSelection(timeType, startTs, endTs);
  return {
    label: `${label.trim()} (OSM search)`,
    isMapSelection: true,
    selectionMethod: "place_search",
    coordinate: coord,
    analysisArea,
    timeSelection,
  };
}

/**
 * Creates a selection from coordinates explicitly supplied to the WebMCP
 * tool. The label remains user/agent supplied and carries an explicit suffix;
 * it is never presented as a verified geocoder result or administrative area.
 */
export function buildAgentCoordinateSelection(
  label: unknown,
  coordinate: unknown,
  radiusKm: unknown,
  timeType: unknown,
  startTs?: unknown,
  endTs?: unknown
): PlaceSelection {
  if (typeof label !== "string" || label.trim().length === 0 || label.length > 200) {
    throw new ValidationError("agent place label must be a non-empty string");
  }
  validateCoordinate(coordinate);
  const coord = coordinate as Coordinate;
  const analysisArea = validateAndBuildArea(coord, radiusKm);
  const timeSelection = validateAndBuildTimeSelection(timeType, startTs, endTs);
  return {
    label: `${label.trim()} (agent coordinates)`,
    isMapSelection: true,
    selectionMethod: "agent_coordinate",
    coordinate: coord,
    analysisArea,
    timeSelection,
  };
}

export function buildMapCoordinateSelection(
  coordinate: unknown,
  radiusKm: unknown,
  timeType: unknown,
  startTs?: unknown,
  endTs?: unknown
): PlaceSelection {
  validateCoordinate(coordinate);
  const coord = coordinate as Coordinate;
  const analysisArea = validateAndBuildArea(coord, radiusKm);
  const timeSelection = validateAndBuildTimeSelection(timeType, startTs, endTs);
  return {
    // ADR-0052: "Selected coordinate" sat directly above the coordinates it
    // named and beside a "(coordinate selection)" note, so the card said the
    // same thing three times and never said where.
    label: "Map point",
    isMapSelection: true,
    selectionMethod: "map_click",
    coordinate: coord,
    analysisArea,
    timeSelection,
  };
}
