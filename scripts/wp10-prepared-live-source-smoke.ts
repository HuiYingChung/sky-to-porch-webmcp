/**
 * One-time, owner-authorized WP-10 prepared-path feasibility gate.
 *
 * Maximum: 10 upstream requests, no retry, no alternate source/date, no
 * live-to-fixture fallback, no raw-payload persistence, and no credential
 * output. Never run this from CI.
 */

import { createHash } from "crypto";
import { queryAirNow } from "@/lib/coverage-gap/airnow-live-adapter";
import { queryAtmosphericSatellite } from "@/lib/coverage-gap/atmospheric-live-adapter";
import { queryHansVolcanoActivity } from "@/lib/coverage-gap/hans-live-adapter";
import { resolveUsAdministrativeArea } from "@/lib/drought/administrative-area-live";
import { buildUsdmAdministrativePercentRequest } from "@/lib/drought/source-contracts";
import { normalizeUsdmPercentArea } from "@/lib/drought/live-schema";
import { queryFloodExtent } from "@/lib/flood/extent-live-adapter";
import { queryGhcnhGroundEvidence } from "@/lib/heat/ground-live-adapter";

const AUTHORIZATION_FLAG = "WP10_PREPARED_LIVE_SMOKE_AUTHORIZED";
const MAX_REQUESTS = 10;
const HOUSTON = { west: -95.8, south: 29.4, east: -95.0, north: 30.1 } as const;
const ANCHORAGE = { west: -150.3, south: 60.9, east: -149.3, north: 61.5 } as const;
const HAWAII = { west: -156.2, south: 18.8, east: -154.7, north: 20.3 } as const;
const SAN_JUAN = { west: -66.3, south: 18.2, east: -65.7, north: 18.6 } as const;

type RequestRole =
  | "gibs_flood_extent"
  | "gibs_maiac_aod"
  | "gibs_omps_so2"
  | "ghcnh_station_inventory"
  | "ghcnh_station_year"
  | "census_state_resolver"
  | "usdm_state_statistics"
  | "hans_volcano_inventory"
  | "hans_notice_search"
  | "airnow_monitoring_site_aqi";

type SafeRequestRecord = { role: RequestRole; host: string; path: string; method: string };
type SafeOutcome = {
  source: string;
  outcome: string;
  observationCount?: number;
  detail?: string;
  hashes?: string[];
};

if (process.env[AUTHORIZATION_FLAG] !== "YES") {
  console.error(`[wp10-prepared-live-smoke] REFUSED: ${AUTHORIZATION_FLAG}=YES is required.`);
  process.exit(2);
}

const requests: SafeRequestRecord[] = [];
const usedRoles = new Set<RequestRole>();
const nativeFetch = globalThis.fetch;

function exactDate(value: string | null, expected: string): boolean {
  return value === expected || value === `${expected}T00` || value === `${expected}T23`;
}

