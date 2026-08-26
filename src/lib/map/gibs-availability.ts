/**
 * ADR-0040 (Bug E): bounded server-side probe answering one question — does
 * NASA GIBS have published, non-transparent imagery for this product, date,
 * and area? A transparent probe means "no imagery for this date here"
 * (unpublished or genuinely no coverage), which the layer card must state
 * instead of showing nothing silently. Mirrors the flood-extent transport
 * bounds; no retry, no fallback, no raw-payload persistence.
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
const CACHE_MAX_ENTRIES = 24;

/** The two map overlays this probe serves; WMS layer names match WMTS. */
export const GIBS_AVAILABILITY_PRODUCTS = {
  rain: "IMERG_Precipitation_Rate",
  surface_temp: "MODIS_Terra_Land_Surface_Temp_Day",
} as const;

export type GibsAvailabilityProduct = keyof typeof GIBS_AVAILABILITY_PRODUCTS;

export type GibsAvailabilityResult =
  | { kind: "checked"; available: boolean; alphaMaximum: number }
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
  const cacheEnabled = fetchImpl === undefined;
  const nowMs = Date.now();
  const cached = cacheEnabled ? cache.get(url.toString()) : undefined;
  if (cached && cached.expiresAt > nowMs) return cached.result;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GIBS_AVAILABILITY_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await (fetchImpl ?? fetch)(url, {
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
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > GIBS_AVAILABILITY_MAX_BYTES) throw new GibsAvailabilityError("oversize");
    let alphaMaximum: number;
    try {
      const stats = await sharp(buffer, { failOn: "error" }).ensureAlpha().stats();
      alphaMaximum = stats.channels[3]?.max ?? 255;
    } catch {
      throw new GibsAvailabilityError("malformed");
    }
    const result: GibsAvailabilityResult = {
      kind: "checked",
      available: alphaMaximum > 0,
      alphaMaximum,
    };
    if (cacheEnabled) {
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= nowMs) cache.delete(key);
      }
      while (cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = cache.keys().next().value as string | undefined;
        if (!oldest) break;
        cache.delete(oldest);
      }
      cache.set(url.toString(), { expiresAt: nowMs + GIBS_AVAILABILITY_CACHE_TTL_MS, result });
    }
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
