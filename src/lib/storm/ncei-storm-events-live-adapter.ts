import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { BoundingBox } from "@/contracts/common";
import type { Observation } from "@/contracts/evidence";
import { validateQueryArea } from "@/lib/location/query-area";

export const NCEI_STORM_EVENTS_HOST = "www.ncei.noaa.gov";
export const NCEI_STORM_EVENTS_INDEX_PATH = "/pub/data/swdi/stormevents/csvfiles/";
export const NCEI_STORM_EVENTS_TIMEOUT_MS = 15_000;
export const NCEI_STORM_EVENTS_INDEX_MAX_BYTES = 1_000_000;
export const NCEI_STORM_EVENTS_GZIP_MAX_BYTES = 40_000_000;
export const NCEI_STORM_EVENTS_CSV_MAX_BYTES = 180_000_000;
export const NCEI_STORM_EVENTS_MAX_OBSERVATIONS = 12;

export type NceiStormEventsHazard = "wind_storm" | "flood_storm";
export type NceiStormEventsFailureReason =
  | "network"
  | "timeout"
  | "redirect"
  | "rate_limited"
  | "provider_failure"
  | "oversize"
  | "malformed"
  | "schema_validation";

export type NceiStormEventsResult =
  | { kind: "observations"; observations: Observation[]; publicationFile: string }
  | { kind: "no_observation"; publicationFile: string }
  | { kind: "source_failure"; reason: NceiStormEventsFailureReason; stage: "index" | "details" };

const WIND_EVENTS = new Set([
  "Blizzard",
  "Dust Devil",
  "Dust Storm",
  "Funnel Cloud",
  "Hail",
  "Heavy Snow",
  "High Wind",
  "Hurricane",
  "Hurricane (Typhoon)",
  "Ice Storm",
  "Lightning",
  "Marine High Wind",
  "Marine Strong Wind",
  "Marine Thunderstorm Wind",
  "Strong Wind",
  "Thunderstorm Wind",
  "Tornado",
  "Tropical Depression",
  "Tropical Storm",
  "Waterspout",
  "Winter Storm",
]);

const FLOOD_EVENTS = new Set([
  "Coastal Flood",
  "Debris Flow",
  "Flash Flood",
  "Flood",
  "Heavy Rain",
  "Hurricane",
  "Hurricane (Typhoon)",
  "Lakeshore Flood",
  "Storm Surge/Tide",
  "Tropical Depression",
  "Tropical Storm",
]);

class NceiStormEventsError extends Error {
  constructor(readonly reason: NceiStormEventsFailureReason) {
    super(reason);
    this.name = "NceiStormEventsError";
  }
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/u, "").trim().toUpperCase();
}

/** RFC-4180-compatible parser kept local so no unbounded CSV dependency is required. */
export function parseNceiCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new NceiStormEventsError("malformed");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function recordFrom(headers: string[], values: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let index = 0; index < headers.length; index += 1) {
    record[headers[index]] = values[index] ?? "";
  }
  return record;
}

function finiteNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inArea(area: BoundingBox, latitude: number, longitude: number): boolean {
  return latitude >= area.south && latitude <= area.north &&
    longitude >= area.west && longitude <= area.east;
}

