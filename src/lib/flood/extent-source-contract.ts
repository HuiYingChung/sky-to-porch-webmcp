import sharp from "sharp";
import type { BoundingBox } from "@/contracts/common";
import { QUERYABLE_SOURCE_IDS } from "@/contracts/dataset-registry";
import { getRegistryEntry } from "@/data/dataset-registry";
import { validateQueryArea } from "@/lib/location/query-area";

export const FLOOD_EXTENT_SOURCE_ID = "nasa_lance_flood_extent" as const;
export const FLOOD_EXTENT_GIBS_HOST = "gibs.earthdata.nasa.gov";
export const FLOOD_EXTENT_GIBS_PATH = "/wms/epsg4326/best/wms.cgi";
export const FLOOD_EXTENT_LAYER = "VIIRS_Combined_Flood_3-Day";
export const FLOOD_EXTENT_IMAGE_SIZE = 512;
export const FLOOD_EXTENT_MAX_BYTES = 2_000_000;
export const FLOOD_EXTENT_TIMEOUT_MS = 10_000;
export const FLOOD_EXTENT_MAX_CONCURRENCY = 2;

export interface FloodExtentRequest {
  sourceId: typeof FLOOD_EXTENT_SOURCE_ID;
  url: string;
  timeoutMs: typeof FLOOD_EXTENT_TIMEOUT_MS;
  maximumBytes: typeof FLOOD_EXTENT_MAX_BYTES;
  acceptedContentTypes: readonly ["image/png"];
  requestCount: 1;
  externalCallsEnabled: true;
}

export interface PreparedFloodExtentInspection {
  outcome: "visualization_returned" | "no_observation";
  width: typeof FLOOD_EXTENT_IMAGE_SIZE;
  height: typeof FLOOD_EXTENT_IMAGE_SIZE;
  contentHashPending: true;
  alphaMaximum: number;
  legendStatus: "unvalidated";
  claimBoundary: string;
}

export class FloodExtentContractError extends Error {
  constructor(
    readonly reason:
      | "invalid_date"
      | "invalid_area"
      | "oversize"
      | "malformed"
      | "schema_validation"
      | "prepared_source_not_queryable"
  ) {
    super(reason);
    this.name = "FloodExtentContractError";
  }
}

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new FloodExtentContractError("invalid_date");
  }
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    throw new FloodExtentContractError("invalid_date");
  }
}

function validatedArea(value: unknown): BoundingBox {
  try {
    return validateQueryArea(value);
  } catch {
    throw new FloodExtentContractError("invalid_area");
  }
}

/** Builds the allowlisted live request for the selected VIIRS flood visualization. */
export function buildFloodExtentRequest(
  date: string,
  area: unknown
): FloodExtentRequest {
  validateDate(date);
  const box = validatedArea(area);
  const url = new URL(`https://${FLOOD_EXTENT_GIBS_HOST}${FLOOD_EXTENT_GIBS_PATH}`);
  const parameters: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    LAYERS: FLOOD_EXTENT_LAYER,
    SRS: "EPSG:4326",
    STYLES: "",
    WIDTH: String(FLOOD_EXTENT_IMAGE_SIZE),
    HEIGHT: String(FLOOD_EXTENT_IMAGE_SIZE),
    TIME: date,
    BBOX: `${box.west},${box.south},${box.east},${box.north}`,
  };
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  assertFloodExtentUrl(url);
  return {
    sourceId: FLOOD_EXTENT_SOURCE_ID,
    url: url.toString(),
    timeoutMs: FLOOD_EXTENT_TIMEOUT_MS,
    maximumBytes: FLOOD_EXTENT_MAX_BYTES,
    acceptedContentTypes: ["image/png"],
    requestCount: 1,
    externalCallsEnabled: true,
  };
}

