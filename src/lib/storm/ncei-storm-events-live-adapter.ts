import { createHash } from "node:crypto";
import type { BoundingBox } from "@/contracts/common";
import type { Observation } from "@/contracts/evidence";
import { validateQueryArea } from "@/lib/location/query-area";

export const NCEI_STORM_EVENTS_HOST = "www.ncei.noaa.gov";
export const NCEI_STORM_EVENTS_INDEX_PATH = "/pub/data/swdi/stormevents/csvfiles/";
/** Timeout for the small directory-index request. */
export const NCEI_STORM_EVENTS_TIMEOUT_MS = 15_000;
/**
 * Timeout for the annual details archive (about 13 MB compressed and 70 MB
 * decompressed for a recent year). It covers download, decompression and
 * parsing together because they run as one stream.
 */
export const NCEI_STORM_EVENTS_DETAILS_TIMEOUT_MS = 25_000;
export const NCEI_STORM_EVENTS_INDEX_MAX_BYTES = 1_000_000;
export const NCEI_STORM_EVENTS_GZIP_MAX_BYTES = 40_000_000;
export const NCEI_STORM_EVENTS_CSV_MAX_BYTES = 180_000_000;
/** Live-stream guardrails; the 2024 publication has 51 columns and a 7,014-character maximum field. */
export const NCEI_STORM_EVENTS_CSV_MAX_RECORD_CHARACTERS = 1_000_000;
export const NCEI_STORM_EVENTS_CSV_MAX_COLUMNS = 128;
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

const INDEX_CONTENT_TYPES = ["text/html", "text/plain"] as const;
const DETAILS_CONTENT_TYPES = ["application/gzip", "application/x-gzip", "application/octet-stream"] as const;
const REQUIRED_HEADERS = ["EVENT_ID", "EVENT_TYPE", "BEGIN_YEARMONTH", "BEGIN_DAY", "BEGIN_LAT", "BEGIN_LON"] as const;

class NceiStormEventsError extends Error {
  constructor(readonly reason: NceiStormEventsFailureReason) {
    super(reason);
    this.name = "NceiStormEventsError";
  }
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/u, "").trim().toUpperCase();
}

const QUOTE = 0x22;
const COMMA = 0x2c;
const LINE_FEED = 0x0a;

/**
 * Incremental RFC-4180-compatible row parser kept local so no unbounded CSV
 * dependency is required. `push` accepts any slicing of the input text
 * (including empty strings) and returns the rows completed by that chunk in
 * file order; `finish` flushes the final unterminated row.
 *
 * The semantics are those of the original whole-string parser: a quote opens
 * a quoted field only at the start of a field, a doubled quote inside a quoted
 * field is a literal quote, text after a closing quote is appended to the same
 * field, one CR immediately before a row-ending LF is dropped, and rows whose
 * fields are all empty are skipped.
 */
export class NceiCsvRowParser {
  private row: string[] = [];
  private field = "";
  private quoted = false;
  private recordCharacters = 0;
  /**
   * The previous chunk ended with a quote while inside a quoted field. Whether
   * it closes the field or escapes a literal quote depends on the next
   * character, which has not arrived yet.
   */
  private pendingQuote = false;
  private finished = false;

  constructor(private readonly limits?: {
    maximumRecordCharacters: number;
    maximumColumns: number;
  }) {}

