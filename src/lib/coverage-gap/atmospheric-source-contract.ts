import type { BoundingBox } from "@/contracts/common";
import { QUERYABLE_SOURCE_IDS } from "@/contracts/dataset-registry";
import { getRegistryEntry } from "@/data/dataset-registry";
import { validateQueryArea } from "@/lib/location/query-area";

export type PreparedAtmosphericSourceId =
  | "nasa_gibs_modis_aod"
  | "nasa_gibs_omps_so2";

const SOURCE_LAYERS: Record<PreparedAtmosphericSourceId, string> = {
  nasa_gibs_modis_aod: "MODIS_Combined_MAIAC_L2G_AerosolOpticalDepth",
  nasa_gibs_omps_so2: "OMPS_NOAA20_SO2_Lower_Troposphere",
};

export const ATMOSPHERIC_GIBS_HOST = "gibs.earthdata.nasa.gov";
export const ATMOSPHERIC_GIBS_PATH = "/wms/epsg4326/best/wms.cgi";
export const ATMOSPHERIC_IMAGE_SIZE = 512;
export const ATMOSPHERIC_MAX_BYTES = 2_000_000;
export const ATMOSPHERIC_TIMEOUT_MS = 10_000;
export const ATMOSPHERIC_MAX_CONCURRENCY = 2;

export interface AtmosphericRequest {
  sourceId: PreparedAtmosphericSourceId;
  layer: string;
  url: string;
  area: BoundingBox;
  date: string;
  timeoutMs: typeof ATMOSPHERIC_TIMEOUT_MS;
  maximumBytes: typeof ATMOSPHERIC_MAX_BYTES;
  maximumConcurrency: typeof ATMOSPHERIC_MAX_CONCURRENCY;
  externalCallsEnabled: true;
  productQueryable: true;
}

export interface AirNowGuardContract {
  sourceId: "airnow";
  requiresServerKey: true;
  serverOnly: true;
  maximumUpstreamRequestsPerQuery: 1;
  maximumConcurrentUpstreamRequests: 2;
  minimumCacheTtlSeconds: 300;
  maximumQueriesPerClientPerMinute: 6;
  credentialValueRead: false;
  externalCallsEnabled: false;
  productQueryable: false;
}

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error("invalid atmospheric date");
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    throw new Error("invalid atmospheric date");
  }
}

/** Pure request construction; no fetch capability is exported. */
export function buildAtmosphericRequest(
  sourceId: PreparedAtmosphericSourceId,
  date: string,
  value: unknown
): AtmosphericRequest {
  validateDate(date);
  const area = validateQueryArea(value);
  const layer = SOURCE_LAYERS[sourceId];
  const url = new URL(`https://${ATMOSPHERIC_GIBS_HOST}${ATMOSPHERIC_GIBS_PATH}`);
  const parameters: Record<string, string> = {
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    LAYERS: layer,
    SRS: "EPSG:4326",
    STYLES: "",
    WIDTH: String(ATMOSPHERIC_IMAGE_SIZE),
    HEIGHT: String(ATMOSPHERIC_IMAGE_SIZE),
    TIME: date,
    BBOX: `${area.west},${area.south},${area.east},${area.north}`,
  };
  for (const [key, parameter] of Object.entries(parameters)) {
    url.searchParams.set(key, parameter);
  }
  return {
    sourceId,
    layer,
    url: url.toString(),
    area,
    date,
    timeoutMs: ATMOSPHERIC_TIMEOUT_MS,
    maximumBytes: ATMOSPHERIC_MAX_BYTES,
    maximumConcurrency: ATMOSPHERIC_MAX_CONCURRENCY,
    externalCallsEnabled: true,
    productQueryable: true,
  };
}

export function airNowGuardContract(): AirNowGuardContract {
  return {
    sourceId: "airnow",
    requiresServerKey: true,
    serverOnly: true,
    maximumUpstreamRequestsPerQuery: 1,
    maximumConcurrentUpstreamRequests: 2,
    minimumCacheTtlSeconds: 300,
    maximumQueriesPerClientPerMinute: 6,
    credentialValueRead: false,
    externalCallsEnabled: false,
    productQueryable: false,
  };
}

export function assertAtmosphericSourceReadiness(): void {
  for (const sourceId of ["nasa_gibs_modis_aod", "nasa_gibs_omps_so2"] as const) {
    const registry = getRegistryEntry(sourceId);
    const queryable = (QUERYABLE_SOURCE_IDS as readonly string[]).includes(sourceId);
    if (
      !registry ||
      registry.decision !== "go" ||
      !registry.supportedDataModes.includes("live") ||
      !queryable
    ) {
      throw new Error(`live atmospheric source contract drift: ${sourceId}`);
    }
  }
  const airNow = getRegistryEntry("airnow");
  const airNowQueryable = (QUERYABLE_SOURCE_IDS as readonly string[]).includes("airnow");
  if (!airNow || airNow.decision !== "defer" || airNowQueryable) {
    throw new Error("AirNow credential gate contract drift");
  }
}

/** @deprecated Compatibility alias for pre-live contract callers. */
export const buildPreparedAtmosphericRequest = buildAtmosphericRequest;
