import { createHash } from "node:crypto";
import type { BoundingBox } from "@/contracts/common";
import {
  WILDFIRE_LAYER_PRODUCT,
  WILDFIRE_LAYER_SOURCE_ID,
  type WildfireLayerErrorCode,
  type WildfireLayerResult,
  type WildfirePointFeature,
  type WildfireProcessing,
} from "@/contracts/wildfire-layer";
import { validateQueryArea } from "@/lib/location/query-area";

const FIRMS_HOST = "firms.modaps.eosdis.nasa.gov";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FEATURES = 5000;
const TIMEOUT_MS = 15_000;
export const FIRMS_LAYER_SERVER_CACHE_TTL_MS = 2 * 60_000;
export const FIRMS_LAYER_SERVER_CACHE_MAX_ENTRIES = 32;
export const FIRMS_LAYER_SERVER_MAX_CONCURRENCY = 2;
export const FIRMS_LAYER_SERVER_RATE_WINDOW_MS = 10 * 60_000;
export const FIRMS_LAYER_SERVER_MAX_REQUESTS_PER_WINDOW = 10;

export interface FirmsNrtDependencies {
  fetch: typeof globalThis.fetch;
  nowIso: () => string;
  mapKey?: string;
}

export type FirmsNrtLayerOutcome =
  | { kind: "success"; result: WildfireLayerResult }
  | { kind: "failure"; error: Exclude<WildfireLayerErrorCode, "invalid_input"> };

const serverCache = new Map<string, { expiresAt: number; outcome: FirmsNrtLayerOutcome }>();
const serverInFlight = new Map<string, Promise<FirmsNrtLayerOutcome>>();
let activeServerRequests = 0;
const serverRequestStarts: number[] = [];

function cacheKey(date: string, area: BoundingBox): string {
  return [date, area.west, area.south, area.east, area.north].join(",");
}

/** ADR-0040 (Bug F): the requested UTC detection day must be real and completed. */
function validateWildfireDate(date: string, nowMs: number): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    return false;
  }
  return parsed < nowMs;
}

function storeServerResult(key: string, outcome: FirmsNrtLayerOutcome, nowMs: number): void {
  for (const [cachedKey, entry] of serverCache) {
    if (entry.expiresAt <= nowMs) serverCache.delete(cachedKey);
  }
  while (serverCache.size >= FIRMS_LAYER_SERVER_CACHE_MAX_ENTRIES) {
    const oldest = serverCache.keys().next().value as string | undefined;
    if (!oldest) break;
    serverCache.delete(oldest);
  }
  serverCache.set(key, { expiresAt: nowMs + FIRMS_LAYER_SERVER_CACHE_TTL_MS, outcome });
}

const REQUIRED_COLUMNS = [
  "latitude",
  "longitude",
  "acq_date",
  "acq_time",
  "satellite",
  "instrument",
  "confidence",
  "version",
  "frp",
  "daynight",
] as const;

/**
 * ADR-0040 (Bug F): the FIRMS area API accepts /{DAY_RANGE}/{DATE} where the
 * window runs FORWARD from DATE (verified against the official docs on
 * 2026-08-19), so /1/{date} returns exactly the requested UTC detection day
 * instead of the previously hardcoded "most recent day".
 */
function buildFirmsNrtUrl(mapKey: string, area: BoundingBox, date: string): URL {
  const areaText = `${area.west},${area.south},${area.east},${area.north}`;
  const url = new URL(
    `https://${FIRMS_HOST}/api/area/csv/${encodeURIComponent(mapKey)}/` +
    `${WILDFIRE_LAYER_PRODUCT}/${areaText}/1/${date}`
  );
  if (url.protocol !== "https:" || url.hostname !== FIRMS_HOST) {
    throw new Error("FIRMS URL outside exact allowlist");
  }
  return url;
}

