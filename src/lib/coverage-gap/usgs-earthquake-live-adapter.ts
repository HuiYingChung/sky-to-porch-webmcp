import { createHash } from "node:crypto";
import type { BoundingBox } from "@/contracts/common";
import { validateQueryArea } from "@/lib/location/query-area";

export const USGS_EARTHQUAKE_HOST = "earthquake.usgs.gov";
export const USGS_EARTHQUAKE_PATH = "/fdsnws/event/1/query";
export const USGS_EARTHQUAKE_TIMEOUT_MS = 10_000;
export const USGS_EARTHQUAKE_MAX_BYTES = 4_000_000;
export const USGS_EARTHQUAKE_MAX_EVENTS = 2_000;

export type UsgsEarthquakeFailureReason =
  | "network"
  | "timeout"
  | "redirect"
  | "rate_limited"
  | "provider_failure"
  | "media_type"
  | "malformed"
  | "oversize"
  | "result_limit"
  | "schema_validation";

export type UsgsEarthquakeJsonType =
  | "array"
  | "boolean"
  | "missing"
  | "null"
  | "number"
  | "object"
  | "string";

export interface UsgsEarthquakeSchemaDiagnostic {
  path: string;
  expected: string;
  actualType: UsgsEarthquakeJsonType;
}

export interface UsgsEarthquakeObservation {
  observationId: string;
  provenance: {
    sourceId: "usgs_earthquake_geojson";
    sourceUrl: string;
    sourceRecordId: string;
    retrievedAt: string;
    observedAt: string;
    product: string;
    payloadHash: string;
    requestParameters: Record<string, string>;
  };
  variableName: "USGS observed earthquake event";
  value?: number;
  unit?: "magnitude";
  textValue?: "observed_earthquake_event_without_reported_magnitude";
  dataMode: "live";
  qualifiers: string[];
  metadata: Record<string, string | number | boolean>;
}

export type UsgsEarthquakeResult =
  | { kind: "observations"; observations: UsgsEarthquakeObservation[] }
  | { kind: "no_observation" }
  | {
      kind: "source_failure";
      reason: UsgsEarthquakeFailureReason;
      stage: "event_query";
      schemaDiagnostic?: UsgsEarthquakeSchemaDiagnostic;
    };

export interface UsgsEarthquakeDependencies {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

class UsgsEarthquakeError extends Error {
  constructor(
    readonly reason: UsgsEarthquakeFailureReason,
    readonly schemaDiagnostic?: UsgsEarthquakeSchemaDiagnostic
  ) {
    super(reason);
    this.name = "UsgsEarthquakeError";
  }
}

interface DayBounds {
  startIso: string;
  endInclusiveIso: string;
  startMs: number;
  endExclusiveMs: number;
}

interface ParsedEarthquakeEvent {
  id: string;
  place: string;
  magnitude: number | null;
  magnitudeType: string | null;
  observedAt: string;
  updatedAt: string;
  reviewStatus: "automatic" | "reviewed";
  longitude: number;
  latitude: number;
  depthKm: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonType(value: unknown): UsgsEarthquakeJsonType {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "object";
}

function schemaFailure(path: string, expected: string, actual: unknown): never {
  throw new UsgsEarthquakeError("schema_validation", {
    path,
    expected,
    actualType: jsonType(actual),
  });
}

function dayBounds(date: string): DayBounds {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new UsgsEarthquakeError("schema_validation");
  }
  const startMs = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || new Date(startMs).toISOString().slice(0, 10) !== date) {
    throw new UsgsEarthquakeError("schema_validation");
  }
  const endExclusiveMs = startMs + 86_400_000;
  return {
    startIso: new Date(startMs).toISOString(),
    endInclusiveIso: new Date(endExclusiveMs - 1).toISOString(),
    startMs,
    endExclusiveMs,
  };
}

