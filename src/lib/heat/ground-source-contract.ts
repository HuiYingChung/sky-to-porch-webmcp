import type { BoundingBox } from "@/contracts/common";
import { QUERYABLE_SOURCE_IDS } from "@/contracts/dataset-registry";
import { getRegistryEntry } from "@/data/dataset-registry";
import { validateQueryArea } from "@/lib/location/query-area";

export const NCEI_GHCNH_SOURCE_ID = "noaa_ncei_global_hourly" as const;
export const NCEI_GHCNH_PRODUCT = "NOAA NCEI GHCNh Version 1 station-by-year PSV";
export const NCEI_GHCNH_DATASET_SLUG = "global-historical-climatology-network-hourly";
export const NCEI_GHCNH_SEARCH_HOST = "www.ncei.noaa.gov";
export const NCEI_GHCNH_SEARCH_PATH =
  "/access/search/data-search/global-historical-climatology-network-hourly";
export const NCEI_GHCNH_MAX_STATION_CANDIDATES = 10;
export const NCEI_GHCNH_MAX_OBSERVATION_ROWS = 240;
/**
 * ADR-0036: an inventory station may publish no station-year file for the
 * requested year (HTTP 404) or a file with no usable rows for the requested
 * date (station stopped reporting, or its rows lack the required variables).
 * The 2026-08-19 authorized live diagnostics showed downtown Houston needs
 * four distance-ordered attempts to reach an active airport station: closed
 * legacy station (404), mid-year-defunct helistop (file, zero rows), small
 * community station, then Hobby AP. At most this many nearest in-area
 * stations are tried, in distance order; only those two conditions advance,
 * every other failure fails closed immediately.
 */
export const NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS = 4;
export const NCEI_GHCNH_MAX_REQUESTS = 5;
export const NCEI_GHCNH_MAX_CONCURRENCY = 1;

export interface PreparedGhcnhGroundPlan {
  sourceId: typeof NCEI_GHCNH_SOURCE_ID;
  datasetSlug: typeof NCEI_GHCNH_DATASET_SLUG;
  discoveryUrl: string;
  area: BoundingBox;
  date: string;
  requiredVariables: readonly ["temperature", "relative_humidity"];
  maximumStationCandidates: typeof NCEI_GHCNH_MAX_STATION_CANDIDATES;
  maximumObservationRows: typeof NCEI_GHCNH_MAX_OBSERVATION_ROWS;
  maximumRequests: typeof NCEI_GHCNH_MAX_REQUESTS;
  maximumConcurrency: typeof NCEI_GHCNH_MAX_CONCURRENCY;
  externalCallsEnabled: false;
  /** ADR-0039: the GHCNh path is product-wired for historical dates. */
  productQueryable: true;
}

function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error("invalid GHCNh date");
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) {
    throw new Error("invalid GHCNh date");
  }
}

/**
 * Pure preparation plan only. Official documentation identifies GHCNh as the
 * ISD replacement and exposes station search, but the machine subset response
 * schema/quality fields still need fixture and live validation.
 */
export function buildPreparedGhcnhGroundPlan(
  date: string,
  value: unknown
): PreparedGhcnhGroundPlan {
  validateDate(date);
  const area = validateQueryArea(value);
  const url = new URL(`https://${NCEI_GHCNH_SEARCH_HOST}${NCEI_GHCNH_SEARCH_PATH}`);
  url.searchParams.set("bbox", `${area.north},${area.west},${area.south},${area.east}`);
  return {
    sourceId: NCEI_GHCNH_SOURCE_ID,
    datasetSlug: NCEI_GHCNH_DATASET_SLUG,
    discoveryUrl: url.toString(),
    area,
    date,
    requiredVariables: ["temperature", "relative_humidity"],
    maximumStationCandidates: NCEI_GHCNH_MAX_STATION_CANDIDATES,
    maximumObservationRows: NCEI_GHCNH_MAX_OBSERVATION_ROWS,
    maximumRequests: NCEI_GHCNH_MAX_REQUESTS,
    maximumConcurrency: NCEI_GHCNH_MAX_CONCURRENCY,
    externalCallsEnabled: false,
    productQueryable: true,
  };
}

export function getGhcnhReadiness(): {
  registryDecision: "go_supporting";
  productQueryable: true;
  wiringNote: string;
} {
  const entry = getRegistryEntry(NCEI_GHCNH_SOURCE_ID);
  const queryable = (QUERYABLE_SOURCE_IDS as readonly string[]).includes(NCEI_GHCNH_SOURCE_ID);
  if (!entry || entry.decision !== "go_supporting" || !queryable) {
    throw new Error("GHCNh readiness contract drift");
  }
  return {
    registryDecision: "go_supporting",
    productQueryable: true,
    wiringNote:
      "The ADR-0035/0036 owner-authorized bounded live smoke passed on the real NCEI " +
      "endpoints on 2026-08-19 (npm run smoke:ghcnh:live), and ADR-0039 wires the path into " +
      "live Extreme Heat queries for dates older than the by-year publication window when no " +
      "operational USCRN station lies inside the selected area.",
  };
}
