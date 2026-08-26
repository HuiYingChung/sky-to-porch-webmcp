/**
 * src/lib/fire/hms-kml.ts
 *
 * WP-05-004: Pure, network-free KML parser for NOAA HMS fire-points and
 * smoke-polygon products. Used only by src/lib/fire/live-adapter.ts.
 *
 * Export surface is minimal by design:
 *   - HmsKmlKind      — discriminates the two product types
 *   - ParsedHmsKml    — parsed result with coordinate count
 *   - parseHmsKml()   — main parse/validate entry point
 *
 * Safety rules enforced here:
 *   - Parsing uses fast-xml-parser (no regex XML parsing).
 *   - Every coordinate token must parse as a finite longitude/latitude pair.
 *   - Any malformed, out-of-range, or unexpected-geometry coordinate content
 *     rejects the complete payload; invalid data is never silently discarded.
 *   - World bounds enforced: lon ∈ [−180, 180], lat ∈ [−90, 90].
 *   - Requires a KML root element and structurally valid placemark content.
 *   - Counts are parsing counts of coordinate pairs inside the requested box,
 *     NEVER counts of distinct fires, homes, or people.
 */

import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { BoundingBox } from "@/contracts/common";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HmsKmlKind = "fire_points" | "smoke_polygons";

export interface ParsedHmsKml {
  /** Product kind. */
  kind: HmsKmlKind;
  /** Total valid coordinate pairs across all placemarks (world-wide). */
  totalCoordinatePairs: number;
  /** Coordinate pairs that fall inside the requested bounding box. */
  inBoxCoordinatePairs: number;
  /** Number of placemarks found in the KML document. */
  placemarkCount: number;
}

// ---------------------------------------------------------------------------
// Fast-XML-Parser configuration
// ---------------------------------------------------------------------------

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,   // Keep all values as strings; we parse numbers ourselves.
  allowBooleanAttributes: true,
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when (lon, lat) is inside the bounding box (inclusive edges).
 */
function inBox(lon: number, lat: number, box: BoundingBox): boolean {
  return lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north;
}

/**
 * Parses a KML coordinates string (space-separated lon,lat,alt tuples) and
 * returns an array of valid [lon, lat] pairs. Any malformed or out-of-range
 * token rejects the payload so callers fail closed.
 */
function parseCoordinateString(raw: string): Array<[number, number]> {
  if (raw.trim().length === 0) {
    throw new Error("HMS KML parse error: empty coordinates value");
  }
  const pairs: Array<[number, number]> = [];
  const tokens = raw.trim().split(/\s+/);
  for (const token of tokens) {
    const parts = token.split(",");
    if (parts.length < 2 || parts[0].trim() === "" || parts[1].trim() === "") {
      throw new Error("HMS KML parse error: malformed coordinate token");
    }
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error("HMS KML parse error: non-finite coordinate");
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new Error("HMS KML parse error: coordinate outside world bounds");
    }
    pairs.push([lon, lat]);
  }
  return pairs;
}

/**
 * Recursively collects nodes whose exact element name matches key.
 */
function collectNodesByKey(node: unknown, targetKey: string): unknown[] {
  if (Array.isArray(node)) {
    return node.flatMap((item) => collectNodesByKey(item, targetKey));
  }
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const results: unknown[] = [];
    for (const [nodeKey, val] of Object.entries(obj)) {
      if (nodeKey === targetKey) {
        if (Array.isArray(val)) results.push(...val);
        else results.push(val);
      }
      results.push(...collectNodesByKey(val, targetKey));
    }
    return results;
  }
  return [];
}

/** Recursively collects <coordinates> strings from an expected geometry. */
function collectCoordinateStrings(node: unknown): string[] {
  const values = collectNodesByKey(node, "coordinates");
  if (values.some((value) => typeof value !== "string")) {
    throw new Error("HMS KML parse error: coordinates must be text");
  }
  return values as string[];
}

// ---------------------------------------------------------------------------
// Public parse entry point
// ---------------------------------------------------------------------------

/**
 * Parses raw KML bytes from a NOAA HMS product.
 *
 * Throws if:
 *   - The XML cannot be parsed at all.
 *   - There is no recognizable KML root element.
 *
 * Returns a ParsedHmsKml with coordinate counts even when there are zero
 * in-box pairs; callers decide what to do with zero counts.
 */
export function parseHmsKml(bytes: Uint8Array, kind: HmsKmlKind, box: BoundingBox): ParsedHmsKml {
  const text = new TextDecoder("utf-8").decode(bytes);

  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    throw new Error("HMS KML parse error: malformed XML");
  }

  const doc = XML_PARSER.parse(text) as Record<string, unknown>;

  // Require a KML root element.
  if (!("kml" in doc)) {
    throw new Error("HMS KML parse error: no 'kml' root element found");
  }

  const kmlNode = doc["kml"];
  if (kmlNode === null || typeof kmlNode !== "object") {
    throw new Error("HMS KML parse error: invalid kml root structure");
  }

  const placemarks = collectNodesByKey(kmlNode, "Placemark");
  const geometryName = kind === "fire_points" ? "Point" : "Polygon";

  let totalCoordinatePairs = 0;
  let inBoxCoordinatePairs = 0;

  for (const placemark of placemarks) {
    const geometries = collectNodesByKey(placemark, geometryName);
    if (geometries.length === 0) {
      throw new Error(`HMS KML parse error: ${kind} placemark lacks ${geometryName} geometry`);
    }
    const coordinateStrings = geometries.flatMap(collectCoordinateStrings);
    if (coordinateStrings.length === 0) {
      throw new Error(`HMS KML parse error: ${geometryName} geometry lacks coordinates`);
    }
    for (const coordStr of coordinateStrings) {
      const pairs = parseCoordinateString(coordStr);
      totalCoordinatePairs += pairs.length;
      for (const [lon, lat] of pairs) {
        if (inBox(lon, lat, box)) {
          inBoxCoordinatePairs++;
        }
      }
    }
  }

  return {
    kind,
    totalCoordinatePairs,
    inBoxCoordinatePairs,
    placemarkCount: placemarks.length,
  };
}
