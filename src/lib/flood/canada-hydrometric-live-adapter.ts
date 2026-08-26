import { createHash } from "crypto";
import type { BoundingBox } from "@/contracts/common";
import type { Observation } from "@/contracts/evidence";
import {
  areaCenter,
  areasIntersect,
  validateQueryArea,
} from "@/lib/location/query-area";
import type { FloodFailureReason } from "./types";

export const CANADA_GEOMET_HOST = "api.weather.gc.ca";
export const CANADA_HYDROMETRIC_COLLECTION = "hydrometric-daily-mean";
export const CANADA_HYDROMETRIC_TIMEOUT_MS = 10_000;
export const CANADA_HYDROMETRIC_MAX_BYTES = 2_000_000;
export const CANADA_HYDROMETRIC_MAX_FEATURES = 100;

/**
 * Coarse request gate only. It avoids obviously irrelevant global requests;
 * it is not used to claim that an area is Canadian. Every returned station
 * must still fall inside the user's validated selection.
 */
export const CANADA_HYDROMETRIC_REQUEST_BOUNDS: BoundingBox = {
  west: -141,
  south: 41.6,
  east: -52,
  north: 84,
};

type FetchLike = typeof fetch;

export interface CanadaHydrometricDependencies {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export type CanadaHydrometricResult =
  | { kind: "observation"; observation: Observation }
  | { kind: "no_observation" }
  | { kind: "not_applicable" }
  | { kind: "source_failure"; failureReason: FloodFailureReason };

class CanadaHydrometricError extends Error {
  constructor(readonly reason: FloodFailureReason) {
    super(reason);
    this.name = "CanadaHydrometricError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function strictDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

export function buildCanadaHydrometricUrl(box: BoundingBox, date: string): URL {
  if (!strictDate(date)) throw new CanadaHydrometricError("validation_failure");
  const url = new URL(
    `https://${CANADA_GEOMET_HOST}/collections/${CANADA_HYDROMETRIC_COLLECTION}/items`
  );
  url.searchParams.set("bbox", `${box.west},${box.south},${box.east},${box.north}`);
  url.searchParams.set("datetime", date);
  url.searchParams.set("limit", String(CANADA_HYDROMETRIC_MAX_FEATURES));
  url.searchParams.set("f", "json");
  if (
    url.protocol !== "https:" ||
    url.hostname !== CANADA_GEOMET_HOST ||
    url.pathname !== `/collections/${CANADA_HYDROMETRIC_COLLECTION}/items`
  ) {
    throw new CanadaHydrometricError("validation_failure");
  }
  return url;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const statedLength = response.headers.get("content-length");
  if (statedLength !== null) {
    const length = Number(statedLength);
    if (!Number.isInteger(length) || length < 0 || length > CANADA_HYDROMETRIC_MAX_BYTES) {
      throw new CanadaHydrometricError("oversize");
    }
  }
  if (!response.body) throw new CanadaHydrometricError("malformed");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > CANADA_HYDROMETRIC_MAX_BYTES) {
      await reader.cancel();
      throw new CanadaHydrometricError("oversize");
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

async function fetchPayload(fetchImpl: FetchLike, url: URL): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CANADA_HYDROMETRIC_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/geo+json, application/json" },
      });
    } catch {
      throw new CanadaHydrometricError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) {
      throw new CanadaHydrometricError("redirect");
    }
    if (response.status === 429) throw new CanadaHydrometricError("rate_limited");
    if (!response.ok) throw new CanadaHydrometricError("provider_failure");
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/geo+json" && contentType !== "application/json") {
      throw new CanadaHydrometricError("schema_validation");
    }
    return readBoundedBody(response);
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CanadaHydrometricError("malformed");
  }
}

interface ParsedStation {
  id: string;
  stationNumber: string;
  stationName: string;
  provinceOrTerritory: string;
  longitude: number;
  latitude: number;
  level: number;
  levelQualifier?: string;
  discharge?: number;
  dischargeQualifier?: string;
  distance: number;
}

function nullableFiniteNumber(value: unknown): number | undefined {
  if (value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CanadaHydrometricError("schema_validation");
  }
  return value;
}

function nullableString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CanadaHydrometricError("schema_validation");
  }
  return value.trim();
}

