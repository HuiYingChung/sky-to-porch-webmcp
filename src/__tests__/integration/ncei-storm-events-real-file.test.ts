/**
 * Streaming checks against one fingerprinted NCEI Storm Events publication on
 * local disk. The archive is not committed; set NCEI_STORM_EVENTS_LOCAL_GZ to
 * the c20260728 2024 details archive to enable the suite. The default
 * integration gate therefore stays offline and fast.
 *
 * This suite intentionally never gunzips, decodes, or retains the whole file.
 * Run it with NODE_OPTIONS=--max-old-space-size=256 to exercise the same bounded
 * path under a constrained V8 heap.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { getHeapStatistics } from "node:v8";
import { createGunzip } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  NCEI_STORM_EVENTS_CSV_MAX_COLUMNS,
  NCEI_STORM_EVENTS_CSV_MAX_RECORD_CHARACTERS,
  NCEI_STORM_EVENTS_HOST,
  NCEI_STORM_EVENTS_INDEX_PATH,
  NceiCsvRowParser,
  queryNceiStormEvents,
} from "@/lib/storm/ncei-storm-events-live-adapter";

const GZ_PATH = process.env.NCEI_STORM_EVENTS_LOCAL_GZ;
const AVAILABLE = Boolean(GZ_PATH && existsSync(GZ_PATH));
const FILENAME = "StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz";
const INDEX_URL = `https://${NCEI_STORM_EVENTS_HOST}${NCEI_STORM_EVENTS_INDEX_PATH}`;
const DETAILS_URL = `${INDEX_URL}${FILENAME}`;
const HOUSTON = {
  west: -96.01605980128672,
  south: 29.050844412504492,
  east: -94.98394019871328,
  north: 29.949155587495508,
};
const NOW = new Date("2026-09-03T00:00:00.000Z");
const CHUNK_BYTES = 65_536;
const MB = 1_048_576;

/** Independent anchors for exactly the official 2024 publication revision c20260728. */
const KNOWN_2024 = {
  gzipBytes: 12_693_243,
  gzipDigest: "2070b83eccab041b36360ab73645b9a249c3eefc5b92b5b3fc0cbba4d9fcc09c",
  csvBytes: 69_861_911,
  csvDigest: "e278ecef5b99b6b7a5bfdeff0e7b75da1b14f36a0c893f272c9afb92abf7f3e3",
  rows: 69_802,
  width: 51,
  header: "BEGIN_YEARMONTH,BEGIN_DAY,BEGIN_TIME,END_YEARMONTH,END_DAY,END_TIME,EPISODE_ID,EVENT_ID,STATE,STATE_FIPS,YEAR,MONTH_NAME,EVENT_TYPE,CZ_TYPE,CZ_FIPS,CZ_NAME,WFO,BEGIN_DATE_TIME,CZ_TIMEZONE,END_DATE_TIME,INJURIES_DIRECT,INJURIES_INDIRECT,DEATHS_DIRECT,DEATHS_INDIRECT,DAMAGE_PROPERTY,DAMAGE_CROPS,SOURCE,MAGNITUDE,MAGNITUDE_TYPE,FLOOD_CAUSE,CATEGORY,TOR_F_SCALE,TOR_LENGTH,TOR_WIDTH,TOR_OTHER_WFO,TOR_OTHER_CZ_STATE,TOR_OTHER_CZ_FIPS,TOR_OTHER_CZ_NAME,BEGIN_RANGE,BEGIN_AZIMUTH,BEGIN_LOCATION,END_RANGE,END_AZIMUTH,END_LOCATION,BEGIN_LAT,BEGIN_LON,END_LAT,END_LON,EPISODE_NARRATIVE,EVENT_NARRATIVE,DATA_SOURCE".split(","),
  houston20240516WindEventIds: [
    "1167816", "1167851", "1167853", "1167865", "1167868", "1188426",
    "1167856", "1167866", "1192624", "1188087", "1188417", "1167848",
  ],
} as const;

function fileStream(path: string): ReadableStream<Uint8Array> {
  let handle: FileHandle | null = null;
  let position = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!handle) handle = await open(path, "r");
      const buffer = new Uint8Array(CHUNK_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, position);
      if (bytesRead === 0) {
        await handle.close();
        handle = null;
        controller.close();
        return;
      }
      position += bytesRead;
      controller.enqueue(bytesRead === CHUNK_BYTES ? buffer : buffer.subarray(0, bytesRead));
    },
    async cancel() {
      await handle?.close();
      handle = null;
    },
  });
}

