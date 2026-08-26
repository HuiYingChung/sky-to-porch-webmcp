import {
  AIRNOW_DAILY_HOST,
  buildAirNowDailyFileUrl,
  queryAirNowDailyData,
} from "@/lib/coverage-gap/airnow-daily-live-adapter";

const AUTHORIZATION = "approved-one-request-2024-07-08-houston";
const DATE = "2024-07-08";
const AREA = { west: -96, south: 29, east: -94, north: 31 } as const;
const EXPECTED_URL = buildAirNowDailyFileUrl(DATE);

if (process.env.WP11_AIRNOW_LIVE_GATE !== AUTHORIZATION) {
  throw new Error(
    "WP-11 AirNow live gate is closed. Set only the exact approved one-request authorization value."
  );
}

let requestCount = 0;
const boundedFetch: typeof fetch = async (input, init) => {
  requestCount += 1;
  if (requestCount > 1) throw new Error("WP-11 AirNow live gate exceeded one request");
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    url.protocol !== "https:" ||
    url.hostname !== AIRNOW_DAILY_HOST ||
    url.pathname !== EXPECTED_URL.pathname ||
    url.search !== ""
  ) {
    throw new Error(`WP-11 AirNow live gate blocked unexpected URL ${url.origin}${url.pathname}`);
  }
  if ((init?.method ?? "GET") !== "GET") {
    throw new Error("WP-11 AirNow live gate permits GET only");
  }
  return fetch(url, init);
};

const result = await queryAirNowDailyData(DATE, AREA, {
  fetchImpl: boundedFetch,
  cache: false,
  externalCallsAuthorized: true,
});

if (requestCount !== 1) throw new Error(`Expected exactly one request, received ${requestCount}`);
if (result.kind !== "observations" || result.observations.length === 0) {
  console.error(JSON.stringify({
    gate: "WP-11 AirNow daily-file live source",
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
  const first = result.observations[0];
  console.log(JSON.stringify({
    gate: "WP-11 AirNow daily-file live source",
    date: DATE,
    area: AREA,
    requestCount,
    kind: result.kind,
    observationCount: result.observations.length,
    areaRecordCount: result.areaRecordCount,
    truncated: result.truncated,
    sourceId: first.provenance.sourceId,
    sourceUrl: first.provenance.sourceUrl,
    payloadHash: first.provenance.payloadHash,
    observedAt: first.provenance.observedAt,
    validDate: first.metadata.validDate,
    parameters: [...new Set(result.observations.map((observation) => observation.variableName))],
    qualifiers: first.qualifiers,
    rawPayloadRetained: false,
    retries: 0,
    fallbacks: 0,
  }, null, 2));
}