  push(text: string): string[][] {
    if (this.finished) throw new Error("NceiCsvRowParser: push after finish");
    const rows: string[][] = [];
    const length = text.length;
    if (length === 0) return rows;
    let index = 0;
    if (this.pendingQuote) {
      this.pendingQuote = false;
      if (text.charCodeAt(0) === QUOTE) {
        this.countRecordCharacters(1);
        this.field += '"';
        index = 1;
      } else {
        this.quoted = false;
      }
    }
    while (index < length) {
      if (this.quoted) {
        const close = text.indexOf('"', index);
        if (close === -1) {
          this.countRecordCharacters(length - index);
          this.field += text.slice(index);
          break;
        }
        this.countRecordCharacters(close - index + 1);
        this.field += text.slice(index, close);
        index = close + 1;
        if (index === length) {
          this.pendingQuote = true;
          break;
        }
        if (text.charCodeAt(index) === QUOTE) {
          this.countRecordCharacters(1);
          this.field += '"';
          index += 1;
        } else {
          this.quoted = false;
        }
        continue;
      }
      const code = text.charCodeAt(index);
      if (code === QUOTE) {
        this.countRecordCharacters(1);
        if (this.field.length === 0) this.quoted = true;
        else this.field += '"';
        index += 1;
      } else if (code === COMMA) {
        this.countRecordCharacters(1);
        if (this.limits && this.row.length + 2 > this.limits.maximumColumns) {
          throw new NceiStormEventsError("oversize");
        }
        this.row.push(this.field);
        this.field = "";
        index += 1;
      } else if (code === LINE_FEED) {
        this.endRow(rows);
        index += 1;
      } else {
        let end = index + 1;
        while (end < length) {
          const next = text.charCodeAt(end);
          if (next === QUOTE || next === COMMA || next === LINE_FEED) break;
          end += 1;
        }
        this.countRecordCharacters(end - index);
        this.field += text.slice(index, end);
        index = end;
      }
    }
    return rows;
  }

  finish(): string[][] {
    if (this.finished) return [];
    this.finished = true;
    const rows: string[][] = [];
    if (this.pendingQuote) {
      // End of input after a quote inside a quoted field closes the field.
      this.pendingQuote = false;
      this.quoted = false;
    }
    if (this.quoted) throw new NceiStormEventsError("malformed");
    if (this.field.length > 0 || this.row.length > 0) this.endRow(rows);
    return rows;
  }

  private endRow(rows: string[][]): void {
    if (this.limits && this.row.length + 1 > this.limits.maximumColumns) {
      throw new NceiStormEventsError("oversize");
    }
    this.row.push(this.field.endsWith("\r") ? this.field.slice(0, -1) : this.field);
    if (this.row.some((value) => value.length > 0)) rows.push(this.row);
    this.row = [];
    this.field = "";
    this.recordCharacters = 0;
  }

  private countRecordCharacters(count: number): void {
    this.recordCharacters += count;
    if (this.limits && this.recordCharacters > this.limits.maximumRecordCharacters) {
      throw new NceiStormEventsError("oversize");
    }
  }
}

/** Parses a complete CSV text; retained for callers that already hold the whole document. */
export function parseNceiCsv(text: string): string[][] {
  const parser = new NceiCsvRowParser();
  const rows = parser.push(text);
  for (const row of parser.finish()) rows.push(row);
  return rows;
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

function eventDate(yearMonth: string, rawDay: string): string | null {
  const day = rawDay.padStart(2, "0");
  if (!/^\d{6}$/u.test(yearMonth) || !/^\d{2}$/u.test(day)) return null;
  const value = `${yearMonth.slice(0, 4)}-${yearMonth.slice(4, 6)}-${day}`;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? value
    : null;
}

interface SelectedCoordinate {
  latitude: number;
  longitude: number;
  basis: "begin" | "end";
}

function selectCoordinate(
  beginLatitude: string,
  beginLongitude: string,
  endLatitude: string,
  endLongitude: string,
  area: BoundingBox
): SelectedCoordinate | null {
  const candidates = [
    { latitude: finiteNumber(beginLatitude), longitude: finiteNumber(beginLongitude), basis: "begin" as const },
    { latitude: finiteNumber(endLatitude), longitude: finiteNumber(endLongitude), basis: "end" as const },
  ];
  for (const candidate of candidates) {
    if (
      candidate.latitude !== null && candidate.longitude !== null &&
      candidate.latitude >= -90 && candidate.latitude <= 90 &&
      candidate.longitude >= -180 && candidate.longitude <= 180 &&
      inArea(area, candidate.latitude, candidate.longitude)
    ) {
      return { latitude: candidate.latitude, longitude: candidate.longitude, basis: candidate.basis };
    }
  }
  return null;
}

function sanitizeText(value: string, maximumLength: number): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, maximumLength);
}

interface NceiSelection {
  publicationUrl: string;
  publicationFile: string;
  area: BoundingBox;
  requestedDate: string;
  hazard: NceiStormEventsHazard;
}

