/**
 * Separately authorized, credential-free live smoke for ADR-0010 sources.
 *
 * Every adapter owns its HTTPS host, timeout, response-size, and record bounds.
 * This script retains no raw payload and prints only result kinds and source IDs.
 */

import { queryGvpEruptions } from "@/lib/coverage-gap/gvp-eruption-live-adapter";
import { queryEpaAqs } from "@/lib/coverage-gap/epa-aqs-live-adapter";
import { queryCanadaDroughtMonitor } from "@/lib/drought/canada-drought-live-adapter";
import { queryWfigsPerimeters } from "@/lib/fire/wfigs-live-adapter";
import { queryLiveFloodEvidence } from "@/lib/flood/live-adapter";
import { queryMrmsQpe } from "@/lib/flood/mrms-qpe-live-adapter";
import { queryLiveStormEvidence } from "@/lib/storm/live-adapter";
import { queryNhcHurdat2 } from "@/lib/storm/nhc-hurdat-live-adapter";

if (!process.argv.includes("--approved-live-smoke")) {
  throw new Error("Live gate is closed. Pass --approved-live-smoke only after explicit authorization.");
}

type ResultSummary = {
  source: string;
  kind: string;
  observationCount: number;
  sourceIds: string[];
  reason?: string;
  stage?: string;
};

function summarize(source: string, result: Record<string, unknown>): ResultSummary {
  const observations = Array.isArray(result.observations)
    ? result.observations
    : result.observation && typeof result.observation === "object"
      ? [result.observation]
      : [];
  const sourceIds = [...new Set(observations.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const provenance = (item as { provenance?: unknown }).provenance;
    if (!provenance || typeof provenance !== "object") return [];
    const sourceId = (provenance as { sourceId?: unknown }).sourceId;
    return typeof sourceId === "string" ? [sourceId] : [];
  }))];
  return {
    source,
    kind: typeof result.kind === "string" ? result.kind : "invalid_result",
    observationCount: observations.length,
    sourceIds,
    ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
    ...(typeof result.stage === "string" ? { stage: result.stage } : {}),
  };
}

const checks = await Promise.all([
  queryNhcHurdat2(
    { west: -96.5, south: 28.5, east: -94.5, north: 31 },
    "2024-07-08"
  ).then((result) => summarize("NHC HURDAT2", result)),
  queryMrmsQpe(
    { west: -96, south: 29, east: -95, north: 30 },
    "2026-08-29"
  ).then((result) => summarize("NOAA MRMS recent QPE", result)),
  queryWfigsPerimeters(
    { west: -119, south: 33.5, east: -117.5, north: 34.8 },
    "2025-01-09"
  ).then((result) => summarize("NIFC WFIGS", result)),
  queryGvpEruptions(
    { west: -156.2, south: 18.8, east: -154.7, north: 20.3 },
    "2024-12-23"
  ).then((result) => summarize("Smithsonian GVP", result)),
  queryCanadaDroughtMonitor(
    { west: -80, south: 43, east: -79, north: 44 },
    "2026-08-28"
  ).then((result) => summarize("Canadian Drought Monitor", result)),
  queryEpaAqs(
    { west: -96, south: 29, east: -95, north: 30 },
    "2025-01-08",
    { credentials: { email: "", key: "" } }
  ).then((result) => summarize("EPA AQS credential gate", result)),
]);

const houstonArea = {
  west: -95.88508539525462,
  south: 29.309782612504492,
  east: -94.85030940474537,
  north: 30.208093787495507,
} as const;
const [windChain, floodChain] = await Promise.all([
  queryLiveStormEvidence({
    placeId: "custom-area",
    date: "2026-08-28",
    mode: "live",
    area: houstonArea,
  }),
  queryLiveFloodEvidence({
    placeId: "custom-area",
    startDate: "2026-08-28",
    endDate: "2026-08-28",
    mode: "live",
    area: houstonArea,
  }),
]);
const windObservations = windChain.evidence?.observations ?? [];
const floodObservations = floodChain.evidence?.observations ?? [];
const stormRegression = {
  request: "Houston 50 km broad storm on 2026-08-28",
  userAreaPreserved: houstonArea,
  wind: {
    kind: windChain.kind,
    sourceOutcomes: windChain.sourceOutcomes,
    observationCount: windObservations.length,
    sourceIds: [...new Set(windObservations.map((item) => item.provenance.sourceId))],
  },
  flood: {
    kind: floodChain.kind,
    sourceOutcomes: floodChain.sourceOutcomes,
    observationCount: floodObservations.length,
    sourceIds: [...new Set(floodObservations.map((item) => item.provenance.sourceId))],
  },
  requiredFloodEventReportFound: floodObservations.some(
    (item) => item.provenance.sourceId === "nws_local_storm_reports"
  ),
};

console.log(JSON.stringify({
  gate: "ADR-0010 credential-free official-source smoke",
  rawPayloadRetained: false,
  paidRequests: 0,
  checks,
  stormRegression,
}, null, 2));

const unexpected = checks.filter((check) =>
  check.kind === "source_failure" || check.kind === "invalid_result"
);
const credentialGate = checks.find((check) => check.source === "EPA AQS credential gate");
if (unexpected.length > 0 || credentialGate?.kind !== "credential_gate_closed") {
  process.exitCode = 1;
}
if (
  windChain.kind === "source_failure" ||
  floodChain.kind === "source_failure" ||
  !stormRegression.requiredFloodEventReportFound
) {
  process.exitCode = 1;
}
