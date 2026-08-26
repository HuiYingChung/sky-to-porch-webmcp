import { createHash } from "crypto";
import type { BoundingBox } from "@/contracts/common";
import { areaCenter, validateQueryArea } from "@/lib/location/query-area";
import {
  NCEI_GHCNH_MAX_OBSERVATION_ROWS,
  NCEI_GHCNH_MAX_REQUESTS,
  NCEI_GHCNH_MAX_STATION_CANDIDATES,
  NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS,
  NCEI_GHCNH_PRODUCT,
  NCEI_GHCNH_SOURCE_ID,
} from "./ground-source-contract";

type FetchLike = typeof fetch;

export const GHCNH_HOST = "www.ncei.noaa.gov";
export const GHCNH_STATION_LIST_PATH =
  "/oa/global-historical-climatology-network/hourly/doc/ghcnh-station-list.csv";
export const GHCNH_BY_YEAR_PREFIX =
  "/oa/global-historical-climatology-network/hourly/access/by-year";
export const GHCNH_TIMEOUT_MS = 10_000;
/**
 * ADR-0035: a full station-year PSV at a busy airport (roughly 1.5 KB per row,
 * tens of rows per day) can far exceed ten seconds on ordinary links, so the
 * station-year request gets its own longer timeout. The station list keeps the
 * shared 10-second timeout.
 */
export const GHCNH_STATION_YEAR_TIMEOUT_MS = 30_000;
/**
 * ADR-0035: the real global station list is larger than the previous 5 MB cap
 * assumed. Its exact size is unverified from this sandbox (external network is
 * blocked); the owner-run bounded live smoke reports the actual byte size.
 */
export const GHCNH_STATION_LIST_MAX_BYTES = 30_000_000;
/**
 * ADR-0035: a full airport station-year with ~329 pipe-separated columns per
 * row exceeds the previous 8 MB cap. The live smoke reports the actual size.
 */
export const GHCNH_STATION_YEAR_MAX_BYTES = 64_000_000;
export const GHCNH_STATION_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
/** ADR-0035 bounded row tolerance: station-list skip ceiling (fraction). */
export const GHCNH_STATION_LIST_MAX_SKIPPED_FRACTION = 0.02;
/** ADR-0035 bounded row tolerance: station-year skip ceiling (fraction). */
export const GHCNH_STATION_YEAR_MAX_SKIPPED_FRACTION = 0.1;

export type GhcnhFailureReason =
  | "rate_limited"
  | "timeout"
  | "network"
  | "redirect"
  | "oversize"
  | "media_type"
  | "malformed"
  | "schema_validation"
  | "not_found"
  | "provider_failure";

export interface GhcnhStation {
  id: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  state: string;
  name: string;
}

export interface GhcnhGroundObservation {
  observationId: string;
  provenance: {
    sourceId: typeof NCEI_GHCNH_SOURCE_ID;
    sourceUrl: string;
    sourceRecordId: string;
    retrievedAt: string;
    observedAt: string;
    product: string;
    payloadHash: string;
    requestParameters: Record<string, string>;
  };
  variableName: "Hourly outdoor air temperature" | "Hourly relative humidity";
  value: number;
  unit: "degC" | "percent";
  dataMode: "live";
  qualifiers: string[];
  metadata: Record<string, string | number>;
}

export type GhcnhGroundResult =
  | { kind: "observations"; station: GhcnhStation; observations: GhcnhGroundObservation[] }
  | { kind: "no_observation"; stage: "station_discovery" | "station_year" }
  | { kind: "source_failure"; reason: GhcnhFailureReason; stage: "station_discovery" | "station_year" };

export interface GhcnhLiveDependencies {
  fetchImpl?: FetchLike;
  now?: () => Date;
  stationCache?: false;
}

class GhcnhLiveError extends Error {
  constructor(readonly reason: GhcnhFailureReason) {
    super(reason);
    this.name = "GhcnhLiveError";
  }
}

let cachedStations: { expiresAt: number; stations: GhcnhStation[] } | null = null;
let ghcnhQueue: Promise<void> = Promise.resolve();