async function readBoundedText(response: Response): Promise<string> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_BYTES) {
      throw new Error("response_too_large");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function processingFromVersion(version: string): WildfireProcessing {
  if (version.endsWith("URT")) return "ultra_real_time";
  if (version.endsWith("NRT")) return "near_real_time";
  if (version.endsWith("RT")) return "real_time";
  return "unknown";
}

function parseAcquiredAt(
  date: string,
  time: string,
  retrievedAt: string,
  requestedDate: string
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !/^\d{4}$/u.test(time)) {
    throw new Error("schema_validation");
  }
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  if (hour > 23 || minute > 59) throw new Error("schema_validation");
  const acquiredAt = `${date}T${time.slice(0, 2)}:${time.slice(2, 4)}:00Z`;
  const acquiredMs = Date.parse(acquiredAt);
  const retrievedMs = Date.parse(retrievedAt);
  // ADR-0040 (Bug F): a /1/{date} request returns exactly that UTC day, so
  // every row must belong to it and none may postdate the retrieval.
  if (
    !Number.isFinite(acquiredMs) || !Number.isFinite(retrievedMs) ||
    new Date(acquiredMs).toISOString().slice(0, 10) !== date ||
    date !== requestedDate ||
    acquiredMs > retrievedMs + 5 * 60_000
  ) throw new Error("schema_validation");
  return acquiredAt;
}

function confidenceLabel(value: string): "low" | "nominal" | "high" {
  if (value === "l") return "low";
  if (value === "n") return "nominal";
  if (value === "h") return "high";
  throw new Error("schema_validation");
}

export function parseFirmsNrtCsv(
  text: string,
  area: BoundingBox,
  retrievedAt: string,
  requestedDate: string
): WildfirePointFeature[] {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error("schema_validation");
  const header = lines[0].split(",").map((column) => column.trim().toLowerCase());
  if (new Set(header).size !== header.length) throw new Error("schema_validation");
  const indexes = Object.fromEntries(REQUIRED_COLUMNS.map((column) => [column, header.indexOf(column)]));
  if (REQUIRED_COLUMNS.some((column) => indexes[column] === -1)) {
    throw new Error("schema_validation");
  }
  if (lines.length - 1 > MAX_FEATURES) throw new Error("response_too_large");

  return lines.slice(1).map((line, rowIndex) => {
    const columns = line.split(",");
    if (columns.length !== header.length) throw new Error("schema_validation");
    const read = (column: typeof REQUIRED_COLUMNS[number]) => columns[indexes[column]].trim();
    const latitude = Number(read("latitude"));
    const longitude = Number(read("longitude"));
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < area.south || latitude > area.north ||
      longitude < area.west || longitude > area.east
    ) throw new Error("schema_validation");
    if (read("satellite") !== "N20" || read("instrument") !== "VIIRS") {
      throw new Error("schema_validation");
    }
    const version = read("version");
    if (!/^\d+(?:\.\d+)?(?:URT|RT|NRT)?$/u.test(version)) throw new Error("schema_validation");
    const frpMw = Number(read("frp"));
    if (!Number.isFinite(frpMw) || frpMw < 0) throw new Error("schema_validation");
    const dayNightCode = read("daynight");
    if (dayNightCode !== "D" && dayNightCode !== "N") throw new Error("schema_validation");
    const acquiredAt = parseAcquiredAt(read("acq_date"), read("acq_time"), retrievedAt, requestedDate);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [longitude, latitude] },
      properties: {
        detectionId: `${WILDFIRE_LAYER_PRODUCT}:${acquiredAt}:${latitude.toFixed(5)}:${longitude.toFixed(5)}:${rowIndex}`,
        acquiredAt,
        satellite: "N20",
        instrument: "VIIRS",
        confidence: confidenceLabel(read("confidence")),
        processing: processingFromVersion(version),
        version,
        frpMw,
        dayNight: dayNightCode === "D" ? "day" : "night",
      },
    } satisfies WildfirePointFeature;
  });
}