function eventDate(record: Record<string, string>): string | null {
  const yearMonth = record.BEGIN_YEARMONTH;
  const day = record.BEGIN_DAY.padStart(2, "0");
  if (!/^\d{6}$/u.test(yearMonth) || !/^\d{2}$/u.test(day)) return null;
  const value = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-${day}`;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? value
    : null;
}

function selectCoordinate(
  record: Record<string, string>,
  area: BoundingBox
): { latitude: number; longitude: number; basis: "begin" | "end" } | null {
  const candidates = [
    { latitude: finiteNumber(record.BEGIN_LAT), longitude: finiteNumber(record.BEGIN_LON), basis: "begin" as const },
    { latitude: finiteNumber(record.END_LAT), longitude: finiteNumber(record.END_LON), basis: "end" as const },
  ];
  return candidates.find((candidate) =>
    candidate.latitude !== null && candidate.longitude !== null &&
    candidate.latitude >= -90 && candidate.latitude <= 90 &&
    candidate.longitude >= -180 && candidate.longitude <= 180 &&
    inArea(area, candidate.latitude, candidate.longitude)
  ) as { latitude: number; longitude: number; basis: "begin" | "end" } | undefined ?? null;
}

function sanitizeText(value: string, maximumLength: number): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, maximumLength);
}

export function observationsFromNceiCsv(
  csvBytes: Uint8Array,
  publicationUrl: string,
  publicationFile: string,
  areaValue: unknown,
  requestedDate: string,
  hazard: NceiStormEventsHazard,
  retrievedAt: string
): Observation[] {
  const area = validateQueryArea(areaValue);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(csvBytes);
  const rows = parseNceiCsv(text);
  if (rows.length === 0) throw new NceiStormEventsError("schema_validation");
  const headers = rows[0].map(normalizeHeader);
  for (const required of ["EVENT_ID", "EVENT_TYPE", "BEGIN_YEARMONTH", "BEGIN_DAY", "BEGIN_LAT", "BEGIN_LON"]) {
    if (!headers.includes(required)) throw new NceiStormEventsError("schema_validation");
  }
  const acceptedEvents = hazard === "wind_storm" ? WIND_EVENTS : FLOOD_EVENTS;
  const payloadHash = createHash("sha256").update(csvBytes).digest("hex");
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const values of rows.slice(1)) {
    const record = recordFrom(headers, values);
    if (eventDate(record) !== requestedDate || !acceptedEvents.has(record.EVENT_TYPE)) continue;
    const coordinate = selectCoordinate(record, area);
    if (!coordinate) continue;
    const eventId = record.EVENT_ID.trim();
    if (!/^\d{1,12}$/u.test(eventId) || seen.has(eventId)) continue;
    seen.add(eventId);
    const location = sanitizeText(record.BEGIN_LOCATION || record.CZ_NAME || "reported location", 120);
    const narrative = sanitizeText(record.EVENT_NARRATIVE || record.EPISODE_NARRATIVE, 500);
    const summary = `${record.EVENT_TYPE} was recorded near ${location} in the NOAA NCEI Storm Events database.` +
      (narrative ? ` Source narrative: ${narrative}` : "");
    observations.push({
      observationId: `obs-ncei-storm-event-${eventId}`,
      provenance: {
        sourceId: "noaa_ncei_storm_events",
        sourceUrl: publicationUrl,
        sourceRecordId: eventId,
        retrievedAt,
        observedAt: `${requestedDate}T00:00:00.000Z`,
        product: "NOAA NCEI Storm Events Database details bulk CSV v1.0",
        payloadHash,
        requestParameters: {
          requestedDate,
          hazard,
          publicationFile,
          bbox: `${area.west},${area.south},${area.east},${area.north}`,
          applicability: "event_date_and_reported_coordinate_inside_selected_bbox",
        },
      },
      variableName: "Official historical storm-event record",
      textValue: summary,
      dataMode: "historical",
      qualifiers: [
        "official_historical_event_record",
        "reported_coordinate_inside_selected_area",
        "source_event_date_not_exact_utc_timestamp",
        "regional_context_not_property_evidence",
      ],
      periodStart: `${requestedDate}T00:00:00.000Z`,
      periodEnd: `${requestedDate}T23:59:59.999Z`,
      metadata: {
        eventType: record.EVENT_TYPE,
        state: sanitizeText(record.STATE, 60),
        countyOrZone: sanitizeText(record.CZ_NAME, 120),
        reportedLatitude: coordinate.latitude,
        reportedLongitude: coordinate.longitude,
        coordinateBasis: coordinate.basis,
        beginLocation: location,
      },
    });
    if (observations.length >= NCEI_STORM_EVENTS_MAX_OBSERVATIONS) break;
  }
  return observations;
}

async function fetchBytes(
  fetchImpl: typeof fetch,
  url: URL,
  maximumBytes: number,
  acceptedTypes: readonly string[]
): Promise<Uint8Array> {
  if (url.protocol !== "https:" || url.hostname !== NCEI_STORM_EVENTS_HOST) {
    throw new NceiStormEventsError("schema_validation");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NCEI_STORM_EVENTS_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: acceptedTypes.join(", ") },
      });
    } catch {
      throw new NceiStormEventsError(controller.signal.aborted ? "timeout" : "network");
    }
    if (response.status >= 300 && response.status < 400) throw new NceiStormEventsError("redirect");
    if (response.status === 429) throw new NceiStormEventsError("rate_limited");
    if (!response.ok) throw new NceiStormEventsError("provider_failure");
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!acceptedTypes.includes(contentType)) throw new NceiStormEventsError("schema_validation");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maximumBytes) throw new NceiStormEventsError("oversize");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new NceiStormEventsError("oversize");
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

export function selectNceiDetailsFile(indexHtml: string, year: number): string | null {
  const pattern = new RegExp(
    `StormEvents_details-ftp_v1\\.0_d${year}_c(\\d{8})\\.csv\\.gz`,
    "gu"
  );
  const matches = [...indexHtml.matchAll(pattern)]
    .map((match) => ({ filename: match[0], created: match[1] }))
    .sort((left, right) => right.created.localeCompare(left.created));
  return matches[0]?.filename ?? null;
}

export async function queryNceiStormEvents(
  areaValue: unknown,
  date: string,
  hazard: NceiStormEventsHazard,
  dependencies: { fetchImpl?: typeof fetch; now?: () => Date } = {}
): Promise<NceiStormEventsResult> {
  let area: BoundingBox;
  try {
    area = validateQueryArea(areaValue);
  } catch {
    return { kind: "source_failure", reason: "schema_validation", stage: "index" };
  }
  const year = Number(date.slice(0, 4));
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isInteger(year)) {
    return { kind: "source_failure", reason: "schema_validation", stage: "index" };
  }
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const indexUrl = new URL(`https://${NCEI_STORM_EVENTS_HOST}${NCEI_STORM_EVENTS_INDEX_PATH}`);
  let filename: string;
  try {
    const indexBytes = await fetchBytes(
      fetchImpl,
      indexUrl,
      NCEI_STORM_EVENTS_INDEX_MAX_BYTES,
      ["text/html", "text/plain"]
    );
    const indexHtml = new TextDecoder("utf-8", { fatal: true }).decode(indexBytes);
    const selected = selectNceiDetailsFile(indexHtml, year);
    if (!selected) return { kind: "no_observation", publicationFile: `unpublished-year-${year}` };
    filename = selected;
  } catch (error) {
    return {
      kind: "source_failure",
      reason: error instanceof NceiStormEventsError ? error.reason : "malformed",
      stage: "index",
    };
  }
  const detailsUrl = new URL(`${indexUrl.toString()}${filename}`);
  try {
    const gzipBytes = await fetchBytes(
      fetchImpl,
      detailsUrl,
      NCEI_STORM_EVENTS_GZIP_MAX_BYTES,
      ["application/gzip", "application/x-gzip", "application/octet-stream"]
    );
    let csvBytes: Uint8Array;
    try {
      csvBytes = new Uint8Array(gunzipSync(gzipBytes, { maxOutputLength: NCEI_STORM_EVENTS_CSV_MAX_BYTES }));
    } catch {
      throw new NceiStormEventsError("malformed");
    }
    const observations = observationsFromNceiCsv(
      csvBytes,
      detailsUrl.toString(),
      filename,
      area,
      date,
      hazard,
      (dependencies.now?.() ?? new Date()).toISOString()
    );
    return observations.length > 0
      ? { kind: "observations", observations, publicationFile: filename }
      : { kind: "no_observation", publicationFile: filename };
  } catch (error) {
    return {
      kind: "source_failure",
      reason: error instanceof NceiStormEventsError ? error.reason : "malformed",
      stage: "details",
    };
  }
}
