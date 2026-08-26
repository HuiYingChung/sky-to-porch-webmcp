/**
 * Manual, separately authorized WP-12 product-path live-source smoke.
 *
 * This runs one fixed historical Hawaii Earth & Volcanoes query. It permits
 * exactly one OMPS request, one HANS inventory request, one HANS notice search,
 * and one bounded USGS FDSN earthquake query. There is no retry, alternate
 * date/area, fixture fallback, credential use, or raw-payload retention.
 */

import { buildAtmosphericRequest } from "@/lib/coverage-gap/atmospheric-source-contract";
import {
  HANS_HOST,
  HANS_SEARCH_PATH,
  HANS_VOLCANO_PATH,
} from "@/lib/coverage-gap/hans-live-adapter";
import {
  queryVolcanoEvidence,
  type VolcanoEvidenceDiagnostics,
} from "@/lib/coverage-gap/service";
import { buildUsgsEarthquakeQueryUrl } from "@/lib/coverage-gap/usgs-earthquake-live-adapter";
import { runWp12GuardedQuery } from "@/lib/coverage-gap/wp12-live-smoke-report";

const AUTHORIZATION = "approved-wp12-three-source-hawaii-2024-06-03";
const DATE = "2024-06-03";
const AREA = { west: -156.2, south: 18.8, east: -154.7, north: 20.3 } as const;
const MAX_REQUESTS = 4;
const expectedOmpsUrl = buildAtmosphericRequest("nasa_gibs_omps_so2", DATE, AREA).url;
const expectedEarthquakeUrl = buildUsgsEarthquakeQueryUrl(DATE, AREA).href;

type RequestRole = "omps" | "hans_inventory" | "hans_search" | "earthquake_catalog";

if (process.env.WP12_EARTH_VOLCANO_LIVE_GATE !== AUTHORIZATION) {
  throw new Error(
    "WP-12 Earth & Volcanoes live gate is closed. Set only the exact approved authorization value."
  );
}

const nativeFetch = globalThis.fetch;
const requests: { role: RequestRole; host: string; path: string; method: string }[] = [];
const usedRoles = new Set<RequestRole>();

function classifyRequest(url: URL, init?: RequestInit): RequestRole {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET" && url.href === expectedOmpsUrl) return "omps";
  if (
    method === "GET" &&
    url.protocol === "https:" &&
    url.hostname === HANS_HOST &&
    url.pathname === HANS_VOLCANO_PATH &&
    url.search === ""
  ) return "hans_inventory";
  if (
    method === "POST" &&
    url.protocol === "https:" &&
    url.hostname === HANS_HOST &&
    url.pathname === HANS_SEARCH_PATH &&
    url.search === ""
  ) {
    if (typeof init?.body !== "string") throw new Error("HANS search body must be JSON text");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const startUnixtime = Date.parse(`${DATE}T00:00:00Z`) / 1_000;
    if (JSON.stringify(body) !== JSON.stringify({
      obsAbbr: "",
      noticeTypeCd: "",
      volcCd: "",
      startUnixtime,
      endUnixtime: startUnixtime + 86_399,
      searchText: "",
      pageIndex: 0,
    })) throw new Error("HANS search body is outside the fixed live gate");
    return "hans_search";
  }
  if (method === "GET" && url.href === expectedEarthquakeUrl) return "earthquake_catalog";
  throw new Error(`WP-12 live gate blocked unexpected request: ${method} ${url.origin}${url.pathname}`);
}

const boundedFetch: typeof fetch = async (input, init) => {
  if (requests.length >= MAX_REQUESTS) throw new Error("WP-12 live gate exceeded four requests");
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("WP-12 live gate permits credential-free HTTPS only");
  }
  const headers = new Headers(init?.headers);
  if (headers.has("authorization") || headers.has("cookie")) {
    throw new Error("WP-12 live gate prohibits authorization and cookie headers");
  }
  const role = classifyRequest(url, init);
  if (usedRoles.has(role)) throw new Error(`WP-12 live gate prohibits duplicate ${role} requests`);
  usedRoles.add(role);
  requests.push({ role, host: url.hostname, path: url.pathname, method: (init?.method ?? "GET").toUpperCase() });
  return nativeFetch(input, init);
};

const diagnostics: VolcanoEvidenceDiagnostics = { sourceFailures: [] };
const requiredRoles: RequestRole[] = ["omps", "hans_inventory", "hans_search", "earthquake_catalog"];
const guarded = await runWp12GuardedQuery(() => queryVolcanoEvidence({
  placeId: "custom-area",
  area: AREA,
  date: DATE,
  concern: "community",
}, { fetchImpl: boundedFetch, diagnostics }), {
  date: DATE,
  area: AREA,
  maximumRequests: MAX_REQUESTS,
  requests,
});
const missingRoles = requiredRoles.filter((role) => !usedRoles.has(role));
if (guarded.kind === "failure") {
  console.log(JSON.stringify(guarded.report, null, 2));
  console.error(JSON.stringify({
    outcome: "FAIL_CLOSED",
    missingRoles,
    sourceFailures: [],
    failureStage: "product_path",
    failureClass: "unexpected_exception",
  }));
  process.exitCode = 1;
} else {
  const result = guarded.result;
  const sourceFailures = Object.entries(result.sourceOutcomes)
    .filter(([, outcome]) => outcome === "source_failure")
    .map(([source]) => source);
  const observations = result.evidence?.observations ?? [];
  const safeReport = {
    gate: "WP-12 Earth & Volcanoes three-source product path",
    date: DATE,
    area: AREA,
    maximumRequests: MAX_REQUESTS,
    realizedRequests: requests.length,
    requests,
    resultKind: result.kind,
    sourceOutcomes: result.sourceOutcomes,
    sourceFailureDiagnostics: diagnostics.sourceFailures,
    observationCounts: {
      omps: observations.filter((item) => item.provenance.sourceId === "nasa_gibs_omps_so2").length,
      hans: observations.filter((item) => item.provenance.sourceId === "usgs_volcano_hans").length,
      earthquakeCatalog: observations.filter((item) => item.provenance.sourceId === "usgs_earthquake_geojson").length,
    },
    payloadHashes: [...new Set(observations.map((item) => item.provenance.payloadHash))],
    rejectionReason: result.rejectionReason,
    noPrediction: result.sourceOutcomes.earthquake_prediction === "out_of_scope",
    rawPayloadRetained: false,
    retries: 0,
    fallbacks: 0,
  };
  console.log(JSON.stringify(safeReport, null, 2));

  if (requests.length !== MAX_REQUESTS || missingRoles.length > 0 || sourceFailures.length > 0) {
    console.error(JSON.stringify({
      outcome: "FAIL_CLOSED",
      missingRoles,
      sourceFailures,
    }));
    process.exitCode = 1;
  }
}
