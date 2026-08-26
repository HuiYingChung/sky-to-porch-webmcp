import { createHash } from "crypto";
import sharp from "sharp";
import type { BoundingBox } from "@/contracts/common";
import { validateQueryArea } from "@/lib/location/query-area";
import {
  ATMOSPHERIC_IMAGE_SIZE,
  ATMOSPHERIC_MAX_BYTES,
  ATMOSPHERIC_TIMEOUT_MS,
  buildAtmosphericRequest,
  type PreparedAtmosphericSourceId,
} from "./atmospheric-source-contract";

type FetchLike = typeof fetch;
export const ATMOSPHERIC_CACHE_TTL_MS = 5 * 60 * 1_000;

export type AtmosphericFailureReason =
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "media_type"
  | "malformed"
  | "schema_validation"
  | "provider_failure";

export type AtmosphericSatelliteResult =
  | { kind: "observation"; observation: ValidatedAtmosphericObservation }
  | { kind: "no_observation"; payloadHash: string; sourceUrl: string }
  | { kind: "source_failure"; reason: AtmosphericFailureReason };

export interface AtmosphericLiveDependencies {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

/**
 * Pre-registry observation candidate. It deliberately is not assignable to
 * the product EvidenceObject Observation type while this source remains
 * deferred; the live gate and registry promotion must happen first.
 */
export interface ValidatedAtmosphericObservation {
  observationId: string;
  provenance: {
    sourceId: PreparedAtmosphericSourceId;
    sourceUrl: string;
    retrievedAt: string;
    observedAt: string;
    product: string;
    payloadHash: string;
    requestParameters: Record<string, string>;
  };
  variableName: string;
  textValue: string;
  dataMode: "live";
  qualifiers: string[];
  metadata: Record<string, string | number>;
}

class AtmosphericLiveError extends Error {
  constructor(readonly reason: AtmosphericFailureReason) {
    super(reason);
    this.name = "AtmosphericLiveError";
  }
}

const resultCache = new Map<string, {
  expiresAt: number;
  result: AtmosphericSatelliteResult;
}>();
let activeRequests = 0;
const requestWaiters: Array<() => void> = [];

async function withAtmosphericConcurrency<T>(work: () => Promise<T>): Promise<T> {
  if (activeRequests >= 2) {
    await new Promise<void>((resolve) => requestWaiters.push(resolve));
  }
  activeRequests += 1;
  try {
    return await work();
  } finally {
    activeRequests -= 1;
    requestWaiters.shift()?.();
  }
}

const SOURCE_DETAILS: Record<PreparedAtmosphericSourceId, {
  variableName: string;
  textValue: string;
  product: string;
  qualifiers: string[];
  role: string;
}> = {
  nasa_gibs_modis_aod: {
    variableName: "MAIAC aerosol optical depth visualization",
    textValue: "regional_aod_visualization_available",
    product: "MODIS Terra+Aqua MAIAC L2G Aerosol Optical Depth daily visualization",
    qualifiers: [
      "visualization_only",
      "numeric_aod_not_inferred",
      "aod_is_not_aqi",
      "outdoor_regional_context",
    ],
    role: "satellite_aerosol_optical_depth_visualization",
  },
  nasa_gibs_omps_so2: {
    variableName: "OMPS lower-troposphere sulfur dioxide visualization",
    textValue: "regional_so2_visualization_available",
    product: "NOAA-20 OMPS SO2 Lower Troposphere daily visualization",
    qualifiers: [
      "visualization_only",
      "numeric_so2_not_inferred",
      "eruption_cause_not_inferred",
      "prediction_not_supported",
    ],
    role: "satellite_sulfur_dioxide_visualization",
  },
};

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const statedLength = response.headers.get("content-length");
  if (statedLength !== null) {
    const length = Number(statedLength);
    if (!Number.isInteger(length) || length < 0 || length > ATMOSPHERIC_MAX_BYTES) {
      throw new AtmosphericLiveError("oversize");
    }
  }
  if (!response.body) throw new AtmosphericLiveError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > ATMOSPHERIC_MAX_BYTES) {
      await reader.cancel();
      throw new AtmosphericLiveError("oversize");
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

async function fetchPng(fetchImpl: FetchLike, url: URL): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATMOSPHERIC_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "image/png" },
      });
    } catch {
      throw new AtmosphericLiveError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) {
      throw new AtmosphericLiveError("redirect");
    }
    if (response.status === 429) throw new AtmosphericLiveError("rate_limited");
    if (!response.ok) throw new AtmosphericLiveError("provider_failure");
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "image/png") throw new AtmosphericLiveError("media_type");
    return await readBoundedBody(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectPng(bytes: Uint8Array): Promise<{
  alphaMaximum: number;
  opaqueSampleCount: number;
  distinctColorCount: number;
}> {
  try {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    if (
      metadata.format !== "png" ||
      metadata.width !== ATMOSPHERIC_IMAGE_SIZE ||
      metadata.height !== ATMOSPHERIC_IMAGE_SIZE
    ) {
      throw new AtmosphericLiveError("schema_validation");
    }
    const sample = await sharp(bytes, { failOn: "error" })
      .resize(16, 16, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();
    if (sample.length !== 16 * 16 * 4) {
      throw new AtmosphericLiveError("schema_validation");
    }
    let alphaMaximum = 0;
    let opaqueSampleCount = 0;
    const colors = new Set<string>();
    for (let index = 0; index < sample.length; index += 4) {
      const alpha = sample[index + 3];
      alphaMaximum = Math.max(alphaMaximum, alpha);
      if (alpha === 0) continue;
      opaqueSampleCount += 1;
      colors.add(`${sample[index]},${sample[index + 1]},${sample[index + 2]}`);
    }
    return { alphaMaximum, opaqueSampleCount, distinctColorCount: colors.size };
  } catch (error) {
    if (error instanceof AtmosphericLiveError) throw error;
    throw new AtmosphericLiveError("malformed");
  }
}

function hashArea(area: BoundingBox): string {
  return createHash("sha256")
    .update(`${area.west},${area.south},${area.east},${area.north}`)
    .digest("hex")
    .slice(0, 12);
}

/** Bounded live transport; deterministic tests inject mocked responses. */
export async function queryAtmosphericSatellite(
  sourceId: PreparedAtmosphericSourceId,
  date: string,
  value: unknown,
  dependencies: AtmosphericLiveDependencies = {}
): Promise<AtmosphericSatelliteResult> {
  const area = validateQueryArea(value);
  const prepared = buildAtmosphericRequest(sourceId, date, area);
  const url = new URL(prepared.url);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now?.() ?? new Date();
  const cacheEnabled = dependencies.fetchImpl === undefined;
  const cached = cacheEnabled ? resultCache.get(url.toString()) : undefined;
  if (cached && cached.expiresAt > now.getTime()) {
    return structuredClone(cached.result);
  }
  return withAtmosphericConcurrency(async () => {
    try {
      const bytes = await fetchPng(fetchImpl, url);
      const inspection = await inspectPng(bytes);
      const payloadHash = createHash("sha256").update(bytes).digest("hex");
      const details = SOURCE_DETAILS[sourceId];
      const result: AtmosphericSatelliteResult = inspection.alphaMaximum === 0
        ? { kind: "no_observation", payloadHash, sourceUrl: url.toString() }
        : {
            kind: "observation",
            observation: {
        observationId: `obs-${sourceId}-${hashArea(area)}-${date.replaceAll("-", "")}`,
        provenance: {
          sourceId,
          sourceUrl: url.toString(),
          retrievedAt: now.toISOString(),
          observedAt: `${date}T00:00:00Z`,
          product: details.product,
          payloadHash,
          requestParameters: Object.fromEntries(url.searchParams.entries()),
        },
        variableName: details.variableName,
        textValue: details.textValue,
        dataMode: "live",
        qualifiers: details.qualifiers,
        metadata: {
          atmosphericRole: details.role,
          layerId: prepared.layer,
          contentType: "image/png",
          imageWidth: ATMOSPHERIC_IMAGE_SIZE,
          imageHeight: ATMOSPHERIC_IMAGE_SIZE,
          byteLength: bytes.byteLength,
          opaqueSampleCount: inspection.opaqueSampleCount,
          distinctColorCount: inspection.distinctColorCount,
          boundingBox: `${area.west},${area.south},${area.east},${area.north}`,
          claimBoundary:
            sourceId === "nasa_gibs_modis_aod"
              ? "AOD is not AQI, PM2.5, indoor air quality, or personal exposure."
              : "SO2 imagery does not identify eruption cause, predict activity, or establish exposure.",
        },
            },
          };
      if (cacheEnabled) {
        resultCache.set(url.toString(), {
          expiresAt: now.getTime() + ATMOSPHERIC_CACHE_TTL_MS,
          result,
        });
      }
      return result;
    } catch (error) {
      return {
        kind: "source_failure",
        reason: error instanceof AtmosphericLiveError ? error.reason : "schema_validation",
      };
    }
  });
}
