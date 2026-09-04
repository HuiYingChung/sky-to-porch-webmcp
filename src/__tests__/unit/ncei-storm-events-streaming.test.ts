import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createGzip, gzipSync } from "node:zlib";
import { validateObservation } from "@/contracts/evidence";
import {
  NCEI_STORM_EVENTS_CSV_MAX_COLUMNS,
  NCEI_STORM_EVENTS_CSV_MAX_RECORD_CHARACTERS,
  NCEI_STORM_EVENTS_DETAILS_TIMEOUT_MS,
  NCEI_STORM_EVENTS_GZIP_MAX_BYTES,
  NCEI_STORM_EVENTS_HOST,
  NCEI_STORM_EVENTS_INDEX_MAX_BYTES,
  NCEI_STORM_EVENTS_INDEX_PATH,
  NCEI_STORM_EVENTS_TIMEOUT_MS,
  NceiCsvRowParser,
  observationsFromNceiCsv,
  parseNceiCsv,
  queryNceiStormEvents,
} from "@/lib/storm/ncei-storm-events-live-adapter";

const AREA = { west: -96, south: 29, east: -95, north: 30 };
const NOW = new Date("2026-09-03T00:00:00.000Z");
const INDEX_URL = `https://${NCEI_STORM_EVENTS_HOST}${NCEI_STORM_EVENTS_INDEX_PATH}`;
const FILENAME = "StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz";
const DETAILS_URL = `${INDEX_URL}${FILENAME}`;
const HEADER = "BEGIN_YEARMONTH,BEGIN_DAY,EVENT_ID,EVENT_TYPE,STATE,CZ_NAME,BEGIN_LOCATION,BEGIN_LAT,BEGIN_LON,END_LAT,END_LON,EPISODE_NARRATIVE,EVENT_NARRATIVE";

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hex(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseChunks(chunks: string[]): string[][] {
  const parser = new NceiCsvRowParser();
  const rows: string[][] = [];
  for (const chunk of chunks) rows.push(...parser.push(chunk));
  rows.push(...parser.finish());
  return rows;
}

function decodeChunks(hexChunks: string[]): { texts: string[]; flush: () => string } {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const texts = hexChunks.map((chunk) => decoder.decode(hex(chunk), { stream: true }));
  return { texts, flush: () => decoder.decode() };
}

describe("NceiCsvRowParser chunk boundaries", () => {
  const LONG_A = "a".repeat(64);
  const LONG_B = "b".repeat(64);
  const LONG_C = "c".repeat(64);
  const HUGE_A = "a".repeat(65_536);
  const HUGE_B = "b".repeat(65_536);
  const HUGE_C = "c".repeat(65_536);

  const cases: Array<{ name: string; chunks: string[]; rows: string[][] }> = [
    {
      name: "escaped quote split across chunks",
      chunks: ['1,"Wind gust of 60 mph "', '"est"" near Katy",TX\n'],
      rows: [["1", 'Wind gust of 60 mph "est" near Katy', "TX"]],
    },
    {
      name: "closing quote at chunk end then comma",
      chunks: ['1,"Houston, TX"', ",Thunderstorm Wind\n"],
      rows: [["1", "Houston, TX", "Thunderstorm Wind"]],
    },
    {
      name: "closing quote at chunk end then LF",
      chunks: ['1,"Harris"', '\n2,"Fort Bend"\n'],
      rows: [["1", "Harris"], ["2", "Fort Bend"]],
    },
    {
      name: "closing quote at chunk end then CRLF",
      chunks: ['1,"a"', "\r\n2,b\n"],
      rows: [["1", "a"], ["2", "b"]],
    },
    {
      name: "closing quote ends the final chunk without a trailing newline",
      chunks: ['1,"Harris"'],
      rows: [["1", "Harris"]],
    },
    {
      name: "opening quote at chunk end",
      chunks: ['1,"', 'a,b",2\n'],
      rows: [["1", "a,b", "2"]],
    },
    {
      name: "CR at chunk end, LF at next chunk start",
      chunks: ["1,Harris\r", "\n2,Galveston\r\n"],
      rows: [["1", "Harris"], ["2", "Galveston"]],
    },
    {
      name: "embedded newline in a quoted narrative split across chunks",
      chunks: ['1,"Line one of narrative\n', 'line two\r\nline three",TX\n'],
      rows: [["1", "Line one of narrative\nline two\r\nline three", "TX"]],
    },
    {
      name: "plain field split mid-field",
      chunks: ["1,Thunder", "storm Wind,TX\n"],
      rows: [["1", "Thunderstorm Wind", "TX"]],
    },
    {
      name: "empty chunks around plain data",
      chunks: ["", "1,", "", "a\n", "", ""],
      rows: [["1", "a"]],
    },
    {
      name: "empty chunk while a quote is pending",
      chunks: ['1,"a"', "", '"b"', "", ",c\n"],
      rows: [["1", 'a"b', "c"]],
    },
    {
      name: "header only",
      chunks: [`${HEADER}\n`],
      rows: [HEADER.split(",")],
    },
    { name: "empty input with no chunks", chunks: [], rows: [] },
    { name: "empty input with a single empty chunk", chunks: [""], rows: [] },
    {
      name: "BOM passes through to header normalisation",
      chunks: ["\uFEFFEVENT_ID,EVENT_TYPE\n", "1,Hail\n"],
      rows: [["\uFEFFEVENT_ID", "EVENT_TYPE"], ["1", "Hail"]],
    },
    {
      name: "all-empty rows are skipped, including a comma/newline split across chunks",
      chunks: ["1,a\n", ",\n", "\n", '"",""\n', ",", "\n2,b\n"],
      rows: [["1", "a"], ["2", "b"]],
    },
    {
      name: "long field spanning five chunks",
      chunks: ['1,"', LONG_A, LONG_B, LONG_C, '",TX\n'],
      rows: [["1", `${LONG_A}${LONG_B}${LONG_C}`, "TX"]],
    },
    {
      name: "long field spanning five 64 KiB chunks",
      chunks: ['1,"', HUGE_A, HUGE_B, HUGE_C, '",TX\n'],
      rows: [["1", `${HUGE_A}${HUGE_B}${HUGE_C}`, "TX"]],
    },
    {
      name: "multibyte text split at code point boundaries",
      chunks: ['1,"Kī', "lauea — 🌪", ' plume",HI\n'],
      rows: [["1", "Kīlauea — 🌪 plume", "HI"]],
    },
    {
      name: "legacy leniency: text after a closing quote and a quote inside an unquoted field",
      chunks: ['1,"ab"', 'cd,e\n2,b"c,d\n'],
      rows: [["1", "abcd", "e"], ["2", 'b"c', "d"]],
    },
    {
      name: "CR strip quirks: one terminal CR only, quoted CR before LF stripped, lone CR preserved",
      chunks: ["1,abc\r", '\r\n1,"abc\r"', "\n1,a\rb\n"],
      rows: [["1", "abc\r"], ["1", "abc"], ["1", "a\rb"]],
    },
    { name: "trailing comma then finish", chunks: ["1,a,"], rows: [["1", "a", ""]] },
    { name: "quote-only field variants", chunks: ['1,"",""""\n'], rows: [["1", "", '"']] },
  ];

  it.each(cases)("$name", ({ chunks, rows }) => {
    expect(parseChunks(chunks)).toEqual(rows);
    // Any chunking must agree with the whole-text parse.
    expect(parseNceiCsv(chunks.join(""))).toEqual(rows);
  });

  it("emits rows as soon as their newline arrives and carries partial rows", () => {
    const parser = new NceiCsvRowParser();
    expect(parser.push("h1,h2\n1,a\n2,")).toEqual([["h1", "h2"], ["1", "a"]]);
    expect(parser.push("b\n3,c\n")).toEqual([["2", "b"], ["3", "c"]]);
    expect(parser.finish()).toEqual([]);
  });

  it("starts a fresh row after a chunk boundary that follows a newline", () => {
    const parser = new NceiCsvRowParser();
    expect(parser.push("1,a\n")).toEqual([["1", "a"]]);
    expect(parser.push("2,b\n")).toEqual([["2", "b"]]);
    expect(parser.finish()).toEqual([]);
  });

  it("emits a row only when its LF arrives and flushes the last row on finish", () => {
    const parser = new NceiCsvRowParser();
    expect(parser.push("1,a")).toEqual([]);
    expect(parser.push("\n2,b")).toEqual([["1", "a"]]);
    expect(parser.finish()).toEqual([["2", "b"]]);
  });

  it("reports an unterminated quote as malformed only at finish", () => {
    const parser = new NceiCsvRowParser();
    expect(parser.push('1,"Harris')).toEqual([]);
    expect(parser.push(",TX\n2,Galveston\n")).toEqual([]);
    let failure: unknown;
    try {
      parser.finish();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ name: "NceiStormEventsError", reason: "malformed" });
    expect(() => parseNceiCsv('1,"Harris,TX\n2,Galveston\n')).toThrow("malformed");
  });

  it("keeps the exported parser unbounded unless live-stream limits are supplied", () => {
    const record = "x".repeat(NCEI_STORM_EVENTS_CSV_MAX_RECORD_CHARACTERS + 1);
    expect(parseChunks([record])).toEqual([[record]]);
    const limited = new NceiCsvRowParser({
      maximumRecordCharacters: NCEI_STORM_EVENTS_CSV_MAX_RECORD_CHARACTERS,
      maximumColumns: NCEI_STORM_EVENTS_CSV_MAX_COLUMNS,
    });
    expect(() => limited.push(record)).toThrow("oversize");

    const extraColumns = `${Array.from({ length: NCEI_STORM_EVENTS_CSV_MAX_COLUMNS + 1 }, () => "x").join(",")}\n`;
    expect(parseNceiCsv(extraColumns)[0]).toHaveLength(NCEI_STORM_EVENTS_CSV_MAX_COLUMNS + 1);
    const columnLimited = new NceiCsvRowParser({
      maximumRecordCharacters: NCEI_STORM_EVENTS_CSV_MAX_RECORD_CHARACTERS,
      maximumColumns: NCEI_STORM_EVENTS_CSV_MAX_COLUMNS,
    });
    expect(() => columnLimited.push(extraColumns)).toThrow("oversize");
  });

  it("counts split closing and escaped quotes exactly at a live record limit", () => {
    const closing = new NceiCsvRowParser({ maximumRecordCharacters: 6, maximumColumns: 3 });
    expect(closing.push('1,"ab"')).toEqual([]);
    expect(closing.push("\n")).toEqual([["1", "ab"]]);

    const escaped = new NceiCsvRowParser({ maximumRecordCharacters: 8, maximumColumns: 3 });
    expect(escaped.push('1,"a"')).toEqual([]);
    expect(escaped.push('"b"')).toEqual([]);
    expect(escaped.push("\n")).toEqual([["1", 'a"b']]);

    const oneTooMany = new NceiCsvRowParser({ maximumRecordCharacters: 7, maximumColumns: 3 });
    expect(oneTooMany.push('1,"a"')).toEqual([]);
    expect(() => oneTooMany.push('"b"')).toThrow("oversize");
  });

  it("keeps the header-only and empty-input outcomes at the adapter level", () => {
    expect(observationsFromNceiCsv(bytes(`${HEADER}\n`), DETAILS_URL, FILENAME, AREA, "2024-05-16", "wind_storm", NOW.toISOString()))
      .toEqual([]);
    expect(() => observationsFromNceiCsv(bytes(""), DETAILS_URL, FILENAME, AREA, "2024-05-16", "wind_storm", NOW.toISOString()))
      .toThrow("schema_validation");
  });
});