function parseStations(
  bytes: Uint8Array,
  box: BoundingBox,
  date: string
): ParsedStation[] {
  const payload = parseJson(bytes);
  if (!isRecord(payload) || payload.type !== "FeatureCollection" || !Array.isArray(payload.features)) {
    throw new CanadaHydrometricError("schema_validation");
  }
  const numberReturned = payload.numberReturned;
  const numberMatched = payload.numberMatched;
  if (
    !Number.isInteger(numberReturned) ||
    numberReturned !== payload.features.length ||
    !Number.isInteger(numberMatched) ||
    (numberMatched as number) < (numberReturned as number)
  ) {
    throw new CanadaHydrometricError("schema_validation");
  }
  const hasNext = Array.isArray(payload.links) && payload.links.some(
    (link) => isRecord(link) && link.rel === "next"
  );
  if ((numberMatched as number) > CANADA_HYDROMETRIC_MAX_FEATURES || hasNext) {
    throw new CanadaHydrometricError("oversize");
  }

  const center = areaCenter(box);
  const stations: ParsedStation[] = [];
  for (const feature of payload.features) {
    if (
      !isRecord(feature) ||
      feature.type !== "Feature" ||
      typeof feature.id !== "string" ||
      !isRecord(feature.properties) ||
      !isRecord(feature.geometry) ||
      feature.geometry.type !== "Point" ||
      !Array.isArray(feature.geometry.coordinates) ||
      feature.geometry.coordinates.length < 2
    ) {
      throw new CanadaHydrometricError("schema_validation");
    }
    const [longitude, latitude] = feature.geometry.coordinates;
    const properties = feature.properties;
    if (
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      longitude < box.west ||
      longitude > box.east ||
      latitude < box.south ||
      latitude > box.north ||
      typeof properties.IDENTIFIER !== "string" ||
      properties.IDENTIFIER !== feature.id ||
      typeof properties.STATION_NUMBER !== "string" ||
      !/^[0-9A-Z]{7}$/u.test(properties.STATION_NUMBER) ||
      typeof properties.STATION_NAME !== "string" ||
      properties.STATION_NAME.trim().length === 0 ||
      typeof properties.PROV_TERR_STATE_LOC !== "string" ||
      properties.PROV_TERR_STATE_LOC.trim().length === 0 ||
      properties.DATE !== date ||
      feature.id !== `${properties.STATION_NUMBER}.${date}`
    ) {
      throw new CanadaHydrometricError("schema_validation");
    }
    const level = nullableFiniteNumber(properties.LEVEL);
    const discharge = nullableFiniteNumber(properties.DISCHARGE);
    const levelQualifier = nullableString(properties.LEVEL_SYMBOL_EN);
    const dischargeQualifier = nullableString(properties.DISCHARGE_SYMBOL_EN);
    if (level === undefined) continue;
    const dLon = longitude - center.lon;
    const dLat = latitude - center.lat;
    stations.push({
      id: feature.id,
      stationNumber: properties.STATION_NUMBER,
      stationName: properties.STATION_NAME.trim(),
      provinceOrTerritory: properties.PROV_TERR_STATE_LOC.trim(),
      longitude,
      latitude,
      level,
      ...(levelQualifier ? { levelQualifier } : {}),
      ...(discharge !== undefined ? { discharge } : {}),
      ...(dischargeQualifier ? { dischargeQualifier } : {}),
      distance: dLon * dLon + dLat * dLat,
    });
  }
  return stations.sort(
    (a, b) => a.distance - b.distance || a.stationNumber.localeCompare(b.stationNumber)
  );
}

export async function queryCanadaHydrometricDailyMean(
  box: BoundingBox,
  date: string,
  dependencies: CanadaHydrometricDependencies = {}
): Promise<CanadaHydrometricResult> {
  try {
    const validatedBox = validateQueryArea(box);
    if (!areasIntersect(validatedBox, CANADA_HYDROMETRIC_REQUEST_BOUNDS)) {
      return { kind: "not_applicable" };
    }
    const url = buildCanadaHydrometricUrl(validatedBox, date);
    const bytes = await fetchPayload(dependencies.fetchImpl ?? fetch, url);
    const station = parseStations(bytes, validatedBox, date)[0];
    if (!station) return { kind: "no_observation" };

    const retrievedAt = (dependencies.now?.() ?? new Date()).toISOString();
    const qualifiers = [station.levelQualifier]
      .filter((value): value is string => value !== undefined)
      .sort();
    return {
      kind: "observation",
      observation: {
        observationId: `obs-eccc-hydrometric-${station.stationNumber}-${date}`,
        provenance: {
          sourceId: "canada_geomet",
          sourceUrl: url.toString(),
          sourceRecordId: station.id,
          retrievedAt,
          observedAt: `${date}T00:00:00.000Z`,
          product: "MSC GeoMet hydrometric daily mean",
          payloadHash: sha256(bytes),
          requestParameters: Object.fromEntries(url.searchParams.entries()),
        },
        variableName: "Daily mean water level",
        value: station.level,
        unit: "m",
        dataMode: "live",
        ...(qualifiers.length > 0 ? { qualifiers } : {}),
        periodStart: `${date}T00:00:00.000Z`,
        periodEnd: `${date}T23:59:59.999Z`,
        metadata: {
          stationNumber: station.stationNumber,
          stationName: station.stationName,
          provinceOrTerritory: station.provinceOrTerritory,
          longitude: station.longitude,
          latitude: station.latitude,
          collection: CANADA_HYDROMETRIC_COLLECTION,
          stationSelectionBasis: "bbox_nearest_valid_level",
          ...(station.discharge !== undefined
            ? { dischargeCubicMetresPerSecond: station.discharge }
            : {}),
          ...(station.dischargeQualifier
            ? { dischargeQualifier: station.dischargeQualifier }
            : {}),
          serviceDisclosure: "Daily means and quality symbols may be revised by the source agency",
        },
      },
    };
  } catch (error) {
    return {
      kind: "source_failure",
      failureReason: error instanceof CanadaHydrometricError
        ? error.reason
        : "validation_failure",
    };
  }
}