/**
 * Row filter shared by the streaming and buffered paths. The first row is the
 * header; every later row is checked by column index (date, event type,
 * coordinate) before anything is allocated for it, and only matching rows
 * become observations. Rows are never retained.
 */
class NceiObservationCollector {
  private columns: Map<string, number> | null = null;
  private headerValid = false;
  private readonly seen = new Set<string>();
  private readonly observations: Observation[] = [];
  private readonly acceptedEvents: Set<string>;
  private readonly requestedYearMonth: string;

  constructor(private readonly selection: NceiSelection) {
    this.acceptedEvents = selection.hazard === "wind_storm" ? WIND_EVENTS : FLOOD_EVENTS;
    this.requestedYearMonth = `${selection.requestedDate.slice(0, 4)}${selection.requestedDate.slice(5, 7)}`;
  }

  accept(row: string[]): void {
    if (this.columns === null) {
      this.columns = this.readHeader(row);
      this.headerValid = REQUIRED_HEADERS.every((required) => this.columns?.has(required));
      return;
    }
    // Defer an invalid-header failure until finish() so a later malformed CSV
    // or UTF-8 sequence keeps the same precedence as the buffered legacy path,
    // which validated the complete payload before inspecting its schema.
    if (!this.headerValid) return;
    if (this.observations.length >= NCEI_STORM_EVENTS_MAX_OBSERVATIONS) return;
    const columns = this.columns;
    const value = (name: string): string => {
      const index = columns.get(name);
      return index === undefined ? "" : (row[index] ?? "");
    };
    const yearMonth = value("BEGIN_YEARMONTH");
    if (yearMonth !== this.requestedYearMonth) return;
    if (eventDate(yearMonth, value("BEGIN_DAY")) !== this.selection.requestedDate) return;
    const eventType = value("EVENT_TYPE");
    if (!this.acceptedEvents.has(eventType)) return;
    const coordinate = selectCoordinate(
      value("BEGIN_LAT"),
      value("BEGIN_LON"),
      value("END_LAT"),
      value("END_LON"),
      this.selection.area
    );
    if (!coordinate) return;
    const eventId = value("EVENT_ID").trim();
    if (!/^\d{1,12}$/u.test(eventId) || this.seen.has(eventId)) return;
    this.seen.add(eventId);
    const { publicationUrl, publicationFile, area, requestedDate, hazard } = this.selection;
    const location = sanitizeText(value("BEGIN_LOCATION") || value("CZ_NAME") || "reported location", 120);
    const narrative = sanitizeText(value("EVENT_NARRATIVE") || value("EPISODE_NARRATIVE"), 500);
    const summary = `${eventType} was recorded near ${location} in the NOAA NCEI Storm Events database.` +
      (narrative ? ` Source narrative: ${narrative}` : "");
    this.observations.push({
      observationId: `obs-ncei-storm-event-${eventId}`,
      provenance: {
        sourceId: "noaa_ncei_storm_events",
        sourceUrl: publicationUrl,
        sourceRecordId: eventId,
        // retrievedAt and payloadHash are known only once the whole payload
        // has been received; finish() fills them in.
        retrievedAt: "",
        observedAt: `${requestedDate}T00:00:00.000Z`,
        product: "NOAA NCEI Storm Events Database details bulk CSV v1.0",
        payloadHash: "",
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
        eventType,
        state: sanitizeText(value("STATE"), 60),
        countyOrZone: sanitizeText(value("CZ_NAME"), 120),
        reportedLatitude: coordinate.latitude,
        reportedLongitude: coordinate.longitude,
        coordinateBasis: coordinate.basis,
        beginLocation: location,
      },
    });
  }

  /** Completes the observations with the payload-level provenance; throws when no header row was seen. */
  finish(payloadHash: string, retrievedAt: string): Observation[] {
    if (this.columns === null || !this.headerValid) throw new NceiStormEventsError("schema_validation");
    for (const observation of this.observations) {
      observation.provenance.retrievedAt = retrievedAt;
      observation.provenance.payloadHash = payloadHash;
    }
    return this.observations;
  }

