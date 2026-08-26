/**
 * src/lib/location/area.ts
 *
 * WP-04 analysis-area model: radius (1–250 km) with deterministic
 * bounding-box derivation.
 *
 * The derivation uses a latitude-dependent degree-per-kilometer formula:
 *   1° latitude ≈ 111.32 km (fixed)
 *   1° longitude ≈ 111.32 * cos(lat) km
 *
 * This is an approximation sufficient for analysis-area bounding boxes.
 * It does not claim to be an exact geodetic computation.
 *
 * Edge cases validated and fail-closed:
 *   - Non-finite, NaN longitude or latitude → ValidationError
 *   - Longitude/latitude out of range → ValidationError
 *   - Non-finite, NaN radius → ValidationError
 *   - Radius < 1 or > 250 → ValidationError
 *   - Pole crossing: if the derived box would cross ±90° → ValidationError
 *     (the single-box model cannot represent it truthfully)
 *   - Antimeridian crossing: if the derived box would cross ±180° → ValidationError
 *     (the single-box model cannot represent it truthfully)
 *   - Never clamps silently; always rejects with a visible error.
 *
 * Reuses ValidationError and validators from WP-02 contracts/common.ts.
 */

import {
  type Coordinate,
  type BoundingBox,
  ValidationError,
  assert,
  validateCoordinate,
  isFiniteNumber,
} from "@/contracts/common";

/** Minimum allowed analysis radius in kilometres. */
export const AREA_RADIUS_MIN_KM = 1;

/** Maximum allowed analysis radius in kilometres. */
export const AREA_RADIUS_MAX_KM = 250;

/** Approximately 1° latitude in km. */
const KM_PER_DEGREE_LAT = 111.32;

/**
 * Validated analysis area: a coordinate, a radius, and the derived bounding box.
 * Created only by validateAndBuildArea; never constructed directly.
 */
export interface AnalysisArea {
  /** Center coordinate (WGS-84). */
  center: Coordinate;
  /** Radius in kilometres (1–250). */
  radiusKm: number;
  /** Derived bounding box. */
  boundingBox: BoundingBox;
}

/**
 * Derives the approximate bounding box for a circular analysis area.
 *
 * Throws ValidationError — never clamps — when the box would cross a pole
 * (north > 90 or south < -90) or the antimeridian (west < -180 or east > 180).
 * The single-box model cannot represent those areas truthfully.
 */
export function deriveBoundingBox(center: Coordinate, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  // Guard against divide-by-near-zero at poles (already caught by pole check below,
  // but use a safe fallback for the arithmetic so we produce a meaningful error message)
  const lonDelta = cosLat > 1e-10 ? radiusKm / (KM_PER_DEGREE_LAT * cosLat) : 360;

  const south = center.lat - latDelta;
  const north = center.lat + latDelta;
  const west = center.lon - lonDelta;
  const east = center.lon + lonDelta;

  // Fail closed: reject area if it would cross a pole or the antimeridian.
  // Never silently clamp — the single BoundingBox cannot represent those areas.
  if (south < -90 || north > 90) {
    throw new ValidationError(
      `Analysis area crosses a pole (south=${south.toFixed(3)}, north=${north.toFixed(3)}). ` +
      `Reduce the radius or move the center away from the poles.`
    );
  }
  if (west < -180 || east > 180) {
    throw new ValidationError(
      `Analysis area crosses the antimeridian (west=${west.toFixed(3)}, east=${east.toFixed(3)}). ` +
      `Reduce the radius or move the center away from ±180° longitude.`
    );
  }

  return { west, south, east, north };
}

/**
 * Validates inputs and builds an AnalysisArea.
 * Throws ValidationError if any input is invalid, including pole/antimeridian crossing.
 * The returned object is the only valid way to create an AnalysisArea.
 */
export function validateAndBuildArea(
  center: unknown,
  radiusKm: unknown
): AnalysisArea {
  // Validate coordinate
  validateCoordinate(center);
  const coord = center as Coordinate;

  // Validate radius
  assert(isFiniteNumber(radiusKm), `radiusKm must be a finite number, got ${radiusKm}`);
  assert(
    (radiusKm as number) >= AREA_RADIUS_MIN_KM,
    `radiusKm must be >= ${AREA_RADIUS_MIN_KM}, got ${radiusKm}`
  );
  assert(
    (radiusKm as number) <= AREA_RADIUS_MAX_KM,
    `radiusKm must be <= ${AREA_RADIUS_MAX_KM}, got ${radiusKm}`
  );

  const r = radiusKm as number;
  // deriveBoundingBox throws ValidationError for pole/antimeridian crossings
  const boundingBox = deriveBoundingBox(coord, r);

  return { center: coord, radiusKm: r, boundingBox };
}

export { ValidationError };