describe("streaming UTF-8 decoding ahead of the parser", () => {
  it("reassembles multibyte sequences split across byte chunks", () => {
    const { texts, flush } = decodeChunks(["312c224bc4", "ab6c6175656120e2", "80942078222c48490a"]);
    expect(texts).toEqual(['1,"K', "īlauea ", '— x",HI\n']);
    expect(flush()).toBe("");
    expect(parseChunks(texts)).toEqual([["1", "Kīlauea — x", "HI"]]);
  });

  it("rejects a truncated sequence at end of stream on the final flush", () => {
    const { texts, flush } = decodeChunks(["312c2278222c48490a322c22e280"]);
    expect(texts).toEqual(['1,"x",HI\n2,"']);
    expect(flush).toThrow(TypeError);
  });

  it("strips a BOM that is split across byte chunks", () => {
    const { texts, flush } = decodeChunks(["efbb", "bf452c540a"]);
    expect(texts.join("")).toBe("E,T\n");
    expect(flush()).toBe("");
    expect(parseChunks(texts)).toEqual([["E", "T"]]);
  });
});

const CSV_ROWS = [
  HEADER,
  '202405,16,1167816,Thunderstorm Wind,TEXAS,HARRIS,HOUSTON,29.76,-95.37,29.8,-95.3,"Episode text","A 60 mph ""estimated"" gust snapped trees.\nSecond line, with comma."',
  '202405,16,1188087,Flash Flood,TEXAS,HARRIS,,29.7,-95.4,,,"Flooding",',
  "202405,16,1167851,Thunderstorm Wind,TEXAS,GALVESTON,,31.0,-97.0,29.3,-95.0,,Begins outside; ends inside",
  "202405,16,1167816,Thunderstorm Wind,TEXAS,HARRIS,HOUSTON,29.76,-95.37,,,,Duplicate event id",
  "202405,17,1167899,Thunderstorm Wind,TEXAS,HARRIS,,29.76,-95.37,,,,Wrong date",
  "202405,16,2000000,Hail,TEXAS,HARRIS,,31.5,-97.5,,,,Outside the area",
  "202405,16,ABC,Tornado,TEXAS,HARRIS,,29.7,-95.4,,,,Invalid event id",
  "202405,16,1167853,Marine Thunderstorm Wind,TEXAS,GALVESTON BAY,,29.3,-95.0,,,,Bay gust",
];
const CSV_TEXT = `${CSV_ROWS.join("\n")}\n`;
const CSV_BYTES = bytes(CSV_TEXT);

