/**
 * src/lib/location/query-area.ts
 *
 * UXFIX-02 (ADR-0022): Server-side validation for user-selected query areas.
 *
 * Replaces the per-place bounding-box allowlist for live evidence queries.
 * A query area is the client's derived analysis bounding box (center+radius →
 * bbox, produced by validated WP-04 selection code). The server never trusts
 * it: this validator enforces shape, numeric ranges, ordering, and a hard
 * span cap before any adapter uses it, and adapters keep their own source
 * allowlists, byte caps, and fail-closed behavior unchanged.
 *
 * The span cap (QUERY_AREA_MAX_SPAN_DEG) bounds upstream request cost and
 * matches the WP-04 selection limits (radius ≤ 250 km ≈ 4.5° with margin).
 */

import type { BoundingBox } from "@/contracts/common";
import { ValidationError } from "@/contracts/common";

/** placeId sentinel for a validated user-selected map area. */
export const CUSTOM_AREA_PLACE_ID = "custom-area";

export interface CanonicalAreaQuery {
  placeId: typeof CUSTOM_AREA_PLACE_ID;
  area: BoundingBox;
}

/** Maximum width/height of a live query area, in degrees. */
export const QUERY_AREA_MAX_SPAN_DEG = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates an untrusted query-area payload and returns a plain BoundingBox.
 * Throws ValidationError on any structural, range, ordering, or span problem.
 */
export function validateQueryArea(value: unknown): BoundingBox {
  if (!isRecord(value)) {
    throw new ValidationError("query area must be an object with west/south/east/north");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 4 || keys.join(",") !== "east,north,south,west") {
    throw new ValidationError("query area must have exactly west, south, east, north");
  }
  const { west, south, east, north } = value as Record<string, unknown>;
  for (const [name, v] of Object.entries({ west, south, east, north })) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new ValidationError(`query area ${name} must be a finite number`);
    }
  }
  const w = west as number;
  const s = south as number;
  const e = east as number;
  const n = north as number;
  if (w < -180 || e > 180 || s < -90 || n > 90) {
    throw new ValidationError("query area is outside WGS-84 bounds");
  }
  if (!(w < e) || !(s < n)) {
    throw new ValidationError("query area must satisfy west < east and south < north");
  }
  if (e - w > QUERY_AREA_MAX_SPAN_DEG || n - s > QUERY_AREA_MAX_SPAN_DEG) {
    throw new ValidationError(
      `query area span must be at most ${QUERY_AREA_MAX_SPAN_DEG} degrees per side`
    );
  }
  return { west: w, south: s, east: e, north: n };
}

/**
 * Builds the only live product-area identity accepted by evidence routes.
 * Selection method and demo labels never change deterministic retrieval: the
 * already-derived canonical bounding box is revalidated and sent atomically.
 */
export function canonicalAreaQuery(value: unknown): CanonicalAreaQuery {
  return {
    placeId: CUSTOM_AREA_PLACE_ID,
    area: validateQueryArea(value),
  };
}

export function canonicalAreaQueryForSelection(selection: {
  analysisArea: { boundingBox: unknown };
}): CanonicalAreaQuery {
  return canonicalAreaQuery(selection.analysisArea.boundingBox);
}

/** Server-side counterpart for untrusted route payloads. */
export function validateCanonicalAreaQuery(
  placeId: unknown,
  value: unknown
): CanonicalAreaQuery {
  if (placeId !== CUSTOM_AREA_PLACE_ID) {
    throw new ValidationError("live evidence requests require the canonical area identity");
  }
  return canonicalAreaQuery(value);
}

/** Center point of a bounding box (used for nearest-source selection). */
export function areaCenter(box: BoundingBox): { lon: number; lat: number } {
  return { lon: (box.west + box.east) / 2, lat: (box.south + box.north) / 2 };
}

/** True when an actual source coordinate falls inside the validated query area. */
export function areaContainsCoordinate(
  box: BoundingBox,
  coordinate: { lon: number; lat: number }
): boolean {
  return coordinate.lon >= box.west &&
    coordinate.lon <= box.east &&
    coordinate.lat >= box.south &&
    coordinate.lat <= box.north;
}

/** True when two boxes intersect (inclusive edges). */
export function areasIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;
}

/** Compact human-readable label for a bounding box. */
export function areaLabel(box: BoundingBox): string {
  return `W${box.west.toFixed(2)} S${box.south.toFixed(2)} E${box.east.toFixed(2)} N${box.north.toFixed(2)}`;
}
