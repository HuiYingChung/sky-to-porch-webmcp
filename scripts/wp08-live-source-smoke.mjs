#!/usr/bin/env node
/**
 * Manual, separately authorized WP-08 product-path live-source smoke.
 *
 * Start the built local product first, then run:
 *   WP08_LIVE_SMOKE_AUTHORIZED=YES npm run smoke:wp08:live
 *
 * This makes exactly one local product-route invocation. That route retrieves
 * NASA GIBS and USGS Water Data. There is no retry and no fixture fallback.
 * Raw upstream payloads and credentials are never printed or written.
 * Never add this command to verify or CI.
 */

if (process.env.WP08_LIVE_SMOKE_AUTHORIZED !== "YES") {
  console.error("[wp08-live-smoke] REFUSED: set WP08_LIVE_SMOKE_AUTHORIZED=YES only after explicit live-source authorization.");
  process.exit(2);
}

const response = await fetch("http://localhost:3000/api/flood/query", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    placeId: "demo-houston",
    startDate: "2024-07-08",
    endDate: "2024-07-08",
    mode: "live",
    concern: "home",
  }),
});

if (!response.ok) {
  console.error(`[wp08-live-smoke] FAIL: product route returned HTTP ${response.status}. No retry.`);
  process.exit(1);
}

const body = await response.json();
const result = body?.result;
const evidence = result?.evidence;
if (body?.ok !== true || result?.kind !== "success" || evidence?.dataMode !== "live") {
  console.error(`[wp08-live-smoke] FAIL: expected a validated live success, got ${String(result?.kind ?? "missing")}. No retry or fixture fallback.`);
  process.exit(1);
}

const observations = Array.isArray(evidence.observations) ? evidence.observations : [];
const sourceIds = observations.map((observation) => observation?.provenance?.sourceId).sort();
if (JSON.stringify(sourceIds) !== JSON.stringify(["nasa_gibs_imerg", "usgs_instantaneous_values"])) {
  console.error(`[wp08-live-smoke] FAIL: exact source pair missing (${sourceIds.join(", ")}).`);
  process.exit(1);
}
if (!Array.isArray(result.assessments) || result.assessments.length !== 6) {
  console.error("[wp08-live-smoke] FAIL: six separated Flood assessments were not returned.");
  process.exit(1);
}
for (const code of ["route_disruption", "property_impact"]) {
  const assessment = result.assessments.find((item) => item.code === code);
  if (assessment?.status !== "not_supported") {
    console.error(`[wp08-live-smoke] FAIL: ${code} was not locked to not_supported.`);
    process.exit(1);
  }
}
for (const observation of observations) {
  if (!/^[a-f0-9]{64}$/iu.test(observation?.provenance?.payloadHash ?? "")) {
    console.error(`[wp08-live-smoke] FAIL: invalid payload hash for ${String(observation?.provenance?.sourceId)}.`);
    process.exit(1);
  }
  console.log(
    `[wp08-live-smoke] ${observation.provenance.sourceId}: observedAt=${observation.provenance.observedAt}; hash=${observation.provenance.payloadHash}`
  );
}

console.log(`[wp08-live-smoke] PASS: ${evidence.evidenceId}; six claims separated; no raw payload stored.`);