  private readHeader(row: string[]): Map<string, number> {
    const columns = new Map<string, number>();
    // A repeated header name resolves to its last column, as a record object would.
    row.forEach((header, index) => columns.set(normalizeHeader(header), index));
    return columns;
  }
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
  const collector = new NceiObservationCollector({ publicationUrl, publicationFile, area, requestedDate, hazard });
  for (const row of rows) collector.accept(row);
  return collector.finish(createHash("sha256").update(csvBytes).digest("hex"), retrievedAt);
}

function discardBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // A locked or already-consumed body has nothing left to release.
  }
}

/** Issues the request and validates status, content type and declared length; the body is left unread. */
async function openResponse(
  fetchImpl: typeof fetch,
  url: URL,
  signal: AbortSignal,
  maximumBytes: number,
  acceptedTypes: readonly string[]
): Promise<Response> {
  if (url.protocol !== "https:" || url.hostname !== NCEI_STORM_EVENTS_HOST) {
    throw new NceiStormEventsError("schema_validation");
  }
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal,
      headers: { Accept: acceptedTypes.join(", ") },
    });
  } catch {
    throw new NceiStormEventsError(signal.aborted ? "timeout" : "network");
  }
  const reject = (reason: NceiStormEventsFailureReason): never => {
    discardBody(response);
    throw new NceiStormEventsError(reason);
  };
  if (response.status >= 300 && response.status < 400) reject("redirect");
  if (response.status === 429) reject("rate_limited");
  if (!response.ok) reject("provider_failure");
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!acceptedTypes.includes(contentType)) reject("schema_validation");
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) reject("oversize");
  return response;
}

/** Buffered fetch for small documents such as the directory index. */
async function fetchBytes(
  fetchImpl: typeof fetch,
  url: URL,
  maximumBytes: number,
  acceptedTypes: readonly string[],
  timeoutMs: number
): Promise<Uint8Array> {
  const controller = new AbortController();
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let completed = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    void reader?.cancel(new NceiStormEventsError("timeout")).catch(() => undefined);
  }, timeoutMs);
  try {
    const response = await openResponse(fetchImpl, url, controller.signal, maximumBytes, acceptedTypes);
    if (!response.body) {
      completed = true;
      return new Uint8Array();
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        throw new NceiStormEventsError(timedOut || controller.signal.aborted ? "timeout" : "network");
      }
      if (timedOut) throw new NceiStormEventsError("timeout");
      if (result.done) break;
      received += result.value.byteLength;
      if (received > maximumBytes) throw new NceiStormEventsError("oversize");
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    completed = true;
    return bytes;
  } finally {
    if (!completed) {
      controller.abort();
      void reader?.cancel().catch(() => undefined);
    }
    clearTimeout(timeout);
  }
}

/**
 * Wraps the response body so that compressed bytes are counted against the
 * archive cap and transport failures are classified before decompression.
 * An error thrown here propagates through the decompressor to the consumer;
 * `onError` records it so the consumer can report it even if a stream
 * implementation were to replace the error object.
 */
function boundedByteSource(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
  signal: AbortSignal,
  onError: (error: NceiStormEventsError) => void
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let received = 0;
  const fail = (reason: NceiStormEventsFailureReason): never => {
    const error = new NceiStormEventsError(reason);
    onError(error);
    void reader.cancel(error).catch(() => undefined);
    throw error;
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        return fail(signal.aborted ? "timeout" : "network");
      }
      if (result.done) {
        controller.close();
        return;
      }
      received += result.value.byteLength;
      if (received > maximumBytes) return fail("oversize");
      controller.enqueue(result.value);
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => undefined);
    },
  });
}

interface DecompressedSink {
  chunk(bytes: Uint8Array): void;
  end(): void;
}

/**
 * Downloads and gunzips the details archive as one stream, handing each
 * decompressed chunk to the sink. Peak memory is a few stream buffers
 * regardless of the archive size; both byte caps are enforced while data
 * arrives so an oversize publication fails with its own reason instead of
 * exhausting the process.
 */
