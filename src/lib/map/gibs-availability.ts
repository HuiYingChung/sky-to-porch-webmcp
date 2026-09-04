/**
 * ADR-0040 (Bug E): bounded server-side probe answering one narrow question —
 * does a NASA GIBS response contain any visible pixel for this product, date,
 * and area? A fully transparent response cannot distinguish valid transparent
 * imagery from unavailable coverage. No retry, fallback, or payload storage.
 */

import sharp from "sharp";
import type { BoundingBox } from "@/contracts/common";
import { validateQueryArea } from "@/lib/location/query-area";

type FetchLike = typeof fetch;

export const GIBS_AVAILABILITY_HOST = "gibs.earthdata.nasa.gov";
export const GIBS_AVAILABILITY_PATH = "/wms/epsg4326/best/wms.cgi";
export const GIBS_AVAILABILITY_IMAGE_SIZE = 256;
export const GIBS_AVAILABILITY_MAX_BYTES = 1_000_000;
export const GIBS_AVAILABILITY_TIMEOUT_MS = 10_000;
export const GIBS_AVAILABILITY_CACHE_TTL_MS = 5 * 60 * 1_000;
export const GIBS_AVAILABILITY_MAX_CONCURRENCY = 2;
export const GIBS_AVAILABILITY_RATE_WINDOW_MS = 60_000;
export const GIBS_AVAILABILITY_MAX_REQUESTS_PER_WINDOW = 12;
const CACHE_MAX_ENTRIES = 24;

/** The two map overlays this probe serves; WMS layer names match WMTS. */
export const GIBS_AVAILABILITY_PRODUCTS = {
  rain: "IMERG_Precipitation_Rate",
  surface_temp: "MODIS_Terra_Land_Surface_Temp_Day",
} as const;

export type GibsAvailabilityProduct = keyof typeof GIBS_AVAILABILITY_PRODUCTS;

export type GibsAvailabilityResult =
  | {
      kind: "checked";
      visiblePixelsDetected: boolean;
      alphaMaximum: number;
    }
  | {
      kind: "source_failure";
      reason:
        | "rate_limited"
        | "timeout"
        | "network"
        | "redirect"
        | "oversize"
        | "media_type"
        | "malformed"
        | "provider_failure"
        | "invalid_input";
    };

class GibsAvailabilityError extends Error {
  constructor(readonly reason: Extract<GibsAvailabilityResult, { kind: "source_failure" }>["reason"]) {
    super(reason);
    this.name = "GibsAvailabilityError";
  }
}

const cache = new Map<string, { expiresAt: number; result: GibsAvailabilityResult }>();
const inFlight = new Map<string, Promise<GibsAvailabilityResult>>();
const requestStarts: number[] = [];
let activeRequests = 0;

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new GibsAvailabilityError("invalid_input");
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    throw new GibsAvailabilityError("invalid_input");
  }
}

export function buildGibsAvailabilityUrl(
  product: GibsAvailabilityProduct,
  date: string,
  area: BoundingBox
): URL {
  const url = new URL(`https://${GIBS_AVAILABILITY_HOST}${GIBS_AVAILABILITY_PATH}`);
  const parameters: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    LAYERS: GIBS_AVAILABILITY_PRODUCTS[product],
    SRS: "EPSG:4326",
    STYLES: "",
    WIDTH: String(GIBS_AVAILABILITY_IMAGE_SIZE),
    HEIGHT: String(GIBS_AVAILABILITY_IMAGE_SIZE),
    TIME: date,
    BBOX: `${area.west},${area.south},${area.east},${area.north}`,
  };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url;
}