export async function queryFirmsNrtLayer(
  date: string,
  areaInput: BoundingBox,
  deps: FirmsNrtDependencies
): Promise<FirmsNrtLayerOutcome> {
  let area: BoundingBox;
  try {
    area = validateQueryArea(areaInput);
  } catch {
    return { kind: "failure", error: "schema_validation" };
  }
  const mapKey = deps.mapKey ?? process.env.FIRMS_MAP_KEY;
  if (!mapKey || mapKey.trim().length === 0) {
    return { kind: "failure", error: "unconfigured" };
  }
  const retrievedAt = deps.nowIso();
  if (!Number.isFinite(Date.parse(retrievedAt))) {
    return { kind: "failure", error: "schema_validation" };
  }
  if (!validateWildfireDate(date, Date.parse(retrievedAt))) {
    return { kind: "failure", error: "schema_validation" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await deps.fetch(buildFirmsNrtUrl(mapKey, area, date), {
        method: "GET",
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/csv" },
      });
    } catch {
      return { kind: "failure", error: "source_failure" };
    }
    if (response.status === 429) return { kind: "failure", error: "rate_limited" };
    if (response.status >= 300 && response.status < 400) {
      return { kind: "failure", error: "source_failure" };
    }
    if (!response.ok) return { kind: "failure", error: "source_failure" };
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!["text/csv", "application/csv", "text/plain"].includes(contentType)) {
      return { kind: "failure", error: "schema_validation" };
    }
    let text: string;
    try {
      text = await readBoundedText(response);
    } catch (error) {
      return {
        kind: "failure",
        error: error instanceof Error && error.message === "response_too_large"
          ? "response_too_large"
          : "schema_validation",
      };
    }
    let features: WildfirePointFeature[];
    try {
      features = parseFirmsNrtCsv(text, area, retrievedAt, date);
    } catch (error) {
      return {
        kind: "failure",
        error: error instanceof Error && error.message === "response_too_large"
          ? "response_too_large"
          : "schema_validation",
      };
    }
    const latestAcquiredAt = features.reduce<string | null>(
      (latest, feature) => !latest || feature.properties.acquiredAt > latest
        ? feature.properties.acquiredAt
        : latest,
      null
    );
    return {
      kind: "success",
      result: {
        sourceId: WILDFIRE_LAYER_SOURCE_ID,
        sourceUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
        product: WILDFIRE_LAYER_PRODUCT,
        dataMode: "live",
        evidenceState: features.length > 0 ? "observations_returned" : "no_observation",
        retrievedAt,
        latestAcquiredAt,
        requestArea: area,
        featureCollection: { type: "FeatureCollection", features },
        payloadHash: createHash("sha256").update(text).digest("hex"),
        limitations: [
          "Hotspots are satellite pixel detections, not wildfire perimeters or counts of distinct fires.",
          "Cloud, canopy, small or cool fires, and satellite timing can cause missed detections; no detection is not evidence of no fire or no danger.",
          "This layer does not establish property damage, air quality, route safety, evacuation need, or official incident status.",
        ],
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Process-local cache/coalescing/concurrency guard for the private-key map route. */
export async function queryFirmsNrtLayerGuarded(
  date: string,
  areaInput: BoundingBox,
  deps: FirmsNrtDependencies
): Promise<FirmsNrtLayerOutcome> {
  let area: BoundingBox;
  try {
    area = validateQueryArea(areaInput);
  } catch {
    return { kind: "failure", error: "schema_validation" };
  }
  const key = cacheKey(date, area);
  const nowIso = deps.nowIso();
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return { kind: "failure", error: "schema_validation" };
  const cached = serverCache.get(key);
  if (cached && cached.expiresAt > nowMs) return structuredClone(cached.outcome);
  const pending = serverInFlight.get(key);
  if (pending) return pending;
  while (serverRequestStarts[0] !== undefined && serverRequestStarts[0] <= nowMs - FIRMS_LAYER_SERVER_RATE_WINDOW_MS) {
    serverRequestStarts.shift();
  }
  if (serverRequestStarts.length >= FIRMS_LAYER_SERVER_MAX_REQUESTS_PER_WINDOW) {
    return { kind: "failure", error: "rate_limited" };
  }
  if (activeServerRequests >= FIRMS_LAYER_SERVER_MAX_CONCURRENCY) {
    return { kind: "failure", error: "rate_limited" };
  }

  serverRequestStarts.push(nowMs);
  activeServerRequests += 1;
  const request = queryFirmsNrtLayer(date, area, { ...deps, nowIso: () => nowIso }).then((outcome) => {
    if (outcome.kind === "success") storeServerResult(key, outcome, nowMs);
    return outcome;
  }).finally(() => {
    activeServerRequests -= 1;
    serverInFlight.delete(key);
  });
  serverInFlight.set(key, request);
  return request;
}

export function clearFirmsNrtLayerServerStateForTests(): void {
  serverCache.clear();
  serverInFlight.clear();
  activeServerRequests = 0;
  serverRequestStarts.length = 0;
}