function chunkedStream(
  source: Uint8Array,
  chunkSize: number,
  failAfter?: number,
  onCancel?: (reason: unknown) => void
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter !== undefined && offset >= failAfter) {
        controller.error(new Error("socket hang up"));
        return;
      }
      if (offset >= source.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(source.slice(offset, Math.min(offset + chunkSize, source.byteLength)));
      offset += chunkSize;
    },
    cancel(reason) {
      onCancel?.(reason);
    },
  });
}

function gzipResponse(
  gzipBytes: Uint8Array,
  options: {
    chunkSize?: number;
    headers?: Record<string, string>;
    failAfter?: number;
    onCancel?: (reason: unknown) => void;
    status?: number;
  } = {}
): Response {
  const headers = options.headers ?? {
    "content-type": "application/gzip",
    "content-length": String(gzipBytes.byteLength),
  };
  return new Response(chunkedStream(gzipBytes, options.chunkSize ?? 7, options.failAfter, options.onCancel), {
    status: options.status ?? 200,
    headers,
  });
}

function indexResponse(html = `<a href="${FILENAME}">${FILENAME}</a>`, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html" } });
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(details: () => Response | Promise<Response>, index: () => Response = () => indexResponse()) {
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === INDEX_URL) return index();
    if (url === DETAILS_URL) return details();
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function gzipRepeatedLines(header: string, line: Uint8Array, repeats: number): Promise<Uint8Array> {
  const gzip = createGzip({ level: 1 });
  const parts: Buffer[] = [];
  gzip.on("data", (part: Buffer) => parts.push(part));
  const ended = once(gzip, "end");
  gzip.write(bytes(`${header}\n`));
  for (let index = 0; index < repeats; index += 1) {
    if (!gzip.write(line)) await once(gzip, "drain");
  }
  gzip.end();
  await ended;
  return Uint8Array.from(Buffer.concat(parts));
}

describe("queryNceiStormEvents streaming download", () => {
  it("streams a chunked gzip archive and matches the buffered path", async () => {
    const gz = gzipSync(CSV_BYTES);
    const { fetchImpl, calls } = stubFetch(() => gzipResponse(gz, { chunkSize: 7 }));
    const result = await queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl, now: () => NOW });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") return;
    expect(result.publicationFile).toBe(FILENAME);
    expect(result.observations.map((item) => item.provenance.sourceRecordId)).toEqual(["1167816", "1167851", "1167853"]);
    expect(result.observations.map((item) => item.metadata?.coordinateBasis)).toEqual(["begin", "end", "begin"]);
    expect(result.observations[0].textValue).toContain('Source narrative: A 60 mph "estimated" gust snapped trees. Second line, with comma.');
    expect(result.observations[0].metadata).toMatchObject({
      eventType: "Thunderstorm Wind",
      state: "TEXAS",
      countyOrZone: "HARRIS",
      beginLocation: "HOUSTON",
      reportedLatitude: 29.76,
      reportedLongitude: -95.37,
    });
    const payloadHash = sha256(CSV_BYTES);
    for (const observation of result.observations) {
      expect(observation.provenance.payloadHash).toBe(payloadHash);
      expect(observation.provenance.retrievedAt).toBe(NOW.toISOString());
      expect(observation.provenance.sourceUrl).toBe(DETAILS_URL);
      expect(observation.provenance.requestParameters).toMatchObject({ publicationFile: FILENAME, hazard: "wind_storm", requestedDate: "2024-05-16" });
      expect(() => validateObservation(observation)).not.toThrow();
    }
    expect(result.observations).toEqual(
      observationsFromNceiCsv(CSV_BYTES, DETAILS_URL, FILENAME, AREA, "2024-05-16", "wind_storm", NOW.toISOString())
    );
    const detailsCall = calls.find((call) => call.url === DETAILS_URL);
    expect(detailsCall?.init).toMatchObject({ method: "GET", redirect: "manual", cache: "no-store" });
    expect((detailsCall?.init?.headers as Record<string, string>).Accept).toContain("application/gzip");
    expect(detailsCall?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("normalizes a real BOM when it is preserved inside the quoted first header", async () => {
    const csv = CSV_TEXT.replace("BEGIN_YEARMONTH", '"\uFEFFBEGIN_YEARMONTH"');
    const { fetchImpl } = stubFetch(() => gzipResponse(gzipSync(bytes(csv)), { chunkSize: 2 }));
    const result = await queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", {
      fetchImpl,
      now: () => NOW,
    });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") return;
    expect(result.observations.map((item) => item.provenance.sourceRecordId)).toEqual([
      "1167816",
      "1167851",
      "1167853",
    ]);
  });

  it("applies the flood event filter to the same stream", async () => {
    const { fetchImpl } = stubFetch(() => gzipResponse(gzipSync(CSV_BYTES), { chunkSize: 3 }));
    const result = await queryNceiStormEvents(AREA, "2024-05-16", "flood_storm", { fetchImpl, now: () => NOW });
    expect(result.kind).toBe("observations");
    if (result.kind !== "observations") return;
    expect(result.observations.map((item) => item.provenance.sourceRecordId)).toEqual(["1188087"]);
    expect(result.observations[0].metadata?.eventType).toBe("Flash Flood");
  });

  it("returns no_observation for a date with no in-area event and for an unpublished year", async () => {
    const { fetchImpl } = stubFetch(() => gzipResponse(gzipSync(CSV_BYTES)));
    await expect(queryNceiStormEvents(AREA, "2024-07-08", "wind_storm", { fetchImpl, now: () => NOW }))
      .resolves.toEqual({ kind: "no_observation", publicationFile: FILENAME });
    const missingYear = stubFetch(() => gzipResponse(gzipSync(CSV_BYTES)), () => indexResponse("StormEvents_details-ftp_v1.0_d2023_c20240101.csv.gz"));
    await expect(queryNceiStormEvents(AREA, "2024-07-08", "wind_storm", { fetchImpl: missingYear.fetchImpl }))
      .resolves.toEqual({ kind: "no_observation", publicationFile: "unpublished-year-2024" });
    expect(missingYear.calls.map((call) => call.url)).toEqual([INDEX_URL]);
  });

  it("keeps a header-only archive as no_observation", async () => {
    const { fetchImpl } = stubFetch(() => gzipResponse(gzipSync(bytes(`${HEADER}\n`))));
    await expect(queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl }))
      .resolves.toEqual({ kind: "no_observation", publicationFile: FILENAME });
  });

  const detailFailures: Array<{ name: string; response: () => Response; reason: string }> = [
    {
      name: "declared content-length above the archive cap",
      response: () => gzipResponse(gzipSync(CSV_BYTES), { headers: { "content-type": "application/gzip", "content-length": String(NCEI_STORM_EVENTS_GZIP_MAX_BYTES + 1) } }),
      reason: "oversize",
    },
    { name: "redirect status", response: () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }), reason: "redirect" },
    { name: "rate limited status", response: () => new Response("slow down", { status: 429 }), reason: "rate_limited" },
    { name: "server error status", response: () => new Response("boom", { status: 503 }), reason: "provider_failure" },
    {
      name: "unexpected content type",
      response: () => gzipResponse(gzipSync(CSV_BYTES), { headers: { "content-type": "text/html" } }),
      reason: "schema_validation",
    },
    { name: "body that is not gzip", response: () => gzipResponse(bytes("BEGIN_YEARMONTH,not,gzip\n")), reason: "malformed" },
    { name: "truncated gzip archive", response: () => gzipResponse(gzipSync(CSV_BYTES).subarray(0, 40)), reason: "malformed" },
    {
      name: "invalid UTF-8 inside the archive",
      response: () => gzipResponse(gzipSync(hex("312c2278222c48490a322c22e280"))),
      reason: "malformed",
    },
    {
      name: "unterminated quote inside the archive",
      response: () => gzipResponse(gzipSync(bytes(`${HEADER}\n202405,16,1,Hail,TX,"Harris,,29.5,-95.5,,,,\n`))),
      reason: "malformed",
    },
    {
      name: "missing required header",
      response: () => gzipResponse(gzipSync(bytes("EVENT_ID,EVENT_TYPE\n1,Hail\n"))),
      reason: "schema_validation",
    },
    { name: "empty archive", response: () => gzipResponse(gzipSync(bytes(""))), reason: "schema_validation" },
    { name: "empty body", response: () => new Response(null, { status: 200, headers: { "content-type": "application/gzip" } }), reason: "malformed" },
    {
      name: "transport failure mid-stream",
      response: () => gzipResponse(gzipSync(CSV_BYTES), { chunkSize: 16, failAfter: 32 }),
      reason: "network",
    },
  ];

  it.each(detailFailures)("reports $name as $reason at the details stage", async ({ response, reason }) => {
    const { fetchImpl } = stubFetch(response);
    await expect(queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl }))
      .resolves.toEqual({ kind: "source_failure", reason, stage: "details" });
  });

  it("reports a rejected details request as network", async () => {
    const { fetchImpl } = stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    await expect(queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl }))
      .resolves.toEqual({ kind: "source_failure", reason: "network", stage: "details" });
  });

  it("never returns observations collected before a later malformed record", async () => {
    const csv = `${HEADER}\n${CSV_ROWS[1]}\n202405,16,9999999,Hail,TEXAS,HARRIS,,29.7,-95.4,,,,"unterminated`;
    const { fetchImpl } = stubFetch(() => gzipResponse(gzipSync(bytes(csv)), { chunkSize: 11 }));
    const result = await queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl });
    expect(result).toEqual({ kind: "source_failure", reason: "malformed", stage: "details" });
    expect(result).not.toHaveProperty("observations");
  });

  it("enforces the compressed-byte cap while the archive streams", async () => {
    // Stored (level 0) deflate keeps the compressed size close to the raw size,
    // so 41 MB of rows exceed the 40 MB archive cap without any content-length.
    const line = Buffer.concat([Buffer.alloc(65_535, 0x78), Buffer.from("\n")]);
    const raw = Buffer.concat([Buffer.from(`${HEADER}\n`), Buffer.alloc(41_000_000, line)]);
    const gz = gzipSync(raw, { level: 0 });
    expect(gz.byteLength).toBeGreaterThan(NCEI_STORM_EVENTS_GZIP_MAX_BYTES);
    const onCancel = vi.fn();
    const { fetchImpl, calls } = stubFetch(() => gzipResponse(gz, {
      chunkSize: 1_048_576,
      headers: { "content-type": "application/gzip" },
      onCancel,
    }));
    const result = await queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl });
    expect(result).toEqual({ kind: "source_failure", reason: "oversize", stage: "details" });
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(calls.find((call) => call.url === DETAILS_URL)?.init?.signal?.aborted).toBe(true);
  }, 30_000);

  it("enforces the decompressed-byte cap while the archive streams", async () => {
    // Highly compressible rows: about 181 MB decompressed from a small archive.
    const line = Uint8Array.from(Buffer.concat([Buffer.alloc(65_535, 0x78), Buffer.from("\n")]));
    const gz = await gzipRepeatedLines(HEADER, line, Math.ceil(181_000_000 / line.byteLength));
    expect(gz.byteLength).toBeLessThan(NCEI_STORM_EVENTS_GZIP_MAX_BYTES);
    const { fetchImpl, calls } = stubFetch(() => gzipResponse(gz, { chunkSize: 65_536 }));
    const result = await queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl });
    expect(result).toEqual({ kind: "source_failure", reason: "oversize", stage: "details" });
    expect(calls.find((call) => call.url === DETAILS_URL)?.init?.signal?.aborted).toBe(true);
  }, 60_000);

  it.each([
    {
      name: "logical record",
      row: "x".repeat(NCEI_STORM_EVENTS_CSV_MAX_RECORD_CHARACTERS + 1),
    },
    {
      name: "column count",
      row: Array.from({ length: NCEI_STORM_EVENTS_CSV_MAX_COLUMNS + 1 }, () => "x").join(","),
    },
  ])("bounds the live parser $name", async ({ row }) => {
    const gz = gzipSync(bytes(`${HEADER}\n${row}\n`));
    const { fetchImpl, calls } = stubFetch(() => gzipResponse(gz, { chunkSize: 257 }));
    const result = await queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl });
    expect(result).toEqual({ kind: "source_failure", reason: "oversize", stage: "details" });
    expect(calls.find((call) => call.url === DETAILS_URL)?.init?.signal?.aborted).toBe(true);
  });

  it("enforces the index cap without Content-Length and cancels the source", async () => {
    const repeatedChunk = new Uint8Array(Math.floor(NCEI_STORM_EVENTS_INDEX_MAX_BYTES / 2) + 1).fill(0x61);
    const onCancel = vi.fn();
    const index = () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(repeatedChunk);
      },
      cancel: onCancel,
    }, { highWaterMark: 0 }), {
      headers: { "content-type": "text/html" },
    });
    const { fetchImpl, calls } = stubFetch(() => gzipResponse(gzipSync(CSV_BYTES)), index);
    const result = await queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl });
    expect(result).toEqual({ kind: "source_failure", reason: "oversize", stage: "index" });
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(calls).toHaveLength(1);
    expect(calls[0].init?.signal?.aborted).toBe(true);
  });

  it("aborts an index request at its timeout", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      })) as unknown as typeof fetch;
      const pending = queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl });
      await vi.advanceTimersByTimeAsync(NCEI_STORM_EVENTS_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ kind: "source_failure", reason: "timeout", stage: "index" });
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts and cancels a stalled index body at its timeout", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const onCancel = vi.fn();
      let bodyStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        bodyStarted = resolve;
      });
      const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Response(new ReadableStream<Uint8Array>({
          pull() {
            bodyStarted();
            return new Promise<void>(() => undefined);
          },
          cancel(reason) {
            onCancel(reason);
            return new Promise<void>(() => undefined);
          },
        }, { highWaterMark: 0 }), {
          headers: { "content-type": "text/html" },
        });
      }) as unknown as typeof fetch;
      const pending = queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl });
      await started;
      await vi.advanceTimersByTimeAsync(NCEI_STORM_EVENTS_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ kind: "source_failure", reason: "timeout", stage: "index" });
      expect(signal?.aborted).toBe(true);
      expect(onCancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts and cancels a stalled details body at its timeout", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const onCancel = vi.fn();
      let detailsStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        detailsStarted = resolve;
      });
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === INDEX_URL) return indexResponse();
        signal = init?.signal ?? undefined;
        detailsStarted();
        return new Response(new ReadableStream<Uint8Array>({
          pull() {
            return new Promise<void>(() => undefined);
          },
          cancel(reason) {
            onCancel(reason);
            return new Promise<void>(() => undefined);
          },
        }, { highWaterMark: 0 }), {
          headers: { "content-type": "application/gzip" },
        });
      }) as unknown as typeof fetch;
      const pending = queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl });
      await started;
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(NCEI_STORM_EVENTS_DETAILS_TIMEOUT_MS);
      await expect(pending).resolves.toEqual({ kind: "source_failure", reason: "timeout", stage: "details" });
      expect(signal?.aborted).toBe(true);
      expect(onCancel).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports index-stage failures separately", async () => {
    const failing = stubFetch(() => gzipResponse(gzipSync(CSV_BYTES)), () => indexResponse("", 500));
    await expect(queryNceiStormEvents(AREA, "2024-05-16", "wind_storm", { fetchImpl: failing.fetchImpl }))
      .resolves.toEqual({ kind: "source_failure", reason: "provider_failure", stage: "index" });
    expect(failing.calls.map((call) => call.url)).toEqual([INDEX_URL]);
    await expect(queryNceiStormEvents({ west: 1 }, "2024-05-16", "wind_storm", { fetchImpl: failing.fetchImpl }))
      .resolves.toEqual({ kind: "source_failure", reason: "schema_validation", stage: "index" });
    await expect(queryNceiStormEvents(AREA, "2024/05/16", "wind_storm", { fetchImpl: failing.fetchImpl }))
      .resolves.toEqual({ kind: "source_failure", reason: "schema_validation", stage: "index" });
  });
});