export function assertFloodExtentUrl(value: URL): void {
  const expectedKeys = [
    "BBOX",
    "FORMAT",
    "HEIGHT",
    "LAYERS",
    "REQUEST",
    "SERVICE",
    "SRS",
    "STYLES",
    "TIME",
    "TRANSPARENT",
    "VERSION",
    "WIDTH",
  ];
  const actualKeys = [...value.searchParams.keys()].sort();
  if (
    value.protocol !== "https:" ||
    value.hostname !== FLOOD_EXTENT_GIBS_HOST ||
    value.pathname !== FLOOD_EXTENT_GIBS_PATH ||
    JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)
  ) {
    throw new FloodExtentContractError("schema_validation");
  }
  if (
    value.searchParams.get("SERVICE") !== "WMS" ||
    value.searchParams.get("VERSION") !== "1.1.1" ||
    value.searchParams.get("REQUEST") !== "GetMap" ||
    value.searchParams.get("FORMAT") !== "image/png" ||
    value.searchParams.get("TRANSPARENT") !== "true" ||
    value.searchParams.get("LAYERS") !== FLOOD_EXTENT_LAYER ||
    value.searchParams.get("SRS") !== "EPSG:4326" ||
    value.searchParams.get("STYLES") !== "" ||
    value.searchParams.get("WIDTH") !== String(FLOOD_EXTENT_IMAGE_SIZE) ||
    value.searchParams.get("HEIGHT") !== String(FLOOD_EXTENT_IMAGE_SIZE)
  ) {
    throw new FloodExtentContractError("schema_validation");
  }
}

/**
 * Validates mocked or previously authorized response bytes. A non-transparent
 * PNG proves only that the named flood-extent visualization returned. Until
 * the official legend and category semantics pass a bounded live gate, this
 * function does not classify pixels or create product evidence.
 */
export async function inspectPreparedFloodExtentPng(
  bytes: Uint8Array
): Promise<PreparedFloodExtentInspection> {
  if (bytes.byteLength > FLOOD_EXTENT_MAX_BYTES) {
    throw new FloodExtentContractError("oversize");
  }
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  let alphaMaximum: number;
  try {
    metadata = await sharp(bytes, { failOn: "error" }).metadata();
    const stats = await sharp(bytes, { failOn: "error" }).ensureAlpha().stats();
    alphaMaximum = stats.channels[3]?.max ?? 255;
  } catch {
    throw new FloodExtentContractError("malformed");
  }
  if (
    metadata.format !== "png" ||
    metadata.width !== FLOOD_EXTENT_IMAGE_SIZE ||
    metadata.height !== FLOOD_EXTENT_IMAGE_SIZE
  ) {
    throw new FloodExtentContractError("schema_validation");
  }
  const noObservation = alphaMaximum === 0;
  return {
    outcome: noObservation ? "no_observation" : "visualization_returned",
    width: FLOOD_EXTENT_IMAGE_SIZE,
    height: FLOOD_EXTENT_IMAGE_SIZE,
    contentHashPending: true,
    alphaMaximum,
    legendStatus: "unvalidated",
    claimBoundary: noObservation
      ? "A transparent response is no observation, not no flood and not no danger."
      : "A visualization response is not a validated pixel classification, flood depth, property impact, road closure, or evacuation instruction.",
  };
}

export function getFloodExtentReadiness(): {
  registryDecision: "go";
  supportedDataModes: readonly ["live", "fixture", "historical"];
  productQueryable: true;
  reason: string;
} {
  const entry = getRegistryEntry(FLOOD_EXTENT_SOURCE_ID);
  const queryable = (QUERYABLE_SOURCE_IDS as readonly string[]).includes(
    FLOOD_EXTENT_SOURCE_ID
  );
  if (
    !entry ||
    entry.decision !== "go" ||
    JSON.stringify(entry.supportedDataModes) !== JSON.stringify(["live", "fixture", "historical"]) ||
    !queryable
  ) {
    throw new FloodExtentContractError("prepared_source_not_queryable");
  }
  return {
    registryDecision: "go",
    supportedDataModes: ["live", "fixture", "historical"],
    productQueryable: true,
    reason:
      "Bounded live feasibility validated the exact VIIRS 3-day WMS product and transparent no-observation state; legend colors remain uninterpreted.",
  };
}

/** @deprecated Compatibility aliases for pre-live contract callers. */
export const buildPreparedFloodExtentRequest = buildFloodExtentRequest;
export const assertPreparedFloodExtentUrl = assertFloodExtentUrl;
export const getPreparedFloodExtentReadiness = getFloodExtentReadiness;