function fetchFromDisk(path: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === INDEX_URL) {
      return new Response(`<a href="${FILENAME}">${FILENAME}</a>`, {
        headers: { "content-type": "text/html" },
      });
    }
    if (url === DETAILS_URL) {
      return new Response(fileStream(path), {
        headers: {
          "content-type": "application/gzip",
          "content-length": String(statSync(path).size),
        },
      });
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

interface PublicationScan {
  gzipBytes: number;
  gzipDigest: string;
  csvBytes: number;
  csvDigest: string;
  rows: number;
  wrongWidthRows: number;
  header: string[] | null;
}

async function scanPublication(path: string): Promise<PublicationScan> {
  const gzipHash = createHash("sha256");
  const csvHash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parser = new NceiCsvRowParser({
    maximumRecordCharacters: NCEI_STORM_EVENTS_CSV_MAX_RECORD_CHARACTERS,
    maximumColumns: NCEI_STORM_EVENTS_CSV_MAX_COLUMNS,
  });
  let gzipBytes = 0;
  let csvBytes = 0;
  let rows = 0;
  let wrongWidthRows = 0;
  let header: string[] | null = null;
  const accept = (row: string[]): void => {
    rows += 1;
    if (row.length !== KNOWN_2024.width) wrongWidthRows += 1;
    if (header === null) header = [...row];
  };

  const compressed = createReadStream(path);
  compressed.on("data", (chunk: string | Buffer) => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    gzipBytes += bytes.byteLength;
    gzipHash.update(bytes);
  });
  const decompressed = compressed.pipe(createGunzip());
  for await (const chunk of decompressed) {
    const bytes = chunk as Buffer;
    csvBytes += bytes.byteLength;
    csvHash.update(bytes);
    for (const row of parser.push(decoder.decode(bytes, { stream: true }))) accept(row);
  }
  for (const row of parser.push(decoder.decode())) accept(row);
  for (const row of parser.finish()) accept(row);

  return {
    gzipBytes,
    gzipDigest: gzipHash.digest("hex"),
    csvBytes,
    csvDigest: csvHash.digest("hex"),
    rows,
    wrongWidthRows,
    header,
  };
}

describe.skipIf(!AVAILABLE)("NCEI Storm Events streaming adapter against the local annual archive", () => {
  const path = GZ_PATH as string;

  it("matches the fixed publication fingerprint and row shape without whole-file buffering", async () => {
    const scan = await scanPublication(path);
    expect(scan).toEqual({
      gzipBytes: KNOWN_2024.gzipBytes,
      gzipDigest: KNOWN_2024.gzipDigest,
      csvBytes: KNOWN_2024.csvBytes,
      csvDigest: KNOWN_2024.csvDigest,
      rows: KNOWN_2024.rows,
      wrongWidthRows: 0,
      header: [...KNOWN_2024.header],
    });
  }, 120_000);

  it("returns fixed Houston semantic anchors with bounded process memory", async () => {
    const samples: number[] = [];
    const sampler = setInterval(() => samples.push(process.memoryUsage().heapUsed), 10);
    const before = process.memoryUsage().heapUsed;
    const fetchImpl = fetchFromDisk(path);
    const started = performance.now();
    try {
      const wind = await queryNceiStormEvents(HOUSTON, "2024-05-16", "wind_storm", {
        fetchImpl,
        now: () => NOW,
      });
      expect(wind.kind).toBe("observations");
      if (wind.kind !== "observations") return;
      expect(wind.observations.map((item) => item.provenance.sourceRecordId))
        .toEqual(KNOWN_2024.houston20240516WindEventIds);
      expect(wind.observations).toHaveLength(12);
      for (const observation of wind.observations) {
        expect(observation.provenance.payloadHash).toBe(KNOWN_2024.csvDigest);
      }

      await expect(queryNceiStormEvents(HOUSTON, "2024-07-08", "wind_storm", {
        fetchImpl,
        now: () => NOW,
      })).resolves.toEqual({ kind: "no_observation", publicationFile: FILENAME });
      await expect(queryNceiStormEvents(HOUSTON, "2024-05-16", "flood_storm", {
        fetchImpl,
        now: () => NOW,
      })).resolves.toEqual({ kind: "no_observation", publicationFile: FILENAME });
    } finally {
      clearInterval(sampler);
      samples.push(process.memoryUsage().heapUsed);
    }

    const peakMB = Math.max(...samples) / MB;
    const heapLimitMB = getHeapStatistics().heap_size_limit / MB;
    const wallMs = performance.now() - started;
    console.log(
      `[ncei-real-file] three streaming queries: ${wallMs.toFixed(0)} ms, ` +
      `heapUsed before ${(before / MB).toFixed(0)} MB, peak sampled ${peakMB.toFixed(0)} MB, ` +
      `heap limit ${heapLimitMB.toFixed(0)} MB, maxRSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`
    );
    if (heapLimitMB <= 512) expect(peakMB).toBeLessThan(200);
  }, 120_000);
});
