/**
 * src/lib/location/geocode.ts
 *
 * UXFIX-02 (W8): Server-side place-name search via the public Photon API
 * (photon.komoot.io, © komoot — geocoding data © OpenStreetMap contributors).
 *
 * Policy (ADR-0022):
 *   - Public Nominatim remains prohibited; Photon's terms permit reasonable
 *     use without a key. This module enforces good-citizen behavior: one
 *     upstream request per second process-wide, bounded response size, no
 *     retry, fail-closed on any upstream problem.
 *   - Geocoding is a convenience only. Search failure never blocks the demo
 *     places or map-click selection paths.
 *   - For production-scale use, self-host Photon or move to a keyed provider.
 */

import { ValidationError } from "@/contracts/common";

export const PHOTON_HOST = "photon.komoot.io";
export const GEOCODE_MAX_RESULTS = 5;
export const GEOCODE_MIN_INTERVAL_MS = 1000;
export const GEOCODE_ATTRIBUTION =
  "Search results © OpenStreetMap contributors, via Photon (komoot)";

export interface GeocodeResult {
  /** Stable upstream identity when Photon supplies an OSM feature id. */
  id?: string;
  /** Display label assembled from Photon properties (never invented). */
  label: string;
  lon: number;
  lat: number;
}

/** Simple process-wide minimum-interval limiter (good-citizen behavior). */
let lastUpstreamRequestMs = 0;

export function geocodeRateLimiterAllows(nowMs: number): boolean {
  if (nowMs - lastUpstreamRequestMs < GEOCODE_MIN_INTERVAL_MS) return false;
  lastUpstreamRequestMs = nowMs;
  return true;
}

/** Test hook: reset the limiter. */
export function resetGeocodeRateLimiter(): void {
  lastUpstreamRequestMs = 0;
}

export function buildPhotonUrl(query: string): URL {
  const url = new URL(`https://${PHOTON_HOST}/api/`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(GEOCODE_MAX_RESULTS));
  url.searchParams.set("lang", "en");
  if (url.hostname !== PHOTON_HOST) throw new ValidationError("geocoder host mismatch");
  return url;
}

/** Reads and parses a JSON response without buffering more than the byte cap. */
export async function readBoundedJsonBody(
  response: Response,
  maximumBytes: number
): Promise<unknown> {
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json" && contentType !== "application/geo+json") {
    throw new ValidationError("geocoder response content type is not JSON");
  }
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maximumBytes
    ) {
      throw new ValidationError("geocoder response exceeds the byte cap");
    }
  }
  if (!response.body) throw new ValidationError("geocoder response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new ValidationError("geocoder response exceeds the byte cap");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ValidationError("geocoder response is not valid UTF-8 JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a Photon GeoJSON response into bounded, validated results.
 * Throws ValidationError on structural problems; skips malformed features.
 */
export function parsePhotonResponse(body: unknown): GeocodeResult[] {
  if (!isRecord(body) || body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    throw new ValidationError("geocoder response is not a FeatureCollection");
  }
  const results: GeocodeResult[] = [];
  for (const feature of body.features) {
    if (results.length >= GEOCODE_MAX_RESULTS) break;
    if (!isRecord(feature) || feature.type !== "Feature") continue;
    const geometry = feature.geometry;
    const properties = feature.properties;
    if (
      !isRecord(geometry) ||
      geometry.type !== "Point" ||
      !Array.isArray(geometry.coordinates) ||
      typeof geometry.coordinates[0] !== "number" ||
      typeof geometry.coordinates[1] !== "number" ||
      !isRecord(properties)
    ) {
      continue;
    }
    const lon = geometry.coordinates[0];
    const lat = geometry.coordinates[1];
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      lon < -180 ||
      lon > 180 ||
      lat < -90 ||
      lat > 90
    ) continue;
    const name = typeof properties.name === "string" ? properties.name.trim() : "";
    if (name.length === 0) continue;
    const featureType = typeof properties.type === "string"
      ? properties.type.trim().replaceAll("_", " ")
      : "";
    const primaryLabel = featureType.length > 0 ? `${name} (${featureType})` : name;
    const context = [properties.city, properties.district, properties.county]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim())
      .filter((part) => part.toLocaleLowerCase("en-US") !== name.toLocaleLowerCase("en-US"));
    const parts = [primaryLabel, ...context, properties.state, properties.country]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim());
    const deduped = [...new Set(parts)];
    if (deduped.length === 0) continue;
    const osmType = typeof properties.osm_type === "string"
      ? properties.osm_type.trim().toLocaleLowerCase("en-US")
      : "";
    const osmId = properties.osm_id;
    const id = osmType.length > 0 &&
      typeof osmId === "number" &&
      Number.isSafeInteger(osmId) &&
      osmId >= 0
      ? `osm-${osmType}-${osmId}`
      : undefined;
    results.push({
      ...(id ? { id } : {}),
      label: deduped.join(", "),
      lon,
      lat,
    });
  }
  return results;
}
