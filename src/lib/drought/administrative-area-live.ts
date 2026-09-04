import type { BoundingBox } from "@/contracts/common";
import {
  getUsAdministrativeArea,
  type UsAdministrativeArea,
} from "@/data/us-administrative-areas";
import { areaCenter, validateQueryArea } from "@/lib/location/query-area";

type FetchLike = typeof fetch;

export const CENSUS_TIGERWEB_HOST = "tigerweb.geo.census.gov";
export const CENSUS_TIGERWEB_STATES_PATH =
  "/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query";
export const CENSUS_TIGERWEB_TIMEOUT_MS = 8_000;
export const CENSUS_TIGERWEB_MAX_BYTES = 2_000_000;
export const CENSUS_TIGERWEB_MAX_FEATURES = 20;

export type AdministrativeAreaFailureReason =
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "media_type"
  | "malformed"
  | "schema_validation"
  | "provider_failure";

export type AdministrativeAreaResult =
  | {
      kind: "resolved";
      area: UsAdministrativeArea;
      sourceUrl: string;
      selectionBasis: "center_inside";
    }
  | { kind: "no_observation"; sourceUrl: string }
  | { kind: "source_failure"; reason: AdministrativeAreaFailureReason };

export interface AdministrativeAreaDependencies {
  fetchImpl?: FetchLike;
}

class AdministrativeAreaError extends Error {
  constructor(readonly reason: AdministrativeAreaFailureReason) {
    super(reason);
    this.name = "AdministrativeAreaError";
  }
}

export function buildCensusAdministrativeAreaUrl(value: unknown): URL {
  const area = validateQueryArea(value);
  const url = new URL(`https://${CENSUS_TIGERWEB_HOST}${CENSUS_TIGERWEB_STATES_PATH}`);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("geometry", JSON.stringify({
    xmin: area.west,
    ymin: area.south,
    xmax: area.east,
    ymax: area.north,
    spatialReference: { wkid: 4326 },
  }));
  url.searchParams.set("geometryType", "esriGeometryEnvelope");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "STATE,NAME,STUSAB");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("resultRecordCount", String(CENSUS_TIGERWEB_MAX_FEATURES));
  url.searchParams.set("f", "geojson");
  return url;
}

async function readBody(response: Response): Promise<Uint8Array> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isInteger(length) || length < 0 || length > CENSUS_TIGERWEB_MAX_BYTES) {
      throw new AdministrativeAreaError("oversize");
    }
  }
  if (!response.body) throw new AdministrativeAreaError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CENSUS_TIGERWEB_MAX_BYTES) {
      await reader.cancel();
      throw new AdministrativeAreaError("oversize");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

type Position = [number, number];
type Polygon = Position[][];

function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length >= 2 &&
    typeof value[0] === "number" && Number.isFinite(value[0]) &&
    typeof value[1] === "number" && Number.isFinite(value[1]);
}

function parsePolygons(geometry: unknown): Polygon[] {
  if (typeof geometry !== "object" || geometry === null || Array.isArray(geometry)) {
    throw new AdministrativeAreaError("schema_validation");
  }
  const item = geometry as Record<string, unknown>;
  if (!Array.isArray(item.coordinates)) {
    throw new AdministrativeAreaError("schema_validation");
  }
  const rawPolygons = item.type === "Polygon"
    ? [item.coordinates]
    : item.type === "MultiPolygon"
      ? item.coordinates
      : null;
  if (!rawPolygons || !Array.isArray(rawPolygons)) {
    throw new AdministrativeAreaError("schema_validation");
  }
  const polygons: Polygon[] = [];
  for (const rawPolygon of rawPolygons) {
    if (!Array.isArray(rawPolygon)) throw new AdministrativeAreaError("schema_validation");
    const polygon: Polygon = [];
    for (const rawRing of rawPolygon) {
      if (!Array.isArray(rawRing) || rawRing.length < 4 || !rawRing.every(isPosition)) {
        throw new AdministrativeAreaError("schema_validation");
      }
      polygon.push(rawRing as Position[]);
    }
    if (polygon.length === 0) throw new AdministrativeAreaError("schema_validation");
    polygons.push(polygon);
  }
  return polygons;
}

function inRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > point[1]) !== (yj > point[1]) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function inPolygon(point: Position, polygon: Polygon): boolean {
  return inRing(point, polygon[0]) && !polygon.slice(1).some((hole) => inRing(point, hole));
}

function geometryDistanceSquared(point: Position, polygons: Polygon[]): number {
  if (polygons.some((polygon) => inPolygon(point, polygon))) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        minimum = Math.min(minimum, (x - point[0]) ** 2 + (y - point[1]) ** 2);
      }
    }
  }
  return minimum;
}

export async function resolveUsAdministrativeArea(
  value: unknown,
  dependencies: AdministrativeAreaDependencies = {}
): Promise<AdministrativeAreaResult> {
  const area: BoundingBox = validateQueryArea(value);
  const url = buildCensusAdministrativeAreaUrl(area);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CENSUS_TIGERWEB_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (dependencies.fetchImpl ?? fetch)(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/geo+json, application/json" },
      });
    } catch {
      throw new AdministrativeAreaError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) {
      throw new AdministrativeAreaError("redirect");
    }
    if (response.status === 429) throw new AdministrativeAreaError("rate_limited");
    if (!response.ok) throw new AdministrativeAreaError("provider_failure");
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!["application/geo+json", "application/json"].includes(contentType)) {
      throw new AdministrativeAreaError("media_type");
    }
    const bytes = await readBody(response);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new AdministrativeAreaError("malformed");
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new AdministrativeAreaError("schema_validation");
    }
    const collection = payload as Record<string, unknown>;
    if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
      throw new AdministrativeAreaError("schema_validation");
    }
    if (collection.features.length === 0) {
      return { kind: "no_observation", sourceUrl: url.toString() };
    }
    if (collection.features.length > CENSUS_TIGERWEB_MAX_FEATURES) {
      throw new AdministrativeAreaError("oversize");
    }
    const center = areaCenter(area);
    const point: Position = [center.lon, center.lat];
    const candidates: Array<{
      area: UsAdministrativeArea;
      distance: number;
    }> = [];
    for (const feature of collection.features) {
      if (typeof feature !== "object" || feature === null || Array.isArray(feature)) {
        throw new AdministrativeAreaError("schema_validation");
      }
      const item = feature as Record<string, unknown>;
      if (item.type !== "Feature" || typeof item.properties !== "object" ||
        item.properties === null || Array.isArray(item.properties)) {
        throw new AdministrativeAreaError("schema_validation");
      }
      const properties = item.properties as Record<string, unknown>;
      if (
        typeof properties.STATE !== "string" ||
        typeof properties.NAME !== "string" ||
        typeof properties.STUSAB !== "string"
      ) {
        throw new AdministrativeAreaError("schema_validation");
      }
      const registered = getUsAdministrativeArea(properties.STATE);
      if (!registered || registered.name !== properties.NAME || registered.postalCode !== properties.STUSAB) {
        throw new AdministrativeAreaError("schema_validation");
      }
      const polygons = parsePolygons(item.geometry);
      candidates.push({ area: registered, distance: geometryDistanceSquared(point, polygons) });
    }
    candidates.sort((left, right) =>
      left.distance - right.distance || left.area.fips.localeCompare(right.area.fips)
    );
    // USDM returns whole-state statistics. A state that merely intersects the
    // request envelope is not representative when the selected area's center
    // is outside that state (for example, Toronto with a box that grazes New
    // York). Fail closed instead of promoting the nearest intersecting state.
    if (candidates[0].distance !== 0) {
      return { kind: "no_observation", sourceUrl: url.toString() };
    }
    return {
      kind: "resolved",
      area: candidates[0].area,
      sourceUrl: url.toString(),
      selectionBasis: "center_inside",
    };
  } catch (error) {
    return {
      kind: "source_failure",
      reason: error instanceof AdministrativeAreaError
        ? error.reason
        : "schema_validation",
    };
  } finally {
    clearTimeout(timeout);
  }
}
