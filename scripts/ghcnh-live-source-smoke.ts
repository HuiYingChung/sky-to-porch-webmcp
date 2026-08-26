/**
 * One-time, owner-authorized GHCNh real-endpoint feasibility gate (ADR-0035).
 *
 * Maximum: 5 upstream requests (one station list plus at most
 * NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS station-year files, ADR-0036), no
 * retry, no alternate source/date, no live-to-fixture fallback, no
 * raw-payload persistence, and no credential use. Never run this from CI or
 * tests — manual execution only:
 *
 *   GHCNH_LIVE_SMOKE_AUTHORIZED=YES npm run smoke:ghcnh:live
 *
 * Stages:
 *   1. Fetch the global station list; report byte size, total data rows,
 *      U.S. station count, and skipped-row count (bounded tolerance).
 *   2. Nearest-station discovery (no request) for the Houston and Tucson
 *      demo areas, derived with the same selection code the product uses.
 *   3. Fetch the Houston station-year PSV for 2026 with the ADR-0036 bounded
 *      next-nearest fallback (advance only on http_404 or a file without
 *      usable requested-date rows, at most
 *      NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS stations); report byte size,
 *      requested-date rows, peak temperature/RH, skipped rows, and skipped
 *      stations.
 */

import {
  GHCNH_BY_YEAR_PREFIX,
  GHCNH_HOST,
  GHCNH_STATION_LIST_MAX_BYTES,
  GHCNH_STATION_LIST_PATH,
  GHCNH_STATION_YEAR_MAX_BYTES,
  GHCNH_STATION_YEAR_TIMEOUT_MS,
  GHCNH_TIMEOUT_MS,
  nearestStations,
  parseGhcnhRows,
  parseGhcnhStationList,
  stationYearUrl,
  type GhcnhStation,
} from "@/lib/heat/ground-live-adapter";
import { NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS } from "@/lib/heat/ground-source-contract";
import { validateAndBuildArea } from "@/lib/location/area";
import { USCRN_TUCSON_COORDINATE } from "@/lib/heat/source-contracts";

const AUTHORIZATION_FLAG = "GHCNH_LIVE_SMOKE_AUTHORIZED";
const MAX_REQUESTS = 1 + NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS;
// ADR-0036: the by-year PSV product lags roughly four weeks behind real time
// (files regenerated 2026-08-19 ended at 2026-07-21/22 across stations), so
// the gate date must sit safely inside published coverage.
const REQUEST_DATE = "2026-07-15";
const REQUEST_YEAR = "2026";
// The same center+radius→bbox derivation the product's selection code uses.
const HOUSTON_AREA = validateAndBuildArea({ lon: -95.3698, lat: 29.7604 }, 25).boundingBox;
const TUCSON_AREA = validateAndBuildArea(
  { lon: USCRN_TUCSON_COORDINATE.lon, lat: USCRN_TUCSON_COORDINATE.lat },
  25
).boundingBox;

if (process.env[AUTHORIZATION_FLAG] !== "YES") {
  console.error(`[ghcnh-live-smoke] REFUSED: ${AUTHORIZATION_FLAG}=YES is required.`);
  process.exit(2);
}

let requestCount = 0;
const stageResults: { stage: string; pass: boolean; detail: string }[] = [];

function report(stage: string, pass: boolean, detail: string): void {
  stageResults.push({ stage, pass, detail });
  console.log(`[ghcnh-live-smoke] ${pass ? "PASS" : "FAIL"} ${stage}: ${detail}`);
}

