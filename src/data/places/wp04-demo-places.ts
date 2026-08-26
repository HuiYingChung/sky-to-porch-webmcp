/**
 * src/data/places/wp04-demo-places.ts
 *
 * Deterministic demo place index for WP-04/WP-05.
 *
 * Contains the evidenced demo locations (Houston, Los Angeles, Lake Michigan,
 * and the fixed NOAA USCRN Tucson station vicinity).
 * Centers are derived deterministically from the evidenced bounding boxes:
 *   center.lon = (west + east) / 2
 *   center.lat = (south + north) / 2
 *
 * These are NOT geocoded addresses. They do not imply property identity or
 * authoritative boundary. They are labeled explicitly as demo locations.
 *
 * No live geocoder is called. Public Nominatim is not authorized (policy:
 * https://operations.osmfoundation.org/policies/nominatim/).
 *
 * Bounding-box evidence:
 *   WP-02 source feasibility (docs/data/source-feasibility.md)
 *   established Houston [-97,28,-94,31] and Los Angeles [-119,33,-117,35].
 *   WP-05 fire feasibility established the Lake Michigan no-observation test
 *   box [-87.0,-86.9,43.0,43.1] (fire-no-observation.json).
 */

import type { Coordinate, BoundingBox } from "@/contracts/common";

export interface DemoPlace {
  /** Stable identifier for this demo entry. */
  id: string;
  /** Display label shown in the UI. Clearly identifies this as a demo location. */
  label: string;
  /** Center coordinate derived deterministically from boundingBox. */
  center: Coordinate;
  /** Bounding box from which the center is derived. */
  boundingBox: BoundingBox;
}

/**
 * Derives a center coordinate from a bounding box.
 * lon = (west + east) / 2, lat = (south + north) / 2.
 */
function deriveCenter(box: BoundingBox): Coordinate {
  return {
    lon: (box.west + box.east) / 2,
    lat: (box.south + box.north) / 2,
  };
}

const HOUSTON_BOX: BoundingBox = { west: -97, south: 28, east: -94, north: 31 };
const LOS_ANGELES_BOX: BoundingBox = { west: -119, south: 33, east: -117, north: 35 };
/** Fixed station-vicinity box centered exactly on NOAA USCRN AZ Tucson 11 W. */
const TUCSON_HEAT_BOX: BoundingBox = {
  west: -111.18,
  south: 32.23,
  east: -111.16,
  north: 32.25,
};
/**
 * Lake Michigan feasibility box — pinned from WP-02/WP-05 fire no-observation fixture.
 * This is a narrow water-coverage box used to demonstrate a genuine no-observation
 * result. It is NOT a residential or property location.
 * box: lon [-87.0,-86.9], lat [43.0,43.1]
 */
const LAKE_MICHIGAN_BOX: BoundingBox = { west: -87.0, south: 43.0, east: -86.9, north: 43.1 };
/** ADR-0044 demo-story places: Las Vegas basin, Hawaii Island, New York City. */
const LAS_VEGAS_BOX: BoundingBox = { west: -115.6, south: 35.7, east: -114.7, north: 36.6 };
const HAWAII_ISLAND_BOX: BoundingBox = { west: -156.1, south: 18.9, east: -154.8, north: 20.3 };
const NEW_YORK_BOX: BoundingBox = { west: -74.3, south: 40.5, east: -73.7, north: 40.95 };

export const DEMO_PLACES: readonly DemoPlace[] = [
  {
    id: "demo-houston",
    label: "Houston area (demo)",
    center: deriveCenter(HOUSTON_BOX),
    boundingBox: HOUSTON_BOX,
  },
  {
    id: "demo-los-angeles",
    label: "Los Angeles area (demo)",
    center: deriveCenter(LOS_ANGELES_BOX),
    boundingBox: LOS_ANGELES_BOX,
  },
  {
    id: "demo-lake-michigan",
    label: "Lake Michigan box (demo — fire no-observation)",
    center: deriveCenter(LAKE_MICHIGAN_BOX),
    boundingBox: LAKE_MICHIGAN_BOX,
  },
  {
    id: "demo-tucson",
    label: "Tucson AZ USCRN station area (demo — Extreme Heat)",
    center: deriveCenter(TUCSON_HEAT_BOX),
    boundingBox: TUCSON_HEAT_BOX,
  },
  {
    id: "demo-source-failure",
    label: "Source failure test (demo — governed source failure)",
    center: deriveCenter(LAKE_MICHIGAN_BOX),
    boundingBox: LAKE_MICHIGAN_BOX,
  },
  {
    id: "demo-las-vegas",
    label: "Las Vegas area (demo)",
    center: deriveCenter(LAS_VEGAS_BOX),
    boundingBox: LAS_VEGAS_BOX,
  },
  {
    id: "demo-hawaii-island",
    label: "Hawaii Island area (demo)",
    center: deriveCenter(HAWAII_ISLAND_BOX),
    boundingBox: HAWAII_ISLAND_BOX,
  },
  {
    id: "demo-new-york",
    label: "New York City area (demo)",
    center: deriveCenter(NEW_YORK_BOX),
    boundingBox: NEW_YORK_BOX,
  },
] as const;

/** Search the demo place index. Case-insensitive substring match on label. */
export function searchDemoPlaces(query: string): readonly DemoPlace[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return DEMO_PLACES;
  return DEMO_PLACES.filter((p) => p.label.toLowerCase().includes(q));
}

/** Look up a demo place by ID. Returns undefined if not found. */
export function getDemoPlaceById(id: string): DemoPlace | undefined {
  return DEMO_PLACES.find((p) => p.id === id);
}