async function readBoundedBytes(response: Response): Promise<Uint8Array> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > GIBS_AVAILABILITY_MAX_BYTES
    ) {
      throw new GibsAvailabilityError("oversize");
    }
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > GIBS_AVAILABILITY_MAX_BYTES) {
      await reader.cancel();
      throw new GibsAvailabilityError("oversize");
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

async function retrieveGibsAvailability(
  url: URL,
  fetchImpl: FetchLike
): Promise<GibsAvailabilityResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GIBS_AVAILABILITY_TIMEOUT_MS);
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
      throw new GibsAvailabilityError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new GibsAvailabilityError("redirect");
    if (response.status === 429) throw new GibsAvailabilityError("rate_limited");
    if (!response.ok) throw new GibsAvailabilityError("provider_failure");
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "image/png") throw new GibsAvailabilityError("media_type");
    const buffer = await readBoundedBytes(response);
    let alphaMaximum: number;
    try {
      const image = sharp(buffer, {
        failOn: "error",
        limitInputPixels:
          GIBS_AVAILABILITY_IMAGE_SIZE * GIBS_AVAILABILITY_IMAGE_SIZE,
      });
      const metadata = await image.metadata();
      if (
        metadata.width !== GIBS_AVAILABILITY_IMAGE_SIZE ||
        metadata.height !== GIBS_AVAILABILITY_IMAGE_SIZE
      ) throw new GibsAvailabilityError("malformed");
      if (!metadata.hasAlpha) {
        alphaMaximum = 255;
      } else {
        const channelCount = metadata.channels;
        if (!channelCount || channelCount < 2) {
          throw new GibsAvailabilityError("malformed");
        }
        // PNG may be grayscale+alpha (2 channels) or RGBA (4 channels).
        // The alpha band is the final input channel, not always index 3.
        const stats = await image.stats();
        const alphaChannel = stats.channels[channelCount - 1];
        if (!alphaChannel || !Number.isFinite(alphaChannel.max)) {
          throw new GibsAvailabilityError("malformed");
        }
        alphaMaximum = alphaChannel.max;
      }
    } catch {
      throw new GibsAvailabilityError("malformed");
    }
    const result: GibsAvailabilityResult = {
      kind: "checked",
      visiblePixelsDetected: alphaMaximum > 0,
      alphaMaximum,
    };
    return result;
  } catch (error) {
    return {
      kind: "source_failure",
      reason: error instanceof GibsAvailabilityError ? error.reason : "malformed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function storeCachedResult(
  key: string,
  result: GibsAvailabilityResult,
  nowMs: number
): void {
  for (const [cachedKey, entry] of cache) {
    if (entry.expiresAt <= nowMs) cache.delete(cachedKey);
  }
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
  cache.set(key, {
    expiresAt: nowMs + GIBS_AVAILABILITY_CACHE_TTL_MS,
    result,
  });
}

export async function checkGibsAvailability(
  product: GibsAvailabilityProduct,
  date: string,
  areaValue: unknown,
  fetchImpl?: FetchLike
): Promise<GibsAvailabilityResult> {
  let area: BoundingBox;
  try {
    validateDate(date);
    area = validateQueryArea(areaValue);
  } catch {
    return { kind: "source_failure", reason: "invalid_input" };
  }

  const url = buildGibsAvailabilityUrl(product, date, area);
  const key = url.toString();
  // Dependency-injected transports are bounded test adapters. The public
  // production path additionally gets process-local cache, coalescing, rate,
  // and concurrency guards before any NASA request or Sharp decode begins.
  if (fetchImpl !== undefined) {
    return retrieveGibsAvailability(url, fetchImpl);
  }

  const nowMs = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > nowMs) return cached.result;
  const pending = inFlight.get(key);
  if (pending) return pending;

  while (
    requestStarts[0] !== undefined &&
    requestStarts[0] <= nowMs - GIBS_AVAILABILITY_RATE_WINDOW_MS
  ) requestStarts.shift();
  if (
    requestStarts.length >= GIBS_AVAILABILITY_MAX_REQUESTS_PER_WINDOW ||
    activeRequests >= GIBS_AVAILABILITY_MAX_CONCURRENCY
  ) return { kind: "source_failure", reason: "rate_limited" };

  requestStarts.push(nowMs);
  activeRequests += 1;
  const request = retrieveGibsAvailability(url, fetch).then((result) => {
    if (result.kind === "checked") storeCachedResult(key, result, Date.now());
    return result;
  }).finally(() => {
    activeRequests -= 1;
    inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

export function clearGibsAvailabilityServerStateForTests(): void {
  cache.clear();
  inFlight.clear();
  requestStarts.length = 0;
  activeRequests = 0;
}
