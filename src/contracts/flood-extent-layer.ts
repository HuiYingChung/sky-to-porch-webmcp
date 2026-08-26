import type { BoundingBox } from "./common";

export const FLOOD_EXTENT_LAYER_SOURCE_ID = "nasa_lance_flood_extent" as const;
export const FLOOD_EXTENT_LAYER_PRODUCT = "VIIRS_Combined_Flood_3-Day" as const;
export const FLOOD_EXTENT_LAYER_SOURCE_URL =
  "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi" as const;

export interface FloodExtentLayerResult {
  sourceId: typeof FLOOD_EXTENT_LAYER_SOURCE_ID;
  sourceUrl: typeof FLOOD_EXTENT_LAYER_SOURCE_URL;
  product: typeof FLOOD_EXTENT_LAYER_PRODUCT;
  dataMode: "live";
  evidenceState: "observations_returned" | "no_observation";
  retrievedAt: string;
  observedDate: string | null;
  requestArea: BoundingBox;
  imageDataUrl: string | null;
  imageWidth: 512;
  imageHeight: 512;
  payloadHash: string;
  claimBoundary: string;
  limitations: string[];
}

export type FloodExtentLayerErrorCode =
  | "invalid_input"
  | "source_failure"
  | "rate_limited"
  | "timeout"
  | "schema_validation"
  | "response_too_large";

export type FloodExtentLayerEnvelope =
  | { ok: true; result: FloodExtentLayerResult }
  | { ok: false; error: FloodExtentLayerErrorCode };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function isBoundingBox(value: unknown): value is BoundingBox {
  if (!isRecord(value) || !hasExactKeys(value, ["west", "south", "east", "north"])) return false;
  const { west, south, east, north } = value;
  return (
    typeof west === "number" && Number.isFinite(west) && west >= -180 && west < 180 &&
    typeof east === "number" && Number.isFinite(east) && east > -180 && east <= 180 &&
    typeof south === "number" && Number.isFinite(south) && south >= -90 && south < 90 &&
    typeof north === "number" && Number.isFinite(north) && north > -90 && north <= 90 &&
    west < east && south < north
  );
}

function isPngDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 2_700_000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)
  );
}

export function parseFloodExtentLayerEnvelope(value: unknown): FloodExtentLayerEnvelope | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  if (value.ok === false) {
    if (!hasExactKeys(value, ["ok", "error"])) return null;
    const errors: FloodExtentLayerErrorCode[] = [
      "invalid_input",
      "source_failure",
      "rate_limited",
      "timeout",
      "schema_validation",
      "response_too_large",
    ];
    return errors.includes(value.error as FloodExtentLayerErrorCode)
      ? { ok: false, error: value.error as FloodExtentLayerErrorCode }
      : null;
  }

  if (!hasExactKeys(value, ["ok", "result"]) || !isRecord(value.result)) return null;
  const result = value.result;
  if (!hasExactKeys(result, [
    "sourceId",
    "sourceUrl",
    "product",
    "dataMode",
    "evidenceState",
    "retrievedAt",
    "observedDate",
    "requestArea",
    "imageDataUrl",
    "imageWidth",
    "imageHeight",
    "payloadHash",
    "claimBoundary",
    "limitations",
  ])) return null;

  const state = result.evidenceState;
  const image = result.imageDataUrl;
  if (
    result.sourceId !== FLOOD_EXTENT_LAYER_SOURCE_ID ||
    result.sourceUrl !== FLOOD_EXTENT_LAYER_SOURCE_URL ||
    result.product !== FLOOD_EXTENT_LAYER_PRODUCT ||
    result.dataMode !== "live" ||
    (state !== "observations_returned" && state !== "no_observation") ||
    !isIsoTimestamp(result.retrievedAt) ||
    !isBoundingBox(result.requestArea) ||
    result.imageWidth !== 512 ||
    result.imageHeight !== 512 ||
    typeof result.payloadHash !== "string" || !/^[a-f0-9]{64}$/u.test(result.payloadHash) ||
    typeof result.claimBoundary !== "string" || result.claimBoundary.length === 0 || result.claimBoundary.length > 500 ||
    !Array.isArray(result.limitations) || result.limitations.length < 2 ||
    !result.limitations.every((item) => typeof item === "string" && item.length > 0 && item.length <= 500)
  ) return null;

  if (
    (state === "observations_returned" && (!isDate(result.observedDate) || !isPngDataUrl(image))) ||
    (state === "no_observation" && (result.observedDate !== null || image !== null))
  ) return null;

  return { ok: true, result: result as unknown as FloodExtentLayerResult };
}
