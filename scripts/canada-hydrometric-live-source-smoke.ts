/**
 * Manual, separately authorized one-request ECCC GeoMet schema smoke.
 *
 * The gate permits one fixed historical Vancouver-area GET. It prohibits
 * credentials, redirects, retries, alternate dates/areas, fixture fallback,
 * and raw-payload retention.
 */

import { validateObservation } from "@/contracts/evidence";
import {
  buildCanadaHydrometricUrl,
  queryCanadaHydrometricDailyMean,
} from "@/lib/flood/canada-hydrometric-live-adapter";

const AUTHORIZATION = "approved-canada-geomet-vancouver-2024-07-08";
const DATE = "2024-07-08";
const AREA = { west: -123.4, south: 49, east: -122.8, north: 49.5 } as const;
const expectedUrl = buildCanadaHydrometricUrl(AREA, DATE).href;

if (process.env.CANADA_GEOMET_LIVE_GATE !== AUTHORIZATION) {
  throw new Error(
    "Canada GeoMet live gate is closed. Set only the exact approved one-request authorization value."
  );
}

const nativeFetch = globalThis.fetch;
let requestCount = 0;
const boundedFetch: typeof fetch = async (input, init) => {
  requestCount += 1;
  if (requestCount > 1) throw new Error("Canada GeoMet live gate exceeded one request");
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href !== expectedUrl || (init?.method ?? "GET").toUpperCase() !== "GET") {
    throw new Error(`Canada GeoMet live gate blocked unexpected request ${url.href}`);
  }
  const headers = new Headers(init?.headers);
  if (headers.has("authorization") || headers.has("cookie")) {
    throw new Error("Canada GeoMet live gate prohibits authorization and cookie headers");
  }
  return nativeFetch(input, init);
};

const result = await queryCanadaHydrometricDailyMean(AREA, DATE, {
  fetchImpl: boundedFetch,
});

if (requestCount !== 1 || result.kind !== "observation") {
  console.error(JSON.stringify({
    gate: "Canada GeoMet hydrometric daily mean",
    date: DATE,
    area: AREA,
    requestCount,
    result,
    rawPayloadRetained: false,
    retries: 0,
    fallbacks: 0,
  }, null, 2));
  process.exitCode = 1;
} else {
  validateObservation(result.observation);
  console.log(JSON.stringify({
    gate: "Canada GeoMet hydrometric daily mean",
    date: DATE,
    area: AREA,
    requestCount,
    resultKind: result.kind,
    stationNumber: result.observation.metadata?.stationNumber,
    stationName: result.observation.metadata?.stationName,
    sourceId: result.observation.provenance.sourceId,
    sourceRecordId: result.observation.provenance.sourceRecordId,
    payloadHash: result.observation.provenance.payloadHash,
    observedAt: result.observation.provenance.observedAt,
    value: result.observation.value,
    unit: result.observation.unit,
    rawPayloadRetained: false,
    retries: 0,
    fallbacks: 0,
  }, null, 2));
}