async function streamDetailsCsv(fetchImpl: typeof fetch, url: URL, sink: DecompressedSink): Promise<void> {
  const controller = new AbortController();
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    void reader?.cancel(new NceiStormEventsError("timeout")).catch(() => undefined);
  }, NCEI_STORM_EVENTS_DETAILS_TIMEOUT_MS);
  try {
    const response = await openResponse(
      fetchImpl,
      url,
      controller.signal,
      NCEI_STORM_EVENTS_GZIP_MAX_BYTES,
      DETAILS_CONTENT_TYPES
    );
    // An empty body is not a gzip archive.
    if (!response.body) throw new NceiStormEventsError("malformed");
    let sourceError: NceiStormEventsError | null = null;
    const compressed = boundedByteSource(response.body, NCEI_STORM_EVENTS_GZIP_MAX_BYTES, controller.signal, (error) => {
      sourceError = error;
    });
    const decompressor = new DecompressionStream("gzip") as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >;
    reader = compressed.pipeThrough(decompressor).getReader();
    let decompressedBytes = 0;
    let completed = false;
    try {
      for (;;) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch {
          // Transport and cap failures arrive tagged from the source; anything
          // else is the decompressor rejecting the archive.
          const tagged: NceiStormEventsError | null = sourceError;
          if (tagged) throw tagged;
          throw new NceiStormEventsError(timedOut || controller.signal.aborted ? "timeout" : "malformed");
        }
        if (timedOut) throw new NceiStormEventsError("timeout");
        if (result.done) break;
        decompressedBytes += result.value.byteLength;
        if (decompressedBytes > NCEI_STORM_EVENTS_CSV_MAX_BYTES) throw new NceiStormEventsError("oversize");
        sink.chunk(result.value);
      }
      completed = true;
    } finally {
      if (!completed) {
        // Stop the download as well as the decompressor; the failure reason
        // has already been decided, so aborting cannot be misread as a timeout.
        controller.abort();
        void reader.cancel().catch(() => undefined);
      }
    }
    if (timedOut) throw new NceiStormEventsError("timeout");
    sink.end();
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

function sourceFailure(error: unknown, stage: "index" | "details"): NceiStormEventsResult {
  return {
    kind: "source_failure",
    reason: error instanceof NceiStormEventsError ? error.reason : "malformed",
    stage,
  };
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
      INDEX_CONTENT_TYPES,
      NCEI_STORM_EVENTS_TIMEOUT_MS
    );
    const indexHtml = new TextDecoder("utf-8", { fatal: true }).decode(indexBytes);
    const selected = selectNceiDetailsFile(indexHtml, year);
    if (!selected) return { kind: "no_observation", publicationFile: `unpublished-year-${year}` };
    filename = selected;
  } catch (error) {
    return sourceFailure(error, "index");
  }
  const detailsUrl = new URL(`${indexUrl.toString()}${filename}`);
  try {
    const collector = new NceiObservationCollector({
      publicationUrl: detailsUrl.toString(),
      publicationFile: filename,
      area,
      requestedDate: date,
      hazard,
    });
    const parser = new NceiCsvRowParser({
      maximumRecordCharacters: NCEI_STORM_EVENTS_CSV_MAX_RECORD_CHARACTERS,
      maximumColumns: NCEI_STORM_EVENTS_CSV_MAX_COLUMNS,
    });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const hash = createHash("sha256");
    const decode = (bytes?: Uint8Array): string => {
      try {
        return bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode();
      } catch {
        throw new NceiStormEventsError("malformed");
      }
    };
    await streamDetailsCsv(fetchImpl, detailsUrl, {
      chunk(bytes) {
        hash.update(bytes);
        for (const row of parser.push(decode(bytes))) collector.accept(row);
      },
      end() {
        for (const row of parser.push(decode())) collector.accept(row);
        for (const row of parser.finish()) collector.accept(row);
      },
    });
    const observations = collector.finish(
      hash.digest("hex"),
      (dependencies.now?.() ?? new Date()).toISOString()
    );
    return observations.length > 0
      ? { kind: "observations", observations, publicationFile: filename }
      : { kind: "no_observation", publicationFile: filename };
  } catch (error) {
    return sourceFailure(error, "details");
  }
}
