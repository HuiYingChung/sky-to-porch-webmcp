#!/usr/bin/env node
/**
 * Manual, separately authorized WP-09 product-path live-source smoke.
 *
 * Start the built local product first, then run:
 *   WP09_LIVE_SMOKE_AUTHORIZED=YES npm run smoke:wp09:live
 *
 * This makes exactly one local product-route invocation. The route retrieves
 * one fixed NASA GIBS tile and one fixed NOAA USCRN Heat01 CSV. There is no
 * retry, provider call, or fixture fallback. Raw upstream payloads and secrets
 * are never printed or written. Never add this command to verify or CI.
 */

if (process.env.WP09_LIVE_SMOKE_AUTHORIZED !== "YES") {
  console.error(
    "[wp09-live-smoke] REFUSED: set WP09_LIVE_SMOKE_AUTHORIZED=YES only after explicit live-source authorization."
  );
  process.exit(2);
}

// P0-A: live queries are custom-area only; this box contains the allowlisted
// Tucson USCRN station coordinate (lon -111.17, lat 32.24), so the route must
// return the station observations alongside the GIBS visualization.
const response = await fetch("http://localhost:3000/api/heat/query", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    placeId: "custom-area",
    area: { west: -111.27, south: 32.14, east: -111.07, north: 32.34 },
    date: "2024-07-11",
    mode: "live",
    concern: "home",
  }),
});

if (!response.ok) {
  console.error(`[wp09-live-smoke] FAIL: product route returned HTTP ${response.status}. No retry.`);
  process.exit(1);
}

const body = await response.json();
const result = body?.result;
const evidence = result?.evidence;
if (body?.ok !== true || result?.kind !== "success" || evidence?.dataMode !== "live") {
  console.error(
    `[wp09-live-smoke] FAIL: expected validated live success, got ${String(result?.kind ?? "missing")}; ` +
      `failureReason=${String(result?.failureReason ?? "not_provided")}; ` +
      `failureStage=${String(result?.failureStage ?? "not_provided")}. No retry or fixture fallback.`
  );
  process.exit(1);
}

const observations = Array.isArray(evidence.observations) ? evidence.observations : [];
const uniqueSources = [...new Set(
  observations.map((observation) => observation?.provenance?.sourceId)
)].sort();
if (JSON.stringify(uniqueSources) !== JSON.stringify([
  "nasa_gibs_modis_lst_day",
  "noaa_uscrn_heat_exposure",
])) {
  console.error(`[wp09-live-smoke] FAIL: exact source pair missing (${uniqueSources.join(", ")}).`);
  process.exit(1);
}

const gibs = observations.find(
  (observation) => observation?.provenance?.sourceId === "nasa_gibs_modis_lst_day"
);
if (
  gibs?.textValue !== "visualization_available" ||
  Object.hasOwn(gibs, "value") ||
  Object.hasOwn(gibs, "unit")
) {
  console.error("[wp09-live-smoke] FAIL: GIBS visualization produced or carried a numeric temperature.");
  process.exit(1);
}

const air = observations.find(
  (observation) => observation?.metadata?.heatRole === "ground_air_temperature"
);
const heatIndex = observations.find(
  (observation) => observation?.metadata?.heatRole === "derived_heat_index"
);
if (!Number.isFinite(air?.value) || air?.unit !== "degC") {
  console.error("[wp09-live-smoke] FAIL: validated outdoor station air temperature is missing.");
  process.exit(1);
}
if (!Number.isFinite(heatIndex?.value) || heatIndex?.unit !== "degC") {
  console.error("[wp09-live-smoke] FAIL: validated NOAA-derived heat index is missing.");
  process.exit(1);
}

if (!Array.isArray(result.assessments) || result.assessments.length !== 6) {
  console.error("[wp09-live-smoke] FAIL: six separated Extreme Heat assessments were not returned.");
  process.exit(1);
}
for (const code of [
  "indoor_temperature",
  "household_heat_certainty",
  "individual_medical_risk",
]) {
  const assessment = result.assessments.find((item) => item.code === code);
  if (assessment?.status !== "not_supported") {
    console.error(`[wp09-live-smoke] FAIL: ${code} was not locked to not_supported.`);
    process.exit(1);
  }
}

for (const observation of observations) {
  if (!/^[a-f0-9]{64}$/iu.test(observation?.provenance?.payloadHash ?? "")) {
    console.error(
      `[wp09-live-smoke] FAIL: invalid payload hash for ${String(observation?.provenance?.sourceId)}.`
    );
    process.exit(1);
  }
  console.log(
    `[wp09-live-smoke] ${observation.provenance.sourceId}: observedAt=${observation.provenance.observedAt}; hash=${observation.provenance.payloadHash}`
  );
}

console.log(
  `[wp09-live-smoke] PASS: ${evidence.evidenceId}; six claims separated; no raw payload stored.`
);