function classifyRequest(url: URL, init?: RequestInit): RequestRole {
  const method = (init?.method ?? "GET").toUpperCase();
  if (
    url.hostname === "gibs.earthdata.nasa.gov" &&
    url.pathname === "/wms/epsg4326/best/wms.cgi" &&
    method === "GET"
  ) {
    const layer = url.searchParams.get("LAYERS");
    const date = url.searchParams.get("TIME");
    const bbox = url.searchParams.get("BBOX");
    if (layer === "VIIRS_Combined_Flood_3-Day" && date === "2024-07-08" &&
      bbox === "-95.8,29.4,-95,30.1") return "gibs_flood_extent";
    if (layer === "MODIS_Combined_MAIAC_L2G_AerosolOpticalDepth" &&
      date === "2024-07-08" && bbox === "-150.3,60.9,-149.3,61.5") {
      return "gibs_maiac_aod";
    }
    if (layer === "OMPS_NOAA20_SO2_Lower_Troposphere" && date === "2023-06-07" &&
      bbox === "-156.2,18.8,-154.7,20.3") return "gibs_omps_so2";
  }
  if (url.hostname === "www.ncei.noaa.gov" && method === "GET") {
    if (url.pathname ===
      "/oa/global-historical-climatology-network/hourly/doc/ghcnh-station-list.csv") {
      return "ghcnh_station_inventory";
    }
    if (/^\/oa\/global-historical-climatology-network\/hourly\/access\/by-year\/2024\/psv\/GHCNh_[A-Z0-9-]{6,20}_2024\.psv$/u.test(url.pathname)) {
      return "ghcnh_station_year";
    }
  }
  if (
    url.hostname === "tigerweb.geo.census.gov" &&
    url.pathname === "/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query" &&
    method === "GET"
  ) return "census_state_resolver";
  if (
    url.hostname === "usdmdataservices.unl.edu" &&
    url.pathname === "/api/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent" &&
    method === "GET" && url.searchParams.get("aoi") === "72" &&
    url.searchParams.get("startdate") === "7/9/2024" &&
    url.searchParams.get("enddate") === "7/9/2024" &&
    url.searchParams.get("statisticsType") === "1"
  ) return "usdm_state_statistics";
  if (url.hostname === "volcanoes.usgs.gov") {
    if (url.pathname === "/hans-public/api/volcano/getUSVolcanoes" && method === "GET") {
      return "hans_volcano_inventory";
    }
    if (url.pathname === "/hans-public/api/search/search" && method === "POST") {
      return "hans_notice_search";
    }
  }
  if (
    url.hostname === "www.airnowapi.org" && url.pathname === "/aq/data/" && method === "GET" &&
    exactDate(url.searchParams.get("startDate"), "2024-07-08") &&
    exactDate(url.searchParams.get("endDate"), "2024-07-08") &&
    url.searchParams.get("BBOX") === "-150.3,60.9,-149.3,61.5" &&
    url.searchParams.has("API_KEY")
  ) return "airnow_monitoring_site_aqi";
  throw new Error(`request outside the approved allowlist: ${method} ${url.hostname}${url.pathname}`);
}

const boundedFetch: typeof fetch = async (input, init) => {
  if (requests.length >= MAX_REQUESTS) throw new Error("approved 10-request ceiling reached");
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("only credential-safe HTTPS requests are allowed");
  }
  const headers = new Headers(init?.headers);
  if (headers.has("authorization") || headers.has("cookie")) {
    throw new Error("authorization and cookie headers are prohibited");
  }
  const role = classifyRequest(url, init);
  if (usedRoles.has(role)) throw new Error(`duplicate request role prohibited: ${role}`);
  usedRoles.add(role);
  requests.push({
    role,
    host: url.hostname,
    path: url.pathname,
    method: (init?.method ?? "GET").toUpperCase(),
  });
  return nativeFetch(input, init);
};

async function readBoundedJson(response: Response, maximumBytes: number): Promise<{
  bytes: Uint8Array;
  value: unknown;
}> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null && Number(lengthHeader) > maximumBytes) throw new Error("oversize");
  if (!response.body) throw new Error("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("oversize");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    bytes,
    value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  };
}

const outcomes: SafeOutcome[] = [];

const flood = await queryFloodExtent("2024-07-08", HOUSTON, { fetchImpl: boundedFetch });
outcomes.push({
  source: "nasa_lance_flood_extent",
  outcome: flood.kind,
  observationCount: flood.kind === "observation" ? 1 : 0,
  detail: flood.kind === "source_failure" ? flood.reason : undefined,
  hashes: flood.kind === "observation" ? [flood.observation.provenance.payloadHash] :
    flood.kind === "no_observation" ? [flood.payloadHash] : undefined,
});

for (const item of [
  { sourceId: "nasa_gibs_modis_aod", date: "2024-07-08", area: ANCHORAGE },
  { sourceId: "nasa_gibs_omps_so2", date: "2023-06-07", area: HAWAII },
] as const) {
  const result = await queryAtmosphericSatellite(item.sourceId, item.date, item.area, {
    fetchImpl: boundedFetch,
  });
  outcomes.push({
    source: item.sourceId,
    outcome: result.kind,
    observationCount: result.kind === "observation" ? 1 : 0,
    detail: result.kind === "source_failure" ? result.reason : undefined,
    hashes: result.kind === "observation" ? [result.observation.provenance.payloadHash] :
      result.kind === "no_observation" ? [result.payloadHash] : undefined,
  });
}