export function buildUsgsEarthquakeQueryUrl(date: string, value: unknown): URL {
  const area = validateQueryArea(value);
  const bounds = dayBounds(date);
  const url = new URL(`https://${USGS_EARTHQUAKE_HOST}${USGS_EARTHQUAKE_PATH}`);
  url.search = new URLSearchParams({
    format: "geojson",
    starttime: bounds.startIso,
    endtime: bounds.endInclusiveIso,
    minlatitude: String(area.south),
    maxlatitude: String(area.north),
    minlongitude: String(area.west),
    maxlongitude: String(area.east),
    eventtype: "earthquake",
    orderby: "time-asc",
    limit: String(USGS_EARTHQUAKE_MAX_EVENTS),
    nodata: "204",
  }).toString();
  return url;
}

function isJsonMediaType(rawContentType: string): boolean {
  const base = rawContentType.split(";", 1)[0].trim().toLowerCase();
  return base === "application/json" ||
    /^application\/[a-z0-9!#$%&'*+\-.^_`|~]+\+json$/u.test(base);
}

async function readBody(response: Response): Promise<Uint8Array> {
  const rawLength = response.headers.get("content-length");
  if (rawLength !== null) {
    const length = Number(rawLength);
    if (!Number.isInteger(length) || length < 0 || length > USGS_EARTHQUAKE_MAX_BYTES) {
      throw new UsgsEarthquakeError("oversize");
    }
  }
  if (!response.body) throw new UsgsEarthquakeError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > USGS_EARTHQUAKE_MAX_BYTES) {
      await reader.cancel();
      throw new UsgsEarthquakeError("oversize");
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

function parseEpoch(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    schemaFailure(path, "safe integer epoch milliseconds", value);
  }
  return value;
}

function parseFeature(
  value: unknown,
  area: BoundingBox,
  bounds: DayBounds,
  seenIds: Set<string>
): ParsedEarthquakeEvent {
  if (!isRecord(value)) schemaFailure("$.features[]", "object", value);
  if (value.type !== "Feature") schemaFailure("$.features[].type", 'literal "Feature"', value.type);
  if (typeof value.id !== "string" || !/^[a-z0-9_-]{2,64}$/iu.test(value.id)) {
    schemaFailure("$.features[].id", "2-64 character event identifier", value.id);
  }
  if (seenIds.has(value.id)) {
    schemaFailure("$.features[].id", "unique event identifier", value.id);
  }
  if (!isRecord(value.properties)) {
    schemaFailure("$.features[].properties", "object", value.properties);
  }
  if (!isRecord(value.geometry)) {
    schemaFailure("$.features[].geometry", "object", value.geometry);
  }
  if (value.geometry.type !== "Point") {
    schemaFailure("$.features[].geometry.type", 'literal "Point"', value.geometry.type);
  }
  if (!Array.isArray(value.geometry.coordinates)) {
    schemaFailure("$.features[].geometry.coordinates", "three-number array", value.geometry.coordinates);
  }
  if (value.geometry.coordinates.length !== 3) {
    schemaFailure(
      "$.features[].geometry.coordinates.length",
      "exactly 3",
      value.geometry.coordinates.length
    );
  }
  seenIds.add(value.id);
  const properties = value.properties;
  const [longitude, latitude, depthKm] = value.geometry.coordinates;
  const observedMs = parseEpoch(properties.time, "$.features[].properties.time");
  const updatedMs = parseEpoch(properties.updated, "$.features[].properties.updated");
  const magnitude = properties.mag;
  const magnitudeType = properties.magType;
  if (properties.type !== "earthquake") {
    schemaFailure("$.features[].properties.type", 'literal "earthquake"', properties.type);
  }
  if (typeof properties.place !== "string" || properties.place.trim().length === 0 ||
    properties.place.length > 300) {
    schemaFailure("$.features[].properties.place", "non-empty string up to 300 characters", properties.place);
  }
  if (magnitude !== null &&
    (typeof magnitude !== "number" || !Number.isFinite(magnitude) || magnitude < -5 || magnitude > 12)) {
    schemaFailure("$.features[].properties.mag", "null or finite number in [-5, 12]", magnitude);
  }
  if (magnitudeType !== null &&
    (typeof magnitudeType !== "string" || magnitudeType.trim().length === 0 || magnitudeType.length > 24)) {
    schemaFailure(
      "$.features[].properties.magType",
      "null or non-empty string up to 24 characters",
      magnitudeType
    );
  }
  if (properties.status !== "automatic" && properties.status !== "reviewed") {
    schemaFailure(
      "$.features[].properties.status",
      'literal "automatic" or "reviewed"',
      properties.status
    );
  }
  if (typeof longitude !== "number" || !Number.isFinite(longitude)) {
    schemaFailure("$.features[].geometry.coordinates[0]", "finite longitude", longitude);
  }
  if (typeof latitude !== "number" || !Number.isFinite(latitude)) {
    schemaFailure("$.features[].geometry.coordinates[1]", "finite latitude", latitude);
  }
  if (typeof depthKm !== "number" || !Number.isFinite(depthKm) || depthKm < -100 || depthKm > 1_000) {
    schemaFailure("$.features[].geometry.coordinates[2]", "finite depth in [-100, 1000] km", depthKm);
  }
  if (longitude < area.west || longitude > area.east) {
    schemaFailure("$.features[].geometry.coordinates[0]", "longitude within requested bounds", longitude);
  }
  if (latitude < area.south || latitude > area.north) {
    schemaFailure("$.features[].geometry.coordinates[1]", "latitude within requested bounds", latitude);
  }
  if (observedMs < bounds.startMs || observedMs >= bounds.endExclusiveMs) {
    schemaFailure("$.features[].properties.time", "epoch within requested UTC day", observedMs);
  }
  if (updatedMs < observedMs) {
    schemaFailure("$.features[].properties.updated", "epoch at or after event time", updatedMs);
  }
  return {
    id: value.id,
    place: properties.place.trim(),
    magnitude: magnitude as number | null,
    magnitudeType: magnitudeType === null ? null : (magnitudeType as string).trim(),
    observedAt: new Date(observedMs).toISOString(),
    updatedAt: new Date(updatedMs).toISOString(),
    reviewStatus: properties.status,
    longitude,
    latitude,
    depthKm,
  };
}

function parseFeatureCollection(
  value: unknown,
  area: BoundingBox,
  bounds: DayBounds
): ParsedEarthquakeEvent[] {
  if (!isRecord(value)) schemaFailure("$", "object", value);
  if (value.type !== "FeatureCollection") {
    schemaFailure("$.type", 'literal "FeatureCollection"', value.type);
  }
  if (!isRecord(value.metadata)) schemaFailure("$.metadata", "object", value.metadata);
  if (!Array.isArray(value.features)) schemaFailure("$.features", "array", value.features);
  const { metadata, features } = value;
  if (typeof metadata.generated !== "number" || !Number.isSafeInteger(metadata.generated)) {
    schemaFailure("$.metadata.generated", "safe integer epoch milliseconds", metadata.generated);
  }
  // FDSN GeoJSON documents count, but the observed query response may omit
  // this redundant member. When present it must still match the bounded array.
  if (metadata.count !== undefined) {
    if (typeof metadata.count !== "number" || !Number.isSafeInteger(metadata.count) ||
      metadata.count < 0) {
      schemaFailure("$.metadata.count", "safe non-negative integer", metadata.count);
    }
    if (metadata.count !== features.length) {
      schemaFailure("$.metadata.count", "equal to $.features.length", metadata.count);
    }
  }
  if (metadata.status !== 200) {
    schemaFailure("$.metadata.status", "numeric HTTP status 200", metadata.status);
  }
  if (features.length >= USGS_EARTHQUAKE_MAX_EVENTS) {
    throw new UsgsEarthquakeError("result_limit");
  }
  const seenIds = new Set<string>();
  return features.map((feature) => parseFeature(feature, area, bounds, seenIds));
}

async function requestFeatureCollection(
  fetchImpl: typeof fetch,
  url: URL
): Promise<{ bytes: Uint8Array; value: unknown } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), USGS_EARTHQUAKE_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new UsgsEarthquakeError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status === 204) return null;
    if (response.status >= 300 && response.status < 400) throw new UsgsEarthquakeError("redirect");
    if (response.status === 429) throw new UsgsEarthquakeError("rate_limited");
    if (!response.ok) throw new UsgsEarthquakeError("provider_failure");
    if (!isJsonMediaType(response.headers.get("content-type") ?? "")) {
      throw new UsgsEarthquakeError("media_type");
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBody(response);
    } catch (error) {
      if (error instanceof UsgsEarthquakeError) throw error;
      throw new UsgsEarthquakeError(controller.signal.aborted ? "timeout" : "network");
    }
    try {
      return {
        bytes,
        value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      };
    } catch {
      throw new UsgsEarthquakeError("malformed");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryUsgsEarthquakeEvents(
  date: string,
  value: unknown,
  dependencies: UsgsEarthquakeDependencies = {}
): Promise<UsgsEarthquakeResult> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now?.() ?? new Date();
  try {
    const area = validateQueryArea(value);
    const bounds = dayBounds(date);
    const url = buildUsgsEarthquakeQueryUrl(date, area);
    if (url.protocol !== "https:" || url.hostname !== USGS_EARTHQUAKE_HOST ||
      url.pathname !== USGS_EARTHQUAKE_PATH) {
      throw new UsgsEarthquakeError("schema_validation");
    }
    const response = await requestFeatureCollection(fetchImpl, url);
    if (response === null) return { kind: "no_observation" };
    const events = parseFeatureCollection(response.value, area, bounds);
    if (events.length === 0) return { kind: "no_observation" };
    const payloadHash = createHash("sha256").update(response.bytes).digest("hex");
    const requestParameters = {
      date,
      bbox: `${area.west},${area.south},${area.east},${area.north}`,
      eventtype: "earthquake",
      format: "geojson",
    };
    return {
      kind: "observations",
      observations: events.map((event): UsgsEarthquakeObservation => ({
        observationId: `obs-usgs-earthquake-${createHash("sha256").update(event.id).digest("hex").slice(0, 16)}`,
        provenance: {
          sourceId: "usgs_earthquake_geojson",
          sourceUrl: `https://${USGS_EARTHQUAKE_HOST}/earthquakes/eventpage/${encodeURIComponent(event.id)}`,
          sourceRecordId: event.id,
          retrievedAt: now.toISOString(),
          observedAt: event.observedAt,
          product: "USGS FDSN Earthquake Catalog GeoJSON",
          payloadHash,
          requestParameters,
        },
        variableName: "USGS observed earthquake event",
        ...(event.magnitude === null
          ? { textValue: "observed_earthquake_event_without_reported_magnitude" as const }
          : { value: event.magnitude, unit: "magnitude" as const }),
        dataMode: "live",
        qualifiers: [
          "observed_event_not_prediction",
          "no_eruption_causality",
          event.reviewStatus === "reviewed" ? "reviewed_event" : "automatic_or_preliminary_event",
        ],
        metadata: {
          place: event.place,
          longitude: event.longitude,
          latitude: event.latitude,
          depthKm: event.depthKm,
          reviewStatus: event.reviewStatus,
          updatedAt: event.updatedAt,
          eventType: "earthquake",
          ...(event.magnitudeType ? { magnitudeType: event.magnitudeType } : {}),
        },
      })),
    };
  } catch (error) {
    return {
      kind: "source_failure",
      reason: error instanceof UsgsEarthquakeError ? error.reason : "schema_validation",
      stage: "event_query",
      ...(error instanceof UsgsEarthquakeError && error.schemaDiagnostic
        ? { schemaDiagnostic: error.schemaDiagnostic }
        : {}),
    };
  }
}