async function inSingleConcurrencySlot<T>(work: () => Promise<T>): Promise<T> {
  const previous = ghcnhQueue;
  let release = () => {};
  ghcnhQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

function parseDelimitedLine(line: string, delimiter: "," | "|"): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (quoted) throw new GhcnhLiveError("malformed");
  values.push(current);
  return values;
}

async function readBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const length = Number(lengthHeader);
    if (!Number.isInteger(length) || length < 0 || length > maximumBytes) {
      throw new GhcnhLiveError("oversize");
    }
  }
  if (!response.body) throw new GhcnhLiveError("malformed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new GhcnhLiveError("oversize");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchText(
  fetchImpl: FetchLike,
  url: URL,
  maximumBytes: number,
  acceptedContentTypes: readonly string[],
  timeoutMs: number = GHCNH_TIMEOUT_MS
): Promise<{ bytes: Uint8Array; text: string }> {
  if (url.protocol !== "https:" || url.hostname !== GHCNH_HOST) {
    throw new GhcnhLiveError("schema_validation");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: acceptedContentTypes.join(", ") },
      });
    } catch {
      throw new GhcnhLiveError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new GhcnhLiveError("redirect");
    if (response.status === 429) throw new GhcnhLiveError("rate_limited");
    // ADR-0036: a 404 station-year file means the station has published no
    // data for that year — a distinct condition that may advance to the next
    // nearest candidate, unlike genuine provider failures.
    if (response.status === 404) throw new GhcnhLiveError("not_found");
    if (!response.ok) throw new GhcnhLiveError("provider_failure");
    const contentType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!acceptedContentTypes.includes(contentType)) throw new GhcnhLiveError("media_type");
    const bytes = await readBody(response, maximumBytes);
    try {
      return { bytes, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {
      throw new GhcnhLiveError("malformed");
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ADR-0035: the real files carry many additional columns (the station list has
 * eleven, the PSV about 329). Only the required columns are located by exact
 * name and must appear exactly once each; every other column is tolerated.
 */
function exactHeaderIndices(headers: string[], required: readonly string[]): Record<string, number> {
  const indices: Record<string, number> = {};
  for (const name of required) {
    const index = headers.indexOf(name);
    if (index < 0 || headers.lastIndexOf(name) !== index) {
      throw new GhcnhLiveError("schema_validation");
    }
    indices[name] = index;
  }
  return indices;
}

export interface GhcnhStationInventory {
  /** Stations with ISO_CODE === "US", the product's query scope. */
  stations: GhcnhStation[];
  /** All non-empty data rows in the file, valid or not, any country. */
  dataRowCount: number;
  /** Rows skipped under the ADR-0035 bounded row tolerance policy. */
  skippedRowCount: number;
}

/**
 * Parse the real GHCNh station list (header
 * GHCN_ID,LATITUDE,LONGITUDE,ELEVATION,STATE,NAME,GSN,(US)HCN_(US)CRN,WMO_ID,ICAO,ISO_CODE).
 *
 * ADR-0035 decisions validated against the owner-supplied 2026-08-19 sample:
 * - STATE is dirty descriptive data (a real Antigua row carries STATE=TX), so
 *   country scoping uses ISO_CODE === "US" only; STATE is kept as metadata.
 * - Bounded row tolerance: individually malformed rows (wrong cell count,
 *   invalid ID, duplicate ID after the first, out-of-range coordinates,
 *   invalid elevation, empty name) are skipped and counted instead of failing
 *   the whole inventory. The parse fails closed as schema_validation only if
 *   no valid U.S. station remains or the skipped fraction exceeds
 *   GHCNH_STATION_LIST_MAX_SKIPPED_FRACTION of the data rows.
 */
export function parseGhcnhStationList(text: string): GhcnhStationInventory {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new GhcnhLiveError("malformed");
  const headers = parseDelimitedLine(lines[0].replace(/^\uFEFF/u, ""), ",");
  const indices = exactHeaderIndices(headers, [
    "GHCN_ID", "LATITUDE", "LONGITUDE", "ELEVATION", "STATE", "NAME", "ISO_CODE",
  ]);
  const stations: GhcnhStation[] = [];
  const ids = new Set<string>();
  const dataRowCount = lines.length - 1;
  let skippedRowCount = 0;
  for (const line of lines.slice(1)) {
    let cells: string[];
    try {
      cells = parseDelimitedLine(line, ",");
    } catch {
      skippedRowCount += 1;
      continue;
    }
    if (cells.length !== headers.length) {
      skippedRowCount += 1;
      continue;
    }
    const id = cells[indices.GHCN_ID].trim();
    const latitude = Number(cells[indices.LATITUDE]);
    const longitude = Number(cells[indices.LONGITUDE]);
    const elevationText = cells[indices.ELEVATION].trim();
    const elevationM = elevationText === "" ? null : Number(elevationText);
    const name = cells[indices.NAME].trim();
    if (
      !/^[A-Z0-9-]{6,20}$/u.test(id) || ids.has(id) ||
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      (elevationM !== null && !Number.isFinite(elevationM)) || name.length === 0
    ) {
      skippedRowCount += 1;
      continue;
    }
    ids.add(id);
    // Product scope is U.S. selections; non-US rows are valid rows that are
    // filtered out here (never counted as skipped). This also bounds memory.
    if (cells[indices.ISO_CODE].trim() !== "US") continue;
    stations.push({
      id,
      latitude,
      longitude,
      elevationM,
      state: cells[indices.STATE].trim(),
      name,
    });
  }
  if (
    stations.length === 0 ||
    skippedRowCount / dataRowCount > GHCNH_STATION_LIST_MAX_SKIPPED_FRACTION
  ) {
    throw new GhcnhLiveError("schema_validation");
  }
  return { stations, dataRowCount, skippedRowCount };
}

export function nearestStations(stations: GhcnhStation[], area: BoundingBox): GhcnhStation[] {
  const center = areaCenter(area);
  return stations
    .filter((station) =>
      station.longitude >= area.west && station.longitude <= area.east &&
      station.latitude >= area.south && station.latitude <= area.north
    )
    .map((station) => ({
      station,
      distance: (station.longitude - center.lon) ** 2 + (station.latitude - center.lat) ** 2,
    }))
    .sort((left, right) => left.distance - right.distance || left.station.id.localeCompare(right.station.id))
    .slice(0, NCEI_GHCNH_MAX_STATION_CANDIDATES)
    .map(({ station }) => station);
}

export function stationYearUrl(stationId: string, year: string): URL {
  if (!/^\d{4}$/u.test(year) || !/^[A-Z0-9-]{6,20}$/u.test(stationId)) {
    throw new GhcnhLiveError("schema_validation");
  }
  return new URL(
    `https://${GHCNH_HOST}${GHCNH_BY_YEAR_PREFIX}/${year}/psv/GHCNh_${stationId}_${year}.psv`
  );
}

type GhcnhRow = {
  recordId: string;
  observedAt: string;
  temperatureC: number;
  relativeHumidityPct: number;
  temperatureQc: string;
  relativeHumidityQc: string;
};

export interface GhcnhRowParseResult {
  /** Valid requested-date rows carrying both required variables, sorted. */
  rows: GhcnhRow[];
  /** Well-formed rows whose UTC timestamp falls on the requested date. */
  requestedDateRowCount: number;
  /** Rows skipped under the ADR-0035 bounded row tolerance policy. */
  skippedRowCount: number;
}

/**
 * GHCNh DATE values are UTC but carry no timezone suffix (real sample:
 * "2026-01-01T00:00:00"). JavaScript treats a suffix-less ISO datetime as
 * LOCAL time, so the suffix must be appended before parsing or the date
 * window shifts by the server's UTC offset (ADR-0035). Other shapes are
 * rejected per the row-tolerance policy.
 */
const GHCNH_UNTAGGED_UTC_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u;

function parseGhcnhUtcTimestamp(value: string): number | null {
  if (!GHCNH_UNTAGGED_UTC_DATE.test(value)) return null;
  const timestamp = Date.parse(`${value}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Parse the real GHCNh station-by-year PSV (about 329 pipe-separated columns;
 * quality columns are temperature_Quality_Code / relative_humidity_Quality_Code).
 *
 * ADR-0035 bounded row tolerance:
 * - Structurally malformed lines (wrong cell count, unbalanced quote,
 *   unparseable DATE shape) and requested-date rows whose non-blank
 *   temperature or relative_humidity is non-numeric or outside physical
 *   range are skipped and counted.
 * - Blank temperature or relative_humidity values are VALID rows that simply
 *   lack the variable (multiple report types per hour are normal); they are
 *   never counted as skipped and no quality-code filtering is applied.
 * - The parse fails closed as schema_validation only when skipped rows exceed
 *   GHCNH_STATION_YEAR_MAX_SKIPPED_FRACTION of the attributable rows
 *   (requested-date rows plus structurally malformed lines). Zero valid rows
 *   without that excess stays an empty result (no_observation upstream).
 */
export function parseGhcnhRows(
  text: string,
  stationId: string,
  date: string
): GhcnhRowParseResult {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length < 1) throw new GhcnhLiveError("malformed");
  const headers = parseDelimitedLine(lines[0].replace(/^\uFEFF/u, ""), "|");
  const indices = exactHeaderIndices(headers, [
    "STATION", "DATE", "temperature", "temperature_Quality_Code",
    "relative_humidity", "relative_humidity_Quality_Code",
  ]);
  const start = Date.parse(`${date}T00:00:00Z`);
  const end = Date.parse(`${date}T23:59:59Z`);
  const rows: GhcnhRow[] = [];
  let requestedDateRowCount = 0;
  let malformedRowCount = 0;
  let skippedDateRowCount = 0;
  for (const line of lines.slice(1)) {
    let cells: string[];
    try {
      cells = parseDelimitedLine(line, "|");
    } catch {
      malformedRowCount += 1;
      continue;
    }
    if (cells.length !== headers.length) {
      malformedRowCount += 1;
      continue;
    }
    if (cells[indices.STATION] !== stationId) continue;
    const observedAt = cells[indices.DATE];
    const timestamp = parseGhcnhUtcTimestamp(observedAt);
    if (timestamp === null) {
      malformedRowCount += 1;
      continue;
    }
    if (timestamp < start || timestamp > end) continue;
    requestedDateRowCount += 1;
    const temperatureText = cells[indices.temperature].trim();
    const humidityText = cells[indices.relative_humidity].trim();
    // Blank values are normal (not every report type carries every variable);
    // rows lacking either required variable contribute no observation.
    if (temperatureText === "" || humidityText === "") continue;
    const temperatureC = Number(temperatureText);
    const relativeHumidityPct = Number(humidityText);
    if (
      !Number.isFinite(temperatureC) || temperatureC < -100 || temperatureC > 100 ||
      !Number.isFinite(relativeHumidityPct) || relativeHumidityPct < 0 || relativeHumidityPct > 100
    ) {
      skippedDateRowCount += 1;
      continue;
    }
    rows.push({
      recordId: `${stationId}#${observedAt}`,
      observedAt: new Date(timestamp).toISOString(),
      temperatureC,
      relativeHumidityPct,
      temperatureQc: cells[indices.temperature_Quality_Code],
      relativeHumidityQc: cells[indices.relative_humidity_Quality_Code],
    });
    // NCEI_GHCNH_MAX_OBSERVATION_ROWS bounds the valid rows for the one
    // requested date, after station/date/value filtering. A busy airport
    // reports roughly 40-60 rows per day; exceeding 240 fails closed.
    if (rows.length > NCEI_GHCNH_MAX_OBSERVATION_ROWS) {
      throw new GhcnhLiveError("oversize");
    }
  }
  const skippedRowCount = skippedDateRowCount + malformedRowCount;
  const attributableRowCount = requestedDateRowCount + malformedRowCount;
  if (
    attributableRowCount > 0 &&
    skippedRowCount / attributableRowCount > GHCNH_STATION_YEAR_MAX_SKIPPED_FRACTION
  ) {
    throw new GhcnhLiveError("schema_validation");
  }
  return {
    rows: rows.sort((left, right) => left.observedAt.localeCompare(right.observedAt)),
    requestedDateRowCount,
    skippedRowCount,
  };
}

function buildObservations(
  rows: GhcnhRow[],
  station: GhcnhStation,
  url: URL,
  bytes: Uint8Array,
  retrievedAt: string,
  date: string,
  stationsSkippedForMissingYearFile: string[] = [],
  stationsSkippedWithoutUsableDateRows: string[] = []
): GhcnhGroundObservation[] {
  if (rows.length === 0) return [];
  const peak = [...rows].sort((left, right) =>
    right.temperatureC - left.temperatureC || left.observedAt.localeCompare(right.observedAt)
  )[0];
  const payloadHash = createHash("sha256").update(bytes).digest("hex");
  const shared = {
    sourceId: NCEI_GHCNH_SOURCE_ID,
    sourceUrl: url.toString(),
    sourceRecordId: peak.recordId,
    retrievedAt,
    observedAt: peak.observedAt,
    product: NCEI_GHCNH_PRODUCT,
    payloadHash,
    requestParameters: { stationId: station.id, utcDate: date },
  } as const;
  const metadata = {
    stationId: station.id,
    stationName: station.name,
    stationLatitude: station.latitude,
    stationLongitude: station.longitude,
    stationElevationM: station.elevationM ?? "unknown",
    selectionBasis:
      stationsSkippedForMissingYearFile.length === 0 &&
      stationsSkippedWithoutUsableDateRows.length === 0
        ? "nearest_station_inside_canonical_area"
        : "next_nearest_station_inside_canonical_area_after_skipped_stations",
    ...(stationsSkippedForMissingYearFile.length > 0
      ? { stationsSkippedForMissingYearFile: stationsSkippedForMissingYearFile.join(",") }
      : {}),
    ...(stationsSkippedWithoutUsableDateRows.length > 0
      ? { stationsSkippedWithoutUsableDateRows: stationsSkippedWithoutUsableDateRows.join(",") }
      : {}),
    temperatureQc: peak.temperatureQc || "blank",
    relativeHumidityQc: peak.relativeHumidityQc || "blank",
    rowCountForDate: rows.length,
    // ADR-0039: hour coverage lets the heat wiring decide ground confirmation.
    distinctHourCount: new Set(rows.map((row) => row.observedAt.slice(11, 13))).size,
  };
  return [
    {
      observationId: `obs-ghcnh-temperature-${station.id}-${peak.observedAt.replace(/[^0-9]/gu, "")}`,
      provenance: shared,
      variableName: "Hourly outdoor air temperature",
      value: peak.temperatureC,
      unit: "degC",
      dataMode: "live",
      qualifiers: ["outdoor_station", "quality_flags_preserved_not_reinterpreted"],
      metadata: { ...metadata, fieldName: "temperature" },
    },
    {
      observationId: `obs-ghcnh-humidity-${station.id}-${peak.observedAt.replace(/[^0-9]/gu, "")}`,
      provenance: shared,
      variableName: "Hourly relative humidity",
      value: peak.relativeHumidityPct,
      unit: "percent",
      dataMode: "live",
      qualifiers: ["outdoor_station", "quality_flags_preserved_not_reinterpreted"],
      metadata: { ...metadata, fieldName: "relative_humidity" },
    },
  ];
}

/**
 * Bounded request budget (ADR-0036): cached station inventory discovery plus
 * at most NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS station-year PSV retrievals.
 * Candidates are tried in distance order; only an HTTP 404 (no file for the
 * requested year) or a file without usable requested-date rows advances to
 * the next one. Every other failure still fails closed immediately. No
 * station outside the canonical area is used.
 */
export async function queryGhcnhGroundEvidence(
  date: string,
  value: unknown,
  dependencies: GhcnhLiveDependencies = {}
): Promise<GhcnhGroundResult> {
  const area = validateQueryArea(value);
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
    !Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== date) {
    return { kind: "source_failure", reason: "schema_validation", stage: "station_discovery" };
  }
  return inSingleConcurrencySlot(async () => {
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    const now = dependencies.now?.() ?? new Date();
    let stations: GhcnhStation[];
    try {
      if (dependencies.stationCache !== false && cachedStations && cachedStations.expiresAt > now.getTime()) {
        stations = cachedStations.stations;
      } else {
        const stationUrl = new URL(`https://${GHCNH_HOST}${GHCNH_STATION_LIST_PATH}`);
        const stationResponse = await fetchText(
          fetchImpl,
          stationUrl,
          GHCNH_STATION_LIST_MAX_BYTES,
          ["text/csv", "text/plain", "application/octet-stream"]
        );
        stations = parseGhcnhStationList(stationResponse.text).stations;
        if (dependencies.stationCache !== false) {
          cachedStations = { expiresAt: now.getTime() + GHCNH_STATION_CACHE_TTL_MS, stations };
        }
      }
    } catch (error) {
      return {
        kind: "source_failure",
        reason: error instanceof GhcnhLiveError ? error.reason : "schema_validation",
        stage: "station_discovery",
      };
    }
    const candidates = nearestStations(stations, area);
    if (candidates.length === 0) return { kind: "no_observation", stage: "station_discovery" };
    const attempts = candidates.slice(0, NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS);
    const skippedForMissingYearFile: string[] = [];
    const skippedWithoutUsableDateRows: string[] = [];
    for (const station of attempts) {
      try {
        const dataUrl = stationYearUrl(station.id, date.slice(0, 4));
        const dataResponse = await fetchText(
          fetchImpl,
          dataUrl,
          GHCNH_STATION_YEAR_MAX_BYTES,
          ["text/plain", "text/psv", "application/octet-stream"],
          GHCNH_STATION_YEAR_TIMEOUT_MS
        );
        const { rows } = parseGhcnhRows(dataResponse.text, station.id, date);
        const observations = buildObservations(
          rows,
          station,
          dataUrl,
          dataResponse.bytes,
          now.toISOString(),
          date,
          skippedForMissingYearFile,
          skippedWithoutUsableDateRows
        );
        if (observations.length === 0) {
          // A published year file with no usable requested-date rows (station
          // stopped reporting, or rows lack the required variables) advances
          // to the next nearest candidate exactly like a missing file.
          skippedWithoutUsableDateRows.push(station.id);
          continue;
        }
        return { kind: "observations", station, observations };
      } catch (error) {
        const reason = error instanceof GhcnhLiveError ? error.reason : "schema_validation";
        if (reason === "not_found") {
          skippedForMissingYearFile.push(station.id);
          continue;
        }
        return { kind: "source_failure", reason, stage: "station_year" };
      }
    }
    // Bounded attempts exhausted. When at least one candidate published a
    // year file the honest terminal state is no_observation; when every
    // attempted candidate lacked a file it is a not_found source failure.
    if (skippedWithoutUsableDateRows.length > 0) {
      return { kind: "no_observation", stage: "station_year" };
    }
    return { kind: "source_failure", reason: "not_found", stage: "station_year" };
  });
}

export function ghcnhGuardSummary(): {
  maximumRequestsPerQuery: typeof NCEI_GHCNH_MAX_REQUESTS;
  maximumStationYearAttempts: typeof NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS;
  maximumConcurrency: 1;
  stationCacheTtlMs: typeof GHCNH_STATION_CACHE_TTL_MS;
  outsideAreaFallback: false;
} {
  return {
    maximumRequestsPerQuery: NCEI_GHCNH_MAX_REQUESTS,
    maximumStationYearAttempts: NCEI_GHCNH_MAX_STATION_YEAR_ATTEMPTS,
    maximumConcurrency: 1,
    stationCacheTtlMs: GHCNH_STATION_CACHE_TTL_MS,
    outsideAreaFallback: false,
  };
}
