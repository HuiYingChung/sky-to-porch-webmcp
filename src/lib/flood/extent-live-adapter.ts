import { createHash } from "crypto";
import type { BoundingBox } from "@/contracts/common";
import { validateQueryArea } from "@/lib/location/query-area";
import {
  FLOOD_EXTENT_MAX_BYTES,
  FLOOD_EXTENT_MAX_CONCURRENCY,
  FLOOD_EXTENT_TIMEOUT_MS,
  buildFloodExtentRequest,
  inspectPreparedFloodExtentPng,
} from "./extent-source-contract";

type FetchLike = typeof fetch;

export type FloodExtentFailureReason =
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "media_type"
  | "malformed"
  | "schema_validation"
  | "provider_failure";

export type FloodExtentResult =
  | {
      kind: "observation";
      observation: ValidatedFloodExtentObservation;
      visualization?: FloodExtentVisualization;
    }
  | {
      kind: "no_observation";
      observation: ValidatedFloodExtentObservation;
      payloadHash: string;
      sourceUrl: string;
    }
  | { kind: "source_failure"; reason: FloodExtentFailureReason };

export const FLOOD_EXTENT_CACHE_TTL_MS = 5 * 60 * 1_000;
export const FLOOD_EXTENT_CACHE_MAX_ENTRIES = 24;
const resultCache = new Map<string, { expiresAt: number; result: FloodExtentResult }>();
let activeRequests = 0;
const requestWaiters: Array<() => void> = [];