const ghcnh = await queryGhcnhGroundEvidence("2024-07-08", ANCHORAGE, {
  fetchImpl: boundedFetch,
  stationCache: false,
});
outcomes.push({
  source: "noaa_ncei_global_hourly",
  outcome: ghcnh.kind,
  observationCount: ghcnh.kind === "observations" ? ghcnh.observations.length : 0,
  detail: ghcnh.kind === "source_failure" ? `${ghcnh.stage}:${ghcnh.reason}` :
    ghcnh.kind === "no_observation" ? ghcnh.stage : undefined,
  hashes: ghcnh.kind === "observations"
    ? [...new Set(ghcnh.observations.map((item) => item.provenance.payloadHash))]
    : undefined,
});

const census = await resolveUsAdministrativeArea(SAN_JUAN, { fetchImpl: boundedFetch });
outcomes.push({
  source: "us_census_tigerweb_state_boundaries",
  outcome: census.kind,
  detail: census.kind === "resolved"
    ? `${census.area.fips}:${census.area.name}:${census.selectionBasis}`
    : census.kind === "source_failure" ? census.reason : undefined,
});

if (census.kind === "resolved" && census.area.fips === "72") {
  const request = buildUsdmAdministrativePercentRequest("2024-07-09", census.area);
  try {
    const response = await boundedFetch(new URL(request.url), {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: request.headers,
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim();
    if (!["application/json", "text/json"].includes(contentType)) throw new Error("media_type");
    const payload = await readBoundedJson(response, 2_000_000);
    const row = normalizeUsdmPercentArea(payload.value, "2024-07-09");
    outcomes.push({
      source: "us_drought_monitor_rest",
      outcome: row === null ? "no_observation" : "observation",
      observationCount: row === null ? 0 : 1,
      hashes: [createHash("sha256").update(payload.bytes).digest("hex")],
    });
  } catch (error) {
    outcomes.push({
      source: "us_drought_monitor_rest",
      outcome: "source_failure",
      detail: error instanceof Error ? error.message : "validation_failure",
    });
  }
} else {
  outcomes.push({
    source: "us_drought_monitor_rest",
    outcome: "not_attempted",
    detail: "Census resolver did not return expected Puerto Rico FIPS 72",
  });
}

const hans = await queryHansVolcanoActivity("2024-06-03", HAWAII, {
  fetchImpl: boundedFetch,
  inventoryCache: false,
});
outcomes.push({
  source: "usgs_volcano_hans",
  outcome: hans.kind,
  observationCount: hans.kind === "observations" ? hans.observations.length : 0,
  detail: hans.kind === "source_failure" ? `${hans.stage}:${hans.reason}` :
    hans.kind === "no_observation" ? hans.stage : undefined,
  hashes: hans.kind === "observations"
    ? [...new Set(hans.observations.map((item) => item.provenance.payloadHash))]
    : undefined,
});

const airNow = await queryAirNow("2024-07-08", ANCHORAGE, {
  fetchImpl: boundedFetch,
  cache: false,
});
outcomes.push({
  source: "airnow",
  outcome: airNow.kind,
  observationCount: airNow.kind === "observations" ? airNow.observations.length : 0,
  detail: airNow.kind === "source_failure" ? airNow.reason :
    airNow.kind === "no_observation" ? airNow.cacheStatus : undefined,
  hashes: airNow.kind === "observations"
    ? [...new Set(airNow.observations.map((item) => item.provenance.payloadHash))]
    : undefined,
});

const safeReport = {
  approvedMaximumRequests: MAX_REQUESTS,
  realizedRequests: requests.length,
  noRetry: true,
  noFallback: true,
  rawPayloadPersisted: false,
  credentialValueReported: false,
  requests,
  outcomes,
};
console.log(JSON.stringify(safeReport, null, 2));

const failures = outcomes.filter((item) => item.outcome === "source_failure");
if (failures.length > 0) {
  console.error(`[wp10-prepared-live-smoke] FAIL-CLOSED: ${failures.length} source path(s) failed validation.`);
  process.exitCode = 1;
} else {
  console.log(`[wp10-prepared-live-smoke] PASS: ${requests.length}/${MAX_REQUESTS} requests; no retry/fallback.`);
}