async function fetchBoundedText(
  url: URL,
  maximumBytes: number,
  timeoutMs: number
): Promise<{ byteLength: number; text: string }> {
  if (requestCount >= MAX_REQUESTS) throw new Error("approved 3-request ceiling reached");
  if (url.protocol !== "https:" || url.hostname !== GHCNH_HOST) {
    throw new Error(`request outside the approved allowlist: ${url.href}`);
  }
  requestCount += 1;
  console.log(`[ghcnh-live-smoke] request ${requestCount}/${MAX_REQUESTS}: GET ${url.pathname}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    if (!response.body) throw new Error("empty_body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error(`oversize_beyond_${maximumBytes}_bytes`);
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
      byteLength: total,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Stage 1: station inventory.
let houstonCandidateStations: GhcnhStation[] = [];
try {
  const listUrl = new URL(`https://${GHCNH_HOST}${GHCNH_STATION_LIST_PATH}`);
  const list = await fetchBoundedText(listUrl, GHCNH_STATION_LIST_MAX_BYTES, GHCNH_TIMEOUT_MS);
  const inventory = parseGhcnhStationList(list.text);
  report(
    "station_inventory",
    true,
    `bytes=${list.byteLength} dataRows=${inventory.dataRowCount} ` +
      `usStations=${inventory.stations.length} skippedRows=${inventory.skippedRowCount}`
  );

  // Stage 2: nearest-station discovery (pure geometry, no request).
  const houstonCandidates = nearestStations(inventory.stations, HOUSTON_AREA);
  const tucsonCandidates = nearestStations(inventory.stations, TUCSON_AREA);
  houstonCandidateStations = houstonCandidates;
  report(
    "station_discovery",
    houstonCandidates.length > 0 && tucsonCandidates.length > 0,
    `houston=${houstonCandidates[0]?.id ?? "none"} (${houstonCandidates.length} in area) ` +
      `tucson=${tucsonCandidates[0]?.id ?? "none"} (${tucsonCandidates.length} in area)`
  );
} catch (error) {
  report("station_inventory", false, error instanceof Error ? error.message : "unknown_error");
}

// Stage 3: Houston station-year PSV for the fixed completed UTC date.
// ADR-0036: an inventory station may publish no file for the requested year
// (http_404) or a file with no usable rows for the requested date. Mirror the
// adapter's bounded fallback: try candidates in distance order, advance only
// on those two conditions, and stay inside the approved request ceiling.
if (houstonCandidateStations.length > 0) {
  const attempts = houstonCandidateStations.slice(0, NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS);
  const skippedForMissingYearFile: string[] = [];
  const skippedWithoutUsableDateRows: string[] = [];
  let stageReported = false;
  for (const station of attempts) {
    try {
      const dataUrl = stationYearUrl(station.id, REQUEST_YEAR);
      const data = await fetchBoundedText(
        dataUrl,
        GHCNH_STATION_YEAR_MAX_BYTES,
        GHCNH_STATION_YEAR_TIMEOUT_MS
      );
      const parsed = parseGhcnhRows(data.text, station.id, REQUEST_DATE);
      if (parsed.rows.length === 0) {
        skippedWithoutUsableDateRows.push(station.id);
        continue;
      }
      const peak = [...parsed.rows].sort((left, right) =>
        right.temperatureC - left.temperatureC || left.observedAt.localeCompare(right.observedAt)
      )[0];
      const skipNotes = [
        skippedForMissingYearFile.length > 0
          ? `skippedNoYearFile=${skippedForMissingYearFile.join(",")}`
          : "",
        skippedWithoutUsableDateRows.length > 0
          ? `skippedNoUsableRows=${skippedWithoutUsableDateRows.join(",")}`
          : "",
      ].filter(Boolean).join(" ");
      report(
        "station_year",
        true,
        `station=${station.id} ${skipNotes ? `${skipNotes} ` : ""}bytes=${data.byteLength} ` +
          `date=${REQUEST_DATE} dateRows=${parsed.requestedDateRowCount} ` +
          `validRows=${parsed.rows.length} skippedRows=${parsed.skippedRowCount} ` +
          `peakTemperatureC=${peak.temperatureC} peakRelativeHumidityPct=${peak.relativeHumidityPct} ` +
          `peakAt=${peak.observedAt}`
      );
      stageReported = true;
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      if (message === "http_404") {
        skippedForMissingYearFile.push(station.id);
        continue;
      }
      report("station_year", false, `station=${station.id} ${message}`);
      stageReported = true;
      break;
    }
  }
  if (!stageReported) {
    report(
      "station_year",
      false,
      `bounded candidates exhausted for ${REQUEST_DATE}: ` +
        `noYearFile=[${skippedForMissingYearFile.join(", ")}] ` +
        `noUsableRows=[${skippedWithoutUsableDateRows.join(", ")}]`
    );
  }
} else {
  report("station_year", false, "skipped: no Houston station was discovered");
}

const allPassed = stageResults.length === 3 && stageResults.every((stage) => stage.pass);
console.log(
  `[ghcnh-live-smoke] VERDICT: ${allPassed ? "PASS" : "FAIL"} ` +
    `(${stageResults.filter((stage) => stage.pass).length}/${stageResults.length} stages, ` +
    `${requestCount} requests)`
);
process.exit(allPassed ? 0 : 1);