async function withFloodExtentConcurrency<T>(work: () => Promise<T>): Promise<T> {
  if (activeRequests >= FLOOD_EXTENT_MAX_CONCURRENCY) {
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

export interface FloodExtentLiveDependencies {
  fetchImpl?: FetchLike;
  now?: () => Date;
  includeVisualization?: boolean;
}

export interface FloodExtentVisualization {
  imageDataUrl: string;
  byteLength: number;
}

function cacheResult(key: string, result: FloodExtentResult, nowMs: number): void {
  for (const [cachedKey, entry] of resultCache) {
    if (entry.expiresAt <= nowMs) resultCache.delete(cachedKey);
  }
  while (resultCache.size >= FLOOD_EXTENT_CACHE_MAX_ENTRIES) {
    const oldest = resultCache.keys().next().value as string | undefined;
    if (!oldest) break;
    resultCache.delete(oldest);
  }
  resultCache.set(key, { expiresAt: nowMs + FLOOD_EXTENT_CACHE_TTL_MS, result });
}

/** Product observation after the bounded live gate promoted the source. */
export interface ValidatedFloodExtentObservation {
  observationId: string;
  provenance: {
    sourceId: "nasa_lance_flood_extent";
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

class FloodExtentLiveError extends Error {
  constructor(readonly reason: FloodExtentFailureReason) {
    super(reason);
    this.name = "FloodExtentLiveError";
  }
}

async function readBody(response: Response): Promise<Uint8Array> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isInteger(length) || length < 0 || length > FLOOD_EXTENT_MAX_BYTES) {
      throw new FloodExtentLiveError("oversize");
    }
  }
  if (!response.body) throw new FloodExtentLiveError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > FLOOD_EXTENT_MAX_BYTES) {
      await reader.cancel();
      throw new FloodExtentLiveError("oversize");
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

/** Bounded fail-closed transport; deterministic tests inject mocked responses. */
export async function queryFloodExtent(
  date: string,
  value: unknown,
  dependencies: FloodExtentLiveDependencies = {}
): Promise<FloodExtentResult> {
  const area: BoundingBox = validateQueryArea(value);
  const request = buildFloodExtentRequest(date, area);
  const url = new URL(request.url);
  const now = dependencies.now?.() ?? new Date();
  const cacheEnabled = dependencies.fetchImpl === undefined;
  const cacheKey = `${url.toString()}|visualization=${dependencies.includeVisualization === true}`;
  const cached = cacheEnabled ? resultCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > now.getTime()) {
    return structuredClone(cached.result);
  }
  return withFloodExtentConcurrency(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FLOOD_EXTENT_TIMEOUT_MS);
    try {
    let response: Response;
    try {
      response = await (dependencies.fetchImpl ?? fetch)(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "image/png" },
      });
    } catch {
      throw new FloodExtentLiveError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) {
      throw new FloodExtentLiveError("redirect");
    }
    if (response.status === 429) throw new FloodExtentLiveError("rate_limited");
    if (!response.ok) throw new FloodExtentLiveError("provider_failure");
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "image/png") throw new FloodExtentLiveError("media_type");
    const bytes = await readBody(response);
    let inspection: Awaited<ReturnType<typeof inspectPreparedFloodExtentPng>>;
    try {
      inspection = await inspectPreparedFloodExtentPng(bytes);
    } catch (error) {
      const reason = error instanceof Error && error.message === "oversize"
        ? "oversize"
        : error instanceof Error && error.message === "schema_validation"
          ? "schema_validation"
          : "malformed";
      throw new FloodExtentLiveError(reason);
    }
    const payloadHash = createHash("sha256").update(bytes).digest("hex");
    const retrievedAt = now.toISOString();
    const areaHash = createHash("sha256")
      .update(`${area.west},${area.south},${area.east},${area.north}`)
      .digest("hex")
      .slice(0, 12);
    if (inspection.outcome === "no_observation") {
      const result: FloodExtentResult = {
        kind: "no_observation",
        payloadHash,
        sourceUrl: url.toString(),
        observation: {
          observationId: `obs-nasa-flood-extent-no-observation-${areaHash}-${date.replaceAll("-", "")}`,
          provenance: {
            sourceId: "nasa_lance_flood_extent",
            sourceUrl: url.toString(),
            retrievedAt,
            observedAt: "unknown",
            product: "VIIRS NOAA-20 and NOAA-21 3-Day Flood Composite visualization",
            payloadHash,
            requestParameters: Object.fromEntries(url.searchParams.entries()),
          },
          variableName: "VIIRS flood extent visualization",
          textValue: "transparent_no_observation_not_no_flood",
          dataMode: "live",
          qualifiers: [
            "no_observation",
            "not_no_flood",
            "not_no_danger",
            "pixel_classification_not_inferred",
          ],
          metadata: {
            floodRole: "satellite_flood_extent_visualization",
            layerId: "VIIRS_Combined_Flood_3-Day",
            contentType,
            imageWidth: inspection.width,
            imageHeight: inspection.height,
            byteLength: bytes.byteLength,
            alphaMaximum: inspection.alphaMaximum,
            legendStatus: inspection.legendStatus,
            boundingBox: `${area.west},${area.south},${area.east},${area.north}`,
            claimBoundary: inspection.claimBoundary,
          },
        },
      };
      if (cacheEnabled) {
        cacheResult(cacheKey, result, now.getTime());
      }
      return result;
    }
    const result: FloodExtentResult = {
      kind: "observation",
      observation: {
        observationId: `obs-nasa-flood-extent-${areaHash}-${date.replaceAll("-", "")}`,
        provenance: {
          sourceId: "nasa_lance_flood_extent",
          sourceUrl: url.toString(),
          retrievedAt,
          observedAt: `${date}T00:00:00Z`,
          product: "VIIRS NOAA-20 and NOAA-21 3-Day Flood Composite visualization",
          payloadHash,
          requestParameters: Object.fromEntries(url.searchParams.entries()),
        },
        variableName: "VIIRS flood extent visualization",
        textValue: "flood_extent_visualization_available",
        dataMode: "live",
        qualifiers: [
          "visualization_only",
          "pixel_classification_not_inferred",
          "flood_depth_not_supported",
          "regional_not_property",
        ],
        metadata: {
          floodRole: "satellite_flood_extent_visualization",
          layerId: "VIIRS_Combined_Flood_3-Day",
          contentType,
          imageWidth: inspection.width,
          imageHeight: inspection.height,
          byteLength: bytes.byteLength,
          alphaMaximum: inspection.alphaMaximum,
          legendStatus: inspection.legendStatus,
          boundingBox: `${area.west},${area.south},${area.east},${area.north}`,
          claimBoundary: inspection.claimBoundary,
        },
      },
      ...(dependencies.includeVisualization
        ? {
            visualization: {
              imageDataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
              byteLength: bytes.byteLength,
            },
          }
        : {}),
    };
    if (cacheEnabled) {
      cacheResult(cacheKey, result, now.getTime());
    }
    return result;
    } catch (error) {
      return {
        kind: "source_failure",
        reason: error instanceof FloodExtentLiveError ? error.reason : "schema_validation",
      };
    } finally {
      clearTimeout(timeout);
    }
  });
}
