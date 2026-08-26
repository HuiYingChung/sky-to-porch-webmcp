/**
 * Separately authorized WP-10 product-adapter live-source smoke.
 *
 * PowerShell:
 *   $env:WP10_CUSTOM_AREA_LIVE_SMOKE_AUTHORIZED='YES'
 *   npm run smoke:wp10:custom-area:live
 *
 * This invokes the production drought live adapter directly so that provider
 * configuration and secrets are never read. The injected transport permits
 * exactly two credential-free NASA requests: one GIBS time-domain XML and one
 * NDVI PNG for a fixed New York custom area. There is no retry, alternate
 * date/source, USDM request, provider call, or fixture fallback. Raw upstream
 * payloads are neither printed nor written. Never add this command to CI.
 */

import { queryLiveDroughtEvidence } from "@/lib/drought/live-adapter";

const AUTHORIZATION_FLAG = "WP10_CUSTOM_AREA_LIVE_SMOKE_AUTHORIZED";
const REQUESTED_DATE = "2024-06-04";
const EXPECTED_OBSERVED_DATE = "2024-05-24T00:00:00Z";
const EXPECTED_BBOX = "-74.3,40.4,-73.6,41";
const AREA = { west: -74.3, south: 40.4, east: -73.6, north: 41 } as const;
const EXPECTED_DOMAIN_HOST = "gitc.earthdata.nasa.gov";
const EXPECTED_IMAGE_HOST = "gibs.earthdata.nasa.gov";
const EXPECTED_DOMAIN_PATH_PREFIX =
  "/wmts/epsg4326/std/1.0.0/MODIS_Terra_L3_NDVI_16Day_v6.1_STD/default/250m/all/";
const EXPECTED_IMAGE_PATH = "/wms/epsg4326/std/wms.cgi";

function fail(message: string): never {
  console.error(`[wp10-custom-area-live-smoke] FAIL: ${message} No retry or fixture fallback.`);
  process.exit(1);
}

if (process.env[AUTHORIZATION_FLAG] !== "YES") {
  console.error(
    `[wp10-custom-area-live-smoke] REFUSED: set ${AUTHORIZATION_FLAG}=YES only after explicit live-source authorization.`
  );
  process.exit(2);
}

const requests: Array<{ host: string; path: string }> = [];
const nativeFetch = globalThis.fetch;

const boundedFetch: typeof fetch = async (input, init) => {
  if (requests.length >= 2) {
    throw new Error("The approved two-request HTTP ceiling was reached.");
  }

  const requestUrl = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  );
  const headers = new Headers(init?.headers);
  if (headers.has("authorization") || headers.has("cookie") || headers.has("x-api-key")) {
    throw new Error("Credential-bearing transport is prohibited for this smoke.");
  }
  if (requestUrl.protocol !== "https:" || requestUrl.username || requestUrl.password) {
    throw new Error("Only credential-free HTTPS is permitted.");
  }

  const expectedIndex = requests.length;
  if (
    expectedIndex === 0 &&
    (requestUrl.hostname !== EXPECTED_DOMAIN_HOST ||
      !requestUrl.pathname.startsWith(EXPECTED_DOMAIN_PATH_PREFIX))
  ) {
    throw new Error("The first request was not the approved NASA GIBS time-domain operation.");
  }
  if (
    expectedIndex === 1 &&
    (requestUrl.hostname !== EXPECTED_IMAGE_HOST || requestUrl.pathname !== EXPECTED_IMAGE_PATH)
  ) {
    throw new Error("The second request was not the approved NASA GIBS NDVI image operation.");
  }

  requests.push({ host: requestUrl.hostname, path: requestUrl.pathname });
  return nativeFetch(input, init);
};

const result = await queryLiveDroughtEvidence(
  {
    placeId: "custom-area",
    date: REQUESTED_DATE,
    mode: "live",
    area: AREA,
  },
  { fetchImpl: boundedFetch }
);

if (requests.length !== 2) {
  fail(`expected exactly two NASA requests, observed ${requests.length}`);
}
if (result.kind !== "inconclusive_evidence") {
  fail(
    `expected validated satellite-only evidence, got ${result.kind}; ` +
      `gibs=${result.sourceOutcomes.gibs}; usdm=${result.sourceOutcomes.usdm}`
  );
}
if (result.sourceOutcomes.gibs !== "success" || result.sourceOutcomes.usdm !== "not_attempted") {
  fail(
    `unexpected source outcomes: gibs=${result.sourceOutcomes.gibs}; ` +
      `usdm=${result.sourceOutcomes.usdm}`
  );
}

const evidence = result.evidence;
if (!evidence || evidence.dataMode !== "live" || evidence.observations.length !== 1) {
  fail("the adapter did not return exactly one validated live observation");
}

const observation = evidence.observations[0];
if (observation.provenance.sourceId !== "nasa_gibs_modis_ndvi_16day") {
  fail(`unexpected source ID: ${observation.provenance.sourceId}`);
}
if (observation.provenance.observedAt !== EXPECTED_OBSERVED_DATE) {
  fail(`unexpected native observation date: ${observation.provenance.observedAt}`);
}
if (observation.provenance.requestParameters?.BBOX !== EXPECTED_BBOX) {
  fail(`custom-area bbox drifted: ${String(observation.provenance.requestParameters?.BBOX)}`);
}
if (
  observation.textValue !== "regional_visualization_available" ||
  Object.hasOwn(observation, "value") ||
  Object.hasOwn(observation, "unit")
) {
  fail("the visualization was missing or was incorrectly converted into a numeric NDVI value");
}
if (!/^[a-f0-9]{64}$/u.test(observation.provenance.payloadHash)) {
  fail("the validated PNG payload hash is missing or malformed");
}
if (evidence.missionAttributions.length !== 1) {
  fail(`expected one NASA mission attribution, got ${evidence.missionAttributions.length}`);
}

const limitationIds = evidence.limitations.map((item) => item.limitationId);
for (const requiredId of [
  "lim-wp10-gibs-visual-only",
  "lim-coverage-drought-global-baseline-only",
]) {
  if (!limitationIds.includes(requiredId)) fail(`required limitation missing: ${requiredId}`);
}

console.log(
  `[wp10-custom-area-live-smoke] nasa_gibs_modis_ndvi_16day: ` +
    `requestedDate=${REQUESTED_DATE}; observedAt=${observation.provenance.observedAt}; ` +
    `bbox=${EXPECTED_BBOX}; bytes=${String(observation.metadata?.byteLength ?? "not_reported")}; ` +
    `hash=${observation.provenance.payloadHash}`
);
console.log(
  `[wp10-custom-area-live-smoke] PASS: ${evidence.evidenceId}; ` +
    `two credential-free NASA requests; USDM not attempted; no raw payload stored.`
);
